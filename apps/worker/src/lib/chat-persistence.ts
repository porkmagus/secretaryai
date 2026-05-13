import type { AppConfig } from "@secretary/config";
import {
  createConversationId,
  createMessageId,
  type DeskChatMessageMetadata,
  type MemoryCandidateJobPayload,
  type RuntimeChatRequest,
  type RuntimeChatResponse,
  type RuntimeContextMessage,
  type RuntimeTurnContext,
} from "@secretary/core-runtime";
import {
  activityTraces,
  conversations,
  type DbClient,
  jobs,
  messages,
  personas,
  users,
} from "@secretary/db";
import type { UIMessage } from "ai";
import { and, asc, desc, eq } from "drizzle-orm";
import { parseSecretaryCustomization } from "./admin-runtime.js";
import type { InferenceRuntimeConfig } from "./ai-sdk-registry.js";
import { generateConversationReply } from "./conversation-model.js";
import { getInferenceRuntimeConfig } from "./inference-settings.js";
import { getActiveTaskContext, retrieveRelevantMemories } from "./memory-engine.js";
import {
  defaultSecretaryName,
  defaultSecretarySoul,
  loadSecretaryPersonaProfile,
  loadSecretarySoul,
} from "./persona-soul.js";
import { runResearchSpecialist, shouldUseResearchSpecialist } from "./research-specialist.js";

type PersistTurnParams = {
  config: AppConfig;
  dbClient: DbClient;
  defaultPersonaId: string;
  defaultUserId: string;
  request: RuntimeChatRequest;
  traceId: string;
};

type PersistedConversationMessage = Awaited<ReturnType<typeof getConversationMessages>>[number];

export type PreparedChatTurn = {
  conversationId: string;
  context: RuntimeTurnContext;
  inference: InferenceRuntimeConfig;
  originalMessages: UIMessage<DeskChatMessageMetadata>[];
  request: RuntimeChatRequest;
  traceId: string;
  userId: string;
  userMessageId: string;
};

export function toRuntimeContextMessage(
  message: PersistedConversationMessage,
): RuntimeContextMessage {
  return {
    role: message.role as "assistant" | "specialist" | "system" | "tool" | "user",
    text: message.contentText,
  };
}

export function toDeskChatRole(message: PersistedConversationMessage["role"]) {
  return message === "user" ? "user" : "assistant";
}

export function toDeskChatMessage(
  message: PersistedConversationMessage,
): UIMessage<DeskChatMessageMetadata> {
  return {
    id: message.id,
    role: toDeskChatRole(message.role),
    parts: [
      {
        type: "text",
        text: message.contentText,
      },
    ],
  };
}

export function buildContextSummary(context: RuntimeTurnContext) {
  return {
    memories: context.relevantMemories,
    tasks: context.activeTasks,
    research: context.researchResult ?? undefined,
  };
}

export function validateMessageInsert(params: {
  channelMessageId?: string | null;
  contentText: string;
  role: string;
}) {
  const contentText = params.contentText.trim();

  if (!contentText) {
    return {
      ok: false,
      reason: "empty_content",
    } as const;
  }

  if (
    params.role !== "assistant" &&
    params.role !== "specialist" &&
    params.role !== "system" &&
    params.role !== "tool" &&
    params.role !== "user"
  ) {
    return {
      ok: false,
      reason: "invalid_role",
    } as const;
  }

  return {
    ok: true,
    value: {
      channelMessageId: params.channelMessageId?.trim() || null,
      contentText,
      role: params.role,
    },
  } as const;
}

function createMemoryPayload(params: {
  conversationId: string;
  userId: string;
  request: RuntimeChatRequest;
  messageId: string;
  traceId: string;
}): MemoryCandidateJobPayload {
  return {
    conversationId: params.conversationId,
    messageId: params.messageId,
    traceId: params.traceId,
    userId: params.userId,
    source: params.request.channel,
    text: params.request.message.text,
    telegramChatId: params.request.metadata?.telegramChatId ?? null,
  };
}

async function ensureConversationEnvelope(params: PersistTurnParams) {
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
          gender: "female",
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

    await tx.insert(activityTraces).values({
      id: createMessageId(),
      traceType: "runtime",
      parentTraceId: null,
      conversationId,
      jobId: null,
      eventName: "runtime.chat.received",
      payloadJson: {
        channel: params.request.channel,
        messageId: userMessageId,
        traceId: params.traceId,
      },
    });
  });

  return {
    conversationId,
    userDisplayName,
    userId,
    userMessageId,
  };
}

export async function prepareChatTurn(params: PersistTurnParams): Promise<PreparedChatTurn> {
  const envelope = await ensureConversationEnvelope(params);
  const recentMessages = await getConversationMessages(params.dbClient, envelope.conversationId);
  const relevantMemories = await retrieveRelevantMemories(
    params.dbClient,
    params.request.message.text,
  );
  const activeTasks = await getActiveTaskContext(params.dbClient, envelope.userId);
  const personaRecord =
    (await params.dbClient.db.query.personas.findFirst({
      where: eq(personas.id, params.defaultPersonaId),
    })) ??
    (await params.dbClient.db.query.personas.findFirst({
      where: eq(personas.isDefault, true),
    }));
  const soulText = await loadSecretarySoul(personaRecord?.promptTemplate ?? defaultSecretarySoul);
  const personaProfileText = await loadSecretaryPersonaProfile();
  const researchResult = shouldUseResearchSpecialist(params.request.message.text)
    ? runResearchSpecialist(params.request.message.text)
    : null;
  const inference = await getInferenceRuntimeConfig();

  return {
    conversationId: envelope.conversationId,
    context: {
      conversationId: envelope.conversationId,
      recentMessages: recentMessages.map(toRuntimeContextMessage),
      userDisplayName: envelope.userDisplayName,
      persona: personaRecord
        ? {
            name: personaRecord.name,
            soul: soulText,
            personaProfile: personaProfileText,
            toneMode:
              typeof personaRecord.toneProfile?.mode === "string"
                ? personaRecord.toneProfile.mode
                : null,
            gender:
              personaRecord.toneProfile?.gender === "male"
                ? ("male" as const)
                : ("female" as const),
            customization: parseSecretaryCustomization(personaRecord.toneProfile),
            behaviorRules: personaRecord.behaviorRules,
          }
        : undefined,
      relevantMemories,
      activeTasks,
      researchResult,
    },
    inference,
    originalMessages: recentMessages.map(toDeskChatMessage),
    request: {
      ...params.request,
      conversationId: envelope.conversationId,
      userId: envelope.userId,
    },
    traceId: params.traceId,
    userId: envelope.userId,
    userMessageId: envelope.userMessageId,
  };
}

export async function finalizeChatTurn(params: {
  dbClient: DbClient;
  preparedTurn: PreparedChatTurn;
  assistantMessageId: string;
  outputText: string;
  mode: "model" | "fallback" | "tool";
  model?: string | null;
  pendingApproval?: RuntimeChatResponse["pendingApproval"] | null;
  providerError?: string | null;
  actions?: RuntimeChatResponse["actions"];
}) {
  const responseActions = params.actions ?? [
    {
      kind: "memory_candidate_queued",
      payload: {
        source: params.preparedTurn.request.channel,
        status: "queued",
      },
    },
  ];

  if (
    params.preparedTurn.context.researchResult &&
    !responseActions.some((action) => action.kind === "research_specialist_used")
  ) {
    responseActions.push({
      kind: "research_specialist_used",
      payload: {
        mode: params.preparedTurn.context.researchResult.mode,
        specialist: params.preparedTurn.context.researchResult.specialist,
      },
    });
  }

  await params.dbClient.db.transaction(async (tx) => {
    if (params.preparedTurn.context.researchResult) {
      await tx.insert(activityTraces).values({
        id: createMessageId(),
        traceType: "specialist",
        parentTraceId: params.preparedTurn.traceId,
        conversationId: params.preparedTurn.conversationId,
        jobId: null,
        eventName: "research.specialist.completed",
        payloadJson: params.preparedTurn.context.researchResult,
      });
    }

    await tx.insert(activityTraces).values({
      id: createMessageId(),
      traceType: "runtime",
      parentTraceId: params.preparedTurn.traceId,
      conversationId: params.preparedTurn.conversationId,
      jobId: null,
      eventName: "runtime.chat.context_assembled",
      payloadJson: {
        memoryIds: params.preparedTurn.context.relevantMemories.map((memory) => memory.id),
        taskIds: params.preparedTurn.context.activeTasks.map((task) => task.id),
        researchUsed: Boolean(params.preparedTurn.context.researchResult),
        replyMode: params.mode,
        replyModel: params.model ?? null,
        providerError: params.providerError ?? null,
      },
    });

    await tx.insert(messages).values({
      id: params.assistantMessageId,
      conversationId: params.preparedTurn.conversationId,
      role: "assistant",
      contentText: params.outputText,
      contentJson: null,
      channelMessageId: null,
      parentMessageId: params.preparedTurn.userMessageId,
    });

    await tx
      .update(conversations)
      .set({
        updatedAt: new Date(),
        lastMessageAt: new Date(),
      })
      .where(eq(conversations.id, params.preparedTurn.conversationId));

    await tx.insert(activityTraces).values({
      id: createMessageId(),
      traceType: "runtime",
      parentTraceId: params.preparedTurn.traceId,
      conversationId: params.preparedTurn.conversationId,
      jobId: null,
      eventName: "runtime.chat.completed",
      payloadJson: {
        assistantMessageId: params.assistantMessageId,
        recentContextCount: params.preparedTurn.context.recentMessages.length,
        memoryIds: params.preparedTurn.context.relevantMemories.map((memory) => memory.id),
        taskIds: params.preparedTurn.context.activeTasks.map((task) => task.id),
        researchUsed: Boolean(params.preparedTurn.context.researchResult),
        replyMode: params.mode,
        replyModel: params.model ?? null,
        providerError: params.providerError ?? null,
        outputLength: params.outputText.length,
        traceId: params.preparedTurn.traceId,
      },
    });
  });

  const response = {
    actions: responseActions,
    contextSummary: buildContextSummary(params.preparedTurn.context),
    conversationId: params.preparedTurn.conversationId,
    messageId: params.assistantMessageId,
    outputText: params.outputText,
    pendingApproval: params.pendingApproval ?? null,
    traceId: params.preparedTurn.traceId,
  } satisfies RuntimeChatResponse;

  return {
    conversationId: params.preparedTurn.conversationId,
    memoryPayload: createMemoryPayload({
      conversationId: params.preparedTurn.conversationId,
      userId: params.preparedTurn.userId,
      request: params.preparedTurn.request,
      messageId: params.assistantMessageId,
      traceId: params.preparedTurn.traceId,
    }),
    response,
    userMessageId: params.preparedTurn.userMessageId,
  };
}

export async function persistChatTurn({
  config,
  dbClient,
  defaultPersonaId,
  defaultUserId,
  request,
  traceId,
}: PersistTurnParams) {
  void config;
  const preparedTurn = await prepareChatTurn({
    config,
    dbClient,
    defaultPersonaId,
    defaultUserId,
    request,
    traceId,
  });
  const reply = await generateConversationReply({
    inference: preparedTurn.inference,
    request: preparedTurn.request,
    context: preparedTurn.context,
    traceId,
  });
  return finalizeChatTurn({
    dbClient,
    preparedTurn,
    assistantMessageId: reply.response.messageId,
    outputText: reply.outputText,
    mode: reply.mode,
    model: reply.model ?? null,
    providerError: reply.providerError ?? null,
    actions: reply.response.actions,
    pendingApproval: reply.response.pendingApproval ?? null,
  });
}

type QueueMemoryJobParams = {
  dbClient: DbClient;
  payload: MemoryCandidateJobPayload;
  traceId: string;
};

export async function createQueuedMemoryJob({ dbClient, payload, traceId }: QueueMemoryJobParams) {
  const jobId = createMessageId();

  await dbClient.db.insert(jobs).values({
    id: jobId,
    jobType: "memory.extract_candidates",
    status: "queued",
    payloadJson: payload,
    resultJson: null,
    parentJobId: null,
    scheduledFor: new Date(),
    startedAt: null,
    finishedAt: null,
    errorText: null,
  });

  await dbClient.db.insert(activityTraces).values({
    id: createMessageId(),
    traceType: "queue",
    parentTraceId: traceId,
    conversationId: payload.conversationId,
    jobId,
    eventName: "memory.extract_candidates.queued",
    payloadJson: {
      jobId,
      traceId,
    },
  });

  return jobId;
}

export async function markMemoryJobEnqueueFailed(
  dbClient: DbClient,
  jobId: string,
  errorText: string,
) {
  await dbClient.db
    .update(jobs)
    .set({
      status: "enqueue_failed",
      errorText,
      updatedAt: new Date(),
      finishedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));
}

export async function getConversationMessages(dbClient: DbClient, conversationId: string) {
  return dbClient.db.query.messages.findMany({
    where: eq(messages.conversationId, conversationId),
    orderBy: asc(messages.createdAt),
    limit: 100,
  });
}

export async function findConversationIdByChannelRef(
  dbClient: DbClient,
  channelType: string,
  channelRef: string,
) {
  const conversation = await dbClient.db.query.conversations.findFirst({
    where: and(
      eq(conversations.channelType, channelType),
      eq(conversations.channelRef, channelRef),
    ),
    orderBy: desc(conversations.lastMessageAt),
  });

  return conversation?.id ?? null;
}

export async function attachExternalMessageIdToMessage(
  dbClient: DbClient,
  messageId: string,
  channelMessageId: string,
) {
  await dbClient.db
    .update(messages)
    .set({
      channelMessageId,
    })
    .where(eq(messages.id, messageId));
}

export async function listRecentConversations(dbClient: DbClient) {
  const conversationRows = await dbClient.db.query.conversations.findMany({
    orderBy: desc(conversations.lastMessageAt),
    limit: 20,
  });

  const conversationsWithSummary = await Promise.all(
    conversationRows.map(async (conversation) => {
      const storedMessages = await dbClient.db.query.messages.findMany({
        where: eq(messages.conversationId, conversation.id),
        orderBy: desc(messages.createdAt),
        limit: 1,
      });
      const messageCountRows = await dbClient.db
        .select({
          value: messages.id,
        })
        .from(messages)
        .where(eq(messages.conversationId, conversation.id));

      return {
        id: conversation.id,
        title: conversation.title,
        status: conversation.status,
        channelType: conversation.channelType,
        lastMessageAt: conversation.lastMessageAt.toISOString(),
        messageCount: messageCountRows.length,
        lastMessagePreview: storedMessages[0]?.contentText.slice(0, 140) ?? null,
      };
    }),
  );

  return {
    conversations: conversationsWithSummary,
  };
}
