"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type {
  AgentJobActionResponse,
  AgentJobDetailResponse,
  AgentJobRecord,
  AgentJobRequirementDecisionRequest,
  AgentJobRequirementRecord,
  AgentJobArtifactRecord,
  AgentJobListResponse,
  AgentJobSettingsResponse,
  CreateAgentJobRequest,
} from "@secretary/core-runtime";
import { AppPage, NoticeBanner, PageHero, SurfaceCard } from "../../lib/ui";
import { formatTimestamp } from "../../lib/presenters";

type JobFormState = {
  title: string;
  goal: string;
  workspacePath: string;
  constraintsText: string;
  deliverablesText: string;
};

const defaultForm: JobFormState = {
  title: "New build job",
  goal: "",
  workspacePath: "/mnt/f/hamcult",
  constraintsText: "",
  deliverablesText: "",
};

function parseLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function statusTone(status: string) {
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

  if (status === "running" || status === "ready" || status === "planning" || status === "retrying") {
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

function JobStatusPill({ status }: { status: string }) {
  const tone = statusTone(status);

  return (
    <span
      style={{
        padding: "4px 9px",
        borderRadius: 999,
        background: tone.background,
        border: `1px solid ${tone.border}`,
        color: tone.text,
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

function ArtifactContent({ artifact }: { artifact: AgentJobArtifactRecord }) {
  const fileHref =
    artifact.storageKey
      ? `/api/agent-jobs/artifacts/file?storageKey=${encodeURIComponent(artifact.storageKey)}${
          artifact.mimeType ? `&mimeType=${encodeURIComponent(artifact.mimeType)}` : ""
        }`
      : null;

  if (artifact.mimeType?.startsWith("image/") && fileHref) {
    return (
      <div style={{ display: "grid", gap: 8 }}>
        <a href={fileHref} target="_blank" rel="noreferrer" className="button-secondary" style={{ justifySelf: "start" }}>
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
      <a href={fileHref} target="_blank" rel="noreferrer" className="button-secondary" style={{ justifySelf: "start" }}>
        Download artifact
      </a>
    );
  }

  if (!artifact.contentText) {
    return null;
  }

  return (
    <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.55, color: "var(--muted)" }}>
      {artifact.contentText}
    </pre>
  );
}

export function JobsConsole() {
  const [jobs, setJobs] = useState<AgentJobRecord[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AgentJobDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [actionBusyKey, setActionBusyKey] = useState<string | null>(null);
  const [isCreating, startCreateTransition] = useTransition();
  const [form, setForm] = useState<JobFormState>(defaultForm);

  async function loadJobs(preferredJobId?: string | null, options?: { silent?: boolean }) {
    if (!options?.silent) {
      setIsLoadingList(true);
    }

    try {
      const response = await fetch("/api/agent-jobs", { cache: "no-store" });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load agent jobs.");
      }

      const nextJobs = (payload as AgentJobListResponse).jobs;
      setJobs(nextJobs);
      setError(null);

      const nextSelected =
        preferredJobId && nextJobs.some((job) => job.id === preferredJobId)
          ? preferredJobId
          : nextJobs[0]?.id ?? null;
      setSelectedJobId(nextSelected);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load agent jobs.");
    } finally {
      if (!options?.silent) {
        setIsLoadingList(false);
      }
    }
  }

  async function loadDetail(jobId: string, options?: { silent?: boolean }) {
    if (!options?.silent) {
      setIsLoadingDetail(true);
    }

    try {
      const response = await fetch(`/api/agent-jobs/${jobId}`, { cache: "no-store" });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load agent job.");
      }

      setDetail(payload as AgentJobDetailResponse);
      setDetailError(null);
    } catch (loadError) {
      setDetail(null);
      setDetailError(loadError instanceof Error ? loadError.message : "Unable to load agent job.");
    } finally {
      if (!options?.silent) {
        setIsLoadingDetail(false);
      }
    }
  }

  useEffect(() => {
    void loadJobs();

    void (async () => {
      try {
        const response = await fetch("/api/agent-job-settings", { cache: "no-store" });
        const payload = await response.json();

        if (!response.ok) {
          return;
        }

        const settings = (payload as AgentJobSettingsResponse).settings;
        setForm((current) => ({
          ...current,
          workspacePath: settings.defaultWorkspacePath ?? current.workspacePath,
        }));
      } catch {
        return;
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedJobId) {
      setDetail(null);
      setDetailError(null);
      return;
    }

    void loadDetail(selectedJobId);
  }, [selectedJobId]);

  useEffect(() => {
    if (!detail) {
      return;
    }

    if (!["queued", "planning", "running", "retrying", "waiting_for_approval", "waiting_for_runtime"].includes(detail.job.status)) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadJobs(detail.job.id, { silent: true });
      void loadDetail(detail.job.id, { silent: true });
    }, 4000);

    return () => window.clearInterval(interval);
  }, [detail]);

  const summary = useMemo(
    () => ({
      active: jobs.filter((job) => ["queued", "planning", "running", "retrying"].includes(job.status)).length,
      waiting: jobs.filter((job) => ["waiting_for_approval", "waiting_for_runtime"].includes(job.status)).length,
      completed: jobs.filter((job) => job.status === "completed").length,
    }),
    [jobs],
  );
  const groupedJobs = useMemo(
    () => ({
      active: jobs.filter((job) => ["queued", "planning", "running", "retrying"].includes(job.status)),
      waiting: jobs.filter((job) => ["waiting_for_approval", "waiting_for_runtime", "blocked"].includes(job.status)),
      finished: jobs.filter((job) => ["completed", "failed", "cancelled"].includes(job.status)),
    }),
    [jobs],
  );

  function updateForm<K extends keyof JobFormState>(key: K, value: JobFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function createJob() {
    startCreateTransition(async () => {
      try {
        const requestBody: CreateAgentJobRequest = {
          title: form.title.trim(),
          goal: form.goal.trim(),
          workspacePath: form.workspacePath.trim(),
          constraints: parseLines(form.constraintsText),
          deliverables: parseLines(form.deliverablesText),
        };

        const response = await fetch("/api/agent-jobs", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to create agent job.");
        }

        const nextJob = (payload as { job: AgentJobRecord }).job;
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
        setError(createError instanceof Error ? createError.message : "Unable to create agent job.");
      }
    });
  }

  async function runJobAction(jobId: string, action: "resume" | "cancel") {
    setActionBusyKey(`${action}:${jobId}`);

    try {
      const response = await fetch(`/api/agent-jobs/${jobId}/${action}`, {
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? `Unable to ${action} agent job.`);
      }

      const nextJob = (payload as AgentJobActionResponse).job;
      await loadJobs(nextJob.id);
      await loadDetail(nextJob.id);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `Unable to ${action} agent job.`);
    } finally {
      setActionBusyKey(null);
    }
  }

  async function decideRequirement(jobId: string, requirementId: string, approved: boolean) {
    setActionBusyKey(`${approved ? "approve" : "deny"}:${requirementId}`);

    try {
      const body: AgentJobRequirementDecisionRequest = {
        approved,
        reason: approved ? "Approved from the jobs queue." : "Denied from the jobs queue.",
      };
      const response = await fetch(`/api/agent-jobs/${jobId}/requirements/${requirementId}/decision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update requirement.");
      }

      const nextJob = (payload as AgentJobActionResponse).job;
      await loadJobs(nextJob.id);
      await loadDetail(nextJob.id);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to update requirement.");
    } finally {
      setActionBusyKey(null);
    }
  }

  return (
    <AppPage width="1380px">
      <PageHero
        eyebrow="Activity"
        title="Agent jobs"
        description={
          <p>
            A durable work queue for autonomous builds: start jobs, watch progress, review evidence,
            and intervene only when the queue actually needs you.
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

      <div style={{ display: "grid", gap: 18, gridTemplateColumns: "minmax(320px, 390px) minmax(0, 1fr)" }}>
        <div style={{ display: "grid", gap: 18, alignContent: "start" }}>
          <SurfaceCard
            tone="dark"
            title="Start job"
            description={<p>Name the work, point it at a workspace, and describe the build outcome you want.</p>}
          >
            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Title</span>
                <input
                  value={form.title}
                  onChange={(event) => updateForm("title", event.target.value)}
                  className="input-shell"
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Goal</span>
                <textarea
                  value={form.goal}
                  onChange={(event) => updateForm("goal", event.target.value)}
                  className="textarea-shell"
                  rows={4}
                  placeholder="Describe what the agent should build or change."
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Workspace</span>
                <input
                  value={form.workspacePath}
                  onChange={(event) => updateForm("workspacePath", event.target.value)}
                  className="input-shell"
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Constraints</span>
                <textarea
                  value={form.constraintsText}
                  onChange={(event) => updateForm("constraintsText", event.target.value)}
                  className="textarea-shell"
                  rows={3}
                  placeholder="One constraint per line."
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Deliverables</span>
                <textarea
                  value={form.deliverablesText}
                  onChange={(event) => updateForm("deliverablesText", event.target.value)}
                  className="textarea-shell"
                  rows={3}
                  placeholder="One deliverable per line."
                />
              </label>

              <button
                type="button"
                onClick={createJob}
                disabled={isCreating || !form.goal.trim() || !form.workspacePath.trim() || !form.title.trim()}
                className="button-primary"
              >
                {isCreating ? "Starting job..." : "Start agent job"}
              </button>
            </div>
          </SurfaceCard>

          <SurfaceCard
            tone="dark"
            title="Queue"
            description={<p>Everything queued, in motion, waiting on approvals, or already handed off.</p>}
          >
            {jobs.length === 0 ? (
              <p style={{ margin: 0, color: "var(--muted)" }}>No agent jobs yet.</p>
            ) : (
              <div className="compact-list">
                {([
                  ["Active", groupedJobs.active],
                  ["Waiting", groupedJobs.waiting],
                  ["Finished", groupedJobs.finished],
                ] as const).map(([label, entries]) => (
                  entries.length > 0 ? (
                    <div key={label} style={{ display: "grid", gap: 8 }}>
                      <p style={{ margin: 0, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>
                        {label}
                      </p>
                      {entries.map((job) => (
                        <button
                          key={job.id}
                          type="button"
                          onClick={() => setSelectedJobId(job.id)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            background: job.id === selectedJobId ? "rgba(240, 184, 116, 0.1)" : "transparent",
                            border: job.id === selectedJobId
                              ? "1px solid rgba(240, 184, 116, 0.35)"
                              : "1px solid transparent",
                            borderRadius: 16,
                            padding: "12px 14px",
                            display: "grid",
                            gap: 8,
                            cursor: "pointer",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                            <strong style={{ fontSize: 14 }}>{job.title}</strong>
                            <JobStatusPill status={job.status} />
                          </div>
                          <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, lineHeight: 1.45 }}>
                            {job.goal}
                          </p>
                          <p style={{ margin: 0, color: "var(--muted)", fontSize: 11 }}>
                            {job.workspacePath} · updated {formatTimestamp(job.updatedAt)}
                          </p>
                        </button>
                      ))}
                    </div>
                  ) : null
                ))}
              </div>
            )}
          </SurfaceCard>
        </div>

        <SurfaceCard
          tone="dark"
          title={detail ? detail.job.title : "Job detail"}
          description={
            <p>
              {detail
                ? `${detail.job.goal} ${detail.job.blockerSummary ? `Blocker: ${detail.job.blockerSummary}` : ""}`.trim()
                : "Select a job to inspect its steps, requirements, and captured evidence."}
            </p>
          }
        >
          {!selectedJobId ? (
            <p style={{ margin: 0, color: "var(--muted)" }}>Choose a job from the queue to inspect it.</p>
          ) : isLoadingDetail ? (
            <p style={{ margin: 0, color: "var(--muted)" }}>Loading job detail...</p>
          ) : detail ? (
            <div style={{ display: "grid", gap: 18 }}>
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

              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", flexWrap: "wrap" }}>
                <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(3, minmax(0, 1fr))", flex: "1 1 520px" }}>
                  {[
                    ["Status", <JobStatusPill key="status" status={detail.job.status} />],
                    ["Current step", detail.steps.find((step) => step.id === detail.job.currentStepId)?.title ?? "Not set"],
                    ["Updated", formatTimestamp(detail.job.updatedAt)],
                  ].map(([label, value]) => (
                    <div key={String(label)} style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        {label}
                      </span>
                      <div>{value}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={actionBusyKey === `resume:${detail.job.id}` || detail.job.status === "completed" || detail.job.status === "cancelled"}
                    onClick={() => void runJobAction(detail.job.id, "resume")}
                  >
                    {actionBusyKey === `resume:${detail.job.id}` ? "Resuming..." : "Resume"}
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={actionBusyKey === `cancel:${detail.job.id}` || detail.job.status === "completed" || detail.job.status === "cancelled"}
                    onClick={() => void runJobAction(detail.job.id, "cancel")}
                  >
                    {actionBusyKey === `cancel:${detail.job.id}` ? "Stopping..." : "Stop job"}
                  </button>
                </div>
              </div>

              <div style={{ display: "grid", gap: 18, gridTemplateColumns: "minmax(0, 1.1fr) minmax(300px, 0.9fr)" }}>
                <div style={{ display: "grid", gap: 18 }}>
                  <SurfaceCard tone="soft" title="Planned steps">
                    <div className="compact-list">
                      {detail.steps.map((step) => (
                        <div key={step.id} style={{ display: "grid", gap: 8, padding: "12px 0" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                            <strong style={{ fontSize: 14 }}>{step.sequence}. {step.title}</strong>
                            <JobStatusPill status={step.status} />
                          </div>
                          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
                            {step.detail}
                          </p>
                          <p style={{ margin: 0, color: "var(--muted)", fontSize: 11 }}>
                            {step.toolKey ? `Runtime: ${step.toolKey}` : "No runtime hint recorded."}
                          </p>
                        </div>
                      ))}
                    </div>
                  </SurfaceCard>

                  <SurfaceCard tone="soft" title="Artifacts">
                    {detail.artifacts.length === 0 ? (
                      <p style={{ margin: 0, color: "var(--muted)" }}>No artifacts captured yet.</p>
                    ) : (
                      <div className="compact-list">
                        {detail.artifacts.map((artifact: AgentJobArtifactRecord) => (
                          <div key={artifact.id} style={{ display: "grid", gap: 8, padding: "12px 0" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                              <strong style={{ fontSize: 14 }}>{artifact.label}</strong>
                              <JobStatusPill status={artifact.kind} />
                            </div>
                            <p style={{ margin: 0, color: "var(--muted)", fontSize: 11 }}>
                              {formatTimestamp(artifact.createdAt)}
                            </p>
                            <ArtifactContent artifact={artifact} />
                          </div>
                        ))}
                      </div>
                    )}
                  </SurfaceCard>
                </div>

                <SurfaceCard tone="soft" title="Requirements and blockers">
                  {detail.requirements.length === 0 ? (
                    <p style={{ margin: 0, color: "var(--muted)" }}>
                      No explicit runtime or approval blockers are recorded for this job right now.
                    </p>
                  ) : (
                    <div className="compact-list">
                      {detail.requirements.map((requirement: AgentJobRequirementRecord) => (
                        <div key={requirement.id} style={{ display: "grid", gap: 8, padding: "12px 0" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                            <strong style={{ fontSize: 14 }}>{requirement.label}</strong>
                            <JobStatusPill status={requirement.status} />
                          </div>
                          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
                            {requirement.detail ?? "No extra detail recorded."}
                          </p>
                          {Object.keys(requirement.metadataJson ?? {}).length > 0 ? (
                            <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 11, lineHeight: 1.5, color: "var(--muted)" }}>
                              {JSON.stringify(requirement.metadataJson, null, 2)}
                            </pre>
                          ) : null}
                          {requirement.status === "pending" ? (
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                              <button
                                type="button"
                                className="button-secondary"
                                disabled={actionBusyKey === `approve:${requirement.id}`}
                                onClick={() => void decideRequirement(detail.job.id, requirement.id, true)}
                              >
                                {actionBusyKey === `approve:${requirement.id}` ? "Working..." : "Approve"}
                              </button>
                              <button
                                type="button"
                                className="button-secondary"
                                disabled={actionBusyKey === `deny:${requirement.id}`}
                                onClick={() => void decideRequirement(detail.job.id, requirement.id, false)}
                              >
                                {actionBusyKey === `deny:${requirement.id}` ? "Working..." : "Deny"}
                              </button>
                            </div>
                          ) : null}
                          {requirement.resolutionText ? (
                            <p style={{ margin: 0, color: "var(--muted)", fontSize: 11 }}>
                              Resolution: {requirement.resolutionText}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </SurfaceCard>
              </div>
            </div>
          ) : null}
        </SurfaceCard>
      </div>
    </AppPage>
  );
}
