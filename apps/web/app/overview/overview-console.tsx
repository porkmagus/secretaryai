"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  HeartbeatIntegrationStatusResponse,
  OnboardingStatusResponse,
  SystemHealthResponse,
} from "@secretary/core-runtime";
import { AppPage, NoticeBanner, PageHero, SurfaceCard } from "../lib/ui";

function statusTone(status: string) {
  switch (status) {
    case "ok":
    case "complete":
      return {
        badge: "var(--success-soft-text)",
        border: "var(--success-soft-border)",
        background: "var(--success-soft-bg)",
      };
    case "not_configured":
    case "not_started":
    case "disabled":
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

type OverviewState = {
  heartbeat: HeartbeatIntegrationStatusResponse["integration"] | null;
  onboarding: OnboardingStatusResponse | null;
  health: SystemHealthResponse | null;
};

export function OverviewConsole() {
  const [state, setState] = useState<OverviewState>({
    heartbeat: null,
    onboarding: null,
    health: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRunningHeartbeat, setIsRunningHeartbeat] = useState(false);

  async function load() {
    setError(null);

    try {
      const [onboardingResponse, healthResponse, heartbeatResponse] = await Promise.all([
        fetch("/api/onboarding", { cache: "no-store" }),
        fetch("/api/system/health", { cache: "no-store" }),
        fetch("/api/integrations/heartbeat", { cache: "no-store" }),
      ]);
      const [onboardingPayload, healthPayload, heartbeatPayload] = await Promise.all([
        onboardingResponse.json(),
        healthResponse.json(),
        heartbeatResponse.json(),
      ]);

      if (!onboardingResponse.ok) {
        throw new Error(onboardingPayload.error ?? "Unable to load system overview.");
      }

      if (!healthResponse.ok) {
        throw new Error(healthPayload.error ?? "Unable to load system health.");
      }

      if (!heartbeatResponse.ok) {
        throw new Error(heartbeatPayload.error ?? "Unable to load heartbeat status.");
      }

      setState({
        onboarding: onboardingPayload as OnboardingStatusResponse,
        health: healthPayload as SystemHealthResponse,
        heartbeat: (heartbeatPayload as HeartbeatIntegrationStatusResponse).integration,
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load system overview.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const readiness = useMemo(() => {
    if (!state.onboarding) {
      return [];
    }

    return state.onboarding.steps;
  }, [state.onboarding]);
  const storageByLabel = useMemo(
    () => new Map((state.health?.storage ?? []).map((entry) => [entry.label, entry])),
    [state.health],
  );

  const attentionItems = readiness.filter((step) => step.status !== "complete");
  const services = state.health ? Object.entries(state.health.services) : [];
  const nonIdealServices = services.filter(([, service]) => service.status !== "ok");
  const nextHeartbeatAt = state.heartbeat?.nextRunAt
    ? new Date(state.heartbeat.nextRunAt).toLocaleString()
    : "not scheduled";
  const nextHeartbeatLabel = state.heartbeat?.nextRunAt
    ? new Intl.DateTimeFormat(undefined, {
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(state.heartbeat.nextRunAt))
    : "not scheduled";
  const overviewSignal = error
    ? error
    : attentionItems.length > 0 || nonIdealServices.length > 0
      ? `${attentionItems.length + nonIdealServices.length} area${
          attentionItems.length + nonIdealServices.length === 1 ? "" : "s"
        } need attention. ${attentionItems[0]?.title ?? nonIdealServices[0]?.[0]} is the first place to check.`
      : state.health && state.onboarding
        ? `All good. The secretary is model-backed, the local stack is healthy, and heartbeat is due again ${nextHeartbeatAt}.`
        : "Loading overview...";

  async function refresh() {
    setIsRefreshing(true);
    await load();
  }

  async function runHeartbeatNow() {
    setIsRunningHeartbeat(true);
    setError(null);

    try {
      const response = await fetch("/api/integrations/heartbeat/run", { method: "POST" });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to run heartbeat.");
      }

      await load();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Unable to run heartbeat.");
    } finally {
      setIsRunningHeartbeat(false);
    }
  }

  return (
    <AppPage width="1220px">
      <PageHero
        title="Overview"
        description={<p>A compact readout of the secretary&apos;s current environment and the few things worth checking.</p>}
        tone="dark"
      />

      <NoticeBanner
        tone={
          error
            ? "error"
            : attentionItems.length > 0 || nonIdealServices.length > 0
              ? "warning"
              : "success"
        }
      >
        {overviewSignal}
      </NoticeBanner>

      <section
        style={{
          display: "grid",
          gap: 18,
        }}
      >
        <SurfaceCard
          tone="dark"
          title="Local stack"
          description={<p>Runtime health and storage visibility in one compact place.</p>}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 10,
              alignItems: "center",
              flexWrap: "nowrap",
              overflow: "hidden",
              padding: "10px 12px",
              borderRadius: 14,
              border: "1px solid rgba(164, 141, 100, 0.16)",
              background:
                "linear-gradient(180deg, rgba(43, 35, 27, 0.98), rgba(28, 23, 18, 0.96))",
              boxShadow: "inset 0 1px 0 rgba(255, 248, 238, 0.04)",
            }}
          >
            {[
              ["Readiness", state.onboarding ? `${state.onboarding.completedSteps}/${state.onboarding.totalSteps}` : "..."],
              ["Conversation", state.health?.services.conversation.status === "ok" ? "model-backed" : "fallback"],
              ["Channels", state.health?.services.telegram.status === "ok" ? "web + telegram" : "web only"],
              [
                "Voice",
                state.health?.services.stt.status === "ok" && state.health?.services.tts.status === "ok"
                  ? "stt + tts ready"
                  : "needs attention",
              ],
              ["Heartbeat", nextHeartbeatLabel],
            ].map(([label, value], index) => (
              <div
                key={String(label)}
                style={{
                  display: "inline-flex",
                  alignItems: "baseline",
                  gap: 6,
                  minWidth: 0,
                  flex: "0 1 auto",
                  paddingLeft: index === 0 ? 0 : 10,
                  borderLeft: index === 0 ? "none" : "1px solid rgba(196, 180, 154, 0.1)",
                }}
              >
                <span className="summary-chip-label" style={{ whiteSpace: "nowrap", fontSize: 9 }}>
                  {label}
                </span>
                <span
                  className="summary-chip-value"
                  style={{
                    fontSize: 12,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {value}
                </span>
              </div>
            ))}

            {[
              ["Refresh", isRefreshing ? "Refreshing..." : "Refresh", "button-secondary", () => void refresh()],
              [
                "Run Heartbeat",
                isRunningHeartbeat ? "Running..." : "Run Heartbeat",
                "button-primary",
                () => void runHeartbeatNow(),
              ],
            ].map(([key, label, className, action]) => (
              <div
                key={String(key)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  paddingLeft: 10,
                  borderLeft: "1px solid rgba(196, 180, 154, 0.1)",
                  flex: "0 0 auto",
                }}
              >
                <button
                  type="button"
                  className={String(className)}
                  onClick={action as () => void}
                  style={{ minHeight: 32, padding: "7px 11px", borderRadius: 10 }}
                >
                  {label as string}
                </button>
              </div>
            ))}
          </div>

          <div
            style={{
              display: "grid",
              gap: 14,
              alignItems: "start",
            }}
          >
            <div className="compact-list" style={{ alignSelf: "start" }}>
              {services.map(([key, service]) => {
                const tone = statusTone(service.status);
                const linkedStorage =
                  key === "postgres"
                    ? [storageByLabel.get("Postgres data")]
                    : key === "redis"
                      ? [storageByLabel.get("Redis data")]
                      : key === "stt"
                        ? [storageByLabel.get("Speech storage")]
                        : key === "tts"
                          ? [storageByLabel.get("Speech profiles")]
                          : [];

                return (
                  <div
                    key={key}
                    style={{
                      display: "grid",
                      gap: 8,
                      padding: "10px 0",
                      gridTemplateColumns: "minmax(140px, 176px) minmax(0, 1fr)",
                      alignItems: "start",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          padding: "4px 8px",
                          borderRadius: 999,
                          background: tone.background,
                          border: `1px solid ${tone.border}`,
                          color: tone.badge,
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                        }}
                      >
                        {service.status}
                      </span>
                      <strong style={{ fontSize: 13, textTransform: "capitalize" }}>{key}</strong>
                    </div>
                    <div className="stack-sm" style={{ gap: 6 }}>
                      <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.45, fontSize: 12 }}>
                        {service.summary}
                      </p>
                      {linkedStorage
                        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
                        .map((entry) => (
                          <div
                            key={entry.path}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              minWidth: 0,
                              flexWrap: "wrap",
                            }}
                          >
                            <span className="summary-chip-label" style={{ whiteSpace: "nowrap" }}>
                              {entry.label}
                            </span>
                            <span
                              style={{
                                color: entry.exists ? "var(--success-soft-text)" : "var(--warning-soft-text)",
                                fontSize: 10,
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: "0.06em",
                              }}
                            >
                              {entry.exists ? "ok" : "missing"}
                            </span>
                            <span
                              style={{
                                minWidth: 0,
                                color: "var(--muted)",
                                fontSize: 12,
                                lineHeight: 1.45,
                                fontFamily: "var(--font-mono)",
                              }}
                            >
                              {entry.path}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              style={{
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
                paddingTop: 2,
              }}
            >
              {["Backups", "Exports"]
                .map((label) => storageByLabel.get(label))
                .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
                .map((entry) => (
                  <div
                    key={entry.path}
                    style={{
                      display: "grid",
                      gap: 4,
                      minWidth: "min(320px, 100%)",
                      padding: "8px 10px",
                      borderRadius: 12,
                      background: "rgba(255, 248, 238, 0.03)",
                      border: "1px solid rgba(196, 180, 154, 0.08)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <span className="summary-chip-label">{entry.label}</span>
                      <span
                        style={{
                          color: entry.exists ? "var(--success-soft-text)" : "var(--warning-soft-text)",
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                        }}
                      >
                        {entry.exists ? "ok" : "missing"}
                      </span>
                    </div>
                    <span
                      style={{
                        color: "var(--muted)",
                        fontSize: 12,
                        lineHeight: 1.45,
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {entry.path}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </SurfaceCard>

        <div
          style={{
            display: "grid",
            gap: 18,
            gridTemplateColumns: "minmax(0, 1fr) minmax(300px, 0.72fr)",
            alignItems: "start",
          }}
        >
          <SurfaceCard
            title={attentionItems.length > 0 ? "Focus areas" : "Areas tracked"}
            description={
              <p>
                {attentionItems.length > 0
                  ? "Only the setup areas that still deserve a manual glance."
                  : "Everything is currently landing in a healthy state."}
              </p>
            }
          >
            <div
              className="compact-list"
            >
              {(attentionItems.length > 0 ? attentionItems : readiness).map((step) => {
                const tone = statusTone(step.status);

                return (
                  <div
                    key={step.id}
                    style={{
                      display: "grid",
                      gap: 8,
                      padding: "10px 0",
                      gridTemplateColumns: "minmax(130px, 160px) auto",
                      alignItems: "start",
                    }}
                  >
                    <div className="stack-sm" style={{ gap: 4, alignContent: "start" }}>
                      <span
                        style={{
                          justifySelf: "start",
                          padding: "4px 8px",
                          borderRadius: 999,
                          background: tone.background,
                          border: `1px solid ${tone.border}`,
                          color: tone.badge,
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                        }}
                      >
                        {attentionItems.length > 0 ? step.status.replace("_", " ") : step.id}
                      </span>
                    </div>
                    <div className="stack-sm" style={{ gap: 4 }}>
                      <strong style={{ fontSize: 13 }}>{step.title}</strong>
                      {attentionItems.length > 0 ? (
                        <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, lineHeight: 1.45 }}>
                          {step.detail}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </SurfaceCard>

          <SurfaceCard title="Statistics" description={<p>Live totals worth keeping in view.</p>}>
            <div className="compact-list">
              {[
                ["Conversations", state.health?.stats.conversations ?? 0],
                ["Messages", state.health?.stats.messages ?? 0],
                ["Memories", state.health?.stats.memories ?? 0],
                ["Tasks", state.health?.stats.tasks ?? 0],
                ["Tool runs", state.health?.stats.toolExecutions ?? 0],
                ["Voice profiles", state.health?.stats.voiceProfiles ?? 0],
              ].map(([label, value]) => (
                <div
                  key={String(label)}
                  style={{
                    display: "grid",
                    gap: 6,
                    padding: "10px 0",
                    gridTemplateColumns: "minmax(150px, 180px) auto",
                    alignItems: "center",
                  }}
                >
                  <strong style={{ fontSize: 13 }}>{label}</strong>
                  <p style={{ margin: 0, color: "var(--text)", fontSize: 13, fontWeight: 700 }}>
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </SurfaceCard>
        </div>
      </section>
    </AppPage>
  );
}
