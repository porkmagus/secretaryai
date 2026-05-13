import type { AppConfig } from "@secretary/config";
import { createMessageId, type RuntimeChatRequest } from "@secretary/core-runtime";
import { type DbClient, toolExecutions } from "@secretary/db";
import { and, desc, eq } from "drizzle-orm";
import { finalizeChatTurn, prepareChatTurn } from "./chat-persistence.js";
import { detectConversationDecision } from "./conversation-decisions.js";
import { decideToolExecution } from "./tools-runtime.js";
import { resolveConversationId } from "./utils/index.js";

type MaybeHandleToolApprovalTurnParams = {
  config: AppConfig;
  dbClient: DbClient;
  defaultPersonaId: string;
  defaultUserId: string;
  request: RuntimeChatRequest;
  traceId: string;
};

const approvalHelpPattern =
  /\b(approval|approve|deny|tool|permission|allowed|blocked|what do you need)\b/i;

// Note: resolveConversationId is now imported from utils/conversation.ts

function buildApprovalPrompt(toolName: string, summary: string) {
  return `I'm about to use ${toolName} to ${summary}. Go ahead?`;
}

export async function maybeHandleToolApprovalTurn(params: MaybeHandleToolApprovalTurnParams) {
  const conversationId = await resolveConversationId(params.dbClient, params.request);
  const text = params.request.message.text.trim();

  if (!conversationId) {
    return null;
  }

  const execution = await params.dbClient.db.query.toolExecutions.findFirst({
    where: and(
      eq(toolExecutions.conversationId, conversationId),
      eq(toolExecutions.approvalState, "pending"),
    ),
    orderBy: [desc(toolExecutions.createdAt)],
  });

  if (!execution) {
    return null;
  }

  const decision = detectConversationDecision(text, approvalHelpPattern);

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
    const executionDecision = await decideToolExecution({
      approve: approved,
      config: params.config,
      dbClient: params.dbClient,
      executionId: execution.id,
      traceId: params.traceId,
    });

    const assistantMessageId = executionDecision?.assistantMessage?.id ?? createMessageId();
    const outputText =
      executionDecision?.assistantMessage?.text ??
      (approved
        ? `Approved: ${execution.summary}. I’ve handled it now.`
        : `Denied: ${execution.summary}. I left it blocked and did not run anything.`);

    return {
      memoryPayload: {
        conversationId,
        messageId: assistantMessageId,
        traceId: params.traceId,
        userId: params.request.userId || params.defaultUserId,
        source: params.request.channel,
        text: params.request.message.text,
        telegramChatId: params.request.metadata?.telegramChatId ?? null,
      },
      response: {
        actions: [
          {
            kind: "tool_executed" as const,
            payload: {
              approved: approved ? "true" : "false",
              executionId: execution.id,
              toolKey: executionDecision?.execution.toolKey ?? "unknown",
            },
          },
        ],
        contextSummary: {
          memories: [],
          research: undefined,
          tasks: [],
        },
        conversationId,
        messageId: assistantMessageId,
        outputText,
        pendingApproval: null,
        traceId: params.traceId,
      },
    };
  }

  return finalizeChatTurn({
    dbClient: params.dbClient,
    preparedTurn,
    assistantMessageId: createMessageId(),
    outputText: buildApprovalPrompt("This tool request", execution.summary),
    mode: "tool",
    providerError: null,
  });
}
