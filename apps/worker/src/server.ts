import cors from "@fastify/cors";
import Fastify from "fastify";
import { loadAppConfig } from "@secretary/config";
import {
  type ConversationHistoryResponse,
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
