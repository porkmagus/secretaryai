import { and, asc, desc, eq, isNull, lte, not, or } from "drizzle-orm";
import type { AppConfig } from "@secretary/config";
import {
  activityTraces,
  integrations,
  tasks,
  type DbClient,
} from "@secretary/db";
import {
  createTelegramClient,
  createTelegramWebhookUrl,
  normalizeTelegramUpdate,
  type TelegramUpdate,
} from "@secretary/integrations";
import {
  createMessageId,
  type TelegramIntegrationStatusResponse,
  type TelegramReminderDispatchResponse,
  type TelegramSyncWebhookResponse,
  type TelegramTestMessageRequest,
  type TelegramTestMessageResponse,
  type UpdateTelegramIntegrationRequest,
} from "@secretary/core-runtime";
import type { Infrastructure } from "./infrastructure.js";
import {
  attachExternalMessageIdToMessage,
  createQueuedMemoryJob,
  markMemoryJobEnqueueFailed,
  persistChatTurn,
} from "./chat-persistence.js";

const telegramIntegrationId = "telegram";

type TelegramIntegrationConfig = {
  defaultChatId: string | null;
  webhookUrl: string | null;
};

function parseTelegramIntegrationConfig(value: Record<string, unknown> | null | undefined) {
  return {
    defaultChatId:
      typeof value?.defaultChatId === "string" && value.defaultChatId.trim()
        ? value.defaultChatId
        : null,
    webhookUrl:
      typeof value?.webhookUrl === "string" && value.webhookUrl.trim()
        ? value.webhookUrl
        : null,
  } satisfies TelegramIntegrationConfig;
}

function resolveDesiredWebhookUrl(candidate: string | null) {
  if (!candidate) {
    return null;
  }

  if (candidate.includes("/integrations/telegram/webhook")) {
    return candidate;
  }

  return createTelegramWebhookUrl(candidate);
}

async function ensureTelegramIntegrationRecord(
  dbClient: DbClient,
  config: AppConfig,
) {
  await dbClient.db
    .insert(integrations)
    .values({
      id: telegramIntegrationId,
      integrationType: "telegram",
      enabled: false,
      configJson: {
        defaultChatId: config.telegram.defaultChatId,
        webhookUrl: config.telegram.webhookUrl,
      },
      healthStatus: config.telegram.botToken ? "disabled" : "not_configured",
    })
    .onConflictDoNothing();

  const record = await dbClient.db.query.integrations.findFirst({
    where: eq(integrations.id, telegramIntegrationId),
  });

  if (!record) {
    throw new Error("Telegram integration record could not be created.");
  }

  return record;
}

function getTelegramClient(config: AppConfig) {
  if (!config.telegram.botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }

  return createTelegramClient({
    apiBaseUrl: config.telegram.apiBaseUrl,
    botToken: config.telegram.botToken,
  });
}

async function recordTelegramTrace(params: {
  dbClient: DbClient;
  conversationId: string | null;
  eventName: string;
  payload: Record<string, unknown>;
  parentTraceId?: string | null;
}) {
  await params.dbClient.db.insert(activityTraces).values({
    id: createMessageId(),
    traceType: "integration",
    parentTraceId: params.parentTraceId ?? null,
    conversationId: params.conversationId,
    jobId: null,
    eventName: params.eventName,
    payloadJson: params.payload,
  });
}

async function refreshTelegramHealth(
  dbClient: DbClient,
  config: AppConfig,
  record: Awaited<ReturnType<typeof ensureTelegramIntegrationRecord>>,
) {
  const stored = parseTelegramIntegrationConfig(record.configJson);
  const desiredWebhookUrl = resolveDesiredWebhookUrl(
    stored.webhookUrl ?? config.telegram.webhookUrl,
  );
  const countsResult = await dbClient.pool.query<{
    conversation_count: number;
    delivered_reminder_count: number;
    due_reminder_count: number;
    message_count: number;
  }>(
    `
      select
        (select count(*)::int from conversations where channel_type = 'telegram') as conversation_count,
        (
          select count(*)::int
          from messages
          where conversation_id in (
            select id from conversations where channel_type = 'telegram'
          )
        ) as message_count,
        (
          select count(*)::int
          from tasks
          where delivery_channel_type = 'telegram'
            and reminder_at is not null
            and delivered_at is null
            and reminder_at <= now()
        ) as due_reminder_count,
        (
          select count(*)::int
          from tasks
          where delivery_channel_type = 'telegram'
            and delivered_at is not null
        ) as delivered_reminder_count
    `,
  );
  const counts = countsResult.rows[0];

  let healthStatus = record.enabled ? "degraded" : "disabled";
  let healthSummary = record.enabled
    ? "Telegram is enabled but still needs configuration."
    : "Telegram credentials can be present while the integration remains disabled.";
  let lastError = record.lastErrorText ?? null;
  let botUser: TelegramIntegrationStatusResponse["integration"]["botUser"] = null;
  let pendingUpdateCount: number | null = null;

  if (!config.telegram.botToken) {
    healthStatus = "not_configured";
    healthSummary = "Set TELEGRAM_BOT_TOKEN to enable Telegram messaging.";
    lastError = "Missing TELEGRAM_BOT_TOKEN.";
  } else {
    try {
      const client = getTelegramClient(config);
      const [me, webhookInfo] = await Promise.all([
        client.getMe(),
        client.getWebhookInfo(),
      ]);

      botUser = {
        id: String(me.id),
        username: me.username ?? null,
        displayName: [me.first_name, me.last_name].filter(Boolean).join(" ") || me.username || "Telegram bot",
      };
      pendingUpdateCount = webhookInfo.pending_update_count ?? 0;
      lastError = webhookInfo.last_error_message ?? null;

      if (!record.enabled) {
        healthStatus = "disabled";
        healthSummary = "Telegram credentials are valid, but the integration is disabled.";
      } else if (!desiredWebhookUrl) {
        healthStatus = "degraded";
        healthSummary = "Provide a public worker URL, then sync the webhook.";
      } else if (webhookInfo.url !== desiredWebhookUrl) {
        healthStatus = "degraded";
        healthSummary = "Telegram webhook is reachable but needs syncing to the current worker URL.";
      } else {
        healthStatus = "ok";
        healthSummary = "Telegram text roundtrip is configured and ready.";
      }
    } catch (error) {
      healthStatus = record.enabled ? "degraded" : "disabled";
      healthSummary = "Telegram API check failed. Review the saved token or network reachability.";
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  const checkedAt = new Date();

  await dbClient.db
    .update(integrations)
    .set({
      healthStatus,
      lastCheckedAt: checkedAt,
      lastErrorText: lastError,
      updatedAt: checkedAt,
    })
    .where(eq(integrations.id, telegramIntegrationId));

  return {
    integration: {
      enabled: record.enabled,
      envConfigured: Boolean(config.telegram.botToken),
      botConfigured: botUser !== null,
      healthStatus,
      healthSummary,
      lastCheckedAt: checkedAt.toISOString(),
      lastError,
      webhookUrl:
        healthStatus === "not_configured" || !config.telegram.botToken
          ? null
          : desiredWebhookUrl,
      desiredWebhookUrl,
      pendingUpdateCount,
      defaultChatId: stored.defaultChatId ?? config.telegram.defaultChatId,
      botUser,
      conversationCount: counts.conversation_count,
      messageCount: counts.message_count,
      dueReminderCount: counts.due_reminder_count,
      deliveredReminderCount: counts.delivered_reminder_count,
    },
  } satisfies TelegramIntegrationStatusResponse;
}

export async function getTelegramIntegrationStatus(
  dbClient: DbClient,
  config: AppConfig,
) {
  const record = await ensureTelegramIntegrationRecord(dbClient, config);
  return refreshTelegramHealth(dbClient, config, record);
}

export async function updateTelegramIntegrationSettings(params: {
  dbClient: DbClient;
  config: AppConfig;
  patch: UpdateTelegramIntegrationRequest;
}) {
  const record = await ensureTelegramIntegrationRecord(params.dbClient, params.config);
  const stored = parseTelegramIntegrationConfig(record.configJson);
  const nextConfig = {
    defaultChatId:
      params.patch.defaultChatId !== undefined
        ? params.patch.defaultChatId
        : stored.defaultChatId,
    webhookUrl:
      params.patch.webhookUrl !== undefined
        ? params.patch.webhookUrl
        : stored.webhookUrl,
  };

  await params.dbClient.db
    .update(integrations)
    .set({
      enabled: params.patch.enabled ?? record.enabled,
      configJson: nextConfig,
      updatedAt: new Date(),
    })
    .where(eq(integrations.id, telegramIntegrationId));

  return getTelegramIntegrationStatus(params.dbClient, params.config);
}

export async function syncTelegramWebhook(params: {
  dbClient: DbClient;
  config: AppConfig;
}) {
  const record = await ensureTelegramIntegrationRecord(params.dbClient, params.config);
  const stored = parseTelegramIntegrationConfig(record.configJson);
  const client = getTelegramClient(params.config);

  if (!record.enabled) {
    await client.deleteWebhook();
    await params.dbClient.db
      .update(integrations)
      .set({
        healthStatus: "disabled",
        lastCheckedAt: new Date(),
        lastErrorText: null,
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, telegramIntegrationId));

    return {
      ok: true,
      webhookUrl: null,
    } satisfies TelegramSyncWebhookResponse;
  }

  const desiredWebhookUrl = resolveDesiredWebhookUrl(
    stored.webhookUrl ?? params.config.telegram.webhookUrl,
  );

  if (!desiredWebhookUrl) {
    throw new Error("A public Telegram webhook URL is required before syncing.");
  }

  await client.setWebhook(desiredWebhookUrl, params.config.telegram.webhookSecret);
  await params.dbClient.db
    .update(integrations)
    .set({
      healthStatus: "ok",
      lastCheckedAt: new Date(),
      lastErrorText: null,
      updatedAt: new Date(),
    })
    .where(eq(integrations.id, telegramIntegrationId));

  return {
    ok: true,
    webhookUrl: desiredWebhookUrl,
  } satisfies TelegramSyncWebhookResponse;
}

export async function sendTelegramTestMessage(params: {
  dbClient: DbClient;
  config: AppConfig;
  request: TelegramTestMessageRequest;
}) {
  const record = await ensureTelegramIntegrationRecord(params.dbClient, params.config);
  const stored = parseTelegramIntegrationConfig(record.configJson);
  const chatId =
    params.request.chatId?.trim() ||
    stored.defaultChatId ||
    params.config.telegram.defaultChatId;

  if (!chatId) {
    throw new Error("No Telegram chat id is configured for test delivery.");
  }

  const client = getTelegramClient(params.config);
  const sentMessageIds = await client.sendMessageChunks(
    chatId,
    params.request.text?.trim() ||
      "Secretary Telegram test message: the webhook, outbound transport, and local runtime are connected.",
  );

  return {
    ok: true,
    chatId,
    sentMessageIds,
  } satisfies TelegramTestMessageResponse;
}

export async function dispatchDueTelegramReminders(params: {
  dbClient: DbClient;
  config: AppConfig;
}) {
  const record = await ensureTelegramIntegrationRecord(params.dbClient, params.config);
  const stored = parseTelegramIntegrationConfig(record.configJson);

  if (!record.enabled) {
    return {
      scanned: 0,
      delivered: 0,
      failed: 0,
      taskIds: [],
      errors: [],
    } satisfies TelegramReminderDispatchResponse;
  }

  const client = getTelegramClient(params.config);
  const dueTasks = await params.dbClient.db.query.tasks.findMany({
    where: and(
      eq(tasks.deliveryChannelType, "telegram"),
      not(isNull(tasks.reminderAt)),
      lte(tasks.reminderAt, new Date()),
      isNull(tasks.deliveredAt),
      or(eq(tasks.status, "open"), eq(tasks.status, "in_progress")),
    ),
    orderBy: [asc(tasks.reminderAt), desc(tasks.createdAt)],
    limit: 25,
  });

  const taskIds: string[] = [];
  const errors: string[] = [];
  let delivered = 0;
  let failed = 0;

  for (const task of dueTasks) {
    const chatId =
      task.deliveryTargetRef ??
      stored.defaultChatId ??
      params.config.telegram.defaultChatId;

    if (!chatId) {
      failed += 1;
      errors.push(`Task ${task.id} has no Telegram chat configured.`);
      await params.dbClient.db
        .update(tasks)
        .set({
          lastDeliveryError: "No Telegram chat configured.",
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, task.id));
      continue;
    }

    try {
      const reminderText = [
        `Reminder: ${task.title}`,
        task.detail,
        task.reminderAt
          ? `Scheduled for ${task.reminderAt.toISOString()}.`
          : null,
      ]
        .filter(Boolean)
        .join("\n\n");
      const sentMessageIds = await client.sendMessageChunks(chatId, reminderText);

      await params.dbClient.db
        .update(tasks)
        .set({
          deliveredAt: new Date(),
          lastDeliveryError: null,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, task.id));

      await recordTelegramTrace({
        dbClient: params.dbClient,
        conversationId: task.conversationId ?? null,
        eventName: "telegram.reminder.sent",
        payload: {
          chatId,
          sentMessageIds,
          taskId: task.id,
          title: task.title,
        },
      });

      delivered += 1;
      taskIds.push(task.id);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);

      await params.dbClient.db
        .update(tasks)
        .set({
          lastDeliveryError: errorText,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, task.id));

      await recordTelegramTrace({
        dbClient: params.dbClient,
        conversationId: task.conversationId ?? null,
        eventName: "telegram.reminder.failed",
        payload: {
          chatId,
          errorText,
          taskId: task.id,
          title: task.title,
        },
      });

      failed += 1;
      errors.push(`Task ${task.id}: ${errorText}`);
    }
  }

  return {
    scanned: dueTasks.length,
    delivered,
    failed,
    taskIds,
    errors,
  } satisfies TelegramReminderDispatchResponse;
}

export async function handleTelegramWebhookUpdate(params: {
  config: AppConfig;
  infrastructure: Infrastructure;
  update: TelegramUpdate;
}) {
  const record = await ensureTelegramIntegrationRecord(
    params.infrastructure.dbClient,
    params.config,
  );

  if (!record.enabled) {
    return {
      ignored: true,
      reason: "disabled",
    };
  }

  const normalized = normalizeTelegramUpdate(params.update);

  if (!normalized) {
    return {
      ignored: true,
      reason: "unsupported_update",
    };
  }

  const requestText =
    normalized.text ??
    (normalized.hasVoice
      ? "Voice note received."
      : "Unsupported Telegram message received.");
  const traceId = `telegram_${normalized.updateId}`;
  const persistedTurn = await persistChatTurn({
    dbClient: params.infrastructure.dbClient,
    defaultPersonaId: params.config.defaultPersonaId,
    defaultUserId: params.config.defaultUserId,
    request: {
      channel: "telegram",
      userId: params.config.defaultUserId,
      message: {
        text: requestText,
      },
      metadata: {
        requestId: traceId,
        sourceMessageId: normalized.messageId,
        telegramChatId: normalized.chatId,
        telegramChatLabel: normalized.chatLabel,
        telegramUserDisplayName: normalized.userDisplayName,
      },
    },
    traceId,
  });

  await recordTelegramTrace({
    dbClient: params.infrastructure.dbClient,
    conversationId: persistedTurn.response.conversationId,
    parentTraceId: traceId,
    eventName: "telegram.update.received",
    payload: {
      chatId: normalized.chatId,
      chatLabel: normalized.chatLabel,
      hasVoice: normalized.hasVoice,
      textLength: normalized.text?.length ?? 0,
      updateId: normalized.updateId,
    },
  });

  const jobId = await createQueuedMemoryJob({
    dbClient: params.infrastructure.dbClient,
    payload: persistedTurn.memoryPayload,
    traceId,
  });

  try {
    await params.infrastructure.memoryQueue.enqueue(jobId, persistedTurn.memoryPayload);
  } catch (error) {
    await markMemoryJobEnqueueFailed(
      params.infrastructure.dbClient,
      jobId,
      error instanceof Error ? error.message : "Unknown enqueue error",
    );

    throw error;
  }

  const client = getTelegramClient(params.config);
  const replyText = normalized.text
    ? persistedTurn.response.outputText
    : "Telegram text is live now. Voice note handling lands in Phase 4, so send me text for the moment.";
  const sentMessageIds = await client.sendMessageChunks(normalized.chatId, replyText);

  if (sentMessageIds[0]) {
    await attachExternalMessageIdToMessage(
      params.infrastructure.dbClient,
      persistedTurn.response.messageId,
      sentMessageIds[0],
    );
  }

  await recordTelegramTrace({
    dbClient: params.infrastructure.dbClient,
    conversationId: persistedTurn.response.conversationId,
    parentTraceId: traceId,
    eventName: "telegram.reply.sent",
    payload: {
      assistantMessageId: persistedTurn.response.messageId,
      chatId: normalized.chatId,
      sentMessageIds,
    },
  });

  return {
    ignored: false,
    conversationId: persistedTurn.response.conversationId,
    traceId,
  };
}
