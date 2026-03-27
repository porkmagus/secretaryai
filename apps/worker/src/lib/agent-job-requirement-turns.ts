import { and, desc, eq, inArray } from "drizzle-orm";
import type { AppConfig } from "@secretary/config";
import { agentJobRequirements, agentJobs, jobs, type DbClient } from "@secretary/db";
import { createMessageId, type RuntimeChatRequest } from "@secretary/core-runtime";
import type { AgentJobQueueAdapter } from "./agent-job-queue.js";
import { decideAgentJobRequirement } from "./agent-jobs.js";
import { finalizeChatTurn, findConversationIdByChannelRef, prepareChatTurn } from "./chat-persistence.js";
import { detectConversationDecision } from "./conversation-decisions.js";

type MaybeHandleAgentJobRequirementTurnParams = {
  config: AppConfig;
  dbClient: DbClient;
  queue: AgentJobQueueAdapter;
  defaultPersonaId: string;
  defaultUserId: string;
  request: RuntimeChatRequest;
  traceId: string;
};

const requirementHelpPattern = /\b(blocked|requirement|requirements|approve|approval|deny|denied|runtime|what do you need)\b/i;

async function resolveConversationId(dbClient: DbClient, request: RuntimeChatRequest) {
  if (request.conversationId) {
    return request.conversationId;
  }

  if (request.channel === "telegram" && request.metadata?.telegramChatId) {
    return findConversationIdByChannelRef(dbClient, "telegram", request.metadata.telegramChatId);
  }

  return null;
}

function buildRequirementPrompt(label: string, detail: string | null) {
  const detailLine = detail ? ` ${detail}` : "";
  return `The build job is waiting on: ${label}.${detailLine} Say yes, continue, or approve to let me keep going, or say no to leave it blocked.`;
}

export async function maybeHandleAgentJobRequirementTurn(
  params: MaybeHandleAgentJobRequirementTurnParams,
) {
  const conversationId = await resolveConversationId(params.dbClient, params.request);
  const text = params.request.message.text.trim();

  if (!conversationId) {
    return null;
  }

  const pendingRequirement = await params.dbClient.db
    .select({
      requirement: agentJobRequirements,
      agent: agentJobs,
      job: jobs,
    })
    .from(agentJobRequirements)
    .innerJoin(agentJobs, eq(agentJobRequirements.jobId, agentJobs.jobId))
    .innerJoin(jobs, eq(agentJobs.jobId, jobs.id))
    .where(
      and(
        eq(agentJobs.conversationId, conversationId),
        eq(agentJobRequirements.status, "pending"),
        inArray(jobs.status, ["waiting_for_approval", "waiting_for_runtime", "blocked"]),
      ),
    )
    .orderBy(desc(agentJobRequirements.createdAt))
    .limit(1);

  const current = pendingRequirement[0] ?? null;
  if (!current) {
    return null;
  }

  const decision = detectConversationDecision(text, requirementHelpPattern);

  if (!decision) {
    return null;
  }

  const preparedTurn = await prepareChatTurn({
    config: params.config,
    dbClient: params.dbClient,
    defaultPersonaId: params.defaultPersonaId,
    defaultUserId: params.defaultUserId,
    request: params.request,
    traceId: params.traceId,
  });

  if (decision === "approve" || decision === "deny") {
    const approved = decision === "approve";
    await decideAgentJobRequirement({
      config: params.config,
      dbClient: params.dbClient,
      queue: params.queue,
      jobId: current.requirement.jobId,
      requirementId: current.requirement.id,
      decision: {
        approved,
        reason: approved
          ? "Approved in the conversation thread."
          : "Denied in the conversation thread.",
      },
      notifyConversation: false,
    });

    return finalizeChatTurn({
      dbClient: params.dbClient,
      preparedTurn,
      assistantMessageId: createMessageId(),
      outputText: approved
        ? `Approved: ${current.requirement.label}. I’m continuing the build job now.`
        : `Denied: ${current.requirement.label}. I’ll keep the build job blocked until that requirement changes.`,
      mode: "tool",
      providerError: null,
    });
  }

  return finalizeChatTurn({
    dbClient: params.dbClient,
    preparedTurn,
    assistantMessageId: createMessageId(),
    outputText: buildRequirementPrompt(current.requirement.label, current.requirement.detail),
    mode: "tool",
    providerError: null,
  });
}
