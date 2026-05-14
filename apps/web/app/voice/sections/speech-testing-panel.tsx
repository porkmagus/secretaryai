"use client";

import type { ConversationListItem } from "@secretary/core-runtime";
import { snippet } from "../../lib/presenters";
import { ActionRow, FieldHint } from "../../lib/ui";

type PushToTalkResult = {
  artifactId: string;
  conversationId: string;
  transcriptText: string;
  replyText: string;
};

const inputStyle = {
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

type SpeechTestingPanelProps = {
  conversations: ConversationListItem[];
  previewText: string;
  onPreviewTextChange: (text: string) => void;
  isPreviewing: boolean;
  previewUrl: string | null;
  isRecording: boolean;
  isSubmittingRecording: boolean;
  recordingError: string | null;
  recordingConversationId: string;
  onRecordingConversationIdChange: (id: string) => void;
  onPreviewVoice: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  pushToTalkResult: PushToTalkResult | null;
};

export function SpeechTestingPanel({
  conversations,
  previewText,
  onPreviewTextChange,
  isPreviewing,
  previewUrl,
  isRecording,
  isSubmittingRecording,
  recordingError,
  recordingConversationId,
  onRecordingConversationIdChange,
  onPreviewVoice,
  onStartRecording,
  onStopRecording,
  pushToTalkResult,
}: SpeechTestingPanelProps) {
  return (
    <div className="stack-md">
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
          Preview script
        </span>
        <textarea
          value={previewText}
          onChange={(event) => onPreviewTextChange(event.target.value)}
          rows={5}
          style={{ ...inputStyle, resize: "vertical" }}
        />
        <FieldHint>
          Preview audio is generated on demand and is not kept as long-term artifact clutter.
        </FieldHint>
      </label>

      <ActionRow>
        <button
          type="button"
          onClick={() => void onPreviewVoice()}
          disabled={isPreviewing}
          aria-label="Generate voice preview"
          title="Generate voice preview"
          style={{ ...primaryButton, cursor: isPreviewing ? "wait" : "pointer" }}
        >
          {isPreviewing ? "Synthesizing..." : "Generate preview"}
        </button>
      </ActionRow>

      {previewUrl ? (
        <audio controls title="Voice preview" src={previewUrl} style={{ width: "100%" }} />
      ) : null}

      <div className="section-rule" />

      <div className="stack-sm">
        <h3 style={{ margin: 0, fontSize: 18 }}>Browser push to talk</h3>
        <FieldHint>
          This records in the browser, transcribes through STT, and sends the text through the
          normal secretary chat path.
        </FieldHint>
        <label htmlFor="recording-conversation-selector" className="sr-only">
          Target conversation for recording
        </label>
        <select
          id="recording-conversation-selector"
          value={recordingConversationId}
          onChange={(event) => onRecordingConversationIdChange(event.target.value)}
          style={inputStyle}
        >
          <option value="new">new conversation</option>
          {conversations.map((conversation) => (
            <option key={conversation.id} value={conversation.id}>
              {conversation.title ?? snippet(conversation.lastMessagePreview)}
            </option>
          ))}
        </select>
        <ActionRow align="start">
          <button
            type="button"
            onClick={() => void onStartRecording()}
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
            onClick={() => void onStopRecording()}
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
            <p style={{ margin: 0, fontWeight: 700 }}>
              Transcript: {pushToTalkResult.transcriptText}
            </p>
            <p style={{ margin: 0, color: "var(--muted)" }}>Reply: {pushToTalkResult.replyText}</p>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
              conversation {pushToTalkResult.conversationId} · artifact{" "}
              {pushToTalkResult.artifactId}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
