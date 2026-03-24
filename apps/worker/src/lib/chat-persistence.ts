import { and, asc, desc, eq } from "drizzle-orm";
import {
  activityTraces,
  conversations,
  jobs,
  messages,
  personas,
  users,
  type DbClient,
} from "@secretary/db";
import {
  createConversationId,
  createMessageId,
  createTurnResponse,
  type RuntimeContextMessage,
  type MemoryCandidateJobPayload,
  type RuntimeChatRequest,
} from "@secretary/core-runtime";
import {
  getActiveTaskContext,
  retrieveRelevantMemories,
} from "./memory-engine.js";
import {
  runResearchSpecialist,
  shouldUseResearchSpecialist,
} from "./research-specialist.js";

type PersistTurnParams = {
  dbClient: DbClient;
  defaultPersonaId: string;
  defaultUserId: string;
  request: RuntimeChatRequest;
  traceId: string;
};

type PersistedConversationMessage = Awaited<
  ReturnType<typeof getConversationMessages>
>[number];

function toRuntimeContextMessage(
  message: PersistedConversationMessage,
): RuntimeContextMessage {
  return {
    role: message.role as
      | "assistant"
      | "specialist"
      | "system"
      | "tool"
      | "user",
    text: message.contentText,
  };
}

export async function persistChatTurn({
  dbClient,
  defaultPersonaId,
  defaultUserId,
  request,
  traceId,
}: PersistTurnParams) {
  const existingConversationId =
    request.conversationId ??
    (request.channel === "telegram" && request.metadata?.telegramChatId
      ? await findConversationIdByChannelRef(
          dbClient,
          request.channel,
          request.metadata.telegramChatId,
        )
      : null);
  const conversationId = existingConversationId ?? createConversationId();
  const userId = request.userId || defaultUserId;
  const userDisplayName =
    request.metadata?.telegramUserDisplayName ?? "Local Owner";
  const userMessageId = createMessageId();
  const conversationTitle =
    request.channel === "telegram" && request.metadata?.telegramChatLabel
      ? `Telegram: ${request.metadata.telegramChatLabel}`
      : request.message.text.slice(0, 80);

  await dbClient.db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values({
        id: userId,
        displayName: "Local Owner",
        defaultPersonaId,
      })
      .onConflictDoNothing();

    await tx
      .insert(personas)
      .values({
        id: defaultPersonaId,
        name: "Secretary",
        toneProfile: {
          mode: "calm",
        },
        behaviorRules: [
          "Be helpful",
          "Protect local-first privacy defaults",
        ],
        promptTemplate: "Phase 1 placeholder",
        isDefault: true,
      })
      .onConflictDoNothing();

    await tx
      .insert(conversations)
      .values({
        id: conversationId,
        userId,
        channelType: request.channel,
        channelRef: request.metadata?.telegramChatId ?? null,
        channelLabel: request.metadata?.telegramChatLabel ?? null,
        title: conversationTitle,
        status: "active",
        lastMessageAt: new Date(),
      })
      .onConflictDoUpdate({
        target: conversations.id,
        set: {
          channelType: request.channel,
          channelRef: request.metadata?.telegramChatId ?? null,
          channelLabel: request.metadata?.telegramChatLabel ?? null,
          lastMessageAt: new Date(),
          updatedAt: new Date(),
        },
      });

    await tx.insert(messages).values({
      id: userMessageId,
      conversationId,
      role: "user",
      contentText: request.message.text,
      contentJson: request.message.attachments
        ? { attachments: request.message.attachments }
        : null,
      channelMessageId: request.metadata?.sourceMessageId,
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
        channel: request.channel,
        messageId: userMessageId,
        traceId,
      },
    });
  });

  const recentMessages = await getConversationMessages(dbClient, conversationId);
  const relevantMemories = await retrieveRelevantMemories(
    dbClient,
    request.message.text,
  );
  const activeTasks = await getActiveTaskContext(dbClient, userId);
  const researchResult = shouldUseResearchSpecialist(request.message.text)
    ? runResearchSpecialist(request.message.text)
    : null;
  const response = createTurnResponse(
      {
        ...request,
        conversationId,
      },
      {
        conversationId,
        recentMessages: recentMessages.map(toRuntimeContextMessage),
        userDisplayName,
        relevantMemories,
        activeTasks,
        researchResult,
    },
    traceId,
  );

  await dbClient.db.transaction(async (tx) => {
    if (researchResult) {
      await tx.insert(activityTraces).values({
        id: createMessageId(),
        traceType: "specialist",
        parentTraceId: traceId,
        conversationId,
        jobId: null,
        eventName: "research.specialist.completed",
        payloadJson: researchResult,
      });
    }

    await tx.insert(activityTraces).values({
      id: createMessageId(),
      traceType: "runtime",
      parentTraceId: traceId,
      conversationId,
      jobId: null,
      eventName: "runtime.chat.context_assembled",
      payloadJson: {
        memoryIds: relevantMemories.map((memory) => memory.id),
        taskIds: activeTasks.map((task) => task.id),
        researchUsed: Boolean(researchResult),
      },
    });

    await tx.insert(messages).values({
      id: response.messageId,
      conversationId,
      role: "assistant",
      contentText: response.outputText,
      contentJson: null,
      channelMessageId: null,
      parentMessageId: userMessageId,
    });

    await tx
      .update(conversations)
      .set({
        updatedAt: new Date(),
        lastMessageAt: new Date(),
      })
      .where(eq(conversations.id, conversationId));

    await tx.insert(activityTraces).values({
      id: createMessageId(),
      traceType: "runtime",
      parentTraceId: traceId,
      conversationId,
      jobId: null,
      eventName: "runtime.chat.completed",
      payloadJson: {
        assistantMessageId: response.messageId,
        recentContextCount: recentMessages.length,
        memoryIds: relevantMemories.map((memory) => memory.id),
        taskIds: activeTasks.map((task) => task.id),
        researchUsed: Boolean(researchResult),
        outputLength: response.outputText.length,
        traceId,
      },
    });
  });

  const memoryPayload: MemoryCandidateJobPayload = {
    conversationId,
    messageId: response.messageId,
    traceId,
    userId,
    source: request.channel,
    text: request.message.text,
    telegramChatId: request.metadata?.telegramChatId ?? null,
  };

  return {
    conversationId,
    memoryPayload,
    response,
    userMessageId,
  };
}

type QueueMemoryJobParams = {
  dbClient: DbClient;
  payload: MemoryCandidateJobPayload;
  traceId: string;
};

export async function createQueuedMemoryJob({
  dbClient,
  payload,
  traceId,
}: QueueMemoryJobParams) {
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

export async function getConversationMessages(
  dbClient: DbClient,
  conversationId: string,
) {
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
