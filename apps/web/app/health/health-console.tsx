"use client";

import { useEffect, useState } from "react";
import type { SystemHealthResponse } from "@secretary/core-runtime";

function statusTone(status: string) {
  switch (status) {
    case "ok":
      return {
        badge: "#bbf7d0",
        border: "rgba(134, 239, 172, 0.24)",
        background: "rgba(5, 46, 22, 0.24)",
      };
    case "not_configured":
      return {
        badge: "#cbd5e1",
        border: "rgba(148, 163, 184, 0.2)",
        background: "rgba(15, 23, 42, 0.72)",
      };
    default:
      return {
        badge: "#fde68a",
        border: "rgba(251, 191, 36, 0.28)",
        background: "rgba(120, 53, 15, 0.18)",
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
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 16,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div>
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
                Health Dashboard
              </p>
              <h1
                style={{
                  margin: "12px 0 10px",
                  fontSize: "clamp(2.1rem, 4vw, 4rem)",
                  lineHeight: 1,
                }}
              >
                Local system health and storage
              </h1>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6, maxWidth: 760 }}>
                Short, useful operator state: dependency health, speech and Telegram
                readiness, visible storage paths, and a quick sense of how much state the
                Secretary is carrying.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              style={{
                border: "1px solid rgba(125, 211, 252, 0.2)",
                borderRadius: 999,
                padding: "10px 14px",
                background: "rgba(56, 189, 248, 0.08)",
                color: "var(--text)",
                font: "inherit",
                cursor: "pointer",
              }}
            >
              Refresh
            </button>
          </div>
          <p style={{ margin: "12px 0 0", color: "var(--muted)", fontSize: 14 }}>
            {error ??
              (data
                ? `Updated ${new Date(data.generatedAt).toLocaleString()}`
                : "Loading system health...")}
          </p>
        </header>

        <section
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          {data
            ? Object.entries(data.stats).map(([key, value]) => (
                <article
                  key={key}
                  style={{
                    padding: 18,
                    borderRadius: 22,
                    border: "1px solid var(--border)",
                    background: "var(--panel-strong)",
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>{key}</p>
                  <p style={{ margin: 0, fontSize: 32, fontWeight: 800 }}>{value}</p>
                </article>
              ))
            : null}
        </section>

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
                  <article
                    key={key}
                    style={{
                      padding: 18,
                      borderRadius: 22,
                      border: `1px solid ${tone.border}`,
                      background: "var(--panel-strong)",
                      display: "grid",
                      gap: 10,
                    }}
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
                  </article>
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
                  border: "1px solid rgba(148, 163, 184, 0.14)",
                  background: "rgba(2, 6, 23, 0.65)",
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
      </section>
    </main>
  );
}
