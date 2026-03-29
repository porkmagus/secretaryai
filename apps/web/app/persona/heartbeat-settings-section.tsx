"use client";

import { useEffect, useState } from "react";
import type {
  HeartbeatIntegrationStatusResponse,
  HeartbeatRunResponse,
} from "@secretary/core-runtime";
import { SurfaceCard, ToggleField } from "../lib/ui";

export function HeartbeatSettingsSection() {
  const [heartbeat, setHeartbeat] = useState<HeartbeatIntegrationStatusResponse | null>(null);
  const [heartbeatDraft, setHeartbeatDraft] = useState<{
    enabled: boolean;
    intervalMinutes: string;
    prompt: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isSavingHeartbeat, setIsSavingHeartbeat] = useState(false);
  const [isRunningHeartbeat, setIsRunningHeartbeat] = useState(false);

  async function loadHeartbeat() {
    try {
      const response = await fetch("/api/integrations/heartbeat", { cache: "no-store" });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load heartbeat settings.");
      }

      const heartbeatData = payload as HeartbeatIntegrationStatusResponse;
      setHeartbeat(heartbeatData);
      setHeartbeatDraft({
        enabled: heartbeatData.integration.enabled,
        intervalMinutes: String(heartbeatData.integration.intervalMinutes),
        prompt: heartbeatData.integration.prompt,
      });
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load heartbeat settings.");
    }
  }

  useEffect(() => {
    void loadHeartbeat();
  }, []);

  async function saveHeartbeat() {
    if (!heartbeatDraft) {
      return;
    }

    setIsSavingHeartbeat(true);
    setError(null);
    setStatus(null);

    try {
      const response = await fetch("/api/integrations/heartbeat", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enabled: heartbeatDraft.enabled,
          intervalMinutes: Number(heartbeatDraft.intervalMinutes),
          prompt: heartbeatDraft.prompt,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update heartbeat settings.");
      }

      const heartbeatData = payload as HeartbeatIntegrationStatusResponse;
      setHeartbeat(heartbeatData);
      setHeartbeatDraft({
        enabled: heartbeatData.integration.enabled,
        intervalMinutes: String(heartbeatData.integration.intervalMinutes),
        prompt: heartbeatData.integration.prompt,
      });
      setStatus("Heartbeat settings saved.");
      await loadHeartbeat();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to update heartbeat settings.",
      );
    } finally {
      setIsSavingHeartbeat(false);
    }
  }

  async function runHeartbeatNow() {
    setIsRunningHeartbeat(true);
    setError(null);
    setStatus(null);

    try {
      const response = await fetch("/api/integrations/heartbeat/run", {
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to run heartbeat.");
      }

      const data = payload as HeartbeatRunResponse;
      setStatus(
        `Heartbeat ran. ${data.outputPreview}${data.outputPreview.endsWith(".") ? "" : "..."}`,
      );
      await loadHeartbeat();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Unable to run heartbeat.");
    } finally {
      setIsRunningHeartbeat(false);
    }
  }

  return (
    <SurfaceCard
      tone="dark"
      title="Autonomy heartbeat"
      description={
        <p>
          A configurable self-check for the secretary. Set how often it runs and what it
          asks the agent to review, then test it with a manual run whenever you want.
        </p>
      }
    >
      {(error || status) ? (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            background: error ? "var(--warning-soft-bg)" : "var(--success-soft-bg)",
            border: `1px solid ${error ? "var(--warning-soft-border)" : "var(--success-soft-border)"}`,
            color: error ? "var(--warning-soft-text)" : "var(--success-soft-text)",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {error ?? status}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gap: 14,
          gridTemplateColumns: "minmax(0, 1fr) minmax(180px, 220px) minmax(180px, 220px)",
          alignItems: "end",
        }}
      >
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>Heartbeat prompt</span>
          <textarea
            rows={4}
            value={heartbeatDraft?.prompt ?? ""}
            onChange={(event) =>
              setHeartbeatDraft((current) =>
                current ? { ...current, prompt: event.target.value } : current,
              )
            }
            style={{
              borderRadius: 14,
              border: "1px solid var(--field-border)",
              background: "var(--field-bg)",
              color: "var(--text)",
              padding: 14,
              font: "inherit",
              resize: "vertical",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>Interval (minutes)</span>
          <input
            type="number"
            min={5}
            max={1440}
            step={1}
            value={heartbeatDraft?.intervalMinutes ?? ""}
            onChange={(event) =>
              setHeartbeatDraft((current) =>
                current ? { ...current, intervalMinutes: event.target.value } : current,
              )
            }
            style={{
              borderRadius: 12,
              border: "1px solid var(--field-border)",
              background: "var(--field-bg)",
              color: "var(--text)",
              padding: "10px 12px",
              font: "inherit",
            }}
          />
        </label>

        <ToggleField
          checked={heartbeatDraft?.enabled ?? false}
          onChange={(next) =>
            setHeartbeatDraft((current) => (current ? { ...current, enabled: next } : current))
          }
          label="Enable heartbeat"
          hint="Keeps the worker running periodic autonomy checks."
        />
      </div>

      <div className="compact-list">
        {heartbeat ? (
          <>
            <div
              style={{
                display: "grid",
                gap: 8,
                padding: "12px 0",
                gridTemplateColumns: "minmax(150px, 220px) auto",
                alignItems: "start",
              }}
            >
              <strong style={{ fontSize: 14 }}>Current state</strong>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.45, fontSize: 13 }}>
                {heartbeat.integration.healthSummary}
              </p>
            </div>
            <div
              style={{
                display: "grid",
                gap: 8,
                padding: "12px 0",
                gridTemplateColumns: "minmax(150px, 220px) auto",
                alignItems: "start",
              }}
            >
              <strong style={{ fontSize: 14 }}>Last run / next run</strong>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.45, fontSize: 13 }}>
                {heartbeat.integration.lastRunAt
                  ? new Date(heartbeat.integration.lastRunAt).toLocaleString()
                  : "Never"}
                {" / "}
                {heartbeat.integration.nextRunAt
                  ? new Date(heartbeat.integration.nextRunAt).toLocaleString()
                  : "Not scheduled"}
              </p>
            </div>
            {heartbeat.integration.lastError ? (
              <div
                style={{
                  display: "grid",
                  gap: 8,
                  padding: "12px 0",
                  gridTemplateColumns: "minmax(150px, 220px) auto",
                  alignItems: "start",
                }}
              >
                <strong style={{ fontSize: 14 }}>Last error</strong>
                <p style={{ margin: 0, color: "var(--warning-soft-text)", lineHeight: 1.45, fontSize: 13 }}>
                  {heartbeat.integration.lastError}
                </p>
              </div>
            ) : null}
          </>
        ) : (
          <p style={{ margin: 0, color: "var(--muted)" }}>Loading heartbeat status...</p>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
          Use a short, actionable prompt here. Heartbeat runs in the worker, not the browser,
          so it keeps working while the local stack is up.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className="button-secondary"
            onClick={() => void runHeartbeatNow()}
            disabled={isRunningHeartbeat}
          >
            {isRunningHeartbeat ? "Running..." : "Run now"}
          </button>
          <button
            type="button"
            className="button-primary"
            onClick={() => void saveHeartbeat()}
            disabled={isSavingHeartbeat}
          >
            {isSavingHeartbeat ? "Saving..." : "Save heartbeat"}
          </button>
        </div>
      </div>
    </SurfaceCard>
  );
}
