import type { AppConfig } from "@secretary/config";
import type {
  AgentJobActionResponse,
  AgentJobDetailResponse,
  AgentJobListResponse,
  AgentJobRecord,
} from "@secretary/core-runtime";
import { createMessageId } from "@secretary/core-runtime";
import { agentJobArtifacts, agentJobSteps, agentJobs, type DbClient, jobs } from "@secretary/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  buildAgentJobLocationHint,
  postAgentJobConversationUpdate,
} from "../agent-job-conversation-updates.js";
import { normalizeWorkspacePath } from "../agent-job-executor.js";
import type { AgentJobQueueAdapter } from "../agent-job-queue.js";
import { loadAgentJobSettings } from "../agent-job-settings.js";
import {
  toAgentJobRecord,
  toArtifactRecord,
  toRequirementRecord,
  toStepRecord,
} from "../agent-job-transformers.js";
import { normalizeApprovalMode } from "../utils.js";
import { insertTrace } from "./artifacts.js";
import { ensureDefaultUser } from "./helpers.js";
import { getAgentJobRow, listRequirementRows, listStepRows, updateJobState } from "./state.js";
import type { CreateAgentJobParams } from "./types.js";

export async function listAgentJobs(dbClient: DbClient): Promise<AgentJobListResponse> {
  const rows = await dbClient.db
    .select({
      job: jobs,
      agent: agentJobs,
    })
    .from(agentJobs)
    .innerJoin(jobs, eq(agentJobs.jobId, jobs.id))
    .orderBy(desc(jobs.createdAt));

  return {
    jobs: rows.map(toAgentJobRecord),
  };
}

export async function getAgentJobDetail(
  dbClient: DbClient,
  jobId: string,
): Promise<AgentJobDetailResponse | null> {
  const row = await getAgentJobRow(dbClient, jobId);

  if (!row) {
    return null;
  }

  const [steps, artifacts, requirements] = await Promise.all([
    listStepRows(dbClient, jobId),
    dbClient.db.query.agentJobArtifacts.findMany({
      where: eq(agentJobArtifacts.jobId, jobId),
      orderBy: [asc(agentJobArtifacts.createdAt)],
    }),
    listRequirementRows(dbClient, jobId),
  ]);

  return {
    job: toAgentJobRecord(row),
    steps: steps.map(toStepRecord),
    artifacts: artifacts.map(toArtifactRecord),
    requirements: requirements.map(toRequirementRecord),
  };
}

export async function createAgentJob(params: CreateAgentJobParams): Promise<AgentJobRecord> {
  const settings = await loadAgentJobSettings();
  const approvalMode = normalizeApprovalMode(
    params.request.approvalMode ?? settings.defaultApprovalMode,
  );
  const normalizedWorkspacePath = normalizeWorkspacePath(
    params.request.workspacePath?.trim() || settings.defaultWorkspacePath || process.cwd(),
    settings.executionBackend,
  );
  const jobId = createMessageId();
  const scheduledFor = new Date();

  await ensureDefaultUser(params.dbClient, params.config);

  await params.dbClient.db.insert(jobs).values({
    id: jobId,
    jobType: "agent.build",
    status: "queued",
    payloadJson: {
      goal: params.request.goal,
      workspacePath: normalizedWorkspacePath,
      constraints: params.request.constraints ?? [],
      deliverables: params.request.deliverables ?? [],
      approvalMode,
    },
    resultJson: null,
    parentJobId: null,
    scheduledFor,
    startedAt: null,
    finishedAt: null,
    errorText: null,
  });

  await params.dbClient.db.insert(agentJobs).values({
    jobId,
    requestedByUserId: params.config.defaultUserId,
    conversationId: params.request.conversationId ?? null,
    title: params.request.title,
    goal: params.request.goal,
    workspacePath: normalizedWorkspacePath,
    approvalMode,
    blockerSummary: null,
    currentStepId: null,
    resultSummary: null,
  });

  await insertTrace({
    dbClient: params.dbClient,
    conversationId: params.request.conversationId ?? null,
    jobId,
    eventName: "agent.job.created",
    payloadJson: {
      title: params.request.title,
      approvalMode,
      workspacePath: normalizedWorkspacePath,
    },
  });

  try {
    await params.queue.enqueue(jobId);
  } catch (error) {
    const errorText = error instanceof Error ? error.message : "Unknown queue enqueue error";
    const failedAt = new Date();

    await params.dbClient.db
      .update(jobs)
      .set({
        status: "failed",
        errorText,
        finishedAt: failedAt,
        updatedAt: failedAt,
      })
      .where(eq(jobs.id, jobId));

    await params.dbClient.db
      .update(agentJobs)
      .set({
        blockerSummary: errorText,
      })
      .where(eq(agentJobs.jobId, jobId));

    await insertTrace({
      dbClient: params.dbClient,
      conversationId: params.request.conversationId ?? null,
      jobId,
      eventName: "agent.job.enqueue_failed",
      payloadJson: {
        errorText,
      },
    });

    throw error instanceof Error ? error : new Error(errorText);
  }

  const row = await getAgentJobRow(params.dbClient, jobId);
  if (!row) {
    throw new Error("Agent job was created but could not be reloaded.");
  }

  return toAgentJobRecord(row);
}

export async function markAgentJobFailed(
  config: AppConfig,
  dbClient: DbClient,
  jobId: string,
  errorText: string,
) {
  const row = await getAgentJobRow(dbClient, jobId);
  const finishedAt = new Date();

  await dbClient.db
    .update(jobs)
    .set({
      status: "failed",
      errorText,
      finishedAt,
      updatedAt: finishedAt,
    })
    .where(eq(jobs.id, jobId));

  await dbClient.db
    .update(agentJobs)
    .set({
      blockerSummary: errorText,
    })
    .where(eq(agentJobs.jobId, jobId));

  await insertTrace({
    dbClient,
    conversationId: row?.agent.conversationId ?? null,
    jobId,
    eventName: "agent.job.failed",
    payloadJson: {
      errorText,
    },
  });

  await postAgentJobConversationUpdate({
    dbClient,
    config,
    conversationId: row?.agent.conversationId ?? null,
    jobId,
    eventName: "agent.job.chat.failed",
    importance: "important",
    text: `The build job failed: ${errorText}. ${buildAgentJobLocationHint(jobId)}`,
    metadataJson: {
      errorText,
    },
  });
}

export async function resumeAgentJob(params: {
  config: AppConfig;
  dbClient: DbClient;
  queue: AgentJobQueueAdapter;
  jobId: string;
}): Promise<AgentJobActionResponse | null> {
  const row = await getAgentJobRow(params.dbClient, params.jobId);

  if (!row) {
    return null;
  }

  if (row.job.status === "completed" || row.job.status === "cancelled") {
    return {
      job: toAgentJobRecord(row),
    };
  }

  await updateJobState({
    dbClient: params.dbClient,
    jobId: params.jobId,
    status: "queued",
    blockerSummary: row.agent.blockerSummary,
    currentStepId: row.agent.currentStepId ?? null,
    errorText: null,
  });
  await params.queue.enqueue(params.jobId);

  await postAgentJobConversationUpdate({
    dbClient: params.dbClient,
    config: params.config,
    conversationId: row.agent.conversationId ?? null,
    jobId: params.jobId,
    eventName: "agent.job.chat.resumed",
    importance: "normal",
    text: "Resumed from where I left off.",
  });

  const nextRow = await getAgentJobRow(params.dbClient, params.jobId);
  return nextRow ? { job: toAgentJobRecord(nextRow) } : null;
}

export async function cancelAgentJob(params: {
  config: AppConfig;
  dbClient: DbClient;
  jobId: string;
}): Promise<AgentJobActionResponse | null> {
  const row = await getAgentJobRow(params.dbClient, params.jobId);

  if (!row) {
    return null;
  }

  const finishedAt = new Date();
  await params.dbClient.db
    .update(agentJobSteps)
    .set({
      status: "cancelled",
      finishedAt,
      updatedAt: finishedAt,
    })
    .where(
      and(
        eq(agentJobSteps.jobId, params.jobId),
        inArray(agentJobSteps.status, [
          "pending",
          "ready",
          "running",
          "retrying",
          "waiting_for_approval",
          "waiting_for_runtime",
          "blocked",
        ]),
      ),
    );

  await updateJobState({
    dbClient: params.dbClient,
    jobId: params.jobId,
    status: "cancelled",
    blockerSummary: "Cancelled by operator.",
    currentStepId: null,
    resultSummary: row.agent.resultSummary,
    errorText: null,
    finishedAt,
  });

  await postAgentJobConversationUpdate({
    dbClient: params.dbClient,
    config: params.config,
    conversationId: row.agent.conversationId ?? null,
    jobId: params.jobId,
    eventName: "agent.job.chat.cancelled",
    importance: "important",
    text: "Build job cancelled.",
  });

  const nextRow = await getAgentJobRow(params.dbClient, params.jobId);
  return nextRow ? { job: toAgentJobRecord(nextRow) } : null;
}
