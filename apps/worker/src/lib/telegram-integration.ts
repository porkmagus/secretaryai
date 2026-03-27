import { writeFile } from "node:fs/promises";
import { and, asc, desc, eq, isNull, lte, not, or } from "drizzle-orm";
import type { AppConfig } from "@secretary/config";
import {
  activityTraces,
  integrations,
  speechArtifacts,
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
  type TelegramDeliveryMode,
  type TelegramPresenceUpdateResponse,
  type TelegramIntegrationStatusResponse,
  type TelegramReminderDispatchResponse,
  type TelegramSyncWebhookResponse,
  type TelegramTestMessageRequest,
  type TelegramTestMessageResponse,
  type TelegramPresenceUpdateRequest,
  type RuntimeChatRequest,
  type UpdateTelegramIntegrationRequest,
} from "@secretary/core-runtime";
import type { Infrastructure } from "./infrastructure.js";
import {
  attachExternalMessageIdToMessage,
  findConversationIdByChannelRef,
} from "./chat-persistence.js";
import {
  createSpeechArtifact,
  recordSpeechTrace,
  updateSpeechArtifact,
} from "./speech-runtime.js";
import {
  createSpeechStorageKey,
  ensureSpeechStoragePath,
} from "./speech-storage.js";
import { transcribeAudioFile } from "./stt-service.js";
import { createTelegramVoiceReply } from "./voice-replies.js";
import { enqueueTurnMemoryFollowup, processRuntimeTurn } from "./turn-orchestrator.js";

const telegramIntegrationId = "telegram";

type TelegramIntegrationConfig = {
  defaultChatId: string | null;
  deliveryMode: TelegramDeliveryMode;
  idleTimeoutMinutes: number;
  mode: "webhook" | "polling";
  pollCursor: number | null;
  webPresenceLastActiveAt: string | null;
  webhookUrl: string | null;
};

const DEFAULT_IDLE_TIMEOUT_MINUTES = 15;

function clampIdleTimeoutMinutes(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_IDLE_TIMEOUT_MINUTES;
  }

  return Math.max(1, Math.min(8 * 60, Math.round(value)));
}

function parseTelegramIntegrationConfig(value: Record<string, unknown> | null | undefined) {
  return {
    defaultChatId:
      typeof value?.defaultChatId === "string" && value.defaultChatId.trim()
        ? value.defaultChatId
        : null,
    deliveryMode:
      value?.deliveryMode === "mirror_all" ||
      value?.deliveryMode === "telegram_when_away" ||
      value?.deliveryMode === "important_only" ||
      value?.deliveryMode === "web_only"
        ? value.deliveryMode
        : "web_only",
    idleTimeoutMinutes: clampIdleTimeoutMinutes(value?.idleTimeoutMinutes),
    mode: value?.mode === "polling" ? "polling" : "webhook",
    pollCursor:
      typeof value?.pollCursor === "number" && Number.isFinite(value.pollCursor)
        ? value.pollCursor
        : null,
    webPresenceLastActiveAt:
      typeof value?.webPresenceLastActiveAt === "string" && value.webPresenceLastActiveAt.trim()
        ? value.webPresenceLastActiveAt
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
        deliveryMode: "web_only",
        idleTimeoutMinutes: DEFAULT_IDLE_TIMEOUT_MINUTES,
        mode: "webhook",
        pollCursor: null,
        webPresenceLastActiveAt: null,
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

async function saveTelegramRecord(params: {
  dbClient: DbClient;
  recordId: string;
  configJson?: TelegramIntegrationConfig;
  enabled?: boolean;
  healthStatus?: string;
  lastCheckedAt?: Date | null;
  lastErrorText?: string | null;
}) {
  await params.dbClient.db
    .update(integrations)
    .set({
      ...(params.configJson ? { configJson: params.configJson } : {}),
      ...(params.enabled !== undefined ? { enabled: params.enabled } : {}),
      ...(params.healthStatus !== undefined ? { healthStatus: params.healthStatus } : {}),
      ...(params.lastCheckedAt !== undefined ? { lastCheckedAt: params.lastCheckedAt } : {}),
      ...(params.lastErrorText !== undefined ? { lastErrorText: params.lastErrorText } : {}),
      updatedAt: new Date(),
    })
    .where(eq(integrations.id, params.recordId));
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

function shouldDeliverTelegramMirror(params: {
  deliveryMode: TelegramDeliveryMode;
  idleTimeoutMinutes: number;
  importance: "important" | "normal";
  webPresenceLastActiveAt: string | null;
}) {
  switch (params.deliveryMode) {
    case "web_only":
      return false;
    case "mirror_all":
      return true;
    case "important_only":
      return params.importance === "important";
    case "telegram_when_away": {
      if (!params.webPresenceLastActiveAt) {
        return true;
      }

      const lastActiveAt = Date.parse(params.webPresenceLastActiveAt);
      if (Number.isNaN(lastActiveAt)) {
        return true;
      }

      return Date.now() - lastActiveAt >= params.idleTimeoutMinutes * 60 * 1000;
    }
  }
}

export async function touchTelegramWebPresence(params: {
  dbClient: DbClient;
  config: AppConfig;
  request: TelegramPresenceUpdateRequest;
}) {
  const record = await ensureTelegramIntegrationRecord(params.dbClient, params.config);
  const stored = parseTelegramIntegrationConfig(record.configJson);
  const lastWebPresenceAt = new Date().toISOString();

  await saveTelegramRecord({
    dbClient: params.dbClient,
    recordId: telegramIntegrationId,
    configJson: {
      ...stored,
      webPresenceLastActiveAt: lastWebPresenceAt,
    },
  });

  return {
    ok: true,
    lastWebPresenceAt,
  } satisfies TelegramPresenceUpdateResponse;
}

export async function maybeDeliverTelegramAssistantMessage(params: {
  dbClient: DbClient;
  config: AppConfig;
  conversationId: string | null;
  messageId: string | null;
  text: string;
  importance: "important" | "normal";
  source: "heartbeat" | "web" | "job";
  traceId: string;
  forceChatId?: string | null;
  ignoreDeliveryPolicy?: boolean;
}) {
  const record = await ensureTelegramIntegrationRecord(params.dbClient, params.config);
  if (!record.enabled || !params.config.telegram.botToken) {
    return {
      delivered: false,
      reason: "disabled",
    } as const;
  }

  const stored = parseTelegramIntegrationConfig(record.configJson);
  const chatId =
    params.forceChatId ??
    stored.defaultChatId ??
    params.config.telegram.defaultChatId;

  if (!chatId) {
    return {
      delivered: false,
      reason: "missing_chat_id",
    } as const;
  }

  const shouldDeliver = shouldDeliverTelegramMirror({
    deliveryMode: stored.deliveryMode,
    idleTimeoutMinutes: stored.idleTimeoutMinutes,
    importance: params.importance,
      webPresenceLastActiveAt: stored.webPresenceLastActiveAt,
    });

  if (!params.ignoreDeliveryPolicy && !shouldDeliver) {
    return {
      delivered: false,
      reason: "policy_suppressed",
    } as const;
  }

  const client = getTelegramClient(params.config);
  const sentMessageIds = await client.sendMessageChunks(chatId, params.text);

  await recordTelegramTrace({
    dbClient: params.dbClient,
    conversationId: params.conversationId,
    parentTraceId: params.traceId,
    eventName: "telegram.delivery.mirrored",
    payload: {
      assistantMessageId: params.messageId,
      chatId,
      deliveryMode: stored.deliveryMode,
      importance: params.importance,
      sentMessageIds,
      source: params.source,
      webPresenceLastActiveAt: stored.webPresenceLastActiveAt,
    },
  });

  return {
    delivered: true,
    sentMessageIds,
    chatId,
  } as const;
}

async function downloadTelegramVoiceArtifact(params: {
  config: AppConfig;
  dbClient: DbClient;
  normalized: ReturnType<typeof normalizeTelegramUpdate> extends infer T ? Exclude<T, null> : never;
  traceId: string;
}) {
  if (!params.normalized.voice) {
    return null;
  }

  const conversationId = await findConversationIdByChannelRef(
    params.dbClient,
    "telegram",
    params.normalized.chatId,
  );
  const client = getTelegramClient(params.config);
  const file = await client.getFile(params.normalized.voice.fileId);

  if (!file.file_path) {
    throw new Error("Telegram voice note did not include a downloadable file path.");
  }

  const extension = file.file_path.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "dat";
  const storageKey = createSpeechStorageKey(
    "telegram",
    `${Date.now()}-${params.normalized.chatId}-${params.normalized.messageId}.${extension}`,
  );
  const storagePath = await ensureSpeechStoragePath(storageKey);
  const download = await client.downloadFile(file.file_path);

  await writeFile(storagePath, download.data);

  const artifactId = await createSpeechArtifact({
    dbClient: params.dbClient,
    conversationId,
    messageId: null,
    artifactKind: "telegram_voice_note",
    status: "stored",
    storageKey,
    mimeType: params.normalized.voice.mimeType ?? download.contentType,
    durationMs: params.normalized.voice.durationMs,
    transcriptText: null,
    sourceChannel: "telegram",
    sourceRef: params.normalized.voice.fileId,
    metadataJson: {
      chatId: params.normalized.chatId,
      messageId: params.normalized.messageId,
      updateId: params.normalized.updateId,
    },
  });

  await recordSpeechTrace({
    dbClient: params.dbClient,
    conversationId,
    parentTraceId: params.traceId,
    eventName: "speech.telegram_voice.stored",
    payload: {
      artifactId,
      chatId: params.normalized.chatId,
      fileId: params.normalized.voice.fileId,
      mimeType: params.normalized.voice.mimeType ?? download.contentType ?? null,
      storageKey,
    },
  });

  return {
    artifactId,
    conversationId,
    mimeType: params.normalized.voice.mimeType ?? download.contentType ?? null,
    storageKey,
    storagePath,
  };
}

async function refreshTelegramHealth(
  dbClient: DbClient,
  config: AppConfig,
  record: Awaited<ReturnType<typeof ensureTelegramIntegrationRecord>>,
) {
  const stored = parseTelegramIntegrationConfig(record.configJson);
  const mode = stored.mode;
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
      } else if (mode === "polling") {
        healthStatus = "ok";
        healthSummary = "Telegram polling is active locally. No public webhook URL is required.";
        lastError = null;
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
      mode,
      envConfigured: Boolean(config.telegram.botToken),
      botConfigured: botUser !== null,
      healthStatus,
      healthSummary,
      lastCheckedAt: checkedAt.toISOString(),
      lastError,
      webhookUrl:
        healthStatus === "not_configured" || !config.telegram.botToken || mode === "polling"
          ? null
          : desiredWebhookUrl,
      deliveryMode: stored.deliveryMode,
      idleTimeoutMinutes: stored.idleTimeoutMinutes,
      lastWebPresenceAt: stored.webPresenceLastActiveAt,
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
    deliveryMode: params.patch.deliveryMode ?? stored.deliveryMode,
    idleTimeoutMinutes:
      params.patch.idleTimeoutMinutes !== undefined
        ? clampIdleTimeoutMinutes(params.patch.idleTimeoutMinutes)
        : stored.idleTimeoutMinutes,
    mode: params.patch.mode ?? stored.mode,
    pollCursor: stored.pollCursor,
    webPresenceLastActiveAt: stored.webPresenceLastActiveAt,
    webhookUrl:
      params.patch.webhookUrl !== undefined
        ? params.patch.webhookUrl
        : stored.webhookUrl,
  };

  await saveTelegramRecord({
    dbClient: params.dbClient,
    recordId: telegramIntegrationId,
    enabled: params.patch.enabled ?? record.enabled,
    configJson: nextConfig,
  });

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

  if (stored.mode === "polling") {
    await client.deleteWebhook();
    await saveTelegramRecord({
      dbClient: params.dbClient,
      recordId: telegramIntegrationId,
      healthStatus: "ok",
      lastCheckedAt: new Date(),
      lastErrorText: null,
    });

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

export function startTelegramPolling(params: {
  config: AppConfig;
  infrastructure: Infrastructure;
  onError?: (error: unknown) => void;
}) {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let webhookClearedForPolling = false;

  const schedule = (delayMs: number) => {
    if (stopped) {
      return;
    }

    timer = setTimeout(() => {
      void tick();
    }, delayMs);
  };

  const tick = async () => {
    if (stopped) {
      return;
    }

    try {
      const record = await ensureTelegramIntegrationRecord(
        params.infrastructure.dbClient,
        params.config,
      );
      const stored = parseTelegramIntegrationConfig(record.configJson);

      if (!record.enabled || stored.mode !== "polling" || !params.config.telegram.botToken) {
        webhookClearedForPolling = false;
        schedule(5000);
        return;
      }

      const client = getTelegramClient(params.config);

      if (!webhookClearedForPolling) {
        await client.deleteWebhook();
        webhookClearedForPolling = true;
      }

      const updates = await client.getUpdates({
        allowedUpdates: ["message", "edited_message"],
        limit: 10,
        offset: stored.pollCursor !== null ? stored.pollCursor + 1 : undefined,
        timeoutSeconds: 20,
      });

      let nextCursor = stored.pollCursor;

      for (const update of updates) {
        nextCursor =
          nextCursor === null ? update.update_id : Math.max(nextCursor, update.update_id);

        try {
          await handleTelegramWebhookUpdate({
            config: params.config,
            infrastructure: params.infrastructure,
            update,
          });
        } catch (error) {
          params.onError?.(error);
        }
      }

      if (nextCursor !== stored.pollCursor) {
        await saveTelegramRecord({
          configJson: {
            ...stored,
            pollCursor: nextCursor,
          },
          dbClient: params.infrastructure.dbClient,
          recordId: telegramIntegrationId,
        });
      }

      schedule(updates.length > 0 ? 200 : 1000);
    } catch (error) {
      params.onError?.(error);
      schedule(5000);
    }
  };

  void tick();

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
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

  const traceId = `telegram_${normalized.updateId}`;
  await recordTelegramTrace({
    dbClient: params.infrastructure.dbClient,
    conversationId: null,
    parentTraceId: traceId,
    eventName: "telegram.update.received",
    payload: {
      chatId: normalized.chatId,
      chatLabel: normalized.chatLabel,
      hasVoice: normalized.hasVoice,
      hasText: Boolean(normalized.text),
      textLength: normalized.text?.length ?? 0,
      updateId: normalized.updateId,
    },
  });

  let requestText = normalized.text;
  let audioAttachment:
    | {
        mimeType: string;
        storageKey: string;
      }
    | undefined;

  if (!requestText && normalized.voice) {
    const voiceArtifact = await downloadTelegramVoiceArtifact({
      config: params.config,
      dbClient: params.infrastructure.dbClient,
      normalized,
      traceId,
    });

    if (voiceArtifact) {
      audioAttachment = {
        mimeType: voiceArtifact.mimeType ?? "audio/ogg",
        storageKey: voiceArtifact.storageKey,
      };
      const transcription = await transcribeAudioFile({
        config: params.config,
        filePath: voiceArtifact.storagePath,
        mimeType: voiceArtifact.mimeType,
      });

      if (!transcription) {
        const client = getTelegramClient(params.config);
        const sentMessageIds = await client.sendMessageChunks(
          normalized.chatId,
          "I saved your voice note locally, but speech transcription is not configured yet. Add STT_BASE_URL when you're ready for voice-to-text.",
        );

        await recordSpeechTrace({
          dbClient: params.infrastructure.dbClient,
          conversationId: voiceArtifact.conversationId,
          parentTraceId: traceId,
          eventName: "speech.transcription.awaiting_configuration",
          payload: {
            artifactId: voiceArtifact.artifactId,
            storageKey: voiceArtifact.storageKey,
          },
        });

        await recordTelegramTrace({
          dbClient: params.infrastructure.dbClient,
          conversationId: voiceArtifact.conversationId,
          parentTraceId: traceId,
          eventName: "telegram.reply.sent",
          payload: {
            assistantMessageId: null,
            chatId: normalized.chatId,
            sentMessageIds,
            mode: "voice_acknowledgement",
          },
        });

        return {
          ignored: false,
          conversationId: voiceArtifact.conversationId ?? null,
          traceId,
        };
      }

      requestText = transcription.text;

      await updateSpeechArtifact({
        dbClient: params.infrastructure.dbClient,
        artifactId: voiceArtifact.artifactId,
        conversationId: voiceArtifact.conversationId,
        status: "transcribed",
        durationMs: transcription.durationMs ?? normalized.voice.durationMs,
        transcriptText: transcription.text,
      });

      await recordSpeechTrace({
        dbClient: params.infrastructure.dbClient,
        conversationId: voiceArtifact.conversationId,
        parentTraceId: traceId,
        eventName: "speech.transcription.completed",
        payload: {
          artifactId: voiceArtifact.artifactId,
          storageKey: voiceArtifact.storageKey,
          transcriptLength: transcription.text.length,
        },
      });
    }
  }

  if (!requestText) {
    const client = getTelegramClient(params.config);
    const sentMessageIds = await client.sendMessageChunks(
      normalized.chatId,
      "I can process text right now, and voice-note intake is wired for Phase 4. If this message had no transcriptable content, send text or configure STT for voice transcription.",
    );

    await recordTelegramTrace({
      dbClient: params.infrastructure.dbClient,
      conversationId: null,
      parentTraceId: traceId,
      eventName: "telegram.reply.sent",
      payload: {
        assistantMessageId: null,
        chatId: normalized.chatId,
        sentMessageIds,
        mode: "unsupported_fallback",
      },
    });

    return {
      ignored: false,
      conversationId: null,
      traceId,
    };
  }

  const runtimeRequest: RuntimeChatRequest = {
    channel: "telegram",
    userId: params.config.defaultUserId,
    message: {
      text: requestText,
      attachments: audioAttachment
        ? [
            {
              kind: "audio" as const,
              mimeType: audioAttachment.mimeType,
              storageKey: audioAttachment.storageKey,
            },
          ]
        : undefined,
    },
    metadata: {
      requestId: traceId,
      sourceMessageId: normalized.messageId,
      telegramChatId: normalized.chatId,
      telegramChatLabel: normalized.chatLabel,
      telegramUserDisplayName: normalized.userDisplayName,
    },
  };

  const persistedTurn = await processRuntimeTurn({
    config: params.config,
    dbClient: params.infrastructure.dbClient,
    queue: params.infrastructure.agentJobQueue,
    defaultPersonaId: params.config.defaultPersonaId,
    defaultUserId: params.config.defaultUserId,
    request: runtimeRequest,
    traceId,
  });

  if (normalized.voice && audioAttachment && "userMessageId" in persistedTurn) {
    const latestArtifact = await params.infrastructure.dbClient.db.query.speechArtifacts.findFirst({
      where: eq(speechArtifacts.sourceRef, normalized.voice.fileId),
      orderBy: (fields, { desc }) => [desc(fields.createdAt)],
    });

    if (latestArtifact) {
      await updateSpeechArtifact({
        dbClient: params.infrastructure.dbClient,
        artifactId: latestArtifact.id,
        conversationId: persistedTurn.response.conversationId,
        messageId: persistedTurn.userMessageId,
      });
    }
  }

  await recordTelegramTrace({
    dbClient: params.infrastructure.dbClient,
    conversationId: persistedTurn.response.conversationId,
    parentTraceId: traceId,
    eventName: "telegram.update.received",
    payload: {
      chatId: normalized.chatId,
      chatLabel: normalized.chatLabel,
      hasVoice: normalized.hasVoice,
      textLength: requestText.length,
      updateId: normalized.updateId,
    },
  });

  await enqueueTurnMemoryFollowup({
    dbClient: params.infrastructure.dbClient,
    memoryPayload: persistedTurn.memoryPayload,
    memoryQueue: params.infrastructure.memoryQueue,
    traceId,
  });

  const client = getTelegramClient(params.config);
  const replyText = persistedTurn.response.outputText;
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

  if (normalized.voice) {
    try {
      const voiceReply = await createTelegramVoiceReply({
        assistantMessageId: persistedTurn.response.messageId,
        config: params.config,
        conversationId: persistedTurn.response.conversationId,
        dbClient: params.infrastructure.dbClient,
        parentTraceId: traceId,
        replyText,
      });

      if (voiceReply) {
        const voiceResult =
          voiceReply.deliveryKind === "voice"
            ? await client.sendVoice({
                audio: voiceReply.audio,
                chatId: normalized.chatId,
                filename: voiceReply.filename,
                mimeType: voiceReply.mimeType,
              })
            : await client.sendAudio({
                audio: voiceReply.audio,
                chatId: normalized.chatId,
                filename: voiceReply.filename,
                mimeType: voiceReply.mimeType,
              });

        await recordTelegramTrace({
          dbClient: params.infrastructure.dbClient,
          conversationId: persistedTurn.response.conversationId,
          parentTraceId: traceId,
          eventName:
            voiceReply.deliveryKind === "voice"
              ? "telegram.voice_reply.sent"
              : "telegram.audio_reply.sent",
          payload: {
            artifactId: voiceReply.artifactId,
            chatId: normalized.chatId,
            deliveryKind: voiceReply.deliveryKind,
            sentMessageId: String(voiceResult.message_id),
          },
        });
      }
    } catch (error) {
      await recordSpeechTrace({
        dbClient: params.infrastructure.dbClient,
        conversationId: persistedTurn.response.conversationId,
        parentTraceId: traceId,
        eventName: "speech.tts.failed",
        payload: {
          error: error instanceof Error ? error.message : String(error),
          messageId: persistedTurn.response.messageId,
        },
      });
    }
  }

  return {
    ignored: false,
    conversationId: persistedTurn.response.conversationId,
    traceId,
  };
}
