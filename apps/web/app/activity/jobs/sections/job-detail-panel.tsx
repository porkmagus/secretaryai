import type {
  AgentJobArtifactRecord,
  AgentJobDetailResponse,
  AgentJobRequirementRecord,
} from "@secretary/core-runtime";
import { formatTimestamp } from "../../lib/presenters";
import { EmptyState, NoticeBanner, StatCard, StatGrid, SurfaceCard } from "../../lib/ui";
import { ArtifactContent, JobStatusPill } from "./job-status-pill";

type JobDetailPanelProps = {
  detail: AgentJobDetailResponse | null;
  isLoadingDetail: boolean;
  selectedJobId: string | null;
  detailJobId: string | null;
  actionBusyKey: string | null;
  emptyTitle: string;
  emptyDescription: string;
  loadingText: string;
  noJobText: string;
  statusDetail: string;
  stepDetail: string;
  updatedDetail: string;
  onRunJobAction: (jobId: string, action: "resume" | "cancel") => void;
  onDecideRequirement: (jobId: string, requirementId: string, approved: boolean) => void;
};

export function JobDetailPanel({
  detail,
  isLoadingDetail,
  selectedJobId,
  detailJobId,
  actionBusyKey,
  emptyTitle,
  emptyDescription,
  loadingText,
  noJobText,
  statusDetail,
  stepDetail,
  updatedDetail,
  onRunJobAction,
  onDecideRequirement,
}: JobDetailPanelProps) {
  if (!detailJobId) {
    return <EmptyState title={emptyTitle} description={<p>{emptyDescription}</p>} />;
  }

  if (isLoadingDetail && detail?.job.id !== detailJobId) {
    return <p style={{ margin: 0, color: "var(--muted)" }}>{loadingText}</p>;
  }

  if (!detail || detail.job.id !== detailJobId) {
    return <p style={{ margin: 0, color: "var(--muted)" }}>{noJobText}</p>;
  }

  return (
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
              detail={statusDetail}
              tone="soft"
            />
            <StatCard
              label="Current step"
              value={
                detail.steps.find((step) => step.id === detail.job.currentStepId)?.title ??
                "Not set"
              }
              detail={stepDetail}
              tone="soft"
            />
            <StatCard
              label="Updated"
              value={formatTimestamp(detail.job.updatedAt)}
              detail={updatedDetail}
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
            onClick={() => void onRunJobAction(detail.job.id, "resume")}
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
            onClick={() => void onRunJobAction(detail.job.id, "cancel")}
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
                    {step.toolKey ? `Runtime: ${step.toolKey}` : "No runtime hint recorded."}
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
                    This run does not currently need extra approval, runtime help, or intervention.
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
                            void onDecideRequirement(detail.job.id, requirement.id, true)
                          }
                        >
                          {actionBusyKey === `approve:${requirement.id}` ? "Working..." : "Approve"}
                        </button>
                        <button
                          type="button"
                          className="button-secondary"
                          disabled={actionBusyKey === `deny:${requirement.id}`}
                          onClick={() =>
                            void onDecideRequirement(detail.job.id, requirement.id, false)
                          }
                        >
                          {actionBusyKey === `deny:${requirement.id}` ? "Working..." : "Deny"}
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
                    Artifacts will appear here as the job produces logs, files, and verification
                    output.
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
                    <p className="jobs-item-row__meta">{formatTimestamp(artifact.createdAt)}</p>
                    <ArtifactContent artifact={artifact} />
                  </div>
                ))}
              </div>
            )}
          </SurfaceCard>
        </div>
      </div>
    </div>
  );
}
