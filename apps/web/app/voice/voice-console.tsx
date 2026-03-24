"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type {
  ConversationListItem,
  ConversationListResponse,
  SpeechArtifactListResponse,
  SpeechArtifactRecord,
  VoiceProfileListResponse,
  VoiceProfileRecord,
} from "@secretary/core-runtime";
import { formatTimestamp, snippet } from "../lib/presenters";

type VoicePageState = {
  conversations: ConversationListItem[];
  profiles: VoiceProfileRecord[];
  artifacts: SpeechArtifactRecord[];
};

function artifactTone(status: SpeechArtifactRecord["status"]) {
  switch (status) {
    case "transcribed":
    case "synthesized":
      return "#86efac";
    case "failed":
      return "#fca5a5";
    default:
      return "#7dd3fc";
  }
}

function prettyArtifactKind(kind: SpeechArtifactRecord["artifactKind"]) {
  return kind.replaceAll("_", " ");
}

function prettyDuration(durationMs: number | null) {
  if (!durationMs || durationMs <= 0) {
    return "n/a";
  }

  const seconds = Math.round(durationMs / 1000);
  return `${seconds}s`;
}

export function VoiceConsole() {
  const [state, setState] = useState<VoicePageState>({
    conversations: [],
    profiles: [],
    artifacts: [],
  });
  const [selectedConversationId, setSelectedConversationId] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const activeProfile = useMemo(
    () => state.profiles.find((profile) => profile.isActive) ?? state.profiles[0] ?? null,
    [state.profiles],
  );
  const artifactSummary = useMemo(() => {
    const transcriptCount = state.artifacts.filter((artifact) => artifact.transcriptText).length;
    const failedCount = state.artifacts.filter((artifact) => artifact.status === "failed").length;
    const ttsCount = state.artifacts.filter((artifact) => artifact.artifactKind === "tts_output").length;

    return {
      transcriptCount,
      failedCount,
      ttsCount,
    };
  }, [state.artifacts]);

  useEffect(() => {
    void refresh("all");
  }, []);

  async function refresh(conversationId = selectedConversationId) {
    setIsLoading(true);
    setError(null);

    try {
      const artifactsUrl =
        conversationId && conversationId !== "all"
          ? `/api/speech/artifacts?conversationId=${encodeURIComponent(conversationId)}`
          : "/api/speech/artifacts";

      const [profilesResponse, artifactsResponse, conversationsResponse] = await Promise.all([
        fetch("/api/voice/profiles", { cache: "no-store" }),
        fetch(artifactsUrl, { cache: "no-store" }),
        fetch("/api/conversations", { cache: "no-store" }),
      ]);

      const [profilesPayload, artifactsPayload, conversationsPayload] = await Promise.all([
        profilesResponse.json(),
        artifactsResponse.json(),
        conversationsResponse.json(),
      ]);

      if (!profilesResponse.ok) {
        throw new Error(profilesPayload.error ?? "Unable to load voice profiles.");
      }

      if (!artifactsResponse.ok) {
        throw new Error(artifactsPayload.error ?? "Unable to load speech artifacts.");
      }

      if (!conversationsResponse.ok) {
        throw new Error(conversationsPayload.error ?? "Unable to load conversations.");
      }

      setState({
        profiles: (profilesPayload as VoiceProfileListResponse).profiles,
        artifacts: (artifactsPayload as SpeechArtifactListResponse).artifacts,
        conversations: (conversationsPayload as ConversationListResponse).conversations,
      });
      setSelectedConversationId(conversationId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load voice workspace.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", padding: "32px 18px 48px" }}>
      <section style={{ width: "min(1220px, 100%)", margin: "0 auto", display: "grid", gap: 20 }}>
        <header
          style={{
            padding: 28,
            borderRadius: 28,
            border: "1px solid var(--border)",
            background: "var(--panel)",
            boxShadow: "var(--shadow)",
            display: "grid",
            gap: 18,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <p style={{ margin: 0, color: "var(--accent)", letterSpacing: "0.12em", textTransform: "uppercase", fontSize: 12, fontWeight: 700 }}>
                Voice Lab
              </p>
              <h1 style={{ margin: "12px 0 10px", fontSize: "clamp(2.1rem, 4vw, 4rem)", lineHeight: 1 }}>
                Speech Intake and Voice Profiles
              </h1>
              <p style={{ margin: 0, maxWidth: 780, color: "var(--muted)", fontSize: 17, lineHeight: 1.6 }}>
                Track speech artifacts as they land, confirm the active cloned-voice profile,
                and keep the Phase 4 pipeline visible before STT and TTS become fully live.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void refresh()}
              style={{
                borderRadius: 999,
                border: "1px solid rgba(148, 163, 184, 0.18)",
                background: "rgba(2, 6, 23, 0.68)",
                color: "var(--text)",
                padding: "12px 18px",
                font: "inherit",
                cursor: "pointer",
              }}
            >
              Refresh
            </button>
          </div>

          <section style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
            {[
              { label: "Voice Profiles", value: String(state.profiles.length) },
              { label: "Speech Artifacts", value: String(state.artifacts.length) },
              { label: "Transcripts", value: String(artifactSummary.transcriptCount) },
              { label: "TTS Outputs", value: String(artifactSummary.ttsCount) },
              { label: "Failures", value: String(artifactSummary.failedCount) },
            ].map((card) => (
              <article key={card.label} style={{ padding: 18, borderRadius: 22, border: "1px solid var(--border)", background: "var(--panel-strong)" }}>
                <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>{card.label}</p>
                <p style={{ margin: "8px 0 0", fontSize: 28, fontWeight: 700 }}>{card.value}</p>
              </article>
            ))}
          </section>
        </header>

        <section style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0, 1.4fr) minmax(300px, 0.9fr)" }}>
          <div style={{ display: "grid", gap: 18, alignContent: "start" }}>
            <article style={{ padding: 22, borderRadius: 24, border: "1px solid var(--border)", background: "var(--panel-strong)", display: "grid", gap: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <h2 style={{ margin: 0 }}>Speech Artifact Feed</h2>
                  <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>
                    {error ??
                      (isLoading
                        ? "Loading voice workspace..."
                        : selectedConversationId === "all"
                          ? "Showing recent artifacts across all conversations."
                          : "Showing artifacts for one conversation.")}
                  </p>
                </div>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ color: "var(--muted)", fontSize: 13 }}>Filter by conversation</span>
                  <select
                    value={selectedConversationId}
                    onChange={(event) => void refresh(event.target.value)}
                    style={{
                      minWidth: 240,
                      borderRadius: 14,
                      border: "1px solid rgba(148, 163, 184, 0.18)",
                      background: "rgba(2, 6, 23, 0.75)",
                      color: "var(--text)",
                      padding: "10px 12px",
                      font: "inherit",
                    }}
                  >
                    <option value="all">All conversations</option>
                    {state.conversations.map((conversation) => (
                      <option key={conversation.id} value={conversation.id}>
                        {(conversation.title ?? "Untitled conversation").slice(0, 48)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {state.artifacts.length === 0 ? (
                <article style={{ padding: 18, borderRadius: 20, border: "1px dashed rgba(148, 163, 184, 0.24)", background: "rgba(2, 6, 23, 0.48)", display: "grid", gap: 8 }}>
                  <p style={{ margin: 0, fontWeight: 700 }}>No speech artifacts yet</p>
                  <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>
                    Telegram voice notes, web recordings, STT transcripts, and synthesized voice
                    outputs will all land here as Phase 4 fills in.
                  </p>
                </article>
              ) : (
                state.artifacts.map((artifact) => (
                  <article key={artifact.id} style={{ padding: 18, borderRadius: 20, border: "1px solid rgba(148, 163, 184, 0.14)", background: "rgba(2, 6, 23, 0.62)", display: "grid", gap: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                      <div>
                        <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                          {prettyArtifactKind(artifact.artifactKind)}
                        </p>
                        <h3 style={{ margin: "6px 0 0", fontSize: 22 }}>{artifact.id}</h3>
                      </div>
                      <span style={{ color: artifactTone(artifact.status), fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        {artifact.status}
                      </span>
                    </div>

                    <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>
                      {artifact.transcriptText
                        ? snippet(artifact.transcriptText, 240)
                        : "Transcript is not attached to this artifact yet."}
                    </p>

                    <div style={{ display: "grid", gap: 6, color: "var(--muted)", fontSize: 13 }}>
                      <p style={{ margin: 0 }}>Source: {artifact.sourceChannel} · {artifact.sourceRef ?? "no external reference yet"}</p>
                      <p style={{ margin: 0 }}>Storage key: {artifact.storageKey}</p>
                      <p style={{ margin: 0 }}>Duration: {prettyDuration(artifact.durationMs)} · Updated {formatTimestamp(artifact.updatedAt)}</p>
                      <p style={{ margin: 0 }}>Conversation: {artifact.conversationId ?? "standalone asset"} · Message: {artifact.messageId ?? "not linked yet"}</p>
                    </div>
                  </article>
                ))
              )}
            </article>
          </div>

          <aside style={{ display: "grid", gap: 20, alignContent: "start" }}>
            <article style={{ padding: 20, borderRadius: 24, border: "1px solid var(--border)", background: "var(--panel-strong)", display: "grid", gap: 12 }}>
              <h2 style={{ margin: 0 }}>Active Voice Profile</h2>
              {activeProfile ? (
                <>
                  <p style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{activeProfile.name}</p>
                  <p style={{ margin: 0, color: "var(--muted)" }}>
                    Engine: <strong style={{ color: "var(--text)" }}>{activeProfile.engineId}</strong>
                  </p>
                  <p style={{ margin: 0, color: "var(--muted)" }}>
                    Style: <strong style={{ color: "var(--text)" }}>{activeProfile.speakingStyle ?? "not defined yet"}</strong>
                  </p>
                  <p style={{ margin: 0, color: "var(--muted)" }}>
                    Quality preset: <strong style={{ color: "var(--text)" }}>{activeProfile.qualityPreset ?? "not defined yet"}</strong>
                  </p>
                  <p style={{ margin: 0, color: "var(--muted)" }}>
                    Sample: <strong style={{ color: "var(--text)" }}>{activeProfile.sampleStorageKey ?? "no sample attached yet"}</strong>
                  </p>
                </>
              ) : (
                <p style={{ margin: 0, color: "var(--muted)" }}>
                  No voice profile has been created yet. The worker should seed one automatically on startup.
                </p>
              )}
            </article>

            <article style={{ padding: 20, borderRadius: 24, border: "1px solid var(--border)", background: "var(--panel-strong)", display: "grid", gap: 12 }}>
              <h2 style={{ margin: 0 }}>Voice Queue Snapshot</h2>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>
                This page is the Phase 4 staging area for the full voice loop: capture audio, persist
                artifacts, transcribe to text, then synthesize speech replies back out.
              </p>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>
                Right now the foundation is in place: speech storage exists, a default profile is seeded,
                and artifact visibility is wired through the app.
              </p>
            </article>

            <article style={{ padding: 20, borderRadius: 24, border: "1px solid var(--border)", background: "var(--panel-strong)", display: "grid", gap: 12 }}>
              <h2 style={{ margin: 0 }}>Jump To</h2>
              <Link href="/" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 700 }}>
                Open Desk
              </Link>
              <Link href="/activity" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 700 }}>
                Inspect Activity
              </Link>
              <Link href="/channels" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 700 }}>
                Manage Telegram
              </Link>
            </article>
          </aside>
        </section>
      </section>
    </main>
  );
}
