import { and, desc, eq, inArray } from "drizzle-orm";
import type { AppConfig } from "@secretary/config";
import { agentJobRequirements, agentJobs, jobs, type DbClient } from "@secretary/db";
import { createMessageId, type RuntimeChatRequest } from "@secretary/core-runtime";
import type { AgentJobQueueAdapter } from "./agent-job-queue.js";
import { decideAgentJobRequirement } from "./agent-jobs.js";
import { finalizeChatTurn, findConversationIdByChannelRef, prepareChatTurn } from "./chat-persistence.js";

type MaybeHandleAgentJobRequirementTurnParams = {
  config: AppConfig;
  dbClient: DbClient;
  queue: AgentJobQueueAdapter;
  defaultPersonaId: string;
  defaultUserId: string;
  request: RuntimeChatRequest;
  traceId: string;
};

const affirmativePattern = /^(?:yes|yep|yeah|sure|okay|ok|go ahead|do it|approve|allow|continue|proceed)\b/i;
const negativePattern = /^(?:no|nope|deny|reject|don't|do not|stop|cancel|block)\b/i;
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
  return `The build job is waiting on: ${label}.${detailLine} Reply yes to approve it, or no to keep the job blocked.`;
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

  const wantsDecision =
    affirmativePattern.test(text) ||
    negativePattern.test(text) ||
    requirementHelpPattern.test(text);

  if (!wantsDecision) {
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

  if (affirmativePattern.test(text) || negativePattern.test(text)) {
    const approved = affirmativePattern.test(text);
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
