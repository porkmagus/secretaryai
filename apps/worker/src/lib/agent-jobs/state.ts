import type { AgentJobStatus, AgentJobStepStatus } from "@secretary/core-runtime";
import { agentJobRequirements, agentJobSteps, agentJobs, type DbClient, jobs } from "@secretary/db";
import { asc, eq } from "drizzle-orm";

export async function getAgentJobRow(dbClient: DbClient, jobId: string) {
  const rows = await dbClient.db
    .select({
      job: jobs,
      agent: agentJobs,
    })
    .from(agentJobs)
    .innerJoin(jobs, eq(agentJobs.jobId, jobs.id))
    .where(eq(agentJobs.jobId, jobId))
    .limit(1);

  return rows[0] ?? null;
}

export async function listStepRows(dbClient: DbClient, jobId: string) {
  return dbClient.db.query.agentJobSteps.findMany({
    where: eq(agentJobSteps.jobId, jobId),
    orderBy: [asc(agentJobSteps.sequence), asc(agentJobSteps.createdAt)],
  });
}

export async function listRequirementRows(dbClient: DbClient, jobId: string) {
  return dbClient.db.query.agentJobRequirements.findMany({
    where: eq(agentJobRequirements.jobId, jobId),
    orderBy: [asc(agentJobRequirements.createdAt)],
  });
}

export async function updateJobState(params: {
  dbClient: DbClient;
  jobId: string;
  status?: AgentJobStatus;
  blockerSummary?: string | null;
  currentStepId?: string | null;
  resultSummary?: string | null;
  errorText?: string | null;
  finishedAt?: Date | null;
}) {
  const now = new Date();
  await params.dbClient.db
    .update(jobs)
    .set({
      ...(params.status ? { status: params.status } : {}),
      ...(params.errorText !== undefined ? { errorText: params.errorText } : {}),
      ...(params.finishedAt !== undefined ? { finishedAt: params.finishedAt } : {}),
      updatedAt: now,
    })
    .where(eq(jobs.id, params.jobId));

  await params.dbClient.db
    .update(agentJobs)
    .set({
      ...(params.blockerSummary !== undefined ? { blockerSummary: params.blockerSummary } : {}),
      ...(params.currentStepId !== undefined ? { currentStepId: params.currentStepId } : {}),
      ...(params.resultSummary !== undefined ? { resultSummary: params.resultSummary } : {}),
    })
    .where(eq(agentJobs.jobId, params.jobId));
}

export async function updateStepState(params: {
  dbClient: DbClient;
  stepId: string;
  status?: AgentJobStepStatus;
  outputJson?: Record<string, unknown> | null;
  summary?: string | null;
  errorText?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}) {
  await params.dbClient.db
    .update(agentJobSteps)
    .set({
      ...(params.status ? { status: params.status } : {}),
      ...(params.outputJson !== undefined ? { outputJson: params.outputJson } : {}),
      ...(params.summary !== undefined ? { summary: params.summary } : {}),
      ...(params.errorText !== undefined ? { errorText: params.errorText } : {}),
      ...(params.startedAt !== undefined ? { startedAt: params.startedAt } : {}),
      ...(params.finishedAt !== undefined ? { finishedAt: params.finishedAt } : {}),
      updatedAt: new Date(),
    })
    .where(eq(agentJobSteps.id, params.stepId));
}

export function getCurrentStep(
  steps: Array<typeof agentJobSteps.$inferSelect>,
  currentStepId: string | null,
) {
  return (
    steps.find((step) => step.id === currentStepId) ??
    steps.find((step) => step.status !== "completed" && step.status !== "cancelled") ??
    null
  );
}
