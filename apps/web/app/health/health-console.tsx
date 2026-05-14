"use client";

import type { SystemHealthResponse } from "@secretary/core-runtime";
import { useEffect } from "react";
import { AppPage, LoadingSurface, PageHero, SurfaceCard } from "../lib/ui";
import { useAsyncData } from "../lib/use-async-data";
import { HeartbeatSettingsSection } from "../persona/heartbeat-settings-section";

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

async function fetchHealth(): Promise<SystemHealthResponse> {
  const response = await fetch("/api/system/health", { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Unable to load system health.");
  }
  return payload as SystemHealthResponse;
}

export function HealthConsole() {
  const { data, error, isLoading, load } = useAsyncData(fetchHealth);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading || !data) {
    return (
      <AppPage>
        <LoadingSurface
          title="Preparing the health dashboard"
          description={
            <p>
              Checking local services and runtime readiness so the health page opens with a complete
              operator view.
            </p>
          }
          blocks={3}
        />
      </AppPage>
    );
  }

  return (
    <AppPage>
      <PageHero
        eyebrow="Health Dashboard"
        title="Local system check"
        description={
          <p>
            A quick operator glance at service readiness, storage visibility, and the few commands
            you actually need when something feels off.
          </p>
        }
        meta={<p>{error ?? `Updated ${new Date(data.generatedAt).toLocaleString()}`}</p>}
        actions={
          <button type="button" className="button-secondary" onClick={() => void load()}>
            Refresh
          </button>
        }
        tone="dark"
      />

      <div className="summary-strip">
        {Object.entries(data.stats).map(([key, value]) => (
          <div key={key} className="summary-chip">
            <p className="summary-chip-label">{key}</p>
            <p className="summary-chip-value">{value}</p>
          </div>
        ))}
      </div>

      <SurfaceCard
        tone="dark"
        title="Service status"
        description={<p>One compact line per system instead of a full grid of cards.</p>}
      >
        <div className="compact-list">
          {Object.entries(data.services).map(([key, service]) => {
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
          })}
        </div>
      </SurfaceCard>

      <HeartbeatSettingsSection />

      <section
        style={{
          display: "grid",
          gap: 18,
          gridTemplateColumns: "minmax(0, 1.28fr) minmax(300px, 0.92fr)",
        }}
      >
        <SurfaceCard title="Visible storage paths">
          <div className="compact-list">
            {(data.storage ?? []).map((entry) => (
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

        <SurfaceCard
          title="Runbook shortcuts"
          description={<p>Keep these close; nothing here needs a giant block.</p>}
        >
          <div style={{ display: "grid", gap: 10 }}>
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
