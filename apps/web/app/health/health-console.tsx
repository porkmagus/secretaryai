"use client";

import { useEffect, useState } from "react";
import type { SystemHealthResponse } from "@secretary/core-runtime";
import { AppPage, PageHero, StatCard, StatGrid, SurfaceCard } from "../lib/ui";

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
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const response = await fetch("/api/system/health", { cache: "no-store" });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load system health.");
      }

      setData(payload as SystemHealthResponse);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load system health.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <AppPage>
      <PageHero
        eyebrow="Health Dashboard"
        title="Local system health and storage"
        description={
          <p>
            Short, useful operator state: dependency health, speech and Telegram
            readiness, visible storage paths, and a quick sense of how much state the
            Secretary is carrying.
          </p>
        }
        meta={
          <p>
            {error ??
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
      />

      <StatGrid>
          {data
            ? Object.entries(data.stats).map(([key, value]) => (
                <StatCard
                  key={key}
                  label={key}
                  value={value}
                  detail="Current runtime snapshot"
                />
              ))
            : null}
      </StatGrid>

      <section
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          }}
        >
          {data
            ? Object.entries(data.services).map(([key, service]) => {
                const tone = statusTone(service.status);

                return (
                  <SurfaceCard
                    key={key}
                    className="stack-sm"
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        alignItems: "center",
                      }}
                    >
                      <h2 style={{ margin: 0, fontSize: 20 }}>{key}</h2>
                      <span
                        style={{
                          padding: "6px 10px",
                          borderRadius: 999,
                          background: tone.background,
                          border: `1px solid ${tone.border}`,
                          color: tone.badge,
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        {service.status}
                      </span>
                    </div>
                    <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                      {service.summary}
                    </p>
                  </SurfaceCard>
                );
              })
            : null}
      </section>

      <section
          style={{
            display: "grid",
            gap: 20,
            gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 0.9fr)",
          }}
        >
          <article
            style={{
              padding: 20,
              borderRadius: 24,
              border: "1px solid var(--border)",
              background: "var(--panel-strong)",
              display: "grid",
              gap: 12,
            }}
          >
            <h2 style={{ margin: 0 }}>Visible storage paths</h2>
            {(data?.storage ?? []).map((entry) => (
              <article
                key={entry.path}
                style={{
                  padding: 12,
                  borderRadius: 14,
                  border: "1px solid rgba(64, 89, 112, 0.12)",
                  background: "rgba(255, 255, 255, 0.66)",
                }}
              >
                <p style={{ margin: "0 0 4px", fontWeight: 700 }}>{entry.label}</p>
                <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>{entry.path}</p>
                <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 12 }}>
                  {entry.exists ? "available" : "missing"}
                </p>
              </article>
            ))}
          </article>

          <article
            style={{
              padding: 20,
              borderRadius: 24,
              border: "1px solid var(--border)",
              background: "var(--panel-strong)",
              display: "grid",
              gap: 12,
            }}
          >
            <h2 style={{ margin: 0 }}>Runbook shortcuts</h2>
            {[
              "`npm run stack:up` for local services",
              "`npm run backup:create` to write a backup bundle into runtime/backups",
              "`npm run export:settings` for a JSON settings snapshot",
              "`npm run phase6:verify` for the Phase 6 acceptance pass",
            ].map((line) => (
              <p key={line} style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>
                {line}
              </p>
            ))}
          </article>
        </section>
    </AppPage>
  );
}
