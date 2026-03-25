import { createMessageId, createTraceId, type HeartbeatIntegrationStatusResponse, type HeartbeatRunResponse, type UpdateHeartbeatIntegrationRequest } from "@secretary/core-runtime";
import type { AppConfig } from "@secretary/config";
import { activityTraces, conversations, integrations, type DbClient } from "@secretary/db";
import type { Infrastructure } from "./infrastructure.js";
import { createQueuedMemoryJob, markMemoryJobEnqueueFailed, persistChatTurn } from "./chat-persistence.js";
import { eq } from "drizzle-orm";
import { maybeDeliverTelegramAssistantMessage } from "./telegram-integration.js";

const heartbeatIntegrationId = "heartbeat";
const defaultHeartbeatPrompt =
  "Pause, look over the current state of Samantha's environment, memory, and open work, then decide one concrete helpful thing to notice, suggest, prepare, or improve next. Answer naturally as Samantha.";

type HeartbeatIntegrationConfig = {
  intervalMinutes: number;
  prompt: string;
  conversationId: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
};

function clampIntervalMinutes(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 60;
  }

  return Math.max(5, Math.min(24 * 60, Math.round(value)));
}

function parseHeartbeatConfig(value: Record<string, unknown> | null | undefined) {
  return {
    intervalMinutes: clampIntervalMinutes(value?.intervalMinutes),
    prompt:
      typeof value?.prompt === "string" && value.prompt.trim().length > 0
        ? value.prompt.trim()
        : defaultHeartbeatPrompt,
    conversationId:
      typeof value?.conversationId === "string" && value.conversationId.trim().length > 0
        ? value.conversationId.trim()
        : null,
    lastRunAt:
      typeof value?.lastRunAt === "string" && value.lastRunAt.trim().length > 0
        ? value.lastRunAt
        : null,
    nextRunAt:
      typeof value?.nextRunAt === "string" && value.nextRunAt.trim().length > 0
        ? value.nextRunAt
        : null,
  } satisfies HeartbeatIntegrationConfig;
}

function computeNextRunAt(intervalMinutes: number, from = new Date()) {
  return new Date(from.getTime() + intervalMinutes * 60 * 1000);
}

async function ensureHeartbeatIntegrationRecord(
  dbClient: DbClient,
  config: AppConfig,
) {
  await dbClient.db
    .insert(integrations)
    .values({
      id: heartbeatIntegrationId,
      integrationType: "heartbeat",
      enabled: false,
      configJson: {
        intervalMinutes: 60,
        prompt: defaultHeartbeatPrompt,
        conversationId: null,
        lastRunAt: null,
        nextRunAt: null,
      },
      healthStatus: "disabled",
    })
    .onConflictDoNothing();

  const record = await dbClient.db.query.integrations.findFirst({
    where: eq(integrations.id, heartbeatIntegrationId),
  });

  if (!record) {
    throw new Error("Heartbeat integration record could not be created.");
  }

  return record;
}

async function saveHeartbeatRecord(params: {
  dbClient: DbClient;
  enabled?: boolean;
  configJson?: HeartbeatIntegrationConfig;
  healthStatus?: string;
  lastCheckedAt?: Date | null;
  lastErrorText?: string | null;
}) {
  await params.dbClient.db
    .update(integrations)
    .set({
      ...(params.enabled !== undefined ? { enabled: params.enabled } : {}),
      ...(params.configJson ? { configJson: params.configJson } : {}),
      ...(params.healthStatus !== undefined ? { healthStatus: params.healthStatus } : {}),
      ...(params.lastCheckedAt !== undefined ? { lastCheckedAt: params.lastCheckedAt } : {}),
      ...(params.lastErrorText !== undefined ? { lastErrorText: params.lastErrorText } : {}),
      updatedAt: new Date(),
    })
    .where(eq(integrations.id, heartbeatIntegrationId));
}

async function recordHeartbeatTrace(params: {
  dbClient: DbClient;
  conversationId: string | null;
  traceId: string;
  eventName: string;
  payload: Record<string, unknown>;
}) {
  await params.dbClient.db.insert(activityTraces).values({
    id: createMessageId(),
    traceType: "integration",
    parentTraceId: params.traceId,
    conversationId: params.conversationId,
    jobId: null,
    eventName: params.eventName,
    payloadJson: params.payload,
  });
}

async function refreshHeartbeatConversationLabel(dbClient: DbClient, conversationId: string) {
  await dbClient.db
    .update(conversations)
    .set({
      title: "Heartbeat",
      channelType: "heartbeat",
      channelLabel: "Autonomy Heartbeat",
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));
}

function toHeartbeatSummary(params: {
  enabled: boolean;
  config: HeartbeatIntegrationConfig;
  healthStatus: string;
  lastErrorText: string | null;
}) {
  if (!params.enabled) {
    return "Heartbeat is disabled. Samantha will only self-check when you run it manually.";
  }

  if (params.healthStatus === "degraded" && params.lastErrorText) {
    return `Heartbeat is enabled, but the last run failed: ${params.lastErrorText}`;
  }

  return `Heartbeat is enabled every ${params.config.intervalMinutes} minute${
    params.config.intervalMinutes === 1 ? "" : "s"
  }.`;
}

export async function getHeartbeatIntegrationStatus(
  dbClient: DbClient,
  config: AppConfig,
): Promise<HeartbeatIntegrationStatusResponse> {
  const record = await ensureHeartbeatIntegrationRecord(dbClient, config);
  const heartbeatConfig = parseHeartbeatConfig(record.configJson);

  return {
    integration: {
      enabled: record.enabled,
      healthStatus:
        record.enabled
          ? record.healthStatus === "degraded"
            ? "degraded"
            : "ok"
          : "disabled",
      healthSummary: toHeartbeatSummary({
        enabled: record.enabled,
        config: heartbeatConfig,
        healthStatus: record.healthStatus,
        lastErrorText: record.lastErrorText ?? null,
      }),
      intervalMinutes: heartbeatConfig.intervalMinutes,
      prompt: heartbeatConfig.prompt,
      conversationId: heartbeatConfig.conversationId,
      lastRunAt: heartbeatConfig.lastRunAt,
      nextRunAt: heartbeatConfig.nextRunAt,
      lastCheckedAt: record.lastCheckedAt?.toISOString() ?? null,
      lastError: record.lastErrorText ?? null,
    },
  };
}

export async function updateHeartbeatIntegrationSettings(params: {
  dbClient: DbClient;
  config: AppConfig;
  patch: UpdateHeartbeatIntegrationRequest;
}) {
  const record = await ensureHeartbeatIntegrationRecord(params.dbClient, params.config);
  const currentConfig = parseHeartbeatConfig(record.configJson);
  const nextEnabled = params.patch.enabled ?? record.enabled;
  const nextConfig: HeartbeatIntegrationConfig = {
    ...currentConfig,
    intervalMinutes:
      params.patch.intervalMinutes !== undefined
        ? clampIntervalMinutes(params.patch.intervalMinutes)
        : currentConfig.intervalMinutes,
    prompt:
      params.patch.prompt !== undefined
        ? (params.patch.prompt?.trim() || defaultHeartbeatPrompt)
        : currentConfig.prompt,
    nextRunAt: currentConfig.nextRunAt,
  };

  if (params.patch.enabled !== undefined || params.patch.intervalMinutes !== undefined) {
    nextConfig.nextRunAt = nextEnabled
      ? computeNextRunAt(nextConfig.intervalMinutes).toISOString()
      : null;
  }

  await saveHeartbeatRecord({
    dbClient: params.dbClient,
    enabled: nextEnabled,
    configJson: nextConfig,
    healthStatus: nextEnabled ? "ok" : "disabled",
    lastCheckedAt: new Date(),
    lastErrorText: null,
  });

  return getHeartbeatIntegrationStatus(params.dbClient, params.config);
}

export async function runHeartbeat(params: {
  config: AppConfig;
  infrastructure: Infrastructure;
  reason: "manual" | "scheduled";
}): Promise<HeartbeatRunResponse> {
  const record = await ensureHeartbeatIntegrationRecord(
    params.infrastructure.dbClient,
    params.config,
  );
  const heartbeatConfig = parseHeartbeatConfig(record.configJson);
  const traceId = createTraceId();
  const now = new Date();

  if (params.reason === "scheduled" && !record.enabled) {
    throw new Error("Heartbeat is disabled.");
  }

  await recordHeartbeatTrace({
    dbClient: params.infrastructure.dbClient,
    conversationId: heartbeatConfig.conversationId,
    traceId,
    eventName: "heartbeat.run.started",
    payload: {
      reason: params.reason,
      intervalMinutes: heartbeatConfig.intervalMinutes,
    },
  });

  try {
    const persistedTurn = await persistChatTurn({
      config: params.config,
      dbClient: params.infrastructure.dbClient,
      defaultPersonaId: params.config.defaultPersonaId,
      defaultUserId: params.config.defaultUserId,
      request: {
        channel: "web",
        userId: params.config.defaultUserId,
        conversationId: heartbeatConfig.conversationId ?? undefined,
        message: {
          text: heartbeatConfig.prompt,
        },
        metadata: {
          requestId: traceId,
        },
      },
      traceId,
    });

    await refreshHeartbeatConversationLabel(
      params.infrastructure.dbClient,
      persistedTurn.conversationId,
    );

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
    }

    const nextRunAt = record.enabled
      ? computeNextRunAt(heartbeatConfig.intervalMinutes, now).toISOString()
      : null;
    const nextConfig: HeartbeatIntegrationConfig = {
      ...heartbeatConfig,
      conversationId: persistedTurn.conversationId,
      lastRunAt: now.toISOString(),
      nextRunAt,
    };

    await saveHeartbeatRecord({
      dbClient: params.infrastructure.dbClient,
      configJson: nextConfig,
      healthStatus: record.enabled ? "ok" : "disabled",
      lastCheckedAt: now,
      lastErrorText: null,
    });

    await recordHeartbeatTrace({
      dbClient: params.infrastructure.dbClient,
      conversationId: persistedTurn.conversationId,
      traceId,
      eventName: "heartbeat.run.completed",
      payload: {
        reason: params.reason,
        assistantMessageId: persistedTurn.response.messageId,
        outputLength: persistedTurn.response.outputText.length,
        nextRunAt,
      },
    });

    try {
      await maybeDeliverTelegramAssistantMessage({
        dbClient: params.infrastructure.dbClient,
        config: params.config,
        conversationId: persistedTurn.conversationId,
        messageId: persistedTurn.response.messageId,
        text: persistedTurn.response.outputText,
        importance: "important",
        source: "heartbeat",
        traceId,
      });
    } catch {
      // Heartbeat delivery should not fail the run if Telegram mirroring is unavailable.
    }

    return {
      ok: true,
      traceId,
      conversationId: persistedTurn.conversationId,
      assistantMessageId: persistedTurn.response.messageId,
      outputPreview: persistedTurn.response.outputText.slice(0, 220),
      nextRunAt,
    };
  } catch (error) {
    const nextRunAt = record.enabled
      ? computeNextRunAt(heartbeatConfig.intervalMinutes, now).toISOString()
      : null;

    await saveHeartbeatRecord({
      dbClient: params.infrastructure.dbClient,
      configJson: {
        ...heartbeatConfig,
        nextRunAt,
      },
      healthStatus: "degraded",
      lastCheckedAt: now,
      lastErrorText: error instanceof Error ? error.message : String(error),
    });

    await recordHeartbeatTrace({
      dbClient: params.infrastructure.dbClient,
      conversationId: heartbeatConfig.conversationId,
      traceId,
      eventName: "heartbeat.run.failed",
      payload: {
        reason: params.reason,
        error: error instanceof Error ? error.message : String(error),
        nextRunAt,
      },
    });

    throw error;
  }
}

export function startHeartbeatLoop(params: {
  config: AppConfig;
  infrastructure: Infrastructure;
  onError: (error: unknown) => void;
}) {
  let running = false;

  const tick = async () => {
    if (running) {
      return;
    }

    running = true;
    try {
      const status = await getHeartbeatIntegrationStatus(
        params.infrastructure.dbClient,
        params.config,
      );

      if (!status.integration.enabled || !status.integration.nextRunAt) {
        return;
      }

      if (Date.parse(status.integration.nextRunAt) > Date.now()) {
        return;
      }

      await runHeartbeat({
        config: params.config,
        infrastructure: params.infrastructure,
        reason: "scheduled",
      });
    } catch (error) {
      params.onError(error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, 30_000);

  void tick();

  return () => {
    clearInterval(timer);
  };
}
