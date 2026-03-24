"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { OnboardingStatusResponse } from "@secretary/core-runtime";

function stepTone(status: OnboardingStatusResponse["steps"][number]["status"]) {
  switch (status) {
    case "complete":
      return {
        badge: "#bbf7d0",
        border: "rgba(134, 239, 172, 0.24)",
        background: "rgba(5, 46, 22, 0.24)",
      };
    case "attention":
      return {
        badge: "#fde68a",
        border: "rgba(251, 191, 36, 0.28)",
        background: "rgba(120, 53, 15, 0.18)",
      };
    default:
      return {
        badge: "#cbd5e1",
        border: "rgba(148, 163, 184, 0.2)",
        background: "rgba(15, 23, 42, 0.72)",
      };
  }
}

export function OnboardingConsole() {
  const [data, setData] = useState<OnboardingStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/onboarding", { cache: "no-store" });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to load onboarding status.");
        }

        if (!cancelled) {
          setData(payload as OnboardingStatusResponse);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load onboarding.");
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ minHeight: "100vh", padding: "32px 18px 48px" }}>
      <section
        style={{
          width: "min(1180px, 100%)",
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
            Onboarding
          </p>
          <h1
            style={{
              margin: "12px 0 10px",
              fontSize: "clamp(2.1rem, 4vw, 4rem)",
              lineHeight: 1,
            }}
          >
            Finish the daily-use setup
          </h1>
          <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6, maxWidth: 760 }}>
            This page keeps the practical startup sequence visible: make sure the stack is
            healthy, shape the Secretary persona, wire channels, review tools, and confirm
            the voice path is actually usable.
          </p>
          <p style={{ margin: "12px 0 0", color: "var(--muted)", fontSize: 14 }}>
            {error ??
              (data
                ? `${data.completedSteps} of ${data.totalSteps} onboarding steps are complete.`
                : "Loading onboarding state...")}
          </p>
        </header>

        <section
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          {[
            { label: "Health", value: data ? `${data.completedSteps}/${data.totalSteps}` : "..." },
            { label: "Primary channels", value: "Web + Telegram" },
            { label: "Voice path", value: "Local STT + TTS" },
            { label: "Next habit", value: "Back up before risky changes" },
          ].map((item) => (
            <article
              key={item.label}
              style={{
                padding: 18,
                borderRadius: 22,
                border: "1px solid var(--border)",
                background: "var(--panel-strong)",
                display: "grid",
                gap: 6,
              }}
            >
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>{item.label}</p>
              <p style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>{item.value}</p>
            </article>
          ))}
        </section>

        <section style={{ display: "grid", gap: 16 }}>
          {(data?.steps ?? []).map((step) => {
            const tone = stepTone(step.status);

            return (
              <article
                key={step.id}
                style={{
                  padding: 20,
                  borderRadius: 24,
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
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <p
                      style={{
                        margin: 0,
                        color: "var(--accent)",
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                      }}
                    >
                      {step.id}
                    </p>
                    <h2 style={{ margin: "6px 0 0", fontSize: 24 }}>{step.title}</h2>
                  </div>
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
                    {step.status.replace("_", " ")}
                  </span>
                </div>
                <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>
                  {step.detail}
                </p>
                <Link
                  href={step.href}
                  style={{
                    color: "var(--accent)",
                    textDecoration: "none",
                    fontWeight: 700,
                  }}
                >
                  Open {step.href}
                </Link>
              </article>
            );
          })}
        </section>
      </section>
    </main>
  );
}
