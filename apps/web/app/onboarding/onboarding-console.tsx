"use client";

import type { OnboardingStatusResponse } from "@secretary/core-runtime";
import Link from "next/link";
import { useEffect } from "react";
import { AppPage, PageHero, StatCard, StatGrid, SurfaceCard } from "../lib/ui";
import { useAsyncData } from "../lib/use-async-data";

function stepTone(status: OnboardingStatusResponse["steps"][number]["status"]) {
  switch (status) {
    case "complete":
      return {
        badge: "var(--success-soft-text)",
        border: "var(--success-soft-border)",
        background: "var(--success-soft-bg)",
      };
    case "attention":
      return {
        badge: "var(--warning-soft-text)",
        border: "var(--warning-soft-border)",
        background: "var(--warning-soft-bg)",
      };
    default:
      return {
        badge: "var(--neutral-soft-text)",
        border: "var(--neutral-soft-border)",
        background: "var(--neutral-soft-bg)",
      };
  }
}

async function fetchOnboarding(): Promise<OnboardingStatusResponse> {
  const response = await fetch("/api/onboarding", { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Unable to load onboarding status.");
  }
  return payload as OnboardingStatusResponse;
}

export function OnboardingConsole() {
  const { data, error, load } = useAsyncData(fetchOnboarding);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppPage width="1180px">
      <PageHero
        eyebrow="Overview"
        title="System overview"
        description={
          <p>
            This page is the broad view of what is configured, what still needs attention, and which
            parts of the Secretary stack are ready for daily use.
          </p>
        }
        meta={
          <p>
            {error ??
              (data
                ? `${data.completedSteps} of ${data.totalSteps} setup areas are in a good state.`
                : "Loading system overview...")}
          </p>
        }
      />

      <StatGrid>
        <StatCard
          label="Health"
          value={data ? `${data.completedSteps}/${data.totalSteps}` : "..."}
          detail="Current setup readiness across the local install"
        />
        <StatCard
          label="Conversation"
          value={
            data?.steps.find((step) => step.id === "conversation")?.status === "complete"
              ? "Model-backed"
              : "Fallback"
          }
          detail="Whether secretary text chat is using a real model or local fallback logic"
        />
        <StatCard
          label="Primary channels"
          value="Web + Telegram"
          detail="Desk and bot are active entry points"
        />
        <StatCard
          label="Voice path"
          value="Local STT + TTS"
          detail="Speech stays inside the local stack"
        />
        <StatCard
          label="Next habit"
          value="Backup first"
          detail="Take a snapshot before risky changes or imports"
          tone="soft"
        />
      </StatGrid>

      <section className="stack-md">
        {(data?.steps ?? []).map((step) => {
          const tone = stepTone(step.status);

          return (
            <SurfaceCard key={step.id} className="stack-sm">
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
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>{step.detail}</p>
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
            </SurfaceCard>
          );
        })}
      </section>
    </AppPage>
  );
}
