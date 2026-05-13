import type { AppConfig } from "@secretary/config";
import type {
  MemoryCandidateJobPayload,
  RuntimeChatRequest,
  RuntimeChatResponse,
} from "@secretary/core-runtime";
import type { DbClient } from "@secretary/db";
import { maybeHandleAgentJobLaunchTurn } from "./agent-job-launch-intents.js";
import type { AgentJobQueueAdapter } from "./agent-job-queue.js";
import { maybeHandleAgentJobRequirementTurn } from "./agent-job-requirement-turns.js";
import {
  createQueuedMemoryJob,
  markMemoryJobEnqueueFailed,
  persistChatTurn,
} from "./chat-persistence.js";
import type { MemoryQueueAdapter } from "./memory-queue.js";
import { maybeHandleToolApprovalTurn } from "./tool-approval-turns.js";
import { handleToolAwareTurn } from "./tools-runtime.js";

export type RuntimeTurnPersistence = {
  memoryPayload: MemoryCandidateJobPayload;
  response: RuntimeChatResponse;
  conversationId?: string;
  userMessageId?: string;
};

type TurnRoutingParams = {
  config: AppConfig;
  dbClient: DbClient;
  defaultPersonaId: string;
  defaultUserId: string;
  request: RuntimeChatRequest;
  traceId: string;
};

type ImmediateTurnParams = TurnRoutingParams & {
  queue: AgentJobQueueAdapter;
};

export type RuntimeTurnBranch =
  | "agent_job_launch"
  | "agent_job_requirement"
  | "chat"
  | "tool_approval"
  | "tool_runtime";

export function selectRuntimeTurnBranch(
  handled: Partial<Record<Exclude<RuntimeTurnBranch, "chat">, boolean>>,
): RuntimeTurnBranch {
  if (handled.tool_runtime) {
    return "tool_runtime";
  }

  if (handled.tool_approval) {
    return "tool_approval";
  }

  if (handled.agent_job_requirement) {
    return "agent_job_requirement";
  }

  if (handled.agent_job_launch) {
    return "agent_job_launch";
  }

  return "chat";
}

export async function resolveImmediateRuntimeTurn(
  params: ImmediateTurnParams,
): Promise<RuntimeTurnPersistence | null> {
  const toolHandledTurn = await handleToolAwareTurn({
    config: params.config,
    dbClient: params.dbClient,
    defaultPersonaId: params.defaultPersonaId,
    defaultUserId: params.defaultUserId,
    request: params.request,
    traceId: params.traceId,
  });

  if (toolHandledTurn) {
    void selectRuntimeTurnBranch({ tool_runtime: true });
    return toolHandledTurn;
  }

  const toolApprovalHandledTurn = await maybeHandleToolApprovalTurn({
    config: params.config,
    dbClient: params.dbClient,
    defaultPersonaId: params.defaultPersonaId,
    defaultUserId: params.defaultUserId,
    request: params.request,
    traceId: params.traceId,
  });

  if (toolApprovalHandledTurn) {
    void selectRuntimeTurnBranch({ tool_approval: true });
    return toolApprovalHandledTurn;
  }

  const requirementHandledTurn = await maybeHandleAgentJobRequirementTurn({
    config: params.config,
    dbClient: params.dbClient,
    queue: params.queue,
    defaultPersonaId: params.defaultPersonaId,
    defaultUserId: params.defaultUserId,
    request: params.request,
    traceId: params.traceId,
  });

  if (requirementHandledTurn) {
    void selectRuntimeTurnBranch({ agent_job_requirement: true });
    return requirementHandledTurn;
  }

  return (
    (await maybeHandleAgentJobLaunchTurn({
      config: params.config,
      dbClient: params.dbClient,
      queue: params.queue,
      defaultPersonaId: params.defaultPersonaId,
      defaultUserId: params.defaultUserId,
      request: params.request,
      traceId: params.traceId,
    })) ?? null
  );
}

export async function processRuntimeTurn(
  params: ImmediateTurnParams,
): Promise<RuntimeTurnPersistence> {
  return (
    (await resolveImmediateRuntimeTurn(params)) ??
    (await persistChatTurn({
      config: params.config,
      dbClient: params.dbClient,
      defaultPersonaId: params.defaultPersonaId,
      defaultUserId: params.defaultUserId,
      request: params.request,
      traceId: params.traceId,
    }))
  );
}

export async function enqueueTurnMemoryFollowup(params: {
  dbClient: DbClient;
  memoryPayload: MemoryCandidateJobPayload;
  memoryQueue: MemoryQueueAdapter;
  traceId: string;
}) {
  const jobId = await createQueuedMemoryJob({
    dbClient: params.dbClient,
    payload: params.memoryPayload,
    traceId: params.traceId,
  });

  try {
    await params.memoryQueue.enqueue(jobId, params.memoryPayload);
  } catch (error) {
    await markMemoryJobEnqueueFailed(
      params.dbClient,
      jobId,
      error instanceof Error ? error.message : "Unknown enqueue error",
    );
  }

  return jobId;
}
