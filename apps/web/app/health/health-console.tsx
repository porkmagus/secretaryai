"use client";

import { useEffect, useState } from "react";
import type {
  HeartbeatIntegrationStatusResponse,
  HeartbeatRunResponse,
  SystemHealthResponse,
} from "@secretary/core-runtime";
import { AppPage, PageHero, SurfaceCard } from "../lib/ui";

function statusTone(status: string) {
  switch (status) {
    case "ok":
      return {
        badge: "var(--success-soft-text)",
        border: "var(--success-soft-border)",
        background: "var(--success-soft-bg)",
      };
    case "not_configured":
      return {
        badge: "var(--neutral-soft-text)",
        border: "var(--neutral-soft-border)",
        background: "var(--neutral-soft-bg)",
      };
    default:
      return {
        badge: "var(--warning-soft-text)",
        border: "var(--warning-soft-border)",
        background: "var(--warning-soft-bg)",
      };
  }
}

export function HealthConsole() {
  const [data, setData] = useState<SystemHealthResponse | null>(null);
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

  async function load() {
    try {
      const [healthResponse, heartbeatResponse] = await Promise.all([
        fetch("/api/system/health", { cache: "no-store" }),
        fetch("/api/integrations/heartbeat", { cache: "no-store" }),
      ]);
      const [healthPayload, heartbeatPayload] = await Promise.all([
        healthResponse.json(),
        heartbeatResponse.json(),
      ]);

      if (!healthResponse.ok) {
        throw new Error(healthPayload.error ?? "Unable to load system health.");
      }

      if (!heartbeatResponse.ok) {
        throw new Error(heartbeatPayload.error ?? "Unable to load heartbeat settings.");
      }

      setData(healthPayload as SystemHealthResponse);
      const heartbeatData = heartbeatPayload as HeartbeatIntegrationStatusResponse;
      setHeartbeat(heartbeatData);
      setHeartbeatDraft({
        enabled: heartbeatData.integration.enabled,
        intervalMinutes: String(heartbeatData.integration.intervalMinutes),
        prompt: heartbeatData.integration.prompt,
      });
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load system health.");
    }
  }

  useEffect(() => {
    void load();
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
      await load();
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
      await load();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Unable to run heartbeat.");
    } finally {
      setIsRunningHeartbeat(false);
    }
  }

  return (
    <AppPage>
      <PageHero
        eyebrow="Health Dashboard"
        title="Local system check"
        description={
          <p>
            A quick operator glance at service readiness, storage visibility, and the
            few commands you actually need when something feels off.
          </p>
        }
        meta={
          <p>
            {error ??
              status ??
              (data
                ? `Updated ${new Date(data.generatedAt).toLocaleString()}`
                : "Loading system health...")}
          </p>
        }
        actions={
          <button type="button" className="button-secondary" onClick={() => void load()}>
            Refresh
          </button>
        }
        tone="dark"
      />

      {data ? (
        <div className="summary-strip">
          {Object.entries(data.stats).map(([key, value]) => (
            <div key={key} className="summary-chip">
              <p className="summary-chip-label">{key}</p>
              <p className="summary-chip-value">{value}</p>
            </div>
          ))}
        </div>
      ) : null}

      <SurfaceCard
        tone="dark"
        title="Service status"
        description={
          <p>
            One compact line per system instead of a full grid of cards.
          </p>
        }
      >
        <div className="compact-list">
          {data
            ? Object.entries(data.services).map(([key, service]) => {
                const tone = statusTone(service.status);

                return (
                  <div
                    key={key}
                    style={{
                      display: "grid",
                      gap: 8,
                      padding: "12px 0",
                      gridTemplateColumns: "minmax(110px, 140px) auto",
                      alignItems: "start",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          padding: "4px 9px",
                          borderRadius: 999,
                          background: tone.background,
                          border: `1px solid ${tone.border}`,
                          color: tone.badge,
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                        }}
                      >
                        {service.status}
                      </span>
                      <strong style={{ fontSize: 14, textTransform: "capitalize" }}>{key}</strong>
                    </div>
                    <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.45, fontSize: 13 }}>
                      {service.summary}
                    </p>
                  </div>
                );
              })
            : (
              <p style={{ margin: 0, color: "var(--muted)" }}>Loading services...</p>
            )}
        </div>
      </SurfaceCard>

      <SurfaceCard
        tone="dark"
        title="Autonomy heartbeat"
        description={
          <p>
            A configurable self-check for Samantha. Set how often it runs and what it
            asks her to review, then test it with a manual run whenever you want.
          </p>
        }
      >
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

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              minHeight: 42,
            }}
          >
            <input
              type="checkbox"
              checked={heartbeatDraft?.enabled ?? false}
              onChange={(event) =>
                setHeartbeatDraft((current) =>
                  current ? { ...current, enabled: event.target.checked } : current,
                )
              }
            />
            <span style={{ color: "var(--text)", fontSize: 14 }}>Enable heartbeat</span>
          </label>
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

      <section
        style={{
          display: "grid",
          gap: 18,
          gridTemplateColumns: "minmax(0, 1.28fr) minmax(300px, 0.92fr)",
        }}
      >
        <SurfaceCard title="Visible storage paths">
          <div className="compact-list">
            {(data?.storage ?? []).map((entry) => (
              <div
                key={entry.path}
                style={{
                  display: "grid",
                  gap: 6,
                  padding: "12px 0",
                  gridTemplateColumns: "minmax(150px, 190px) auto",
                  alignItems: "start",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <strong style={{ fontSize: 14 }}>{entry.label}</strong>
                  <span
                    style={{
                      color: entry.exists ? "var(--success-soft-text)" : "var(--warning-soft-text)",
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                    }}
                  >
                    {entry.exists ? "OK" : "Missing"}
                  </span>
                </div>
                <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.45 }}>
                  {entry.path}
                </p>
              </div>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard title="Runbook shortcuts" description={<p>Keep these close; nothing here needs a giant block.</p>}>
          <div
            style={{
              display: "grid",
              gap: 10,
            }}
          >
            {[
              "`npm run stack:up`",
              "`npm run backup:create`",
              "`npm run export:settings`",
              "`npm run phase6:verify`",
            ].map((line) => (
              <div
                key={line}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  background: "rgba(18, 15, 12, 0.72)",
                  fontSize: 13,
                  color: "var(--text)",
                }}
              >
                {line}
              </div>
            ))}
          </div>
        </SurfaceCard>
      </section>
    </AppPage>
  );
}
