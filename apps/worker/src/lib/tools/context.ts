import type { AppConfig } from "@secretary/config";
import {
  createConversationId,
  createMessageId,
  type MemoryCandidateJobPayload,
  type RuntimeChatRequest,
  type RuntimeChatResponse,
  type ToolApprovalDecisionResponse,
} from "@secretary/core-runtime";
import {
  activityTraces,
  conversations,
  type DbClient,
  messages,
  personas,
  toolExecutions,
  tools,
  users,
} from "@secretary/db";
import { eq } from "drizzle-orm";
import { parseSecretaryCustomization } from "../admin-runtime-core.js";
import { findConversationIdByChannelRef, getConversationMessages } from "../chat-persistence.js";
import { getActiveTaskContext, retrieveRelevantMemories } from "../memory-engine/index.js";
import { defaultSecretaryName, defaultSecretarySoul } from "../persona-soul.js";
import { logToolExecution } from "../utils.js";
import { executeToolRequest } from "./executors.js";
import { detectToolIntent } from "./parsers.js";
import { getToolByKey, toToolExecutionRecord } from "./registry.js";

export async function insertActivityTrace(params: {
  conversationId: string | null;
  dbClient: DbClient;
  eventName: string;
  payload: Record<string, unknown>;
  parentTraceId: string;
  traceType?: string;
}) {
  await params.dbClient.db.insert(activityTraces).values({
    id: createMessageId(),
    traceType: params.traceType ?? "tool",
    parentTraceId: params.parentTraceId,
    conversationId: params.conversationId,
    jobId: null,
    eventName: params.eventName,
    payloadJson: params.payload,
  });
}

export async function recordToolTrace(params: {
  conversationId: string | null;
  dbClient: DbClient;
  eventName: string;
  executionId: string;
  payload?: Record<string, unknown>;
  traceId: string;
}) {
  await insertActivityTrace({
    conversationId: params.conversationId,
    dbClient: params.dbClient,
    eventName: params.eventName,
    payload: {
      executionId: params.executionId,
      ...params.payload,
    },
    parentTraceId: params.traceId,
    traceType: "tool",
  });
}

export async function ensureConversationEnvelope(params: {
  dbClient: DbClient;
  defaultPersonaId: string;
  defaultUserId: string;
  request: RuntimeChatRequest;
  traceId: string;
}) {
  const existingConversationId =
    params.request.conversationId ??
    (params.request.channel === "telegram" && params.request.metadata?.telegramChatId
      ? await findConversationIdByChannelRef(
          params.dbClient,
          params.request.channel,
          params.request.metadata.telegramChatId,
        )
      : null);
  const conversationId = existingConversationId ?? createConversationId();
  const userId = params.request.userId || params.defaultUserId;
  const userDisplayName = params.request.metadata?.telegramUserDisplayName ?? "Local Owner";
  const userMessageId = createMessageId();
  const conversationTitle =
    params.request.channel === "telegram" && params.request.metadata?.telegramChatLabel
      ? `Telegram: ${params.request.metadata.telegramChatLabel}`
      : params.request.message.text.slice(0, 80);

  await params.dbClient.db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values({
        id: userId,
        displayName: "Local Owner",
        defaultPersonaId: params.defaultPersonaId,
      })
      .onConflictDoNothing();

    await tx
      .insert(personas)
      .values({
        id: params.defaultPersonaId,
        name: defaultSecretaryName,
        toneProfile: {
          mode: "calm",
          customization: parseSecretaryCustomization(null),
        },
        behaviorRules: [
          "Be warm, competent, and calm.",
          "Answer naturally instead of narrating internal system state unless the user asks for it.",
          "Protect local-first privacy defaults.",
        ],
        promptTemplate: defaultSecretarySoul,
        isDefault: true,
      })
      .onConflictDoNothing();

    await tx
      .insert(conversations)
      .values({
        id: conversationId,
        userId,
        channelType: params.request.channel,
        channelRef: params.request.metadata?.telegramChatId ?? null,
        channelLabel: params.request.metadata?.telegramChatLabel ?? null,
        title: conversationTitle,
        status: "active",
        lastMessageAt: new Date(),
      })
      .onConflictDoUpdate({
        target: conversations.id,
        set: {
          channelType: params.request.channel,
          channelRef: params.request.metadata?.telegramChatId ?? null,
          channelLabel: params.request.metadata?.telegramChatLabel ?? null,
          lastMessageAt: new Date(),
          updatedAt: new Date(),
        },
      });

    await tx.insert(messages).values({
      id: userMessageId,
      conversationId,
      role: "user",
      contentText: params.request.message.text,
      contentJson: params.request.message.attachments
        ? { attachments: params.request.message.attachments }
        : null,
      channelMessageId: params.request.metadata?.sourceMessageId,
      parentMessageId: null,
    });
  });

  await insertActivityTrace({
    conversationId,
    dbClient: params.dbClient,
    eventName: "runtime.chat.received",
    payload: {
      channel: params.request.channel,
      messageId: userMessageId,
      traceId: params.traceId,
    },
    parentTraceId: params.traceId,
    traceType: "runtime",
  });

  return {
    conversationId,
    userDisplayName,
    userId,
    userMessageId,
  };
}

export async function buildToolContext(params: {
  conversationId: string;
  dbClient: DbClient;
  userId: string;
  userText: string;
}) {
  const [recentMessages, relevantMemories, activeTasks] = await Promise.all([
    getConversationMessages(params.dbClient, params.conversationId),
    retrieveRelevantMemories(params.dbClient, params.userText),
    getActiveTaskContext(params.dbClient, params.userId),
  ]);

  return {
    activeTasks,
    recentMessages,
    relevantMemories,
  };
}

export async function createExecution(params: {
  approvalState: RuntimeChatResponse["pendingApproval"] extends infer _T
    ? "policy_denied" | "pending" | "not_required"
    : string;
  conversationId: string;
  dbClient: DbClient;
  executionStatus: "completed" | "failed" | "denied" | "awaiting_approval";
  requestJson: Record<string, unknown>;
  requestedBy: string;
  summary: string;
  toolId: string;
}) {
  const id = createMessageId();
  await params.dbClient.db.insert(toolExecutions).values({
    id,
    toolId: params.toolId,
    conversationId: params.conversationId,
    requestedBy: params.requestedBy,
    executionStatus: params.executionStatus,
    approvalState: params.approvalState,
    requestJson: params.requestJson,
    responseJson: null,
    summary: params.summary,
    errorText: null,
    startedAt:
      params.executionStatus === "completed" || params.executionStatus === "failed"
        ? new Date()
        : null,
    finishedAt: null,
  });

  return id;
}

export async function persistAssistantResult(params: {
  actions: RuntimeChatResponse["actions"];
  conversationId: string;
  dbClient: DbClient;
  outputText: string;
  pendingApproval?: RuntimeChatResponse["pendingApproval"];
  traceId: string;
  userMessageId: string;
  context: Awaited<ReturnType<typeof buildToolContext>>;
}) {
  const assistantMessageId = createMessageId();

  await params.dbClient.db.transaction(async (tx) => {
    await tx.insert(messages).values({
      id: assistantMessageId,
      conversationId: params.conversationId,
      role: "assistant",
      contentText: params.outputText,
      contentJson: params.pendingApproval ? { pendingApproval: params.pendingApproval } : null,
      channelMessageId: null,
      parentMessageId: params.userMessageId,
    });

    await tx
      .update(conversations)
      .set({
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, params.conversationId));
  });

  await insertActivityTrace({
    conversationId: params.conversationId,
    dbClient: params.dbClient,
    eventName: "runtime.chat.completed",
    payload: {
      assistantMessageId,
      memoryIds: params.context.relevantMemories.map((memory) => memory.id),
      outputLength: params.outputText.length,
      pendingApproval: Boolean(params.pendingApproval),
      taskIds: params.context.activeTasks.map((task) => task.id),
      traceId: params.traceId,
    },
    parentTraceId: params.traceId,
    traceType: "runtime",
  });

  return assistantMessageId;
}

function createMemoryPayload(params: {
  assistantMessageId: string;
  conversationId: string;
  request: RuntimeChatRequest;
  traceId: string;
}) {
  return {
    conversationId: params.conversationId,
    messageId: params.assistantMessageId,
    traceId: params.traceId,
    userId: params.request.userId,
    source: params.request.channel,
    text: params.request.message.text,
    telegramChatId: params.request.metadata?.telegramChatId ?? null,
  } satisfies MemoryCandidateJobPayload;
}

async function appendApprovalMessage(params: {
  conversationId: string | null;
  dbClient: DbClient;
  text: string;
}) {
  if (!params.conversationId) {
    return null;
  }

  const messageId = createMessageId();
  await params.dbClient.db.insert(messages).values({
    id: messageId,
    conversationId: params.conversationId,
    role: "assistant",
    contentText: params.text,
    contentJson: null,
    channelMessageId: null,
    parentMessageId: null,
  });
  await params.dbClient.db
    .update(conversations)
    .set({
      lastMessageAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, params.conversationId));

  return {
    id: messageId,
    text: params.text,
  };
}

export async function handleToolAwareTurn(params: {
  config: AppConfig;
  dbClient: DbClient;
  defaultPersonaId: string;
  defaultUserId: string;
  request: RuntimeChatRequest;
  traceId: string;
}) {
  const intent = detectToolIntent(params.request.message.text);

  if (!intent) {
    return null;
  }

  const tool = await getToolByKey(params.dbClient, intent.toolKey);

  if (!tool) {
    return null;
  }

  const envelope = await ensureConversationEnvelope({
    dbClient: params.dbClient,
    defaultPersonaId: params.defaultPersonaId,
    defaultUserId: params.defaultUserId,
    request: params.request,
    traceId: params.traceId,
  });
  const context = await buildToolContext({
    conversationId: envelope.conversationId,
    dbClient: params.dbClient,
    userId: envelope.userId,
    userText: params.request.message.text,
  });

  let outputText = "";
  let pendingApproval: RuntimeChatResponse["pendingApproval"] = null;
  let actions: RuntimeChatResponse["actions"] = [];

  if (!tool.enabled || tool.approvalMode === "deny") {
    const executionId = await createExecution({
      approvalState: "policy_denied",
      conversationId: envelope.conversationId,
      dbClient: params.dbClient,
      executionStatus: "denied",
      requestJson: intent.requestJson,
      requestedBy: envelope.userId,
      summary: intent.summary,
      toolId: tool.id,
    });
    await recordToolTrace({
      conversationId: envelope.conversationId,
      dbClient: params.dbClient,
      eventName: "tool.execution.policy_denied",
      executionId,
      payload: {
        approvalMode: tool.approvalMode,
        enabled: tool.enabled,
        toolKey: tool.key,
      },
      traceId: params.traceId,
    });

    await params.dbClient.db
      .update(toolExecutions)
      .set({
        errorText: tool.enabled ? "Tool policy is set to deny." : "Tool is disabled.",
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(toolExecutions.id, executionId));

    outputText = `${tool.name} is currently unavailable for direct execution here because its policy is set to deny or it is disabled.`;
  } else if (tool.approvalMode === "ask_first") {
    const executionId = await createExecution({
      approvalState: "pending",
      conversationId: envelope.conversationId,
      dbClient: params.dbClient,
      executionStatus: "awaiting_approval",
      requestJson: intent.requestJson,
      requestedBy: envelope.userId,
      summary: intent.summary,
      toolId: tool.id,
    });
    await recordToolTrace({
      conversationId: envelope.conversationId,
      dbClient: params.dbClient,
      eventName: "tool.execution.pending_approval",
      executionId,
      payload: {
        requestJson: intent.requestJson,
        summary: intent.summary,
        toolKey: tool.key,
      },
      traceId: params.traceId,
    });

    pendingApproval = {
      executionId,
      summary: intent.summary,
      toolId: tool.id,
      toolKey: tool.key,
      toolName: tool.name,
    };
    actions = [
      {
        kind: "approval_requested",
        payload: {
          executionId,
          toolKey: tool.key,
        },
      },
    ];
    outputText = `I can do that with ${tool.name}, but it needs approval first. Review the request and approve or deny it.`;
  } else {
    const executionId = await createExecution({
      approvalState: "not_required",
      conversationId: envelope.conversationId,
      dbClient: params.dbClient,
      executionStatus: "completed",
      requestJson: intent.requestJson,
      requestedBy: envelope.userId,
      summary: intent.summary,
      toolId: tool.id,
    });
    await recordToolTrace({
      conversationId: envelope.conversationId,
      dbClient: params.dbClient,
      eventName: "tool.execution.started",
      executionId,
      payload: {
        requestJson: intent.requestJson,
        summary: intent.summary,
        toolKey: tool.key,
      },
      traceId: params.traceId,
    });

    const executionStartedAt = performance.now();
    try {
      const result = await executeToolRequest({
        config: params.config,
        conversationId: envelope.conversationId,
        dbClient: params.dbClient,
        requestJson: intent.requestJson,
        requestedBy: envelope.userId,
        toolKey: tool.key,
      });

      logToolExecution({
        toolKey: tool.key,
        durationMs: Math.round(performance.now() - executionStartedAt),
        success: true,
        resultCount: result.responseJson ? 1 : 0,
      });

      await params.dbClient.db
        .update(toolExecutions)
        .set({
          responseJson: result.responseJson,
          startedAt: new Date(),
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(toolExecutions.id, executionId));
      await recordToolTrace({
        conversationId: envelope.conversationId,
        dbClient: params.dbClient,
        eventName: "tool.execution.completed",
        executionId,
        payload: {
          toolKey: tool.key,
        },
        traceId: params.traceId,
      });

      outputText = result.text;
      actions = [
        {
          kind: tool.key === "task_create" ? "task_created" : "tool_executed",
          payload: {
            toolKey: tool.key,
          },
        },
      ];
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logToolExecution({
        toolKey: tool.key,
        durationMs: Math.round(performance.now() - executionStartedAt),
        success: false,
        error: errorMessage,
      });

      await params.dbClient.db
        .update(toolExecutions)
        .set({
          executionStatus: "failed",
          responseJson: null,
          errorText: errorMessage,
          startedAt: new Date(),
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(toolExecutions.id, executionId));
      await recordToolTrace({
        conversationId: envelope.conversationId,
        dbClient: params.dbClient,
        eventName: "tool.execution.failed",
        executionId,
        payload: {
          error: errorMessage,
          toolKey: tool.key,
        },
        traceId: params.traceId,
      });

      outputText = `${tool.name} failed safely. ${errorMessage}`;
    }
  }

  const assistantMessageId = await persistAssistantResult({
    actions,
    conversationId: envelope.conversationId,
    dbClient: params.dbClient,
    outputText,
    pendingApproval,
    traceId: params.traceId,
    userMessageId: envelope.userMessageId,
    context,
  });

  return {
    memoryPayload: createMemoryPayload({
      assistantMessageId,
      conversationId: envelope.conversationId,
      request: {
        ...params.request,
        userId: envelope.userId,
      },
      traceId: params.traceId,
    }),
    response: {
      actions,
      contextSummary: {
        memories: context.relevantMemories,
        tasks: context.activeTasks,
      },
      conversationId: envelope.conversationId,
      messageId: assistantMessageId,
      outputText,
      pendingApproval,
      traceId: params.traceId,
    } satisfies RuntimeChatResponse,
  };
}

export async function decideToolExecution(params: {
  approve: boolean;
  config: AppConfig;
  dbClient: DbClient;
  executionId: string;
  traceId?: string;
}): Promise<ToolApprovalDecisionResponse | null> {
  const execution = await params.dbClient.db.query.toolExecutions.findFirst({
    where: eq(toolExecutions.id, params.executionId),
  });

  if (!execution) {
    return null;
  }

  const tool = await params.dbClient.db.query.tools.findFirst({
    where: eq(tools.id, execution.toolId),
  });

  if (!tool) {
    return null;
  }

  if (execution.approvalState !== "pending") {
    return {
      assistantMessage: null,
      conversationId: execution.conversationId,
      execution: toToolExecutionRecord(execution, tool),
    };
  }

  if (!params.approve) {
    await params.dbClient.db
      .update(toolExecutions)
      .set({
        approvalState: "denied",
        executionStatus: "denied",
        errorText: "User denied execution.",
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(toolExecutions.id, execution.id));
    await recordToolTrace({
      conversationId: execution.conversationId,
      dbClient: params.dbClient,
      eventName: "tool.execution.denied",
      executionId: execution.id,
      payload: {
        toolKey: tool.key,
      },
      traceId: params.traceId ?? execution.id,
    });

    const deniedExecution = await params.dbClient.db.query.toolExecutions.findFirst({
      where: eq(toolExecutions.id, execution.id),
    });
    const assistantMessage = await appendApprovalMessage({
      conversationId: execution.conversationId,
      dbClient: params.dbClient,
      text: `${tool.name} was cancelled.`,
    });

    return {
      assistantMessage,
      conversationId: execution.conversationId,
      execution: toToolExecutionRecord(deniedExecution ?? execution, tool),
    };
  }

  try {
    await recordToolTrace({
      conversationId: execution.conversationId,
      dbClient: params.dbClient,
      eventName: "tool.execution.approved",
      executionId: execution.id,
      payload: {
        toolKey: tool.key,
      },
      traceId: params.traceId ?? execution.id,
    });
    const result = await executeToolRequest({
      config: params.config,
      conversationId: execution.conversationId,
      dbClient: params.dbClient,
      requestJson: execution.requestJson,
      requestedBy: execution.requestedBy,
      toolKey: tool.key,
    });

    await params.dbClient.db
      .update(toolExecutions)
      .set({
        approvalState: "approved",
        executionStatus: "completed",
        responseJson: result.responseJson,
        startedAt: execution.startedAt ?? new Date(),
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(toolExecutions.id, execution.id));
    await recordToolTrace({
      conversationId: execution.conversationId,
      dbClient: params.dbClient,
      eventName: "tool.execution.completed",
      executionId: execution.id,
      payload: {
        toolKey: tool.key,
      },
      traceId: params.traceId ?? execution.id,
    });

    const approvedExecution = await params.dbClient.db.query.toolExecutions.findFirst({
      where: eq(toolExecutions.id, execution.id),
    });
    const assistantMessage = await appendApprovalMessage({
      conversationId: execution.conversationId,
      dbClient: params.dbClient,
      text: result.text,
    });

    return {
      assistantMessage,
      conversationId: execution.conversationId,
      execution: toToolExecutionRecord(approvedExecution ?? execution, tool),
    };
  } catch (error) {
    await params.dbClient.db
      .update(toolExecutions)
      .set({
        approvalState: "approved",
        executionStatus: "failed",
        errorText: error instanceof Error ? error.message : String(error),
        startedAt: execution.startedAt ?? new Date(),
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(toolExecutions.id, execution.id));
    await recordToolTrace({
      conversationId: execution.conversationId,
      dbClient: params.dbClient,
      eventName: "tool.execution.failed",
      executionId: execution.id,
      payload: {
        error: error instanceof Error ? error.message : String(error),
        toolKey: tool.key,
      },
      traceId: params.traceId ?? execution.id,
    });

    const failedExecution = await params.dbClient.db.query.toolExecutions.findFirst({
      where: eq(toolExecutions.id, execution.id),
    });
    const assistantMessage = await appendApprovalMessage({
      conversationId: execution.conversationId,
      dbClient: params.dbClient,
      text: `${tool.name} failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    });

    return {
      assistantMessage,
      conversationId: execution.conversationId,
      execution: toToolExecutionRecord(failedExecution ?? execution, tool),
    };
  }
}
