"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ConversationListItem,
  ConversationListResponse,
  SpeechArtifactListResponse,
  SpeechArtifactRecord,
  SpeechServiceStatusResponse,
  UpdateVoiceProfileRequest,
  VoiceProfileListResponse,
  VoiceProfileRecord,
  WebSpeechTurnResponse,
} from "@secretary/core-runtime";
import { fetchJson } from "../lib/fetch-json";
import {
  ActionRow,
  AppPage,
  EmptyState,
  FieldHint,
  LoadingSurface,
  NoticeBanner,
  StatCard,
  StatGrid,
  SurfaceCard,
} from "../lib/ui";
import { formatTimestamp, snippet } from "../lib/presenters";

type VoiceWorkspaceState = {
  conversations: ConversationListItem[];
  profiles: VoiceProfileRecord[];
};

type ActiveVoiceDraft = {
  name: string;
  engineId: string;
  qualityPreset: string;
  speakingStyle: string;
};

type DiagnosticsState = {
  artifacts: SpeechArtifactRecord[];
  isLoading: boolean;
  isLoaded: boolean;
  selectedConversationId: string;
};

type PushToTalkResult = {
  artifactId: string;
  conversationId: string;
  transcriptText: string;
  replyText: string;
};

type SpeechStatusState = SpeechServiceStatusResponse["services"] | null;

const engines = ["orpheus", "orpheus-fast"] as const;
const qualityPresets = [
  { value: "balanced", label: "Balanced" },
  { value: "clear", label: "Clear" },
  { value: "expressive", label: "Expressive" },
  { value: "gentle", label: "Gentle" },
] as const;
const input = {
  width: "100%",
  borderRadius: 12,
  border: "1px solid var(--field-border)",
  background: "var(--field-bg)",
  color: "var(--text)",
  padding: "10px 12px",
  font: "inherit",
} as const;
const primaryButton = {
  border: "none",
  borderRadius: 999,
  padding: "10px 16px",
  font: "inherit",
  fontWeight: 700,
  color: "#f6fffd",
  background: "linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%)",
} as const;
const ghostButton = {
  border: "1px solid var(--border)",
  borderRadius: 999,
  padding: "10px 16px",
  font: "inherit",
  color: "var(--text)",
  background: "rgba(22, 18, 14, 0.92)",
} as const;

function isAudioMime(mimeType: string | null) {
  return Boolean(mimeType && mimeType.startsWith("audio/"));
}

function buildFileUrl(storageKey: string, mimeType: string | null) {
  const url = new URL("/api/speech/file", window.location.origin);
  url.searchParams.set("storageKey", storageKey);
  if (mimeType) url.searchParams.set("mimeType", mimeType);
  return url.toString();
}

function draftFromProfile(profile: VoiceProfileRecord): ActiveVoiceDraft {
  return {
    name: profile.name,
    engineId: profile.engineId,
    qualityPreset: profile.qualityPreset ?? "",
    speakingStyle: profile.speakingStyle ?? "",
  };
}

export function VoiceConsole() {
  const [state, setState] = useState<VoiceWorkspaceState>({ conversations: [], profiles: [] });
  const [speechStatus, setSpeechStatus] = useState<SpeechStatusState>(null);
  const [draft, setDraft] = useState<ActiveVoiceDraft | null>(null);
  const [clearSampleOnSave, setClearSampleOnSave] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsState>({
    artifacts: [],
    isLoading: false,
    isLoaded: false,
    selectedConversationId: "all",
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "success" | "warning" | "error"; text: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingSample, setIsUploadingSample] = useState(false);
  const [previewText, setPreviewText] = useState(
    "Secretary voice preview. This confirms the active voice path is ready.",
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [recordingConversationId, setRecordingConversationId] = useState("new");
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isSubmittingRecording, setIsSubmittingRecording] = useState(false);
  const [pushToTalkResult, setPushToTalkResult] = useState<PushToTalkResult | null>(null);
  const sampleInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const activeProfile = useMemo(
    () => state.profiles.find((profile) => profile.isActive) ?? state.profiles[0] ?? null,
    [state.profiles],
  );
  const activeVoiceMode = clearSampleOnSave || !activeProfile?.sampleStorageKey ? "default" : "custom";
  const summaryItems = useMemo(
    () => [
      ["Active voice", activeProfile?.name ?? "not set"],
      ["Mode", activeVoiceMode === "custom" ? "custom sample" : "default voice"],
      ["STT", speechStatus?.stt.healthStatus ?? "loading"],
      ["TTS", speechStatus?.tts.healthStatus ?? "loading"],
      ["ffmpeg", speechStatus?.ffmpeg.available ? "ready" : "fallback"],
    ],
    [activeProfile?.name, activeVoiceMode, speechStatus],
  );
  const readinessNotes = useMemo(() => {
    const notes: Array<{ tone: "warning" | "info"; text: string }> = [];

    if (!speechStatus?.stt || speechStatus.stt.healthStatus !== "ok") {
      notes.push({
        tone: "warning",
        text: "Speech-to-text is not fully ready, so browser and Telegram voice transcription may fail.",
      });
    }

    if (!speechStatus?.tts || speechStatus.tts.healthStatus !== "ok") {
      notes.push({
        tone: "warning",
        text: "Text-to-speech is not fully ready, so previews and spoken replies may fail.",
      });
    }

    if (!speechStatus?.ffmpeg.available) {
      notes.push({
        tone: "info",
        text: "ffmpeg is unavailable, so Telegram will fall back to normal audio attachments instead of voice-note bubbles.",
      });
    }

    if (activeVoiceMode === "default") {
      notes.push({
        tone: "info",
        text: "No custom sample is active right now, so the secretary is using the selected engine's built-in voice.",
      });
    }

    return notes;
  }, [activeVoiceMode, speechStatus]);

  useEffect(() => {
    void refreshCore();

    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function refreshCore() {
    setIsLoading(true);
    setError(null);
    try {
      const [profilesPayload, conversationsPayload, statusPayload] = await Promise.all([
        fetchJson<VoiceProfileListResponse>("/api/voice/profiles", { cache: "no-store" }),
        fetchJson<ConversationListResponse>("/api/conversations", { cache: "no-store" }),
        fetchJson<SpeechServiceStatusResponse>("/api/speech/status", { cache: "no-store" }),
      ]);

      const profiles = profilesPayload.profiles;
      const conversations = conversationsPayload.conversations;
      const active = profiles.find((profile) => profile.isActive) ?? profiles[0] ?? null;

      setState({ profiles, conversations });
      setSpeechStatus(statusPayload.services);
      setDraft(active ? draftFromProfile(active) : null);
      setClearSampleOnSave(false);
      if (recordingConversationId !== "new" && !conversations.some((conversation) => conversation.id === recordingConversationId)) {
        setRecordingConversationId("new");
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load the voice workspace.");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadDiagnostics(conversationId = diagnostics.selectedConversationId) {
    setDiagnostics((current) => ({ ...current, isLoading: true }));
    try {
      const artifactsUrl =
        conversationId === "all"
          ? "/api/speech/artifacts"
          : `/api/speech/artifacts?conversationId=${encodeURIComponent(conversationId)}`;
      const payload = await fetchJson<SpeechArtifactListResponse>(artifactsUrl, { cache: "no-store" });
      setDiagnostics({
        artifacts: payload.artifacts,
        isLoading: false,
        isLoaded: true,
        selectedConversationId: conversationId,
      });
    } catch (loadError) {
      setDiagnostics((current) => ({ ...current, isLoading: false }));
      setError(loadError instanceof Error ? loadError.message : "Unable to load recent speech activity.");
    }
  }

  async function saveActiveVoice() {
    if (!activeProfile || !draft) {
      setError("No active voice profile is available yet.");
      return;
    }
    if (!draft.name.trim()) {
      setError("Voice label is required.");
      return;
    }
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const request: UpdateVoiceProfileRequest = {
        name: draft.name.trim(),
        engineId: draft.engineId.trim(),
        qualityPreset: draft.qualityPreset.trim() || null,
        speakingStyle: draft.speakingStyle.trim() || null,
        isActive: true,
        clearSample: clearSampleOnSave,
      };
      const response = await fetch(`/api/voice/profiles/${activeProfile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to save the active voice.");
      }
      setNotice({
        tone: "success",
        text: request.clearSample
          ? "The secretary is back on the default engine voice."
          : "Active voice settings saved.",
      });
      await refreshCore();
      if (diagnosticsOpen && diagnostics.isLoaded) {
        await loadDiagnostics(diagnostics.selectedConversationId);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save the active voice.");
    } finally {
      setIsSaving(false);
    }
  }

  async function uploadSample(file: File) {
    if (!activeProfile) {
      setError("No active voice profile is available yet.");
      return;
    }
    if (!file.type.startsWith("audio/")) {
      setError("Voice samples must be audio files.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError("Voice samples must be 15 MB or smaller.");
      return;
    }
    setIsUploadingSample(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.set("file", file, file.name);
      const response = await fetch(`/api/voice/profiles/${activeProfile.id}/sample`, {
        method: "POST",
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to upload the voice sample.");
      }
      setClearSampleOnSave(false);
      setNotice({
        tone: "success",
        text: "Custom sample uploaded. Save the voice if you want these settings to become the active path.",
      });
      await refreshCore();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload the voice sample.");
    } finally {
      setIsUploadingSample(false);
    }
  }

  async function previewVoice() {
    if (!previewText.trim()) {
      setError("Preview text is required.");
      return;
    }
    setIsPreviewing(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/voice/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: previewText.trim(),
          profileId: activeProfile?.id ?? null,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Unable to generate voice preview." }));
        throw new Error(payload.error ?? "Unable to generate voice preview.");
      }
      const blob = await response.blob();
      const nextUrl = URL.createObjectURL(blob);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(nextUrl);
      setNotice({
        tone: "success",
        text: "Preview generated with the active secretary voice settings.",
      });
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Voice preview failed.");
    } finally {
      setIsPreviewing(false);
    }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordingError("This browser does not support microphone capture.");
      return;
    }
    setRecordingError(null);
    setPushToTalkResult(null);
    setNotice(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const recorder = preferredMimeType ? new MediaRecorder(stream, { mimeType: preferredMimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const recording = chunksRef.current.slice();
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        chunksRef.current = [];
        if (recording.length === 0) return;
        const mimeType = recording[0]?.type || recorder.mimeType || "audio/webm";
        const blob = new Blob(recording, { type: mimeType });
        void submitRecording(blob, mimeType);
      };
      recorder.start();
      setIsRecording(true);
    } catch (recordError) {
      setRecordingError(recordError instanceof Error ? recordError.message : "Microphone capture failed.");
    }
  }

  function stopRecording() {
    if (!recorderRef.current) return;
    setIsRecording(false);
    recorderRef.current.stop();
  }

  async function submitRecording(blob: Blob, mimeType: string) {
    setIsSubmittingRecording(true);
    setRecordingError(null);
    try {
      const extension =
        mimeType.includes("ogg")
          ? "ogg"
          : mimeType.includes("mpeg")
            ? "mp3"
            : mimeType.includes("wav")
              ? "wav"
              : "webm";
      const form = new FormData();
      form.set("audio", blob, `voice-console-recording.${extension}`);
      if (recordingConversationId !== "new") form.set("conversationId", recordingConversationId);
      const response = await fetch("/api/speech/web-turn", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as WebSpeechTurnResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to process voice turn.");
      setPushToTalkResult({
        artifactId: payload.artifactId,
        conversationId: payload.reply.conversationId,
        transcriptText: payload.transcriptText,
        replyText: payload.reply.outputText,
      });
      setNotice({
        tone: "success",
        text: "Voice turn transcribed and routed through the secretary successfully.",
      });
      setRecordingConversationId(payload.reply.conversationId);
      if (diagnosticsOpen) {
        await loadDiagnostics(payload.reply.conversationId);
      }
    } catch (submitError) {
      setRecordingError(
        submitError instanceof Error ? submitError.message : "Voice turn submission failed.",
      );
    } finally {
      setIsSubmittingRecording(false);
    }
  }

  return (
    <AppPage width="1240px">
      {isLoading && !speechStatus && state.profiles.length === 0 ? (
        <LoadingSurface
          title="Preparing the voice path"
          description={
            <p>
              Checking speech services, active profile state, and the latest voice workspace so the
              page opens with one reliable speaking path.
            </p>
          }
          blocks={3}
        />
      ) : null}

      <SurfaceCard
        tone="dark"
        title="Voice"
        description={
          <p>
            Keep one reliable speaking voice for the secretary, test it quickly, and only open
            deeper diagnostics when you actually need them.
          </p>
        }
      >
        <ActionRow align="between">
          <p style={{ margin: 0, color: "var(--muted)", maxWidth: 760 }}>
            Keep the active voice path simple: one engine, one optional sample, one place to test
            what the secretary will sound like.
          </p>

          <button
            type="button"
            onClick={() => void refreshCore()}
            style={{ ...primaryButton, cursor: isLoading ? "wait" : "pointer" }}
          >
            {isLoading ? "Refreshing..." : "Refresh"}
          </button>
        </ActionRow>

        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.55 }}>
          {error ??
            (isLoading
              ? "Checking the active voice path, service readiness, and current speech workspace..."
              : activeProfile
                ? `Active voice: ${activeProfile.name} via ${activeProfile.engineId}.`
                : "No active voice is available yet.")}
        </p>
        <StatGrid>
          {summaryItems.map(([label, value]) => (
            <StatCard key={String(label)} label={String(label)} value={String(value)} tone="soft" />
          ))}
        </StatGrid>
      </SurfaceCard>

      {notice ? (
        <NoticeBanner
          tone={
            notice.tone === "warning"
              ? "warning"
              : notice.tone === "error"
                ? "error"
                : notice.tone === "success"
                  ? "success"
                  : "info"
          }
        >
          {notice.text}
        </NoticeBanner>
      ) : null}

      {readinessNotes.length > 0 ? (
        <div className="stack-sm">
          {readinessNotes.map((note) => (
            <NoticeBanner key={note.text} tone={note.tone === "warning" ? "warning" : "info"}>
              {note.text}
            </NoticeBanner>
          ))}
        </div>
      ) : null}

      <section
        style={{
          display: "grid",
          gap: 20,
          gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.95fr)",
        }}
      >
        <SurfaceCard
          tone="soft"
          title="Active voice"
          description={
            <p>
              Keep one voice path active. Use the engine’s default voice or add a custom sample if
              you want cloning.
            </p>
          }
        >
          {!activeProfile || !draft ? (
            <EmptyState
              title="No active voice yet"
              description={<p>The worker has not prepared an active voice profile yet.</p>}
              tone="warm"
            />
          ) : (
            <div className="stack-md">
              <div
                style={{
                  display: "grid",
                  gap: 12,
                  gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.1fr)",
                }}
              >
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--accent)" }}>
                    Voice label
                  </span>
                  <input
                    value={draft.name}
                    onChange={(event) => setDraft((current) => (current ? { ...current, name: event.target.value } : current))}
                    placeholder="Secretary voice"
                    style={input}
                  />
                  <FieldHint>This is just the local label for the one active voice path.</FieldHint>
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--accent)" }}>
                    Engine
                  </span>
                  <select
                    value={draft.engineId}
                    onChange={(event) => setDraft((current) => (current ? { ...current, engineId: event.target.value } : current))}
                    style={input}
                  >
                    {engines.map((engine) => (
                      <option key={engine} value={engine}>
                        {engine}
                      </option>
                    ))}
                  </select>
                  <FieldHint>The active engine voice is used whenever you are not cloning from a sample.</FieldHint>
                </label>
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 12,
                  gridTemplateColumns: "minmax(0, 0.75fr) minmax(0, 1.25fr)",
                }}
              >
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--accent)" }}>
                    Quality preset
                  </span>
                  <select
                    value={draft.qualityPreset || "balanced"}
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, qualityPreset: event.target.value } : current,
                      )
                    }
                    style={input}
                  >
                    {qualityPresets.map((preset) => (
                      <option key={preset.value} value={preset.value}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  <FieldHint>Choose a known preset instead of typing free-form engine tuning.</FieldHint>
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--accent)" }}>
                    Speaking style
                  </span>
                  <input
                    value={draft.speakingStyle}
                    onChange={(event) => setDraft((current) => (current ? { ...current, speakingStyle: event.target.value } : current))}
                    placeholder="Warm, poised, and clear"
                    style={input}
                  />
                  <FieldHint>Short traits work best here: calm, warm, direct, clear.</FieldHint>
                </label>
              </div>

              <div className="section-rule" />

              <div className="stack-sm">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ display: "grid", gap: 4 }}>
                    <p style={{ margin: 0, fontWeight: 700 }}>
                      {activeVoiceMode === "custom" ? "Custom sample active" : "Default voice active"}
                    </p>
                    <FieldHint>
                      Upload one clean sample if you want cloning. Otherwise the secretary will use
                      the selected engine’s default voice.
                    </FieldHint>
                  </div>

                  <ActionRow align="start">
                    <input
                      ref={sampleInputRef}
                      type="file"
                      accept="audio/*"
                      style={{ display: "none" }}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadSample(file);
                        event.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => sampleInputRef.current?.click()}
                      disabled={isUploadingSample}
                      style={{ ...ghostButton, cursor: isUploadingSample ? "wait" : "pointer" }}
                    >
                      {isUploadingSample
                        ? "Uploading..."
                        : activeProfile.sampleStorageKey && !clearSampleOnSave
                          ? "Replace sample"
                          : "Upload sample"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setClearSampleOnSave(true)}
                      disabled={activeVoiceMode === "default"}
                      style={{ ...ghostButton, cursor: activeVoiceMode === "default" ? "not-allowed" : "pointer" }}
                    >
                      Use default voice
                    </button>
                  </ActionRow>
                </div>

                {activeProfile.sampleStorageKey && !clearSampleOnSave ? (
                  <audio
                    controls
                    src={buildFileUrl(activeProfile.sampleStorageKey, activeProfile.sampleMimeType)}
                    style={{ width: "100%" }}
                  />
                ) : (
                  <EmptyState
                    title="No custom sample loaded"
                    description={
                      <p>
                        The voice page is running in the lightest setup: one active profile and the
                        engine’s built-in voice. Add a sample only if you want cloning.
                      </p>
                    }
                    tone="warm"
                  />
                )}

                <FieldHint>
                  Best results usually come from a clean 10 to 60 second sample with one speaker,
                  little background noise, and no music underneath.
                </FieldHint>
              </div>

              <ActionRow>
                <button
                  type="button"
                  onClick={() => void saveActiveVoice()}
                  disabled={isSaving}
                  style={{ ...primaryButton, cursor: isSaving ? "wait" : "pointer" }}
                >
                  {isSaving ? "Saving..." : "Save voice"}
                </button>
              </ActionRow>
            </div>
          )}
        </SurfaceCard>

        <SurfaceCard
          tone="soft"
          title="Speech testing"
          description={
            <p>
              Test the active voice quickly, then send a browser push-to-talk turn through the same
              transcription path used for real voice messages.
            </p>
          }
        >
          <div className="stack-md">
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--accent)" }}>
                Preview script
              </span>
              <textarea
                value={previewText}
                onChange={(event) => setPreviewText(event.target.value)}
                rows={5}
                style={{ ...input, resize: "vertical" }}
              />
              <FieldHint>
                Preview audio is generated on demand and is not kept as long-term artifact clutter.
              </FieldHint>
            </label>

            <ActionRow>
              <button
                type="button"
                onClick={() => void previewVoice()}
                disabled={isPreviewing}
                style={{ ...primaryButton, cursor: isPreviewing ? "wait" : "pointer" }}
              >
                {isPreviewing ? "Synthesizing..." : "Generate preview"}
              </button>
            </ActionRow>

            {previewUrl ? <audio controls src={previewUrl} style={{ width: "100%" }} /> : null}

            <div className="section-rule" />

            <div className="stack-sm">
              <h3 style={{ margin: 0, fontSize: 18 }}>Browser push to talk</h3>
              <FieldHint>
                This records in the browser, transcribes through STT, and sends the text through the
                normal secretary chat path.
              </FieldHint>
              <select
                value={recordingConversationId}
                onChange={(event) => setRecordingConversationId(event.target.value)}
                style={input}
              >
                <option value="new">new conversation</option>
                {state.conversations.map((conversation) => (
                  <option key={conversation.id} value={conversation.id}>
                    {conversation.title ?? snippet(conversation.lastMessagePreview)}
                  </option>
                ))}
              </select>
              <ActionRow align="start">
                <button
                  type="button"
                  onClick={() => void startRecording()}
                  disabled={isRecording || isSubmittingRecording}
                  style={{
                    ...ghostButton,
                    cursor: isRecording || isSubmittingRecording ? "not-allowed" : "pointer",
                  }}
                >
                  {isSubmittingRecording ? "Submitting..." : "Start recording"}
                </button>
                <button
                  type="button"
                  onClick={stopRecording}
                  disabled={!isRecording}
                  style={{
                    ...primaryButton,
                    cursor: isRecording ? "pointer" : "not-allowed",
                    background: "linear-gradient(135deg, var(--warning) 0%, var(--danger) 100%)",
                  }}
                >
                  Stop and send
                </button>
              </ActionRow>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
                {recordingError ??
                  (isRecording
                    ? "Recording now. Stop when you want to send the turn."
                    : "Use this for a full voice-path test, not just a synthetic preview.")}
              </p>
              {pushToTalkResult ? (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 14,
                    border: "1px solid var(--success-soft-border)",
                    background: "var(--success-soft-bg)",
                    display: "grid",
                    gap: 8,
                  }}
                >
                  <p style={{ margin: 0, fontWeight: 700 }}>Transcript: {pushToTalkResult.transcriptText}</p>
                  <p style={{ margin: 0, color: "var(--muted)" }}>Reply: {pushToTalkResult.replyText}</p>
                  <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                    conversation {pushToTalkResult.conversationId} · artifact {pushToTalkResult.artifactId}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </SurfaceCard>
      </section>

      <SurfaceCard
        tone="soft"
        title="Diagnostics"
        description={
          <p>
            Open this only when you want to inspect recent speech files or service readiness. It
            stays out of the way during normal use.
          </p>
        }
      >
        <details
          open={diagnosticsOpen}
          onToggle={(event) => {
            const nextOpen = event.currentTarget.open;
            setDiagnosticsOpen(nextOpen);
            if (nextOpen && !diagnostics.isLoaded && !diagnostics.isLoading) {
              void loadDiagnostics();
            }
          }}
        >
          <summary style={{ cursor: "pointer", fontWeight: 700, color: "var(--accent)" }}>
            {diagnosticsOpen ? "Hide diagnostics" : "Open diagnostics"}
          </summary>
          <div className="stack-md" style={{ marginTop: 16 }}>
            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.1fr)",
                alignItems: "end",
              }}
            >
              <div className="compact-list">
                {[
                  ["STT", speechStatus?.stt.summary ?? "loading"],
                  ["TTS", speechStatus?.tts.summary ?? "loading"],
                  ["ffmpeg", speechStatus?.ffmpeg.summary ?? "loading"],
                ].map(([label, value]) => (
                  <div key={label} style={{ padding: "10px 0", display: "grid", gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--accent)" }}>
                      {label}
                    </span>
                    <span style={{ color: "var(--muted)", fontSize: 13 }}>{value}</span>
                  </div>
                ))}
              </div>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--accent)" }}>
                  Artifact scope
                </span>
                <select
                  value={diagnostics.selectedConversationId}
                  onChange={(event) => void loadDiagnostics(event.target.value)}
                  style={input}
                >
                  <option value="all">all conversations</option>
                  {state.conversations.map((conversation) => (
                    <option key={conversation.id} value={conversation.id}>
                      {conversation.title ?? snippet(conversation.lastMessagePreview)}
                    </option>
                  ))}
                </select>
                <FieldHint>
                  Missing files are filtered out automatically, so this list only shows playable
                  recent audio that still exists on disk.
                </FieldHint>
              </label>
            </div>

            {diagnostics.isLoading ? (
              <EmptyState
                title="Loading recent speech activity"
                description={<p>Pulling the latest transcripts, recordings, and spoken replies.</p>}
              />
            ) : diagnostics.artifacts.length === 0 ? (
              <EmptyState
                title="No recent speech activity in this view"
                description={<p>Once you run previews or voice turns, the recent surviving artifacts will appear here.</p>}
                tone="warm"
              />
            ) : (
              <div className="compact-list">
                {diagnostics.artifacts.map((artifact) => (
                  <div key={artifact.id} style={{ padding: "12px 0", display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <p style={{ margin: 0, color: "var(--accent)", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        {artifact.artifactKind}
                      </p>
                      <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
                        {formatTimestamp(artifact.createdAt)}
                      </p>
                    </div>
                    <p style={{ margin: 0, fontWeight: 700 }}>{artifact.status}</p>
                    <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                      {artifact.transcriptText
                        ? snippet(artifact.transcriptText, 180)
                        : `${artifact.sourceChannel} · ${artifact.sourceRef ?? "n/a"}`}
                    </p>
                    {isAudioMime(artifact.mimeType) ? (
                      <audio
                        controls
                        src={buildFileUrl(artifact.storageKey, artifact.mimeType)}
                        style={{ width: "100%" }}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      </SurfaceCard>
    </AppPage>
  );
}
