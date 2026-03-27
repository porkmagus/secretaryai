"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ConversationListItem,
  ConversationListResponse,
  CreateVoiceProfileRequest,
  SpeechArtifactListResponse,
  SpeechArtifactRecord,
  SpeechServiceStatusResponse,
  VoiceProfileListResponse,
  VoiceProfileRecord,
  WebSpeechTurnResponse,
} from "@secretary/core-runtime";
import { AppPage, EmptyState, NoticeBanner, SurfaceCard, ToggleField } from "../lib/ui";
import { formatTimestamp, snippet } from "../lib/presenters";

type VoicePageState = {
  conversations: ConversationListItem[];
  profiles: VoiceProfileRecord[];
  artifacts: SpeechArtifactRecord[];
};

type EditableProfile = {
  name: string;
  engineId: string;
  qualityPreset: string;
  speakingStyle: string;
  isActive: boolean;
};

type PushToTalkResult = {
  artifactId: string;
  conversationId: string;
  transcriptText: string;
  replyText: string;
};

type SpeechStatusState = SpeechServiceStatusResponse["services"] | null;

const engines = ["chatterbox", "chatterbox-turbo", "chatterbox-multilingual"] as const;
const panel = { border: "1px solid var(--border)", borderRadius: 20, background: "var(--panel-strong)", padding: 18 } as const;
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

function draftFromProfile(profile: VoiceProfileRecord): EditableProfile {
  return {
    name: profile.name,
    engineId: profile.engineId,
    qualityPreset: profile.qualityPreset ?? "",
    speakingStyle: profile.speakingStyle ?? "",
    isActive: profile.isActive,
  };
}

function toneColor(tone: "info" | "success" | "warning" | "error") {
  switch (tone) {
    case "success":
      return "var(--success-soft-text)";
    case "warning":
      return "var(--warning-soft-text)";
    case "error":
      return "var(--danger-soft-text)";
    default:
      return "var(--muted)";
  }
}

export function VoiceConsole() {
  const [state, setState] = useState<VoicePageState>({ conversations: [], profiles: [], artifacts: [] });
  const [speechStatus, setSpeechStatus] = useState<SpeechStatusState>(null);
  const [drafts, setDrafts] = useState<Record<string, EditableProfile>>({});
  const [selectedConversationId, setSelectedConversationId] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "success" | "warning" | "error"; text: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);
  const [uploadingProfileId, setUploadingProfileId] = useState<string | null>(null);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [createForm, setCreateForm] = useState<CreateVoiceProfileRequest>({ name: "", engineId: "chatterbox", qualityPreset: "balanced", speakingStyle: "warm and clear", isActive: false });
  const [previewText, setPreviewText] = useState("Secretary voice preview. This confirms the local cloned voice path is ready.");
  const [previewProfileId, setPreviewProfileId] = useState("active");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewArtifactId, setPreviewArtifactId] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [recordingConversationId, setRecordingConversationId] = useState("new");
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isSubmittingRecording, setIsSubmittingRecording] = useState(false);
  const [pushToTalkResult, setPushToTalkResult] = useState<PushToTalkResult | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const sampleInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const activeProfile = useMemo(() => state.profiles.find((profile) => profile.isActive) ?? state.profiles[0] ?? null, [state.profiles]);
  const summary = useMemo(() => ({
    profiles: state.profiles.length,
    samples: state.profiles.filter((profile) => profile.sampleStorageKey).length,
    transcripts: state.artifacts.filter((artifact) => artifact.transcriptText).length,
    tts: state.artifacts.filter((artifact) => artifact.artifactKind === "tts_output").length,
  }), [state.artifacts, state.profiles]);
  const readinessNotes = useMemo(() => {
    const notes: Array<{ tone: "warning" | "info"; text: string }> = [];

    if (!speechStatus?.stt || speechStatus.stt.healthStatus !== "ok") {
      notes.push({
        tone: "warning",
        text: "STT is not fully ready, so browser speech and Telegram voice-note transcription may fail.",
      });
    }

    if (!speechStatus?.tts || speechStatus.tts.healthStatus !== "ok") {
      notes.push({
        tone: "warning",
        text: "TTS is not fully ready, so previews and spoken replies may fail.",
      });
    }

    if (!speechStatus?.ffmpeg.available) {
      notes.push({
        tone: "info",
        text: "ffmpeg is unavailable, so Telegram will fall back to normal audio attachments instead of voice-note bubbles.",
      });
    }

    if (activeProfile && !activeProfile.sampleStorageKey) {
      notes.push({
        tone: "info",
        text: "The active voice profile has no uploaded sample yet, so Secretary is using the engine's default voice character.",
      });
    }

    return notes;
  }, [activeProfile, speechStatus]);

  useEffect(() => {
    void refresh("all");
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function refresh(conversationId = selectedConversationId) {
    setIsLoading(true);
    setError(null);
    try {
      const artifactsUrl = conversationId === "all" ? "/api/speech/artifacts" : `/api/speech/artifacts?conversationId=${encodeURIComponent(conversationId)}`;
      const [profilesResponse, artifactsResponse, conversationsResponse, statusResponse] = await Promise.all([
        fetch("/api/voice/profiles", { cache: "no-store" }),
        fetch(artifactsUrl, { cache: "no-store" }),
        fetch("/api/conversations", { cache: "no-store" }),
        fetch("/api/speech/status", { cache: "no-store" }),
      ]);
      const [profilesPayload, artifactsPayload, conversationsPayload, statusPayload] = await Promise.all([
        profilesResponse.json(),
        artifactsResponse.json(),
        conversationsResponse.json(),
        statusResponse.json(),
      ]);
      if (!profilesResponse.ok) throw new Error(profilesPayload.error ?? "Unable to load voice profiles.");
      if (!artifactsResponse.ok) throw new Error(artifactsPayload.error ?? "Unable to load speech artifacts.");
      if (!conversationsResponse.ok) throw new Error(conversationsPayload.error ?? "Unable to load conversations.");
      if (!statusResponse.ok) throw new Error(statusPayload.error ?? "Unable to load speech service status.");
      const profiles = (profilesPayload as VoiceProfileListResponse).profiles;
      setState({
        profiles,
        artifacts: (artifactsPayload as SpeechArtifactListResponse).artifacts,
        conversations: (conversationsPayload as ConversationListResponse).conversations,
      });
      setSpeechStatus((statusPayload as SpeechServiceStatusResponse).services);
      setDrafts((current) => {
        const next = { ...current };
        for (const profile of profiles) next[profile.id] = current[profile.id] ?? draftFromProfile(profile);
        return next;
      });
      setSelectedConversationId(conversationId);
      if (previewProfileId !== "active" && !profiles.some((profile) => profile.id === previewProfileId)) setPreviewProfileId("active");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load voice workspace.");
    } finally {
      setIsLoading(false);
    }
  }

  function updateDraft(profileId: string, patch: Partial<EditableProfile>) {
    setDrafts((current) => ({ ...current, [profileId]: { ...current[profileId], ...patch } }));
  }

  function openSamplePicker(profileId: string) {
    sampleInputRefs.current[profileId]?.click();
  }

  async function createProfile() {
    if (!createForm.name.trim()) {
      setError("Voice profile name is required.");
      return;
    }
    setCreatingProfile(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/voice/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...createForm,
          name: createForm.name.trim(),
          qualityPreset: createForm.qualityPreset?.trim() || null,
          speakingStyle: createForm.speakingStyle?.trim() || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to create voice profile.");
      setCreateForm({ name: "", engineId: "chatterbox", qualityPreset: "balanced", speakingStyle: "warm and clear", isActive: false });
      setNotice({
        tone: createForm.isActive ? "success" : "info",
        text: createForm.isActive
          ? "Voice profile created and made active."
          : "Voice profile created.",
      });
      await refresh(selectedConversationId);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Voice profile creation failed.");
    } finally {
      setCreatingProfile(false);
    }
  }

  async function saveProfile(profile: VoiceProfileRecord) {
    const draft = drafts[profile.id];
    if (!draft) return;
    setSavingProfileId(profile.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/voice/profiles/${profile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          engineId: draft.engineId.trim(),
          qualityPreset: draft.qualityPreset.trim() || null,
          speakingStyle: draft.speakingStyle.trim() || null,
          isActive: draft.isActive,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to update voice profile.");
      setNotice({
        tone: draft.isActive ? "success" : "info",
        text: draft.isActive
          ? `${draft.name || profile.name} is now the active Secretary voice.`
          : `${draft.name || profile.name} was updated.`,
      });
      await refresh(selectedConversationId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Voice profile update failed.");
    } finally {
      setSavingProfileId(null);
    }
  }

  async function uploadSample(profile: VoiceProfileRecord, file: File) {
    if (!file.type.startsWith("audio/")) {
      setError("Voice samples must be audio files.");
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      setError("Voice samples must be 15 MB or smaller.");
      return;
    }

    setUploadingProfileId(profile.id);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.set("file", file, file.name);
      const response = await fetch(`/api/voice/profiles/${profile.id}/sample`, {
        method: "POST",
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to upload voice sample.");
      setNotice({
        tone: "success",
        text: `Sample uploaded for ${profile.name}. Save or activate the profile if you want Secretary to speak with it.`,
      });
      await refresh(selectedConversationId);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Voice sample upload failed.");
    } finally {
      setUploadingProfileId(null);
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
          profileId: previewProfileId === "active" ? null : previewProfileId,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Unable to generate preview." }));
        throw new Error(payload.error ?? "Unable to generate preview.");
      }
      const blob = await response.blob();
      const nextUrl = URL.createObjectURL(blob);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(nextUrl);
      setPreviewArtifactId(response.headers.get("X-Secretary-Artifact-Id"));
      setNotice({
        tone: "success",
        text:
          previewProfileId === "active"
            ? "Preview generated with the active Secretary voice."
            : "Preview generated for the selected voice profile.",
      });
      await refresh(selectedConversationId);
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
      const extension = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mpeg") ? "mp3" : "webm";
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
        text: "Browser speech turn transcribed and routed through Secretary successfully.",
      });
      setRecordingConversationId(payload.reply.conversationId);
      await refresh(payload.reply.conversationId);
    } catch (submitError) {
      setRecordingError(submitError instanceof Error ? submitError.message : "Voice turn submission failed.");
    } finally {
      setIsSubmittingRecording(false);
    }
  }

  return (
    <AppPage width="1240px">
      <SurfaceCard
        tone="dark"
        title="Voice"
        description={<p>Manage the speaking voice, test it quickly, and keep the speech pipeline readable from one place.</p>}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div className="persona-summary-strip">
            {[
              ["Active", activeProfile?.name ?? "none"],
              ["Profiles", summary.profiles],
              ["Samples", summary.samples],
              ["STT", speechStatus?.stt.healthStatus ?? "loading"],
              ["TTS", speechStatus?.tts.healthStatus ?? "loading"],
              ["ffmpeg", speechStatus?.ffmpeg.available ? "ready" : "fallback"],
            ].map(([label, value], index) => (
              <div key={String(label)} className="persona-summary-item">
                <span className="summary-chip-label" style={{ whiteSpace: "nowrap", fontSize: 9 }}>
                  {label}
                </span>
                <span
                  className="summary-chip-value"
                  style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                >
                  {value}
                </span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" onClick={() => void refresh(selectedConversationId)} style={{ ...primaryButton, cursor: "pointer" }}>
              {isLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.55 }}>
          {error ??
            (isLoading
              ? "Loading voice workspace..."
              : activeProfile
                ? `Active profile: ${activeProfile.name} via ${activeProfile.engineId}.`
                : "No voice profile found yet.")}
        </p>
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

      <section style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0, 1.5fr) minmax(320px, 0.95fr)" }}>
          <div style={{ display: "grid", gap: 20, alignContent: "start" }}>
            <article style={{ ...panel, display: "grid", gap: 12 }}>
              <h2 style={{ margin: 0 }}>Profile manager</h2>
              <p style={{ margin: 0, color: "var(--muted)" }}>
                {activeProfile?.name ?? "No active profile"} · {activeProfile?.speakingStyle ?? "no style yet"}
              </p>
              {activeProfile?.sampleStorageKey ? (
                <audio controls src={buildFileUrl(activeProfile.sampleStorageKey, activeProfile.sampleMimeType)} style={{ width: "100%" }} />
              ) : (
                <p style={{ margin: 0, color: "var(--muted)" }}>Upload a sample to shape this voice.</p>
              )}
              <div className="section-rule" />
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                Create a fresh profile for testing before you make it the active Secretary voice.
              </p>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                <input value={createForm.name} onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))} placeholder="Voice profile name" style={input} />
                <select value={createForm.engineId} onChange={(event) => setCreateForm((current) => ({ ...current, engineId: event.target.value }))} style={input}>
                  {engines.map((engine) => <option key={engine} value={engine}>{engine}</option>)}
                </select>
                <input value={createForm.qualityPreset ?? ""} onChange={(event) => setCreateForm((current) => ({ ...current, qualityPreset: event.target.value }))} placeholder="quality preset" style={input} />
                <input value={createForm.speakingStyle ?? ""} onChange={(event) => setCreateForm((current) => ({ ...current, speakingStyle: event.target.value }))} placeholder="speaking style" style={input} />
              </div>
              <ToggleField
                checked={Boolean(createForm.isActive)}
                onChange={(next) => setCreateForm((current) => ({ ...current, isActive: next }))}
                label="Make active immediately"
                hint="Useful when this profile is intended to replace the current voice right away."
              />
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>New profiles stay local until you save and activate them.</p>
                <button type="button" onClick={() => void createProfile()} disabled={creatingProfile} style={{ ...primaryButton, cursor: creatingProfile ? "wait" : "pointer" }}>
                  {creatingProfile ? "Creating..." : "Create Profile"}
                </button>
              </div>
              <div className="section-rule" />
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                <h3 style={{ margin: 0, fontSize: 18 }}>Saved profiles</h3>
                <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                  {state.profiles.length} profile{state.profiles.length === 1 ? "" : "s"} on disk
                </p>
              </div>
              {state.profiles.length === 0 ? (
                <EmptyState
                  title="No saved voice profiles yet"
                  description={<p>Create a profile above to give the secretary a speaking voice and store its sample.</p>}
                />
              ) : (
                <div className="compact-list">
                  {state.profiles.map((profile) => {
                    const draft = drafts[profile.id];
                    if (!draft) return null;
                    return (
                      <div key={profile.id} style={{ display: "grid", gap: 10, padding: "12px 0" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                          <div>
                            <p style={{ margin: 0, color: "var(--accent)", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                              {profile.isActive ? "Active profile" : "Voice profile"}
                            </p>
                            <p style={{ margin: "6px 0 0", fontWeight: 700, fontSize: 16 }}>{profile.name}</p>
                          </div>
                          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>{formatTimestamp(profile.updatedAt)}</p>
                        </div>
                        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                          <input value={draft.name} onChange={(event) => updateDraft(profile.id, { name: event.target.value })} placeholder="name" style={input} />
                          <select value={draft.engineId} onChange={(event) => updateDraft(profile.id, { engineId: event.target.value })} style={input}>
                            {engines.map((engine) => <option key={engine} value={engine}>{engine}</option>)}
                          </select>
                          <input value={draft.qualityPreset} onChange={(event) => updateDraft(profile.id, { qualityPreset: event.target.value })} placeholder="quality preset" style={input} />
                          <input value={draft.speakingStyle} onChange={(event) => updateDraft(profile.id, { speakingStyle: event.target.value })} placeholder="speaking style" style={input} />
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                          <ToggleField
                            checked={draft.isActive}
                            onChange={(next) => updateDraft(profile.id, { isActive: next })}
                            label="Make active"
                            hint="Switch Secretary to this profile on save."
                          />
                          <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                              <input
                                ref={(element) => {
                                  sampleInputRefs.current[profile.id] = element;
                                }}
                                type="file"
                                accept="audio/*"
                                style={{ display: "none" }}
                                onChange={(event) => {
                                  const file = event.target.files?.[0];
                                  if (file) void uploadSample(profile, file);
                                  event.target.value = "";
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => openSamplePicker(profile.id)}
                                disabled={uploadingProfileId === profile.id}
                                style={{ ...ghostButton, cursor: uploadingProfileId === profile.id ? "wait" : "pointer" }}
                              >
                                {uploadingProfileId === profile.id ? "Uploading..." : "Upload Sample"}
                              </button>
                            <button type="button" onClick={() => void saveProfile(profile)} disabled={savingProfileId === profile.id} style={{ ...primaryButton, cursor: savingProfileId === profile.id ? "wait" : "pointer" }}>
                              {savingProfileId === profile.id ? "Saving..." : "Save"}
                            </button>
                            </div>
                            <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, lineHeight: 1.45, maxWidth: 320, textAlign: "right" }}>
                              Audio only, up to 15 MB. A clean 10 to 60 second voice sample usually works best.
                            </p>
                          </div>
                        </div>
                        {profile.sampleStorageKey ? (
                          <audio controls src={buildFileUrl(profile.sampleStorageKey, profile.sampleMimeType)} style={{ width: "100%" }} />
                        ) : (
                          <EmptyState
                            title="No sample uploaded yet"
                            description={<p>Upload a reference sample if you want this profile to sound like a specific voice.</p>}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </article>
          </div>

          <aside style={{ display: "grid", gap: 20, alignContent: "start" }}>
            <article style={{ ...panel, display: "grid", gap: 12 }}>
              <h2 style={{ margin: 0 }}>Speech testing</h2>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                Preview the current voice, then run browser push-to-talk through the same speech path.
              </p>
              <select value={previewProfileId} onChange={(event) => setPreviewProfileId(event.target.value)} style={input}>
                <option value="active">active profile</option>
                {state.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
              <textarea value={previewText} onChange={(event) => setPreviewText(event.target.value)} rows={5} style={{ ...input, resize: "vertical" }} />
              <button type="button" onClick={() => void previewVoice()} disabled={isPreviewing} style={{ ...primaryButton, cursor: isPreviewing ? "wait" : "pointer" }}>
                {isPreviewing ? "Synthesizing..." : "Generate Preview"}
              </button>
              {previewUrl ? (
                <>
                  <audio controls src={previewUrl} style={{ width: "100%" }} />
                  <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>artifact {previewArtifactId ?? "stored"}</p>
                </>
              ) : null}
              <div className="section-rule" />
              <h3 style={{ margin: 0, fontSize: 18 }}>Web push to talk</h3>
              <select value={recordingConversationId} onChange={(event) => setRecordingConversationId(event.target.value)} style={input}>
                <option value="new">new conversation</option>
                {state.conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title ?? snippet(conversation.lastMessagePreview)}</option>)}
              </select>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button type="button" onClick={() => void startRecording()} disabled={isRecording || isSubmittingRecording} style={{ ...ghostButton, cursor: isRecording || isSubmittingRecording ? "not-allowed" : "pointer" }}>
                  {isSubmittingRecording ? "Submitting..." : "Start Recording"}
                </button>
                <button type="button" onClick={stopRecording} disabled={!isRecording} style={{ ...primaryButton, cursor: isRecording ? "pointer" : "not-allowed", background: "linear-gradient(135deg, var(--warning) 0%, var(--danger) 100%)" }}>
                  Stop And Send
                </button>
              </div>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
                {recordingError ?? (isRecording ? "Recording now. Stop when you want to transcribe and send." : "Run browser-side speech through the same STT and chat path as Telegram voice notes.")}
              </p>
              {pushToTalkResult ? (
                <div style={{ padding: 12, borderRadius: 14, border: "1px solid var(--success-soft-border)", background: "var(--success-soft-bg)", display: "grid", gap: 8 }}>
                  <p style={{ margin: 0, fontWeight: 700 }}>Transcript: {pushToTalkResult.transcriptText}</p>
                  <p style={{ margin: 0, color: "var(--muted)" }}>Reply: {pushToTalkResult.replyText}</p>
                  <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>conversation {pushToTalkResult.conversationId} · artifact {pushToTalkResult.artifactId}</p>
                </div>
              ) : null}
            </article>

            <article style={{ ...panel, display: "grid", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <h2 style={{ margin: 0 }}>Speech Artifacts</h2>
                <select value={selectedConversationId} onChange={(event) => void refresh(event.target.value)} style={input}>
                  <option value="all">all conversations</option>
                  {state.conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title ?? snippet(conversation.lastMessagePreview)}</option>)}
                </select>
              </div>
              {state.artifacts.length === 0 ? (
                <EmptyState
                  title="No speech artifacts for this view"
                  description={<p>Previews, transcripts, and TTS outputs will collect here after you test or use voice.</p>}
                />
              ) : (
                <div className="compact-list">
                  {state.artifacts.map((artifact) => (
                    <div key={artifact.id} style={{ padding: "12px 0", display: "grid", gap: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <p style={{ margin: 0, color: "var(--accent)", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{artifact.artifactKind}</p>
                        <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>{formatTimestamp(artifact.createdAt)}</p>
                      </div>
                      <p style={{ margin: 0, fontWeight: 700 }}>{artifact.status}</p>
                      <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                        {artifact.transcriptText ? snippet(artifact.transcriptText, 180) : `${artifact.sourceChannel} · ${artifact.sourceRef ?? "n/a"}`}
                      </p>
                      {isAudioMime(artifact.mimeType) ? (
                        <audio controls src={buildFileUrl(artifact.storageKey, artifact.mimeType)} style={{ width: "100%" }} />
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </article>
          </aside>
        </section>
    </AppPage>
  );
}
