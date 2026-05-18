"use client";

import type {
  AgentJobActionResponse,
  AgentJobArtifactRecord,
  AgentJobDetailResponse,
  AgentJobListResponse,
  AgentJobRecord,
  AgentJobRequirementDecisionRequest,
  AgentJobRequirementRecord,
  AgentJobSettingsResponse,
  CreateAgentJobRequest,
} from "@secretary/core-runtime";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { fetchJson } from "../../lib/fetch-json";
import { formatTimestamp } from "../../lib/presenters";
import {
  AppPage,
  EmptyState,
  NoticeBanner,
  PageHero,
  StatCard,
  StatGrid,
  SurfaceCard,
} from "../../lib/ui";
import { usePolling } from "../../lib/use-polling";
import { JobStatusPill } from "./sections";

export type JobFormState = {
  title: string;
  goal: string;
  workspacePath: string;
  constraintsText: string;
  deliverablesText: string;
};

type JobsViewMode = "operations" | "history";

const defaultForm: JobFormState = {
  title: "New build job",
  goal: "",
  workspacePath: "/mnt/f/hamcult",
  constraintsText: "",
  deliverablesText: "",
};

const RUNNING_JOB_STATUSES = ["queued", "planning", "running", "retrying"] as const;
const WAITING_JOB_STATUSES = ["waiting_for_approval", "waiting_for_runtime", "blocked"] as const;
const ACTIVE_JOB_STATUSES = [...RUNNING_JOB_STATUSES, ...WAITING_JOB_STATUSES] as const;
const HISTORY_JOB_STATUSES = ["completed", "failed", "cancelled"] as const;

function hasJobStatus(job: AgentJobRecord, statuses: readonly string[]) {
  return statuses.includes(job.status);
}

function parseLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function _statusTone(status: string) {
  if (status === "completed") {
    return {
      background: "var(--success-soft-bg)",
      border: "var(--success-soft-border)",
      text: "var(--success-soft-text)",
    };
  }

  if (status === "failed" || status === "blocked" || status === "waiting_for_runtime") {
    return {
      background: "var(--danger-soft-bg)",
      border: "var(--danger-soft-border)",
      text: "var(--danger-soft-text)",
    };
  }

  if (
    status === "running" ||
    status === "ready" ||
    status === "planning" ||
    status === "retrying"
  ) {
    return {
      background: "var(--warning-soft-bg)",
      border: "var(--warning-soft-border)",
      text: "var(--warning-soft-text)",
    };
  }

  return {
    background: "var(--neutral-soft-bg)",
    border: "var(--neutral-soft-border)",
    text: "var(--neutral-soft-text)",
  };
}

function ArtifactContent({ artifact }: { artifact: AgentJobArtifactRecord }) {
  const fileHref = artifact.storageKey
    ? `/api/agent-jobs/artifacts/file?storageKey=${encodeURIComponent(artifact.storageKey)}${
        artifact.mimeType ? `&mimeType=${encodeURIComponent(artifact.mimeType)}` : ""
      }`
    : null;

  if (artifact.mimeType?.startsWith("image/") && fileHref) {
    return (
      <div style={{ display: "grid", gap: 8 }}>
        <a
          href={fileHref}
          target="_blank"
          rel="noreferrer"
          className="button-secondary"
          style={{ justifySelf: "start" }}
        >
          Open image artifact
        </a>
        <img
          src={fileHref}
          alt={artifact.label}
          style={{
            width: "100%",
            maxHeight: 280,
            objectFit: "cover",
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        />
      </div>
    );
  }

  if (fileHref) {
    return (
      <a
        href={fileHref}
        target="_blank"
        rel="noreferrer"
        className="button-secondary"
        style={{ justifySelf: "start" }}
      >
        Download artifact
      </a>
    );
  }

  if (!artifact.contentText) {
    return null;
  }

  return (
    <pre
      style={{
        margin: 0,
        whiteSpace: "pre-wrap",
        fontSize: 12,
        lineHeight: 1.55,
        color: "var(--muted)",
      }}
    >
      {artifact.contentText}
    </pre>
  );
}

export function JobsConsole() {
  const [jobs, setJobs] = useState<AgentJobRecord[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<JobsViewMode>("operations");
  const [detail, setDetail] = useState<AgentJobDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [actionBusyKey, setActionBusyKey] = useState<string | null>(null);
  const [isCreating, startCreateTransition] = useTransition();
  const [form, setForm] = useState<JobFormState>(defaultForm);
  const [showAllFinished, setShowAllFinished] = useState(false);

  const loadJobs = useCallback(
    async (preferredJobId?: string | null, options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setIsLoadingList(true);
      }

      try {
        const payload = await fetchJson<AgentJobListResponse>("/api/agent-jobs", {
          cache: "no-store",
        });
        const nextJobs = payload.jobs;
        setJobs(nextJobs);
        setError(null);

        const operationalJobs = nextJobs.filter((job) => hasJobStatus(job, ACTIVE_JOB_STATUSES));
        const nextSelected =
          preferredJobId && nextJobs.some((job) => job.id === preferredJobId)
            ? preferredJobId
            : (operationalJobs[0]?.id ?? nextJobs[0]?.id ?? null);
        setSelectedJobId(nextSelected);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load agent jobs.");
      } finally {
        if (!options?.silent) {
          setIsLoadingList(false);
        }
      }
    },
    [],
  );

  const loadDetail = useCallback(async (jobId: string, options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setIsLoadingDetail(true);
    }

    try {
      const payload = await fetchJson<AgentJobDetailResponse>(`/api/agent-jobs/${jobId}`, {
        cache: "no-store",
      });
      setDetail(payload);
      setDetailError(null);
    } catch (loadError) {
      setDetail(null);
      setDetailError(loadError instanceof Error ? loadError.message : "Unable to load agent job.");
    } finally {
      if (!options?.silent) {
        setIsLoadingDetail(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadJobs();

    void (async () => {
      try {
        const payload = await fetchJson<AgentJobSettingsResponse>("/api/agent-job-settings", {
          cache: "no-store",
        });
        const settings = payload.settings;
        setForm((current) => ({
          ...current,
          workspacePath: settings.defaultWorkspacePath ?? current.workspacePath,
        }));
      } catch {
        return;
      }
    })();
  }, [loadJobs]);

  useEffect(() => {
    if (!selectedJobId) {
      setDetail(null);
      setDetailError(null);
      return;
    }

    void loadDetail(selectedJobId);
  }, [selectedJobId, loadDetail]);

  usePolling({
    enabled: detail ? hasJobStatus(detail.job, ACTIVE_JOB_STATUSES) : false,
    intervalMs: 4000,
    callback: async () => {
      if (!detail) {
        return;
      }

      await loadJobs(detail.job.id, { silent: true });
      await loadDetail(detail.job.id, { silent: true });
    },
  });

  const summary = useMemo(
    () => ({
      active: jobs.filter((job) => hasJobStatus(job, RUNNING_JOB_STATUSES)).length,
      waiting: jobs.filter((job) => hasJobStatus(job, WAITING_JOB_STATUSES)).length,
      completed: jobs.filter((job) => job.status === "completed").length,
    }),
    [jobs],
  );
  const groupedJobs = useMemo(
    () => ({
      active: jobs.filter((job) => hasJobStatus(job, RUNNING_JOB_STATUSES)),
      waiting: jobs.filter((job) => hasJobStatus(job, WAITING_JOB_STATUSES)),
      finished: jobs.filter((job) => hasJobStatus(job, HISTORY_JOB_STATUSES)),
    }),
    [jobs],
  );

  const operationalJobs = useMemo(
    () => [...groupedJobs.active, ...groupedJobs.waiting],
    [groupedJobs.active, groupedJobs.waiting],
  );

  const updateForm = useCallback(<K extends keyof JobFormState>(key: K, value: JobFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  const visibleFinishedJobs = useMemo(() => {
    if (showAllFinished) {
      return groupedJobs.finished;
    }

    const selectedFinishedJob = groupedJobs.finished.find((job) => job.id === selectedJobId);
    const baseEntries = groupedJobs.finished.slice(0, 6);

    if (selectedFinishedJob && !baseEntries.some((job) => job.id === selectedFinishedJob.id)) {
      return [selectedFinishedJob, ...baseEntries.slice(0, 5)];
    }

    return baseEntries;
  }, [groupedJobs.finished, selectedJobId, showAllFinished]);

  const activeDetailJobId = useMemo(() => {
    if (selectedJobId && operationalJobs.some((job) => job.id === selectedJobId)) {
      return selectedJobId;
    }

    return operationalJobs[0]?.id ?? null;
  }, [operationalJobs, selectedJobId]);

  const historyDetailJobId = useMemo(() => {
    if (selectedJobId && groupedJobs.finished.some((job) => job.id === selectedJobId)) {
      return selectedJobId;
    }

    return groupedJobs.finished[0]?.id ?? null;
  }, [groupedJobs.finished, selectedJobId]);

  const createJob = useCallback(() => {
    startCreateTransition(async () => {
      try {
        const requestBody: CreateAgentJobRequest = {
          title: form.title.trim(),
          goal: form.goal.trim(),
          workspacePath: form.workspacePath.trim(),
          constraints: parseLines(form.constraintsText),
          deliverables: parseLines(form.deliverablesText),
        };

        const payload = await fetchJson<{ job: AgentJobRecord }>("/api/agent-jobs", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });
        const nextJob = payload.job;
        await loadJobs(nextJob.id);
        await loadDetail(nextJob.id);
        setForm((current) => ({
          ...current,
          title: defaultForm.title,
          goal: "",
          constraintsText: "",
          deliverablesText: "",
        }));
      } catch (createError) {
        setError(
          createError instanceof Error ? createError.message : "Unable to create agent job.",
        );
      }
    });
  }, [form, loadJobs, loadDetail]);

  const runJobAction = useCallback(
    async (jobId: string, action: "resume" | "cancel") => {
      setActionBusyKey(`${action}:${jobId}`);

      try {
        const payload = await fetchJson<AgentJobActionResponse>(
          `/api/agent-jobs/${jobId}/${action}`,
          {
            method: "POST",
          },
        );
        const nextJob = payload.job;
        await loadJobs(nextJob.id);
        await loadDetail(nextJob.id);
      } catch (actionError) {
        setError(
          actionError instanceof Error ? actionError.message : `Unable to ${action} agent job.`,
        );
      } finally {
        setActionBusyKey(null);
      }
    },
    [loadJobs, loadDetail],
  );

  const decideRequirement = useCallback(
    async (jobId: string, requirementId: string, approved: boolean) => {
      setActionBusyKey(`${approved ? "approve" : "deny"}:${requirementId}`);

      try {
        const body: AgentJobRequirementDecisionRequest = {
          approved,
          reason: approved ? "Approved from the jobs queue." : "Denied from the jobs queue.",
        };
        const payload = await fetchJson<AgentJobActionResponse>(
          `/api/agent-jobs/${jobId}/requirements/${requirementId}/decision`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          },
        );
        const nextJob = payload.job;
        await loadJobs(nextJob.id);
        await loadDetail(nextJob.id);
      } catch (actionError) {
        setError(
          actionError instanceof Error ? actionError.message : "Unable to update requirement.",
        );
      } finally {
        setActionBusyKey(null);
      }
    },
    [loadJobs, loadDetail],
  );

  return (
    <AppPage width="1380px">
      <PageHero
        eyebrow="Activity"
        title="Agent jobs"
        description={
          <p>
            Start autonomous work, keep an eye on the active build, and step in only when the queue
            genuinely needs you.
          </p>
        }
        meta={
          <p>
            {error ??
              (isLoadingList
                ? "Loading agent jobs..."
                : `${summary.active} active, ${summary.waiting} waiting, ${summary.completed} completed.`)}
          </p>
        }
        tone="dark"
      />

      {error ? <NoticeBanner tone="error">{error}</NoticeBanner> : null}
      {detailError ? <NoticeBanner tone="warning">{detailError}</NoticeBanner> : null}

      <div className="summary-strip">
        {[
          ["Active", summary.active],
          ["Waiting", summary.waiting],
          ["Completed", summary.completed],
        ].map(([label, value]) => (
          <div key={String(label)} className="summary-chip">
            <p className="summary-chip-label">{label}</p>
            <p className="summary-chip-value">{value}</p>
          </div>
        ))}
      </div>

      <div className="jobs-subtabs">
        <button
          type="button"
          className={`jobs-subtabs__tab${viewMode === "operations" ? " is-active" : ""}`}
          onClick={() => {
            setViewMode("operations");
            if (activeDetailJobId) {
              setSelectedJobId(activeDetailJobId);
            }
          }}
        >
          Jobs Start/Active/Queued
        </button>
        <button
          type="button"
          className={`jobs-subtabs__tab${viewMode === "history" ? " is-active" : ""}`}
          onClick={() => {
            setViewMode("history");
            if (historyDetailJobId) {
              setSelectedJobId(historyDetailJobId);
            }
          }}
        >
          History & Artifacts
        </button>
      </div>

      {viewMode === "operations" ? (
        <div className="jobs-operations-stack">
          <SurfaceCard
            tone="dark"
            title="Start job"
            description={
              <p>
                Name the work, point it at a workspace, and describe the build outcome you want.
              </p>
            }
          >
            <div className="jobs-create-grid">
              <label className="jobs-field">
                <span className="jobs-field__label">Title</span>
                <input
                  value={form.title}
                  onChange={(event) => updateForm("title", event.target.value)}
                  className="input-shell"
                />
              </label>

              <label className="jobs-field">
                <span className="jobs-field__label">Workspace</span>
                <input
                  value={form.workspacePath}
                  onChange={(event) => updateForm("workspacePath", event.target.value)}
                  className="input-shell"
                />
              </label>

              <div className="jobs-create-grid__action">
                <button
                  type="button"
                  onClick={createJob}
                  disabled={
                    isCreating ||
                    !form.goal.trim() ||
                    !form.workspacePath.trim() ||
                    !form.title.trim()
                  }
                  className="button-primary"
                >
                  {isCreating ? "Starting job..." : "Start agent job"}
                </button>
              </div>

              <label className="jobs-field jobs-field--goal">
                <span className="jobs-field__label">Goal</span>
                <textarea
                  value={form.goal}
                  onChange={(event) => updateForm("goal", event.target.value)}
                  className="textarea-shell"
                  rows={3}
                  placeholder="Describe what the agent should build or change."
                />
              </label>

              <label className="jobs-field">
                <span className="jobs-field__label">Constraints</span>
                <textarea
                  value={form.constraintsText}
                  onChange={(event) => updateForm("constraintsText", event.target.value)}
                  className="textarea-shell"
                  rows={3}
                  placeholder="One constraint per line."
                />
              </label>

              <label className="jobs-field">
                <span className="jobs-field__label">Deliverables</span>
                <textarea
                  value={form.deliverablesText}
                  onChange={(event) => updateForm("deliverablesText", event.target.value)}
                  className="textarea-shell"
                  rows={3}
                  placeholder="One deliverable per line."
                />
              </label>
            </div>
          </SurfaceCard>

          <SurfaceCard
            tone="dark"
            title={detail && detail.job.id === activeDetailJobId ? detail.job.title : "Active job"}
            description={
              <p>
                {detail && detail.job.id === activeDetailJobId
                  ? `${detail.job.goal} ${detail.job.blockerSummary ? `Blocker: ${detail.job.blockerSummary}` : ""}`.trim()
                  : "The current in-flight or waiting job lives here, with its steps, blockers, and evidence."}
              </p>
            }
          >
            {!activeDetailJobId ? (
              <EmptyState
                title="Nothing is in motion right now"
                description={<p>Start a new job above, and the live workbench will appear here.</p>}
              />
            ) : isLoadingDetail && detail?.job.id !== activeDetailJobId ? (
              <p style={{ margin: 0, color: "var(--muted)" }}>Loading job detail...</p>
            ) : detail && detail.job.id === activeDetailJobId ? (
              <div className="jobs-detail">
                {detail.job.blockerSummary ? (
                  <NoticeBanner
                    tone={
                      detail.job.status === "waiting_for_runtime" || detail.job.status === "blocked"
                        ? "warning"
                        : "info"
                    }
                  >
                    {detail.job.blockerSummary}
                  </NoticeBanner>
                ) : null}

                <div className="jobs-detail__header">
                  <div className="jobs-detail__stats">
                    <StatGrid>
                      <StatCard
                        label="Status"
                        value={<JobStatusPill status={detail.job.status} />}
                        detail="Current run state"
                        tone="soft"
                      />
                      <StatCard
                        label="Current step"
                        value={
                          detail.steps.find((step) => step.id === detail.job.currentStepId)
                            ?.title ?? "Not set"
                        }
                        detail="What the agent is working through now"
                        tone="soft"
                      />
                      <StatCard
                        label="Updated"
                        value={formatTimestamp(detail.job.updatedAt)}
                        detail="Latest durable checkpoint"
                        tone="soft"
                      />
                    </StatGrid>
                  </div>

                  <div className="jobs-detail__actions">
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={
                        actionBusyKey === `resume:${detail.job.id}` ||
                        detail.job.status === "completed" ||
                        detail.job.status === "cancelled"
                      }
                      onClick={() => void runJobAction(detail.job.id, "resume")}
                    >
                      {actionBusyKey === `resume:${detail.job.id}` ? "Resuming..." : "Resume"}
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={
                        actionBusyKey === `cancel:${detail.job.id}` ||
                        detail.job.status === "completed" ||
                        detail.job.status === "cancelled"
                      }
                      onClick={() => void runJobAction(detail.job.id, "cancel")}
                    >
                      {actionBusyKey === `cancel:${detail.job.id}` ? "Stopping..." : "Stop job"}
                    </button>
                  </div>
                </div>

                <div className="jobs-detail__workspace">
                  <SurfaceCard tone="soft" title="Planned steps">
                    {detail.steps.length === 0 ? (
                      <p style={{ margin: 0, color: "var(--muted)" }}>No steps recorded yet.</p>
                    ) : (
                      <div className="compact-list jobs-panel-scroll">
                        {detail.steps.map((step) => (
                          <div key={step.id} className="jobs-item-row">
                            <div className="jobs-item-row__top">
                              <strong style={{ fontSize: 14 }}>
                                {step.sequence}. {step.title}
                              </strong>
                              <JobStatusPill status={step.status} />
                            </div>
                            <p className="jobs-item-row__body">{step.detail}</p>
                            <p className="jobs-item-row__meta">
                              {step.toolKey
                                ? `Runtime: ${step.toolKey}`
                                : "No runtime hint recorded."}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </SurfaceCard>

                  <div className="jobs-detail__support">
                    <SurfaceCard tone="soft" title="Requirements and blockers">
                      {detail.requirements.length === 0 ? (
                        <EmptyState
                          title="No blockers recorded"
                          description={
                            <p>
                              This run does not currently need extra approval, runtime help, or
                              intervention.
                            </p>
                          }
                        />
                      ) : (
                        <div className="compact-list jobs-panel-scroll">
                          {detail.requirements.map((requirement: AgentJobRequirementRecord) => (
                            <div key={requirement.id} className="jobs-item-row">
                              <div className="jobs-item-row__top">
                                <strong style={{ fontSize: 14 }}>{requirement.label}</strong>
                                <JobStatusPill status={requirement.status} />
                              </div>
                              <p className="jobs-item-row__body">
                                {requirement.detail ?? "No extra detail recorded."}
                              </p>
                              {Object.keys(requirement.metadataJson ?? {}).length > 0 ? (
                                <pre className="jobs-item-row__json">
                                  {JSON.stringify(requirement.metadataJson, null, 2)}
                                </pre>
                              ) : null}
                              {requirement.status === "pending" ? (
                                <div className="jobs-detail__actions">
                                  <button
                                    type="button"
                                    className="button-secondary"
                                    disabled={actionBusyKey === `approve:${requirement.id}`}
                                    onClick={() =>
                                      void decideRequirement(detail.job.id, requirement.id, true)
                                    }
                                  >
                                    {actionBusyKey === `approve:${requirement.id}`
                                      ? "Working..."
                                      : "Approve"}
                                  </button>
                                  <button
                                    type="button"
                                    className="button-secondary"
                                    disabled={actionBusyKey === `deny:${requirement.id}`}
                                    onClick={() =>
                                      void decideRequirement(detail.job.id, requirement.id, false)
                                    }
                                  >
                                    {actionBusyKey === `deny:${requirement.id}`
                                      ? "Working..."
                                      : "Deny"}
                                  </button>
                                </div>
                              ) : null}
                              {requirement.resolutionText ? (
                                <p className="jobs-item-row__meta">
                                  Resolution: {requirement.resolutionText}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </SurfaceCard>

                    <SurfaceCard tone="soft" title="Artifacts">
                      {detail.artifacts.length === 0 ? (
                        <EmptyState
                          title="No evidence captured yet"
                          description={
                            <p>
                              Artifacts will appear here as the job produces logs, files, and
                              verification output.
                            </p>
                          }
                        />
                      ) : (
                        <div className="compact-list jobs-panel-scroll">
                          {detail.artifacts.map((artifact: AgentJobArtifactRecord) => (
                            <div key={artifact.id} className="jobs-item-row">
                              <div className="jobs-item-row__top">
                                <strong style={{ fontSize: 14 }}>{artifact.label}</strong>
                                <JobStatusPill status={artifact.kind} />
                              </div>
                              <p className="jobs-item-row__meta">
                                {formatTimestamp(artifact.createdAt)}
                              </p>
                              <ArtifactContent artifact={artifact} />
                            </div>
                          ))}
                        </div>
                      )}
                    </SurfaceCard>
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                title="Choose a job from the queue"
                description={
                  <p>Select an active or waiting run below to inspect its live workspace.</p>
                }
              />
            )}
          </SurfaceCard>

          <SurfaceCard
            tone="dark"
            title="Queue"
            description={
              <p>Jobs in motion or waiting for approval, runtime, or the next execution pass.</p>
            }
          >
            {operationalJobs.length === 0 ? (
              <EmptyState
                title="The queue is clear"
                description={
                  <p>
                    New jobs will line up here when something is running, waiting, or ready to
                    start.
                  </p>
                }
              />
            ) : (
              <div className="jobs-queue jobs-queue--compact">
                {(
                  [
                    ["Active", groupedJobs.active],
                    ["Waiting", groupedJobs.waiting],
                  ] as const
                ).map(([label, entries]) =>
                  entries.length > 0 ? (
                    <section key={label} className="jobs-queue__group">
                      <p className="jobs-queue__heading">{label}</p>
                      <div className="jobs-queue__stack">
                        {entries.map((job) => (
                          <button
                            key={job.id}
                            type="button"
                            onClick={() => {
                              setViewMode("operations");
                              setSelectedJobId(job.id);
                            }}
                            className={`jobs-queue__item${job.id === activeDetailJobId ? " is-active" : ""}`}
                          >
                            <div className="jobs-queue__item-top">
                              <strong>{job.title}</strong>
                              <JobStatusPill status={job.status} />
                            </div>
                            <p className="jobs-queue__goal">{job.goal}</p>
                            <p className="jobs-queue__meta">
                              {job.workspacePath} · updated {formatTimestamp(job.updatedAt)}
                            </p>
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : null,
                )}
              </div>
            )}
          </SurfaceCard>
        </div>
      ) : (
        <div className="jobs-board">
          <SurfaceCard
            tone="dark"
            title="History"
            description={
              <p>Finished, failed, and cancelled runs. Open any one to review what happened.</p>
            }
          >
            {groupedJobs.finished.length === 0 ? (
              <EmptyState
                title="No history yet"
                description={
                  <p>
                    Finished, failed, and cancelled runs will collect here once the queue has been
                    used.
                  </p>
                }
              />
            ) : (
              <div className="jobs-queue">
                <section className="jobs-queue__group">
                  <p className="jobs-queue__heading">Finished</p>
                  <div className="jobs-queue__stack">
                    {visibleFinishedJobs.map((job) => (
                      <button
                        key={job.id}
                        type="button"
                        onClick={() => {
                          setViewMode("history");
                          setSelectedJobId(job.id);
                        }}
                        className={`jobs-queue__item${job.id === historyDetailJobId ? " is-active" : ""}`}
                      >
                        <div className="jobs-queue__item-top">
                          <strong>{job.title}</strong>
                          <JobStatusPill status={job.status} />
                        </div>
                        <p className="jobs-queue__goal">{job.goal}</p>
                        <p className="jobs-queue__meta">
                          {job.workspacePath} · updated {formatTimestamp(job.updatedAt)}
                        </p>
                      </button>
                    ))}
                  </div>
                  {groupedJobs.finished.length > visibleFinishedJobs.length ? (
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => setShowAllFinished((current) => !current)}
                      style={{ justifySelf: "start" }}
                    >
                      {showAllFinished
                        ? "Show fewer finished jobs"
                        : `Show ${groupedJobs.finished.length - visibleFinishedJobs.length} more finished jobs`}
                    </button>
                  ) : null}
                  {groupedJobs.finished.length <= visibleFinishedJobs.length &&
                  groupedJobs.finished.length > 6 ? (
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => setShowAllFinished((current) => !current)}
                      style={{ justifySelf: "start" }}
                    >
                      {showAllFinished ? "Show fewer finished jobs" : "Show all finished jobs"}
                    </button>
                  ) : null}
                </section>
              </div>
            )}
          </SurfaceCard>

          <SurfaceCard
            tone="dark"
            title={detail && detail.job.id === historyDetailJobId ? detail.job.title : "Job detail"}
            description={
              <p>
                {detail && detail.job.id === historyDetailJobId
                  ? `${detail.job.goal} ${detail.job.blockerSummary ? `Blocker: ${detail.job.blockerSummary}` : ""}`.trim()
                  : "Select a finished job to inspect its steps, requirements, and captured evidence."}
              </p>
            }
          >
            {!historyDetailJobId ? (
              <EmptyState
                title="Choose a finished run"
                description={
                  <p>
                    Select any job from history to inspect its steps, blockers, and saved artifacts.
                  </p>
                }
              />
            ) : isLoadingDetail && detail?.job.id !== historyDetailJobId ? (
              <p style={{ margin: 0, color: "var(--muted)" }}>Loading job detail...</p>
            ) : detail && detail.job.id === historyDetailJobId ? (
              <div className="jobs-detail">
                {detail.job.blockerSummary ? (
                  <NoticeBanner
                    tone={
                      detail.job.status === "waiting_for_runtime" || detail.job.status === "blocked"
                        ? "warning"
                        : "info"
                    }
                  >
                    {detail.job.blockerSummary}
                  </NoticeBanner>
                ) : null}

                <div className="jobs-detail__header">
                  <div className="jobs-detail__stats">
                    <StatGrid>
                      <StatCard
                        label="Status"
                        value={<JobStatusPill status={detail.job.status} />}
                        detail="Final recorded run state"
                        tone="soft"
                      />
                      <StatCard
                        label="Current step"
                        value={
                          detail.steps.find((step) => step.id === detail.job.currentStepId)
                            ?.title ?? "Not set"
                        }
                        detail="Last recorded focus"
                        tone="soft"
                      />
                      <StatCard
                        label="Updated"
                        value={formatTimestamp(detail.job.updatedAt)}
                        detail="When this run last changed"
                        tone="soft"
                      />
                    </StatGrid>
                  </div>

                  <div className="jobs-detail__actions">
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={
                        actionBusyKey === `resume:${detail.job.id}` ||
                        detail.job.status === "completed" ||
                        detail.job.status === "cancelled"
                      }
                      onClick={() => void runJobAction(detail.job.id, "resume")}
                    >
                      {actionBusyKey === `resume:${detail.job.id}` ? "Resuming..." : "Resume"}
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={
                        actionBusyKey === `cancel:${detail.job.id}` ||
                        detail.job.status === "completed" ||
                        detail.job.status === "cancelled"
                      }
                      onClick={() => void runJobAction(detail.job.id, "cancel")}
                    >
                      {actionBusyKey === `cancel:${detail.job.id}` ? "Stopping..." : "Stop job"}
                    </button>
                  </div>
                </div>

                <div className="jobs-detail__workspace">
                  <SurfaceCard tone="soft" title="Planned steps">
                    {detail.steps.length === 0 ? (
                      <p style={{ margin: 0, color: "var(--muted)" }}>No steps recorded yet.</p>
                    ) : (
                      <div className="compact-list jobs-panel-scroll">
                        {detail.steps.map((step) => (
                          <div key={step.id} className="jobs-item-row">
                            <div className="jobs-item-row__top">
                              <strong style={{ fontSize: 14 }}>
                                {step.sequence}. {step.title}
                              </strong>
                              <JobStatusPill status={step.status} />
                            </div>
                            <p className="jobs-item-row__body">{step.detail}</p>
                            <p className="jobs-item-row__meta">
                              {step.toolKey
                                ? `Runtime: ${step.toolKey}`
                                : "No runtime hint recorded."}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </SurfaceCard>

                  <div className="jobs-detail__support">
                    <SurfaceCard tone="soft" title="Requirements and blockers">
                      {detail.requirements.length === 0 ? (
                        <EmptyState
                          title="No blockers recorded"
                          description={
                            <p>
                              This archived run finished without any additional approval or runtime
                              intervention.
                            </p>
                          }
                        />
                      ) : (
                        <div className="compact-list jobs-panel-scroll">
                          {detail.requirements.map((requirement: AgentJobRequirementRecord) => (
                            <div key={requirement.id} className="jobs-item-row">
                              <div className="jobs-item-row__top">
                                <strong style={{ fontSize: 14 }}>{requirement.label}</strong>
                                <JobStatusPill status={requirement.status} />
                              </div>
                              <p className="jobs-item-row__body">
                                {requirement.detail ?? "No extra detail recorded."}
                              </p>
                              {Object.keys(requirement.metadataJson ?? {}).length > 0 ? (
                                <pre className="jobs-item-row__json">
                                  {JSON.stringify(requirement.metadataJson, null, 2)}
                                </pre>
                              ) : null}
                              {requirement.status === "pending" ? (
                                <div className="jobs-detail__actions">
                                  <button
                                    type="button"
                                    className="button-secondary"
                                    disabled={actionBusyKey === `approve:${requirement.id}`}
                                    onClick={() =>
                                      void decideRequirement(detail.job.id, requirement.id, true)
                                    }
                                  >
                                    {actionBusyKey === `approve:${requirement.id}`
                                      ? "Working..."
                                      : "Approve"}
                                  </button>
                                  <button
                                    type="button"
                                    className="button-secondary"
                                    disabled={actionBusyKey === `deny:${requirement.id}`}
                                    onClick={() =>
                                      void decideRequirement(detail.job.id, requirement.id, false)
                                    }
                                  >
                                    {actionBusyKey === `deny:${requirement.id}`
                                      ? "Working..."
                                      : "Deny"}
                                  </button>
                                </div>
                              ) : null}
                              {requirement.resolutionText ? (
                                <p className="jobs-item-row__meta">
                                  Resolution: {requirement.resolutionText}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </SurfaceCard>

                    <SurfaceCard tone="soft" title="Artifacts">
                      {detail.artifacts.length === 0 ? (
                        <EmptyState
                          title="No artifacts were saved"
                          description={
                            <p>
                              This run did not capture any downloadable evidence or generated files.
                            </p>
                          }
                        />
                      ) : (
                        <div className="compact-list jobs-panel-scroll">
                          {detail.artifacts.map((artifact: AgentJobArtifactRecord) => (
                            <div key={artifact.id} className="jobs-item-row">
                              <div className="jobs-item-row__top">
                                <strong style={{ fontSize: 14 }}>{artifact.label}</strong>
                                <JobStatusPill status={artifact.kind} />
                              </div>
                              <p className="jobs-item-row__meta">
                                {formatTimestamp(artifact.createdAt)}
                              </p>
                              <ArtifactContent artifact={artifact} />
                            </div>
                          ))}
                        </div>
                      )}
                    </SurfaceCard>
                  </div>
                </div>
              </div>
            ) : (
              <p style={{ margin: 0, color: "var(--muted)" }}>
                Choose a finished job from history to inspect it.
              </p>
            )}
          </SurfaceCard>
        </div>
      )}
    </AppPage>
  );
}
