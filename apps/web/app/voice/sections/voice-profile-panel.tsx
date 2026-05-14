"use client";

import type { VoiceProfileRecord } from "@secretary/core-runtime";
import { useRef } from "react";
import { ActionRow, EmptyState, FieldHint } from "../../lib/ui";

type ActiveVoiceDraft = {
  name: string;
  engineId: string;
  qualityPreset: string;
  speakingStyle: string;
};

const engines = ["kokoro"] as const;
const qualityPresets = [
  { value: "balanced", label: "Balanced" },
  { value: "clear", label: "Clear" },
  { value: "expressive", label: "Expressive" },
  { value: "gentle", label: "Gentle" },
] as const;

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

function buildFileUrl(storageKey: string, mimeType: string | null) {
  const url = new URL("/api/speech/file", window.location.origin);
  url.searchParams.set("storageKey", storageKey);
  if (mimeType) url.searchParams.set("mimeType", mimeType);
  return url.toString();
}

type VoiceProfilePanelProps = {
  activeProfile: VoiceProfileRecord | null;
  draft: ActiveVoiceDraft | null;
  activeVoiceMode: "default" | "custom";
  isSaving: boolean;
  isUploadingSample: boolean;
  clearSampleOnSave: boolean;
  onDraftChange: (draft: ActiveVoiceDraft) => void;
  onClearSample: (clear: boolean) => void;
  onSave: () => void;
  onUploadSample: (file: File) => void;
};

export function VoiceProfilePanel({
  activeProfile,
  draft,
  activeVoiceMode,
  isSaving,
  isUploadingSample,
  clearSampleOnSave,
  onDraftChange,
  onClearSample,
  onSave,
  onUploadSample,
}: VoiceProfilePanelProps) {
  const sampleInputRef = useRef<HTMLInputElement | null>(null);

  if (!activeProfile || !draft) {
    return (
      <EmptyState
        title="No active voice yet"
        description={<p>The worker has not prepared an active voice profile yet.</p>}
        tone="warm"
      />
    );
  }

  return (
    <div className="stack-md">
      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.1fr)",
        }}
      >
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
            Voice label
          </span>
          <input
            value={draft.name}
            onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
            placeholder="Secretary voice"
            style={inputStyle}
          />
          <FieldHint>This is just the local label for the one active voice path.</FieldHint>
        </label>

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
            Engine
          </span>
          <select
            value={draft.engineId}
            onChange={(event) => onDraftChange({ ...draft, engineId: event.target.value })}
            style={inputStyle}
          >
            {engines.map((engine) => (
              <option key={engine} value={engine}>
                {engine}
              </option>
            ))}
          </select>
          <FieldHint>
            The active engine voice is used whenever you are not cloning from a sample.
          </FieldHint>
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
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--accent)",
            }}
          >
            Quality preset
          </span>
          <select
            value={draft.qualityPreset || "balanced"}
            onChange={(event) => onDraftChange({ ...draft, qualityPreset: event.target.value })}
            style={inputStyle}
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
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--accent)",
            }}
          >
            Speaking style
          </span>
          <input
            value={draft.speakingStyle}
            onChange={(event) => onDraftChange({ ...draft, speakingStyle: event.target.value })}
            placeholder="Warm, poised, and clear"
            style={inputStyle}
          />
          <FieldHint>Short traits work best here: calm, warm, direct, clear.</FieldHint>
        </label>
      </div>

      <div className="section-rule" />

      <div className="stack-sm">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "grid", gap: 4 }}>
            <p style={{ margin: 0, fontWeight: 700 }}>
              {activeVoiceMode === "custom" ? "Custom sample active" : "Default voice active"}
            </p>
            <FieldHint>
              Upload one clean sample if you want cloning. Otherwise the secretary will use the
              selected engine's default voice.
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
                if (file) void onUploadSample(file);
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
              onClick={() => onClearSample(true)}
              disabled={activeVoiceMode === "default"}
              style={{
                ...ghostButton,
                cursor: activeVoiceMode === "default" ? "not-allowed" : "pointer",
              }}
            >
              Use default voice
            </button>
          </ActionRow>
        </div>

        {activeProfile.sampleStorageKey && !clearSampleOnSave ? (
          <audio
            controls
            title="Active voice sample"
            src={buildFileUrl(activeProfile.sampleStorageKey, activeProfile.sampleMimeType)}
            style={{ width: "100%" }}
          />
        ) : (
          <EmptyState
            title="No custom sample loaded"
            description={
              <p>
                The voice page is running in the lightest setup: one active profile and the engine's
                built-in voice. Add a sample only if you want cloning.
              </p>
            }
            tone="warm"
          />
        )}

        <FieldHint>
          Best results usually come from a clean 10 to 60 second sample with one speaker, little
          background noise, and no music underneath.
        </FieldHint>
      </div>

      <ActionRow>
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={isSaving}
          aria-label="Save active voice settings"
          title="Save active voice settings"
          style={{ ...primaryButton, cursor: isSaving ? "wait" : "pointer" }}
        >
          {isSaving ? "Saving..." : "Save voice"}
        </button>
      </ActionRow>
    </div>
  );
}
