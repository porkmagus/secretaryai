"use client";

import { useEffect, useState } from "react";
import type { AgentJobApprovalMode, AgentJobSettingsResponse, UpdateAgentJobSettingsRequest } from "@secretary/core-runtime";
import { NoticeBanner, SurfaceCard } from "../../lib/ui";

type AgentSettingsDraft = {
  defaultWorkspacePath: string;
  defaultApprovalMode: AgentJobApprovalMode;
  maxAgentSteps: string;
  maxCommandTimeoutSeconds: string;
  maxVerificationAttempts: string;
};

function createDraft(response: AgentJobSettingsResponse): AgentSettingsDraft {
  return {
    defaultWorkspacePath: response.settings.defaultWorkspacePath ?? "",
    defaultApprovalMode: response.settings.defaultApprovalMode,
    maxAgentSteps: String(response.settings.maxAgentSteps),
    maxCommandTimeoutSeconds: String(response.settings.maxCommandTimeoutSeconds),
    maxVerificationAttempts: String(response.settings.maxVerificationAttempts),
  };
}

export function AgentSettingsConsole() {
  const [draft, setDraft] = useState<AgentSettingsDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function loadSettings() {
    try {
      const response = await fetch("/api/agent-job-settings", { cache: "no-store" });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load agent settings.");
      }

      setDraft(createDraft(payload as AgentJobSettingsResponse));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load agent settings.");
    }
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  function updateField<K extends keyof AgentSettingsDraft>(key: K, value: AgentSettingsDraft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  async function saveSettings() {
    if (!draft) {
      return;
    }

    setIsSaving(true);
    setStatus(null);

    try {
      const payload: UpdateAgentJobSettingsRequest = {
        defaultWorkspacePath: draft.defaultWorkspacePath.trim() || null,
        defaultApprovalMode: draft.defaultApprovalMode,
        maxAgentSteps: Number(draft.maxAgentSteps),
        maxCommandTimeoutSeconds: Number(draft.maxCommandTimeoutSeconds),
        maxVerificationAttempts: Number(draft.maxVerificationAttempts),
      };
      const response = await fetch("/api/agent-job-settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error ?? "Unable to save agent settings.");
      }

      setDraft(createDraft(body as AgentJobSettingsResponse));
      setError(null);
      setStatus("Agent defaults saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save agent settings.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {error ? <NoticeBanner tone="error">{error}</NoticeBanner> : null}
      {status ? <NoticeBanner tone="success">{status}</NoticeBanner> : null}

      <SurfaceCard
        tone="dark"
        title="Agent defaults"
        description={<p>These are system-level defaults for autonomous build jobs. Job pages only start, pause, resume, and review work.</p>}
      >
        {draft ? (
          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Default workspace path</span>
                <input
                  value={draft.defaultWorkspacePath}
                  onChange={(event) => updateField("defaultWorkspacePath", event.target.value)}
                  className="input-shell"
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Default access mode</span>
                <select
                  value={draft.defaultApprovalMode}
                  onChange={(event) => updateField("defaultApprovalMode", event.target.value as AgentJobApprovalMode)}
                  className="input-shell"
                >
                  <option value="restrictive">Restrictive</option>
                  <option value="builder">Builder</option>
                  <option value="full_access">YOLO / Full access</option>
                </select>
              </label>
            </div>

            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Max agent steps</span>
                <input
                  value={draft.maxAgentSteps}
                  onChange={(event) => updateField("maxAgentSteps", event.target.value)}
                  className="input-shell"
                  inputMode="numeric"
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Command timeout (seconds)</span>
                <input
                  value={draft.maxCommandTimeoutSeconds}
                  onChange={(event) => updateField("maxCommandTimeoutSeconds", event.target.value)}
                  className="input-shell"
                  inputMode="numeric"
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Verification repair passes</span>
                <input
                  value={draft.maxVerificationAttempts}
                  onChange={(event) => updateField("maxVerificationAttempts", event.target.value)}
                  className="input-shell"
                  inputMode="numeric"
                />
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="button-primary" disabled={isSaving} onClick={() => void saveSettings()}>
                {isSaving ? "Saving..." : "Save agent defaults"}
              </button>
            </div>
          </div>
        ) : (
          <p style={{ margin: 0, color: "var(--muted)" }}>Loading agent defaults...</p>
        )}
      </SurfaceCard>
    </div>
  );
}
