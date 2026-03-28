"use client";

import { useEffect, useState } from "react";
import type {
  AdminMaintenanceAction,
  AdminMaintenanceActionResponse,
  AdminMaintenanceOverviewResponse,
} from "@secretary/core-runtime";
import { fetchJson } from "../../lib/fetch-json";
import { LoadingSurface, NoticeBanner, StatCard, StatGrid, SurfaceCard } from "../../lib/ui";

const actions: Array<{
  action: AdminMaintenanceAction;
  title: string;
  description: string;
  tone: "default" | "soft" | "dark";
}> = [
  {
    action: "clear_stale_agent_jobs",
    title: "Clear stale job residue",
    description: "Remove agent jobs and launch intents whose workspace paths are no longer reachable.",
    tone: "dark",
  },
  {
    action: "clear_stale_speech_media",
    title: "Clear stale speech residue",
    description: "Remove speech artifact records and broken voice sample references that point at files no longer on disk.",
    tone: "dark",
  },
  {
    action: "cancel_active_agent_jobs",
    title: "Cancel active jobs",
    description: "Stop every queued, running, or waiting job so the system can return to an idle state.",
    tone: "soft",
  },
  {
    action: "flush_agent_queue",
    title: "Flush agent queue",
    description: "Drain queued queue entries and clear retained queue state when jobs and Redis drift apart.",
    tone: "soft",
  },
  {
    action: "clear_finished_agent_jobs",
    title: "Clear finished history",
    description: "Remove completed, failed, and cancelled job records plus their saved artifacts.",
    tone: "soft",
  },
  {
    action: "reset_secretary_onboarding",
    title: "Reset secretary to first-run state",
    description:
      "Clear memory, conversations, jobs, tools, integrations, voice state, and agent settings, then restore the built-in first-run secretary defaults.",
    tone: "dark",
  },
  {
    action: "wipe_runtime_state",
    title: "Wipe local runtime state",
    description:
      "Do the onboarding reset and also remove generated exports, downloads, logs, and other local runtime residue so the app starts fresh again.",
    tone: "dark",
  },
  {
    action: "run_health_sweep",
    title: "Run health sweep",
    description: "Recheck worker, queue, storage, and service health without changing any state.",
    tone: "soft",
  },
];

function formatServiceStatus(status: string) {
  return status.replaceAll("_", " ");
}

export function AdminSettingsConsole() {
  const [overview, setOverview] = useState<AdminMaintenanceOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [latestResult, setLatestResult] = useState<AdminMaintenanceActionResponse | null>(null);
  const [busyAction, setBusyAction] = useState<AdminMaintenanceAction | null>(null);

  async function loadOverview() {
    try {
      const payload = await fetchJson<AdminMaintenanceOverviewResponse>("/api/admin/maintenance", { cache: "no-store" });
      setOverview(payload);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load admin maintenance status.");
    }
  }

  useEffect(() => {
    void loadOverview();
  }, []);

  async function runAction(action: AdminMaintenanceAction) {
    setBusyAction(action);
    setStatus(null);

    try {
      const result = await fetchJson<AdminMaintenanceActionResponse>("/api/admin/maintenance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action }),
      });
      setLatestResult(result);
      setOverview(result.overview);
      setError(null);
      setStatus(result.summary);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to run maintenance action.");
    } finally {
      setBusyAction(null);
    }
  }

  if (!overview && !error) {
    return (
      <div style={{ display: "grid", gap: 18 }}>
        {status ? <NoticeBanner tone="success">{status}</NoticeBanner> : null}
        <LoadingSurface
          title="Preparing maintenance controls"
          description={
            <p>
              Gathering queue state, service health, and cleanup counts so the admin surface opens
              with the latest operator picture already in place.
            </p>
          }
          blocks={3}
        />
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {error ? <NoticeBanner tone="error">{error}</NoticeBanner> : null}
      {status ? <NoticeBanner tone="success">{status}</NoticeBanner> : null}

      <SurfaceCard
        tone="dark"
        title="Admin"
        description={
          <p>
            Operator-only maintenance controls for cleanup, repair work, and live system checks.
          </p>
        }
      >
        {overview ? (
          <div style={{ display: "grid", gap: 16 }}>
            <StatGrid>
              <StatCard label="Default workspace" value={overview.defaultWorkspacePath ?? "Not set"} detail="Primary agent-job working root" tone="soft" />
              <StatCard label="Active jobs" value={String(overview.jobs.active)} detail="Runs in motion right now" tone="soft" />
              <StatCard label="Waiting jobs" value={String(overview.jobs.waiting)} detail="Runs blocked on approval or runtime" tone="soft" />
              <StatCard label="Finished jobs" value={String(overview.jobs.finished)} detail="Completed, failed, or cancelled runs" tone="soft" />
              <StatCard label="Stale jobs" value={String(overview.jobs.staleWorkspaceJobs)} detail="Workspace paths no longer reachable" tone="soft" />
              <StatCard label="Stale intents" value={String(overview.jobs.staleWorkspaceLaunchIntents)} detail="Conversation launch intents pointing at dead paths" tone="soft" />
              <StatCard label="Stale speech" value={String(overview.speech.staleArtifacts)} detail="Speech records whose media is gone" tone="soft" />
              <StatCard label="Broken samples" value={String(overview.speech.staleProfileSamples)} detail="Voice samples missing from disk" tone="soft" />
            </StatGrid>

            <div className="admin-health-grid">
              <SurfaceCard tone="soft" title="Queue state">
                <div className="admin-meta-list">
                  {Object.entries(overview.queue).map(([label, value]) => (
                    <div key={label} className="admin-meta-row">
                      <span>{label.replaceAll("_", " ")}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
              </SurfaceCard>

              <SurfaceCard tone="soft" title="Service sweep">
                <div className="admin-meta-list">
                  {Object.entries(overview.health.services).map(([label, service]) => (
                    <div key={label} className="admin-meta-row">
                      <span>{label}</span>
                      <strong>{formatServiceStatus(service.status)}</strong>
                    </div>
                  ))}
                </div>
              </SurfaceCard>
            </div>
          </div>
        ) : null}
      </SurfaceCard>

      <SurfaceCard
        tone="dark"
        title="Maintenance actions"
        description={<p>Use these only for cleanup, recovery, and operator repair work.</p>}
      >
        <div className="admin-actions-grid">
          {actions.map((entry) => (
            <SurfaceCard key={entry.action} tone={entry.tone}>
              <div className="admin-action-card">
                <div style={{ display: "grid", gap: 6 }}>
                  <strong style={{ fontSize: 15 }}>{entry.title}</strong>
                  <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
                    {entry.description}
                  </p>
                </div>
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busyAction !== null}
                  onClick={() => void runAction(entry.action)}
                >
                  {busyAction === entry.action ? "Working..." : "Run"}
                </button>
              </div>
            </SurfaceCard>
          ))}
        </div>
      </SurfaceCard>

      {latestResult ? (
        <SurfaceCard
          tone="soft"
          title="Last maintenance result"
          description={<p>{latestResult.summary}</p>}
        >
          <div className="admin-meta-list">
            {Object.entries(latestResult.details).map(([label, value]) => (
              <div key={label} className="admin-meta-row">
                <span>{label.replaceAll(/([A-Z])/g, " $1").trim()}</span>
                <strong>{String(value)}</strong>
              </div>
            ))}
          </div>
        </SurfaceCard>
      ) : null}
    </div>
  );
}
