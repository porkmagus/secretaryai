import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { loadAppConfig } from "@secretary/config";
import {
  createMessageId,
  createTraceId,
  type DeskChatMessageMetadata,
  type RuntimeChatRequest,
  type RuntimeChatStreamRequest,
} from "@secretary/core-runtime";
import { createLogger } from "@secretary/observability";
import { createUIMessageStream, pipeUIMessageStreamToResponse, type UIMessage } from "ai";
import Fastify from "fastify";
import { finalizeChatTurn, prepareChatTurn } from "./lib/chat-persistence.js";
import { createConversationReplyStream } from "./lib/conversation-model.js";
import { createInfrastructure } from "./lib/infrastructure.js";
import { maybeDeliverTelegramAssistantMessage } from "./lib/telegram-integration.js";
import {
  enqueueTurnMemoryFollowup,
  processRuntimeTurn,
  type RuntimeTurnPersistence,
  resolveImmediateRuntimeTurn,
} from "./lib/turn-orchestrator.js";

/**
 * Validate required environment variables before starting the server.
 * Throws a clear, actionable error message if any are missing or empty.
 */
function validateRequiredEnv(): void {
  const required = [
    { key: "DATABASE_URL", example: "postgresql://user:password@localhost:5432/secretary" },
    { key: "REDIS_URL", example: "redis://localhost:6379" },
    { key: "APP_BASE_URL", example: "http://localhost:3000" },
    { key: "WORKER_BASE_URL", example: "http://localhost:4000" },
    { key: "DEFAULT_USER_ID", example: "00000000-0000-0000-0000-000000000000" },
    { key: "DEFAULT_PERSONA_ID", example: "00000000-0000-0000-0000-000000000001" },
  ];

  const missing: string[] = [];
  for (const { key, example } of required) {
    const val = process.env[key];
    if (!val || val.trim().length === 0) {
      missing.push(`  ${key}=${example}`);
    }
  }

  if (missing.length > 0) {
    const lines = [
      "",
      "╔══════════════════════════════════════════════════════════════╗",
      "║             SECRETARY WORKER — MISSING ENV VARS              ║",
      "╚══════════════════════════════════════════════════════════════╝",
      "",
      "The following required environment variables are not set:",
      "",
      ...missing,
      "",
      "Copy .env.example to .env and fill in the values above.",
      "Then restart the worker.",
      "",
    ];
    console.error(lines.join("\n"));
    process.exit(1);
  }
}

import { registerActivityRoutes } from "./routes/activity-routes.js";
import { registerAdminRoutes } from "./routes/admin-routes.js";
import { registerAgentJobsRoutes } from "./routes/agent-jobs-routes.js";
import { registerConversationsRoutes } from "./routes/conversations-routes.js";
import { registerHealthRoutes } from "./routes/health-routes.js";
import { registerInferenceRoutes } from "./routes/inference-routes.js";
import { registerIntegrationsRoutes } from "./routes/integrations-routes.js";
import { registerMemoriesRoutes } from "./routes/memories-routes.js";
import { registerPersonaRoutes } from "./routes/persona-routes.js";
import { registerSettingsRoutes } from "./routes/settings-routes.js";
import { registerSpeechRoutes } from "./routes/speech-routes.js";
import { registerSystemRoutes } from "./routes/system-routes.js";
import { registerTasksRoutes } from "./routes/tasks-routes.js";
import { registerTelegramWebhookRoutes } from "./routes/telegram-webhook-routes.js";
import { registerToolExecutionsRoutes } from "./routes/tool-executions-routes.js";
import { registerToolsRoutes } from "./routes/tools-routes.js";
import { registerVoiceRoutes } from "./routes/voice-routes.js";

export async function buildServer() {
  validateRequiredEnv();
  const config = loadAppConfig(process.env);
  const logger = createLogger("worker");
  const app = Fastify({ logger: false });
  const infrastructure = await createInfrastructure(config);

  function extractText(message: UIMessage<DeskChatMessageMetadata> | undefined) {
    if (!message) {
      return "";
    }

    return message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("")
      .trim();
  }

  function buildDeskChatMetadata(params: {
    response: {
      conversationId: string;
      contextSummary?: DeskChatMessageMetadata["contextSummary"];
      pendingApproval?: DeskChatMessageMetadata["pendingApproval"];
      traceId: string;
    };
    mode: DeskChatMessageMetadata["replyMode"];
    model?: string | null;
    providerError?: string | null;
    totalTokens?: number;
  }) {
    return {
      conversationId: params.response.conversationId,
      traceId: params.response.traceId,
      replyMode: params.mode,
      model: params.model ?? null,
      providerError: params.providerError ?? null,
      pendingApproval: params.response.pendingApproval ?? null,
      contextSummary: params.response.contextSummary ?? {
        memories: [],
        tasks: [],
        research: undefined,
      },
      totalTokens: params.totalTokens,
    } satisfies DeskChatMessageMetadata;
  }

  async function finalizePersistedTurn(params: {
    body: RuntimeChatRequest;
    persistedTurn: RuntimeTurnPersistence;
    traceId: string;
  }) {
    const jobId = await enqueueTurnMemoryFollowup({
      dbClient: infrastructure.dbClient,
      memoryPayload: params.persistedTurn.memoryPayload,
      memoryQueue: infrastructure.memoryQueue,
      traceId: params.traceId,
    });

    logger.info("runtime.chat.completed", {
      channel: params.body.channel,
      conversationId: params.persistedTurn.response.conversationId,
      jobId,
      traceId: params.traceId,
      userId: params.body.userId,
    });

    if (params.body.channel === "web") {
      try {
        await maybeDeliverTelegramAssistantMessage({
          dbClient: infrastructure.dbClient,
          config,
          conversationId: params.persistedTurn.response.conversationId,
          messageId: params.persistedTurn.response.messageId,
          text: params.persistedTurn.response.outputText,
          importance: params.persistedTurn.response.pendingApproval ? "important" : "normal",
          source: "web",
          traceId: params.traceId,
        });
      } catch (deliveryError) {
        logger.error("runtime.chat.telegram_delivery_failed", {
          error: deliveryError instanceof Error ? deliveryError.message : deliveryError,
          traceId: params.traceId,
        });
      }
    }
  }

  await app.register(cors, {
    origin: true,
  });
  await app.register(multipart);

  // OpenAPI/Swagger documentation
  await app.register(swagger, {
    openapi: {
      info: {
        title: "SecretaryAI Worker API",
        description:
          "AI Secretary backend — chat, jobs, persona, channels, tools, memory, and more.",
        version: "0.1.0",
      },
      servers: [{ url: "http://localhost:4000", description: "Local development" }],
      tags: [
        { name: "Health", description: "Service health checks" },
        { name: "Persona", description: "Secretary persona configuration" },
        { name: "Inference", description: "AI inference provider settings" },
        { name: "Conversations", description: "Chat conversation management" },
        { name: "Chat", description: "Real-time chat turns and streaming" },
        { name: "Agent Jobs", description: "Background agent job management" },
        { name: "Tools", description: "Tool execution and approvals" },
        { name: "Memory", description: "Long-term memory management" },
        { name: "Tasks", description: "User task management" },
        { name: "Channels", description: "Outbound channel integrations" },
        { name: "Telegram", description: "Telegram bot integration" },
        { name: "Speech & Voice", description: "STT, TTS, and voice profiles" },
        { name: "Admin", description: "Administration and maintenance" },
        { name: "Heartbeat", description: "Proactive heartbeat system" },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  // Rate limiting: 100 requests per 15 minutes per IP, health endpoints excluded
  // @ts-expect-error -- rate-limit types diverge from this Fastify version; works at runtime
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "15 minutes",
    allowList: (req) => {
      if (!req || typeof req !== "object") return false;
      const url = (req as { url?: string }).url;
      return typeof url === "string" && url.startsWith("/health");
    },
    addHeadersOnExceeding: true,
  });

  await registerActivityRoutes(app, config, infrastructure, logger);
  await registerAdminRoutes(app, config, infrastructure, logger);
  await registerAgentJobsRoutes(app, config, infrastructure, logger);
  await registerConversationsRoutes(app, config, infrastructure, logger);
  await registerHealthRoutes(app, config, infrastructure, logger);
  await registerInferenceRoutes(app, config, infrastructure, logger);
  await registerIntegrationsRoutes(app, config, infrastructure, logger);
  await registerMemoriesRoutes(app, config, infrastructure, logger);
  await registerPersonaRoutes(app, config, infrastructure, logger);
  await registerSettingsRoutes(app, config, infrastructure, logger);
  await registerSpeechRoutes(app, config, infrastructure, logger);
  await registerSystemRoutes(app, config, infrastructure, logger);
  await registerTasksRoutes(app, config, infrastructure, logger);
  await registerTelegramWebhookRoutes(app, config, infrastructure, logger);
  await registerToolExecutionsRoutes(app, config, infrastructure, logger);
  await registerToolsRoutes(app, config, infrastructure, logger);
  await registerVoiceRoutes(app, config, infrastructure, logger);

  app.post<{ Body: RuntimeChatRequest }>("/runtime/chat", async (request, reply) => {
    const body = request.body as RuntimeChatRequest;
    const traceId = body.metadata?.requestId ?? createTraceId();

    try {
      const persistedTurn = await processRuntimeTurn({
        config,
        dbClient: infrastructure.dbClient,
        queue: infrastructure.agentJobQueue,
        defaultPersonaId: config.defaultPersonaId,
        defaultUserId: config.defaultUserId,
        request: body,
        traceId,
      });

      await finalizePersistedTurn({
        body,
        persistedTurn,
        traceId,
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

  app.post<{ Body: RuntimeChatStreamRequest }>("/runtime/chat/stream", async (request, reply) => {
    const body = request.body as RuntimeChatStreamRequest;
    const text = body.text?.trim();

    if (!text) {
      return reply.status(400).send({
        error: "Message text is required.",
      });
    }

    const traceId = createTraceId();
    const runtimeRequest: RuntimeChatRequest = {
      conversationId: body.conversationId,
      channel: "web",
      userId: config.defaultUserId,
      message: {
        text,
      },
      metadata: {
        requestId: traceId,
      },
    };

    try {
      const immediateHandledTurn = await resolveImmediateRuntimeTurn({
        config,
        dbClient: infrastructure.dbClient,
        queue: infrastructure.agentJobQueue,
        defaultPersonaId: config.defaultPersonaId,
        defaultUserId: config.defaultUserId,
        request: runtimeRequest,
        traceId,
      });

      if (immediateHandledTurn) {
        await finalizePersistedTurn({
          body: runtimeRequest,
          persistedTurn: immediateHandledTurn,
          traceId,
        });

        const stream = createUIMessageStream<UIMessage<DeskChatMessageMetadata>>({
          execute: async ({ writer }) => {
            writer.write({
              type: "data-runtime-context",
              data: buildDeskChatMetadata({
                response: immediateHandledTurn.response,
                mode: "tool",
              }),
            });
            writer.write({
              type: "text-start",
              id: immediateHandledTurn.response.messageId,
            });
            writer.write({
              type: "text-delta",
              id: immediateHandledTurn.response.messageId,
              delta: immediateHandledTurn.response.outputText,
            });
            writer.write({
              type: "text-end",
              id: immediateHandledTurn.response.messageId,
            });
          },
          generateId: createMessageId,
        });

        reply.hijack();
        pipeUIMessageStreamToResponse({
          response: reply.raw,
          stream,
          status: 200,
        });
        return reply;
      }

      const preparedTurn = await prepareChatTurn({
        config,
        dbClient: infrastructure.dbClient,
        defaultPersonaId: config.defaultPersonaId,
        defaultUserId: config.defaultUserId,
        request: runtimeRequest,
        traceId,
      });
      const streamPlan = createConversationReplyStream({
        inference: preparedTurn.inference,
        request: preparedTurn.request,
        context: preparedTurn.context,
        traceId,
      });

      const stream = createUIMessageStream<UIMessage<DeskChatMessageMetadata>>({
        originalMessages: preparedTurn.originalMessages,
        generateId: createMessageId,
        execute: async ({ writer }) => {
          if (streamPlan.kind === "model") {
            writer.merge(
              streamPlan.result.toUIMessageStream<UIMessage<DeskChatMessageMetadata>>({
                messageMetadata: ({ part }) => {
                  if (part.type === "start") {
                    return buildDeskChatMetadata({
                      response: {
                        conversationId: preparedTurn.conversationId,
                        contextSummary: {
                          memories: preparedTurn.context.relevantMemories,
                          tasks: preparedTurn.context.activeTasks,
                          research: preparedTurn.context.researchResult ?? undefined,
                        },
                        traceId,
                      },
                      mode: "model",
                      model: streamPlan.model ?? null,
                    });
                  }

                  if (part.type === "finish") {
                    const replyMode = streamPlan.guardState.mode;
                    return buildDeskChatMetadata({
                      response: {
                        conversationId: preparedTurn.conversationId,
                        contextSummary: {
                          memories: preparedTurn.context.relevantMemories,
                          tasks: preparedTurn.context.activeTasks,
                          research: preparedTurn.context.researchResult ?? undefined,
                        },
                        traceId,
                      },
                      mode: replyMode,
                      model: replyMode === "model" ? (streamPlan.model ?? null) : null,
                      providerError: streamPlan.guardState.providerError,
                      totalTokens: part.totalUsage.totalTokens,
                    });
                  }

                  return undefined;
                },
                sendSources: true,
              }),
            );
            return;
          }

          writer.write({
            type: "data-runtime-context",
            data: buildDeskChatMetadata({
              response: {
                conversationId: preparedTurn.conversationId,
                contextSummary: {
                  memories: preparedTurn.context.relevantMemories,
                  tasks: preparedTurn.context.activeTasks,
                  research: preparedTurn.context.researchResult ?? undefined,
                },
                traceId,
              },
              mode: "fallback",
              model: streamPlan.model ?? null,
              providerError: streamPlan.providerError,
            }),
          });
          writer.write({
            type: "text-start",
            id: "fallback-text",
          });
          writer.write({
            type: "text-delta",
            id: "fallback-text",
            delta: streamPlan.text,
          });
          writer.write({
            type: "text-end",
            id: "fallback-text",
          });
        },
        onFinish: async ({ responseMessage }) => {
          const outputText = extractText(responseMessage);

          if (!outputText) {
            return;
          }

          const persistedTurn = await finalizeChatTurn({
            dbClient: infrastructure.dbClient,
            preparedTurn,
            assistantMessageId: responseMessage.id,
            outputText,
            mode: streamPlan.kind === "model" ? streamPlan.guardState.mode : streamPlan.mode,
            model:
              streamPlan.kind === "model" && streamPlan.guardState.mode === "fallback"
                ? null
                : (streamPlan.model ?? null),
            providerError:
              streamPlan.kind === "model"
                ? streamPlan.guardState.providerError
                : (streamPlan.providerError ?? null),
          });

          await finalizePersistedTurn({
            body: preparedTurn.request,
            persistedTurn,
            traceId,
          });
        },
        onError: (error) => {
          logger.error("runtime.chat.stream_failed", {
            error: error instanceof Error ? error.message : error,
            traceId,
          });

          return "Something went wrong. Let me try again.";
        },
      });

      reply.hijack();
      pipeUIMessageStreamToResponse({
        response: reply.raw,
        stream,
        status: 200,
      });
      return reply;
    } catch (error) {
      logger.error("runtime.chat.stream_failed", {
        error: error instanceof Error ? error.message : error,
        traceId,
      });

      return reply.status(500).send({
        error: "Unable to stream chat reply.",
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
