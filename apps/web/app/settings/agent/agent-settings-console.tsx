"use client";

import type {
  AgentExecutionBackend,
  AgentJobApprovalMode,
  AgentJobSettingsResponse,
  UpdateAgentJobSettingsRequest,
} from "@secretary/core-runtime";
import { useEffect, useState } from "react";
import { LoadingSurface, NoticeBanner, SurfaceCard, ToggleField } from "../../lib/ui";

type AgentSettingsDraft = {
  defaultWorkspacePath: string;
  defaultApprovalMode: AgentJobApprovalMode;
  executionBackend: AgentExecutionBackend;
  maxAgentSteps: string;
  maxCommandTimeoutSeconds: string;
  maxVerificationAttempts: string;
  maxJobRuntimeMinutes: string;
  allowNetworkAccess: boolean;
  browserVerificationEnabled: boolean;
  redactSecretsInArtifacts: boolean;
  allowedWorkspaceRoots: string;
};

function createDraft(response: AgentJobSettingsResponse): AgentSettingsDraft {
  return {
    defaultWorkspacePath: response.settings.defaultWorkspacePath ?? "",
    defaultApprovalMode: response.settings.defaultApprovalMode,
    executionBackend: response.settings.executionBackend,
    maxAgentSteps: String(response.settings.maxAgentSteps),
    maxCommandTimeoutSeconds: String(response.settings.maxCommandTimeoutSeconds),
    maxVerificationAttempts: String(response.settings.maxVerificationAttempts),
    maxJobRuntimeMinutes: String(response.settings.maxJobRuntimeMinutes),
    allowNetworkAccess: response.settings.allowNetworkAccess,
    browserVerificationEnabled: response.settings.browserVerificationEnabled,
    redactSecretsInArtifacts: response.settings.redactSecretsInArtifacts,
    allowedWorkspaceRoots: response.settings.allowedWorkspaceRoots.join("\n"),
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
  }, [loadSettings]);

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
        executionBackend: draft.executionBackend,
        maxAgentSteps: Number(draft.maxAgentSteps),
        maxCommandTimeoutSeconds: Number(draft.maxCommandTimeoutSeconds),
        maxVerificationAttempts: Number(draft.maxVerificationAttempts),
        maxJobRuntimeMinutes: Number(draft.maxJobRuntimeMinutes),
        allowNetworkAccess: draft.allowNetworkAccess,
        browserVerificationEnabled: draft.browserVerificationEnabled,
        redactSecretsInArtifacts: draft.redactSecretsInArtifacts,
        allowedWorkspaceRoots: draft.allowedWorkspaceRoots
          .split(/\r?\n/)
          .map((entry) => entry.trim())
          .filter(Boolean),
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

  if (!draft) {
    return (
      <div style={{ display: "grid", gap: 18 }}>
        <LoadingSurface
          title="Preparing agent defaults"
          description={
            <p>
              Loading workspace, execution, safety, and verification defaults so the agent settings
              surface opens with everything in one place.
            </p>
          }
          blocks={3}
        />
        {error ? <NoticeBanner tone="error">{error}</NoticeBanner> : null}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {error ? <NoticeBanner tone="error">{error}</NoticeBanner> : null}
      {status ? <NoticeBanner tone="success">{status}</NoticeBanner> : null}

      <SurfaceCard
        tone="dark"
        title="Agent defaults"
        description={
          <p>
            These are system-level defaults for autonomous build jobs. Job pages only start, pause,
            resume, and review work.
          </p>
        }
      >
        <div style={{ display: "grid", gap: 16 }}>
          <div
            style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}
          >
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
                onChange={(event) =>
                  updateField("defaultApprovalMode", event.target.value as AgentJobApprovalMode)
                }
                className="input-shell"
              >
                <option value="restrictive">Restrictive</option>
                <option value="builder">Builder</option>
                <option value="full_access">YOLO / Full access</option>
              </select>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Execution backend</span>
              <select
                value={draft.executionBackend}
                onChange={(event) =>
                  updateField("executionBackend", event.target.value as AgentExecutionBackend)
                }
                className="input-shell"
              >
                <option value="host_native">Host native shell</option>
                <option value="wsl_bash">WSL bash</option>
                <option value="docker_sandbox">Docker sandbox</option>
              </select>
            </label>
          </div>

          <div
            style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}
          >
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
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                Verification repair passes
              </span>
              <input
                value={draft.maxVerificationAttempts}
                onChange={(event) => updateField("maxVerificationAttempts", event.target.value)}
                className="input-shell"
                inputMode="numeric"
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Max runtime (minutes)</span>
              <input
                value={draft.maxJobRuntimeMinutes}
                onChange={(event) => updateField("maxJobRuntimeMinutes", event.target.value)}
                className="input-shell"
                inputMode="numeric"
              />
            </label>
          </div>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Allowed workspace roots</span>
            <textarea
              value={draft.allowedWorkspaceRoots}
              onChange={(event) => updateField("allowedWorkspaceRoots", event.target.value)}
              className="textarea-shell"
              rows={4}
              placeholder={
                "One root per line, e.g. /home/user/projects\nThe repo root is included by default. Blank means deny-all."
              }
            />
          </label>

          <div style={{ display: "grid", gap: 10 }}>
            <ToggleField
              checked={draft.allowNetworkAccess}
              onChange={(checked) => updateField("allowNetworkAccess", checked)}
              label="Allow network access"
              hint="Controls installs, remote fetches, and network-heavy verification."
            />
            <ToggleField
              checked={draft.browserVerificationEnabled}
              onChange={(checked) => updateField("browserVerificationEnabled", checked)}
              label="Enable browser verification"
              hint="Allow browser-based verification passes when the stack supports them."
            />
            <ToggleField
              checked={draft.redactSecretsInArtifacts}
              onChange={(checked) => updateField("redactSecretsInArtifacts", checked)}
              label="Redact secrets in artifacts"
              hint="Mask obvious credentials from command logs and saved evidence."
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="button-primary"
              disabled={isSaving}
              onClick={() => void saveSettings()}
            >
              {isSaving ? "Saving..." : "Save agent defaults"}
            </button>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}
