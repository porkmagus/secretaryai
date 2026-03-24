import cors from "@fastify/cors";
import Fastify from "fastify";
import { loadAppConfig } from "@secretary/config";
import {
  type ConversationListResponse,
  type ActivityTraceResponse,
  type ConversationHistoryResponse,
  type MemoryListResponse,
  type SpeechArtifactListResponse,
  type TaskListResponse,
  type TelegramTestMessageRequest,
  type UpdateTelegramIntegrationRequest,
  type UpdateMemoryRequest,
  type VoiceProfileListResponse,
  createTraceId,
  type RuntimeChatRequest,
} from "@secretary/core-runtime";
import type { TelegramUpdate } from "@secretary/integrations";
import { createInfrastructure } from "./lib/infrastructure.js";
import {
  createQueuedMemoryJob,
  getConversationMessages,
  listRecentConversations,
  markMemoryJobEnqueueFailed,
  persistChatTurn,
} from "./lib/chat-persistence.js";
import { createLogger } from "@secretary/observability";
import {
  getConversationActivity,
  listMemories,
  listTasksForUser,
  updateMemory,
} from "./lib/memory-engine.js";
import {
  dispatchDueTelegramReminders,
  getTelegramIntegrationStatus,
  handleTelegramWebhookUpdate,
  sendTelegramTestMessage,
  syncTelegramWebhook,
  updateTelegramIntegrationSettings,
} from "./lib/telegram-integration.js";
import {
  listSpeechArtifacts,
  listVoiceProfiles,
} from "./lib/speech-runtime.js";

export async function buildServer() {
  const config = loadAppConfig(process.env);
  const logger = createLogger("worker");
  const app = Fastify({ logger: false });
  const infrastructure = await createInfrastructure(config);

  await app.register(cors, {
    origin: true,
  });

  app.get("/health/live", async () => ({
    ok: true,
    service: "worker",
  }));

  app.get("/health/ready", async (_, reply) => {
    const dependencies = await infrastructure.checkHealth();
    const ok =
      dependencies.postgres === "ok" && dependencies.redis === "ok";

    return reply.status(ok ? 200 : 503).send({
      ok,
      service: "worker",
      dependencies,
    });
  });

  app.get<{
    Params: {
      conversationId: string;
    };
  }>("/runtime/conversations/:conversationId", async (request, reply) => {
    try {
      const storedMessages = await getConversationMessages(
        infrastructure.dbClient,
        request.params.conversationId,
      );

      const response: ConversationHistoryResponse = {
        conversationId: request.params.conversationId,
        messages: storedMessages.map((message) => ({
          id: message.id,
          role: message.role as
            | "assistant"
            | "specialist"
            | "system"
            | "tool"
            | "user",
          text: message.contentText,
          createdAt: message.createdAt.toISOString(),
        })),
      };

      return response;
    } catch (error) {
      logger.error("runtime.conversation.failed", {
        conversationId: request.params.conversationId,
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load conversation history.",
      });
    }
  });

  app.get("/runtime/conversations", async (_, reply) => {
    try {
      const response: ConversationListResponse = await listRecentConversations(
        infrastructure.dbClient,
      );

      return response;
    } catch (error) {
      logger.error("runtime.conversations.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load conversations.",
      });
    }
  });

  app.get<{
    Querystring: {
      search?: string;
      type?: string;
      includeSuppressed?: string;
    };
  }>("/runtime/memories", async (request, reply) => {
    try {
      const response: MemoryListResponse = await listMemories(
        infrastructure.dbClient,
        {
          search: request.query.search,
          memoryType: request.query.type,
          includeSuppressed: request.query.includeSuppressed === "true",
        },
      );

      return response;
    } catch (error) {
      logger.error("runtime.memories.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load memories.",
      });
    }
  });

  app.patch<{
    Params: {
      memoryId: string;
    };
    Body: UpdateMemoryRequest;
  }>("/runtime/memories/:memoryId", async (request, reply) => {
    try {
      const updated = await updateMemory(
        infrastructure.dbClient,
        request.params.memoryId,
        request.body,
      );

      if (!updated) {
        return reply.status(404).send({
          error: "Memory entry not found.",
        });
      }

      return {
        memory: {
          id: updated.id,
          memoryType: updated.memoryType,
          title: updated.title,
          summary: updated.summary,
          contentText: updated.contentText,
          importanceScore: updated.importanceScore,
          confidenceScore: updated.confidenceScore,
          pinned: updated.pinned,
          suppressed: updated.suppressed,
          sourceKind: updated.sourceKind,
          sourceRef: updated.sourceRef,
          tags: updated.tags ?? [],
          lastAccessedAt: updated.lastAccessedAt?.toISOString() ?? null,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        },
      };
    } catch (error) {
      logger.error("runtime.memory.update_failed", {
        error: error instanceof Error ? error.message : error,
        memoryId: request.params.memoryId,
      });

      return reply.status(500).send({
        error: "Unable to update memory entry.",
      });
    }
  });

  app.get<{
    Params: {
      conversationId: string;
    };
  }>("/runtime/activity/:conversationId", async (request, reply) => {
    try {
      const response: ActivityTraceResponse = await getConversationActivity(
        infrastructure.dbClient,
        request.params.conversationId,
      );

      return response;
    } catch (error) {
      logger.error("runtime.activity.failed", {
        conversationId: request.params.conversationId,
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load activity traces.",
      });
    }
  });

  app.get("/runtime/tasks", async (_, reply) => {
    try {
      const response: TaskListResponse = await listTasksForUser(
        infrastructure.dbClient,
        config.defaultUserId,
      );

      return response;
    } catch (error) {
      logger.error("runtime.tasks.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load tasks.",
      });
    }
  });

  app.get<{
    Querystring: {
      conversationId?: string;
    };
  }>("/runtime/speech/artifacts", async (request, reply) => {
    try {
      const response: SpeechArtifactListResponse = await listSpeechArtifacts(
        infrastructure.dbClient,
        request.query.conversationId,
      );

      return response;
    } catch (error) {
      logger.error("runtime.speech.artifacts.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load speech artifacts.",
      });
    }
  });

  app.get("/runtime/voice/profiles", async (_, reply) => {
    try {
      const response: VoiceProfileListResponse = await listVoiceProfiles(
        infrastructure.dbClient,
      );

      return response;
    } catch (error) {
      logger.error("runtime.voice.profiles.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load voice profiles.",
      });
    }
  });

  app.get("/runtime/integrations/telegram", async (_, reply) => {
    try {
      return await getTelegramIntegrationStatus(infrastructure.dbClient, config);
    } catch (error) {
      logger.error("runtime.integrations.telegram.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load Telegram integration state.",
      });
    }
  });

  app.patch<{ Body: UpdateTelegramIntegrationRequest }>(
    "/runtime/integrations/telegram",
    async (request, reply) => {
      try {
        return await updateTelegramIntegrationSettings({
          dbClient: infrastructure.dbClient,
          config,
          patch: request.body,
        });
      } catch (error) {
        logger.error("runtime.integrations.telegram.update_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error: "Unable to update Telegram integration settings.",
        });
      }
    },
  );

  app.post("/runtime/integrations/telegram/sync-webhook", async (_, reply) => {
    try {
      return await syncTelegramWebhook({
        dbClient: infrastructure.dbClient,
        config,
      });
    } catch (error) {
      logger.error("runtime.integrations.telegram.sync_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error:
          error instanceof Error
            ? error.message
            : "Unable to sync Telegram webhook.",
      });
    }
  });

  app.post<{ Body: TelegramTestMessageRequest }>(
    "/runtime/integrations/telegram/test-message",
    async (request, reply) => {
      try {
        return await sendTelegramTestMessage({
          dbClient: infrastructure.dbClient,
          config,
          request: request.body,
        });
      } catch (error) {
        logger.error("runtime.integrations.telegram.test_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error:
            error instanceof Error
              ? error.message
              : "Unable to send Telegram test message.",
        });
      }
    },
  );

  app.post("/runtime/integrations/telegram/deliver-reminders", async (_, reply) => {
    try {
      return await dispatchDueTelegramReminders({
        dbClient: infrastructure.dbClient,
        config,
      });
    } catch (error) {
      logger.error("runtime.integrations.telegram.reminders_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error:
          error instanceof Error
            ? error.message
            : "Unable to deliver Telegram reminders.",
      });
    }
  });

  app.post<{ Body: TelegramUpdate }>("/integrations/telegram/webhook", async (request, reply) => {
    const expectedSecret = config.telegram.webhookSecret;
    const receivedSecret = request.headers["x-telegram-bot-api-secret-token"];

    if (expectedSecret && receivedSecret !== expectedSecret) {
      return reply.status(403).send({
        error: "Invalid Telegram webhook secret.",
      });
    }

    try {
      const result = await handleTelegramWebhookUpdate({
        config,
        infrastructure,
        update: request.body,
      });

      return {
        ok: true,
        ...result,
      };
    } catch (error) {
      logger.error("integrations.telegram.webhook_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to process Telegram webhook event.",
      });
    }
  });

  app.post<{ Body: RuntimeChatRequest }>("/runtime/chat", async (request, reply) => {
    const body = request.body as RuntimeChatRequest;
    const traceId = body.metadata?.requestId ?? createTraceId();

    try {
      const persistedTurn = await persistChatTurn({
        dbClient: infrastructure.dbClient,
        defaultPersonaId: config.defaultPersonaId,
        defaultUserId: config.defaultUserId,
        request: body,
        traceId,
      });

      const jobId = await createQueuedMemoryJob({
        dbClient: infrastructure.dbClient,
        payload: persistedTurn.memoryPayload,
        traceId,
      });

      try {
        await infrastructure.memoryQueue.enqueue(jobId, persistedTurn.memoryPayload);
      } catch (error) {
        await markMemoryJobEnqueueFailed(
          infrastructure.dbClient,
          jobId,
          error instanceof Error ? error.message : "Unknown enqueue error",
        );

        throw error;
      }

      logger.info("runtime.chat.completed", {
        channel: body.channel,
        conversationId: persistedTurn.response.conversationId,
        jobId,
        traceId,
        userId: body.userId,
      });

      return persistedTurn.response;
    } catch (error) {
      logger.error("runtime.chat.failed", {
        error: error instanceof Error ? error.message : error,
        traceId,
      });

      return reply.status(500).send({
        error: "Unable to process chat request.",
        traceId,
      });
    }
  });

  return {
    app,
    config,
    infrastructure,
    logger,
  };
}
