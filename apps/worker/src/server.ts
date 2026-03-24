import cors from "@fastify/cors";
import Fastify from "fastify";
import { loadAppConfig } from "@secretary/config";
import {
  type ActivityTraceResponse,
  type ConversationHistoryResponse,
  type MemoryListResponse,
  type TaskListResponse,
  type UpdateMemoryRequest,
  createTraceId,
  type RuntimeChatRequest,
} from "@secretary/core-runtime";
import { createInfrastructure } from "./lib/infrastructure.js";
import {
  createQueuedMemoryJob,
  getConversationMessages,
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

export async function buildServer() {
  const config = loadAppConfig(process.env);
  const logger = createLogger("worker");
  const app = Fastify({ logger: false });
  const infrastructure = createInfrastructure(config);

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
