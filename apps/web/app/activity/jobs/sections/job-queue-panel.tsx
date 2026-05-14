import type { AgentJobRecord } from "@secretary/core-runtime";
import { formatTimestamp } from "../../../lib/presenters";
import { EmptyState } from "../../../lib/ui";
import { JobStatusPill } from "./job-status-pill";

type JobQueuePanelProps = {
  title: string;
  description: string;
  jobs: AgentJobRecord[];
  selectedJobId: string | null;
  detailJobId: string | null;
  viewMode: "operations" | "history";
  showAllButton?: {
    showMore: boolean;
    count: number;
    onClick: () => void;
  };
  onSelectJob: (jobId: string) => void;
  emptyTitle: string;
  emptyDescription: string;
};

export function JobQueuePanel({
  title,
  description,
  jobs,
  selectedJobId,
  detailJobId,
  viewMode,
  showAllButton,
  onSelectJob,
  emptyTitle,
  emptyDescription,
}: JobQueuePanelProps) {
  return (
    <div className="jobs-queue">
      {jobs.length === 0 ? (
        <EmptyState title={emptyTitle} description={<p>{emptyDescription}</p>} />
      ) : (
        <section className="jobs-queue__group">
          <p className="jobs-queue__heading">{title}</p>
          <div className="jobs-queue__stack">
            {jobs.map((job) => (
              <button
                key={job.id}
                type="button"
                onClick={() => {
                  onSelectJob(job.id);
                }}
                className={`jobs-queue__item${job.id === detailJobId ? " is-active" : ""}`}
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
          {showAllButton && (
            <button
              type="button"
              className="button-secondary"
              onClick={showAllButton.onClick}
              style={{ justifySelf: "start" }}
            >
              {showAllButton.showMore
                ? "Show fewer finished jobs"
                : `Show ${showAllButton.count} more finished jobs`}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
