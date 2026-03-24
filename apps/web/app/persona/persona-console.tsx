"use client";

import { useEffect, useState } from "react";
import type {
  PersonaSettingsResponse,
  SettingsExportResponse,
  SettingsImportRequest,
  SettingsImportResponse,
  UpdatePersonaSettingsRequest,
} from "@secretary/core-runtime";

type PersonaDraft = {
  behaviorRulesText: string;
  name: string;
  promptTemplate: string;
  toneMode: string;
  voiceProfileId: string;
};

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function PersonaConsole() {
  const [data, setData] = useState<PersonaSettingsResponse | null>(null);
  const [draft, setDraft] = useState<PersonaDraft | null>(null);
  const [importJson, setImportJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  async function load() {
    try {
      const response = await fetch("/api/persona", { cache: "no-store" });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load persona settings.");
      }

      const next = payload as PersonaSettingsResponse;
      setData(next);
      setDraft({
        behaviorRulesText: next.persona.behaviorRules.join("\n"),
        name: next.persona.name,
        promptTemplate: next.persona.promptTemplate,
        toneMode: next.persona.toneMode ?? "calm",
        voiceProfileId: next.persona.voiceProfileId ?? "",
      });
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load persona.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!draft) {
      return;
    }

    setIsSaving(true);
    setStatus(null);
    setError(null);

    try {
      const body: UpdatePersonaSettingsRequest = {
        name: draft.name,
        promptTemplate: draft.promptTemplate,
        toneMode: draft.toneMode,
        behaviorRules: draft.behaviorRulesText
          .split("\n")
          .map((rule) => rule.trim())
          .filter(Boolean),
        voiceProfileId: draft.voiceProfileId || null,
      };

      const response = await fetch("/api/persona", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update persona.");
      }

      setStatus("Persona settings saved.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update persona.");
    } finally {
      setIsSaving(false);
    }
  }

  async function exportSettings() {
    setIsExporting(true);
    setStatus(null);
    setError(null);

    try {
      const response = await fetch("/api/export/settings", { cache: "no-store" });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to export settings.");
      }

      const data = payload as SettingsExportResponse;
      downloadJson(
        `secretary-settings-${data.exportedAt.replace(/[:.]/g, "-")}.json`,
        data,
      );
      setStatus("Settings snapshot exported.");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Unable to export settings.");
    } finally {
      setIsExporting(false);
    }
  }

  async function importSettings() {
    setIsImporting(true);
    setStatus(null);
    setError(null);

    try {
      const parsed = JSON.parse(importJson) as SettingsExportResponse | SettingsImportRequest;
      const requestBody: SettingsImportRequest =
        "snapshot" in parsed ? { snapshot: parsed.snapshot } : parsed;
      const response = await fetch("/api/import/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to import settings.");
      }

      const data = payload as SettingsImportResponse;
      setStatus(`Imported settings for ${data.persona.name}.`);
      await load();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Unable to import settings.");
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", padding: "32px 18px 48px" }}>
      <section
        style={{
          width: "min(1220px, 100%)",
          margin: "0 auto",
          display: "grid",
          gap: 20,
        }}
      >
        <header
          style={{
            padding: 28,
            borderRadius: 28,
            border: "1px solid var(--border)",
            background: "var(--panel)",
            boxShadow: "var(--shadow)",
          }}
        >
          <p
            style={{
              margin: 0,
              color: "var(--accent)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            Persona Settings
          </p>
          <h1
            style={{
              margin: "12px 0 10px",
              fontSize: "clamp(2.1rem, 4vw, 4rem)",
              lineHeight: 1,
            }}
          >
            Shape how the Secretary sounds and behaves
          </h1>
          <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6, maxWidth: 760 }}>
            Keep the Secretary identity editable, choose the attached voice profile, and
            move settings in and out as a clean JSON snapshot without hand-editing the
            database.
          </p>
          <p style={{ margin: "12px 0 0", color: "var(--muted)", fontSize: 14 }}>
            {error ?? status ?? "Load, tune, export, or import the current settings."}
          </p>
        </header>

        <section
          style={{
            display: "grid",
            gap: 20,
            gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 0.95fr)",
          }}
        >
          <article
            style={{
              padding: 20,
              borderRadius: 24,
              border: "1px solid var(--border)",
              background: "var(--panel-strong)",
              display: "grid",
              gap: 14,
            }}
          >
            <h2 style={{ margin: 0 }}>Secretary identity</h2>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>Name</span>
              <input
                value={draft?.name ?? ""}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, name: event.target.value } : current,
                  )
                }
                style={{
                  borderRadius: 12,
                  border: "1px solid rgba(148, 163, 184, 0.18)",
                  background: "rgba(2, 6, 23, 0.75)",
                  color: "var(--text)",
                  padding: "10px 12px",
                  font: "inherit",
                }}
              />
            </label>
            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "minmax(160px, 220px) minmax(180px, 260px)",
              }}
            >
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Tone mode</span>
                <input
                  value={draft?.toneMode ?? ""}
                  onChange={(event) =>
                    setDraft((current) =>
                      current ? { ...current, toneMode: event.target.value } : current,
                    )
                  }
                  style={{
                    borderRadius: 12,
                    border: "1px solid rgba(148, 163, 184, 0.18)",
                    background: "rgba(2, 6, 23, 0.75)",
                    color: "var(--text)",
                    padding: "10px 12px",
                    font: "inherit",
                  }}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Voice profile</span>
                <select
                  value={draft?.voiceProfileId ?? ""}
                  onChange={(event) =>
                    setDraft((current) =>
                      current ? { ...current, voiceProfileId: event.target.value } : current,
                    )
                  }
                  style={{
                    borderRadius: 12,
                    border: "1px solid rgba(148, 163, 184, 0.18)",
                    background: "rgba(2, 6, 23, 0.75)",
                    color: "var(--text)",
                    padding: "10px 12px",
                    font: "inherit",
                  }}
                >
                  <option value="">No voice profile selected</option>
                  {(data?.voiceProfiles ?? []).map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                      {profile.isActive ? " (active)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>Prompt template</span>
              <textarea
                value={draft?.promptTemplate ?? ""}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, promptTemplate: event.target.value } : current,
                  )
                }
                rows={8}
                style={{
                  borderRadius: 16,
                  border: "1px solid rgba(148, 163, 184, 0.18)",
                  background: "rgba(2, 6, 23, 0.75)",
                  color: "var(--text)",
                  padding: 16,
                  font: "inherit",
                  resize: "vertical",
                }}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>
                Behavior rules (one per line)
              </span>
              <textarea
                value={draft?.behaviorRulesText ?? ""}
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? { ...current, behaviorRulesText: event.target.value }
                      : current,
                  )
                }
                rows={6}
                style={{
                  borderRadius: 16,
                  border: "1px solid rgba(148, 163, 184, 0.18)",
                  background: "rgba(2, 6, 23, 0.75)",
                  color: "var(--text)",
                  padding: 16,
                  font: "inherit",
                  resize: "vertical",
                }}
              />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => void save()}
                disabled={isSaving}
                style={{
                  border: "none",
                  borderRadius: 999,
                  padding: "12px 18px",
                  font: "inherit",
                  fontWeight: 700,
                  cursor: isSaving ? "wait" : "pointer",
                  color: "#03111f",
                  background:
                    "linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%)",
                }}
              >
                {isSaving ? "Saving..." : "Save Persona"}
              </button>
            </div>
          </article>

          <article
            style={{
              padding: 20,
              borderRadius: 24,
              border: "1px solid var(--border)",
              background: "var(--panel-strong)",
              display: "grid",
              gap: 14,
            }}
          >
            <h2 style={{ margin: 0 }}>Settings import and export</h2>
            <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>
              Export a clean JSON snapshot of personas, integrations, tools, and voice
              profile settings. Importing a snapshot reapplies those settings without
              touching conversation history.
            </p>
            <button
              type="button"
              onClick={() => void exportSettings()}
              disabled={isExporting}
              style={{
                justifySelf: "start",
                border: "none",
                borderRadius: 999,
                padding: "12px 18px",
                font: "inherit",
                fontWeight: 700,
                cursor: isExporting ? "wait" : "pointer",
                color: "#03111f",
                background:
                  "linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%)",
              }}
            >
              {isExporting ? "Exporting..." : "Export settings"}
            </button>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>
                Paste a settings snapshot JSON
              </span>
              <textarea
                value={importJson}
                onChange={(event) => setImportJson(event.target.value)}
                rows={14}
                style={{
                  borderRadius: 16,
                  border: "1px solid rgba(148, 163, 184, 0.18)",
                  background: "rgba(2, 6, 23, 0.75)",
                  color: "var(--text)",
                  padding: 16,
                  font: "inherit",
                  resize: "vertical",
                }}
              />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => void importSettings()}
                disabled={isImporting || importJson.trim().length === 0}
                style={{
                  border: "1px solid rgba(125, 211, 252, 0.24)",
                  borderRadius: 999,
                  padding: "12px 18px",
                  font: "inherit",
                  cursor:
                    isImporting || importJson.trim().length === 0 ? "not-allowed" : "pointer",
                  color: "var(--text)",
                  background: "rgba(56, 189, 248, 0.08)",
                }}
              >
                {isImporting ? "Importing..." : "Import settings"}
              </button>
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
