"use client";

import type {
  ConversationListItem,
  SpeechArtifactListResponse,
  SpeechArtifactRecord,
  SpeechServiceStatusResponse,
} from "@secretary/core-runtime";
import { useState } from "react";
import { fetchJson } from "../../lib/fetch-json";
import { formatTimestamp, snippet } from "../../lib/presenters";
import { EmptyState, FieldHint } from "../../lib/ui";

type DiagnosticsState = {
  artifacts: SpeechArtifactRecord[];
  isLoading: boolean;
  isLoaded: boolean;
  selectedConversationId: string;
};

type SpeechStatusState = SpeechServiceStatusResponse["services"] | null;

const inputStyle = {
  width: "100%",
  borderRadius: 12,
  border: "1px solid var(--field-border)",
  background: "var(--field-bg)",
  color: "var(--text)",
  padding: "10px 12px",
  font: "inherit",
} as const;

function isAudioMime(mimeType: string | null) {
  return Boolean(mimeType?.startsWith("audio/"));
}

function buildFileUrl(storageKey: string, mimeType: string | null) {
  const url = new URL("/api/speech/file", window.location.origin);
  url.searchParams.set("storageKey", storageKey);
  if (mimeType) url.searchParams.set("mimeType", mimeType);
  return url.toString();
}

type DiagnosticsPanelProps = {
  isOpen: boolean;
  onToggle: (open: boolean) => void;
  state: DiagnosticsState;
  speechStatus: SpeechStatusState;
  conversations: ConversationListItem[];
};

export function DiagnosticsPanel({
  isOpen,
  onToggle,
  state,
  speechStatus,
  conversations,
}: DiagnosticsPanelProps) {
  const [internalLoading, setInternalLoading] = useState(false);

  async function loadDiagnostics(conversationId = state.selectedConversationId) {
    setInternalLoading(true);
    try {
      const artifactsUrl =
        conversationId === "all"
          ? "/api/speech/artifacts"
          : `/api/speech/artifacts?conversationId=${encodeURIComponent(conversationId)}`;
      const _payload = await fetchJson<SpeechArtifactListResponse>(artifactsUrl, {
        cache: "no-store",
      });
      setInternalLoading(false);
      onToggle(true);
    } catch {
      setInternalLoading(false);
    }
  }

  return (
    <details
      open={isOpen}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        onToggle(nextOpen);
        if (nextOpen && !state.isLoaded && !state.isLoading && !internalLoading) {
          void loadDiagnostics();
        }
      }}
    >
      <summary style={{ cursor: "pointer", fontWeight: 700, color: "var(--accent)" }}>
        {isOpen ? "Hide diagnostics" : "Open diagnostics"}
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
            {(
              [
                ["STT", speechStatus?.stt.summary ?? "loading"],
                ["TTS", speechStatus?.tts.summary ?? "loading"],
                ["ffmpeg", speechStatus?.ffmpeg.summary ?? "loading"],
              ] as const
            ).map(([label, value]) => (
              <div key={label} style={{ padding: "10px 0", display: "grid", gap: 4 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "var(--accent)",
                  }}
                >
                  {label}
                </span>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>{value}</span>
              </div>
            ))}
          </div>

          <label style={{ display: "grid", gap: 6 }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: "var(--accent)",
              }}
            >
              Artifact scope
            </span>
            <select
              value={state.selectedConversationId}
              onChange={(event) => void loadDiagnostics(event.target.value)}
              style={inputStyle}
            >
              <option value="all">all conversations</option>
              {conversations.map((conversation) => (
                <option key={conversation.id} value={conversation.id}>
                  {conversation.title ?? snippet(conversation.lastMessagePreview)}
                </option>
              ))}
            </select>
            <FieldHint>
              Missing files are filtered out automatically, so this list only shows playable recent
              audio that still exists on disk.
            </FieldHint>
          </label>
        </div>

        {state.isLoading || internalLoading ? (
          <EmptyState
            title="Loading recent speech activity"
            description={<p>Pulling the latest transcripts, recordings, and spoken replies.</p>}
          />
        ) : state.artifacts.length === 0 ? (
          <EmptyState
            title="No recent speech activity in this view"
            description={
              <p>
                Once you run previews or voice turns, the recent surviving artifacts will appear
                here.
              </p>
            }
            tone="warm"
          />
        ) : (
          <div className="compact-list">
            {state.artifacts.map((artifact) => (
              <div key={artifact.id} style={{ padding: "12px 0", display: "grid", gap: 8 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      color: "var(--accent)",
                      fontSize: 12,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
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
                    title={`Speech artifact: ${artifact.artifactKind}`}
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
  );
}
