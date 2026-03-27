import { readFile, writeFile } from "node:fs/promises";
import {
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  type UIMessage,
} from "ai";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { loadAppConfig } from "@secretary/config";
import {
  type DiscordTestMessageRequest,
  type DiscordTestMessageResponse,
  type AdminMaintenanceAction,
  type AdminMaintenanceActionResponse,
  type AdminMaintenanceOverviewResponse,
  type CreateVoiceProfileRequest,
  type DeskChatMessageMetadata,
  type ConversationListResponse,
  type ActivityTraceResponse,
  type AgentJobActionResponse,
  type AgentJobDetailResponse,
  type AgentJobListResponse,
  type AgentJobRequirementDecisionRequest,
  type AgentJobSettingsResponse,
  type CreateAgentJobRequest,
  type ConversationHistoryResponse,
  type EmailTestMessageRequest,
  type EmailTestMessageResponse,
  type HeartbeatIntegrationStatusResponse,
  type HeartbeatRunResponse,
  type InferenceProviderId,
  type MemoryListResponse,
  type OnboardingStatusResponse,
  type OutboundChannelStatusResponse,
  type PersonaSettingsResponse,
  type InferenceSettingsResponse,
  type InferenceModelListResponse,
  type SpeechServiceStatusResponse,
  type SpeechArtifactListResponse,
  type SettingsExportResponse,
  type SettingsImportRequest,
  type SettingsImportResponse,
  type SlackTestMessageRequest,
  type SlackTestMessageResponse,
  type SmsTestMessageRequest,
  type SmsTestMessageResponse,
  type SystemHealthResponse,
  type TaskListResponse,
  type ToolApprovalDecisionResponse,
  type ToolExecutionListResponse,
  type ToolListResponse,
  type TelegramTestMessageRequest,
  type TelegramPresenceUpdateRequest,
  type TelegramPresenceUpdateResponse,
  type UpdateAgentJobSettingsRequest,
  type UpdateHeartbeatIntegrationRequest,
  type UpdateDiscordIntegrationRequest,
  type UpdateEmailIntegrationRequest,
  type UpdateSlackIntegrationRequest,
  type UpdateSmsIntegrationRequest,
  type UpdateToolRequest,
  type UpdatePersonaSettingsRequest,
  type UpdateInferenceSettingsRequest,
  type UpdateVoiceProfileRequest,
  type UpdateTelegramIntegrationRequest,
  type UpdateMemoryRequest,
  type VoicePreviewRequest,
  type VoicePreviewResponse,
  type VoiceProfileListResponse,
  type WebSpeechTurnResponse,
  createMessageId,
  createTraceId,
  type RuntimeChatRequest,
  type RuntimeChatStreamRequest,
} from "@secretary/core-runtime";
import type { TelegramUpdate } from "@secretary/integrations";
import { createInfrastructure } from "./lib/infrastructure.js";
import {
  finalizeChatTurn,
  getConversationMessages,
  listRecentConversations,
  prepareChatTurn,
} from "./lib/chat-persistence.js";
import { createLogger } from "@secretary/observability";
import {
  getConversationActivity,
  listMemories,
  listTasksForUser,
  updateMemory,
} from "./lib/memory-engine.js";
import {
  cancelAgentJob,
  createAgentJob,
  decideAgentJobRequirement,
  getAgentJobDetail,
  getAgentJobSettings,
  listAgentJobs,
  resumeAgentJob,
  updateAgentJobSettings,
} from "./lib/agent-jobs.js";
import { resolveManagedAgentJobArtifactPath } from "./lib/agent-job-artifact-storage.js";
import {
  dispatchDueTelegramReminders,
  getTelegramIntegrationStatus,
  handleTelegramWebhookUpdate,
  maybeDeliverTelegramAssistantMessage,
  sendTelegramTestMessage,
  syncTelegramWebhook,
  touchTelegramWebPresence,
  updateTelegramIntegrationSettings,
} from "./lib/telegram-integration.js";
import {
  getDiscordIntegrationStatus,
  getEmailIntegrationStatus,
  getSlackIntegrationStatus,
  getSmsIntegrationStatus,
  sendDiscordTestMessage,
  sendEmailTestMessage,
  sendSlackTestMessage,
  sendSmsTestMessage,
  updateDiscordIntegrationSettings,
  updateEmailIntegrationSettings,
  updateSlackIntegrationSettings,
  updateSmsIntegrationSettings,
} from "./lib/outbound-channel-integrations.js";
import {
  attachVoiceProfileSample,
  createSpeechArtifact,
  createVoiceProfile,
  getVoiceProfileById,
  listSpeechArtifacts,
  listVoiceProfiles,
  recordSpeechTrace,
  updateVoiceProfile,
} from "./lib/speech-runtime.js";
import {
  createSpeechStorageKey,
  ensureSpeechStoragePath,
  resolveManagedSpeechStoragePath,
} from "./lib/speech-storage.js";
import { getSpeechServiceStatus } from "./lib/speech-health.js";
import { createVoicePreview, processWebSpeechTurn } from "./lib/web-speech.js";
import {
  exportSettingsSnapshot,
  getAdminMaintenanceSnapshot,
  getOnboardingStatus,
  getPersonaSettings,
  getSystemHealth,
  importSettingsSnapshot,
  runAdminMaintenanceAction,
  updatePersonaAvatar,
  updatePersonaSettings,
} from "./lib/admin-runtime.js";
import {
  getHeartbeatIntegrationStatus,
  runHeartbeat,
  updateHeartbeatIntegrationSettings,
} from "./lib/heartbeat-runtime.js";
import {
  listInferenceModels,
  loadInferenceSettings,
  updateInferenceSettings,
} from "./lib/inference-settings.js";
import {
  decideToolExecution,
  listToolExecutions,
  listTools,
  updateTool,
} from "./lib/tools-runtime.js";
import {
  enqueueTurnMemoryFollowup,
  processRuntimeTurn,
  resolveImmediateRuntimeTurn,
  type RuntimeTurnPersistence,
} from "./lib/turn-orchestrator.js";
import { createConversationReplyStream } from "./lib/conversation-model.js";
import {
  createPersonaAvatarStorageKey,
  ensurePersonaStoragePath,
  resolveManagedPersonaStoragePath,
} from "./lib/persona-soul.js";

export async function buildServer() {
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

  app.get("/runtime/system/health", async (_, reply) => {
    try {
      const response: SystemHealthResponse = await getSystemHealth({
        config,
        infrastructure,
      });

      return response;
    } catch (error) {
      logger.error("runtime.system.health_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load system health.",
      });
    }
  });

  app.get("/runtime/onboarding", async (_, reply) => {
    try {
      const response: OnboardingStatusResponse = await getOnboardingStatus({
        config,
        infrastructure,
      });

      return response;
    } catch (error) {
      logger.error("runtime.onboarding.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load onboarding state.",
      });
    }
  });

  app.get("/runtime/persona", async (_, reply) => {
    try {
      const response: PersonaSettingsResponse = await getPersonaSettings(
        infrastructure.dbClient,
        config,
      );

      return response;
    } catch (error) {
      logger.error("runtime.persona.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load persona settings.",
      });
    }
  });

  app.patch<{ Body: UpdatePersonaSettingsRequest }>("/runtime/persona", async (request, reply) => {
    try {
      const response: PersonaSettingsResponse = await updatePersonaSettings({
        dbClient: infrastructure.dbClient,
        config,
        request: request.body,
      });

      return response;
    } catch (error) {
      logger.error("runtime.persona.update_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to update persona settings.",
      });
    }
  });

  app.get<{
    Querystring: {
      storageKey?: string;
      mimeType?: string;
    };
  }>("/runtime/persona/avatar/file", async (request, reply) => {
    try {
      if (!request.query.storageKey) {
        return reply.status(400).send({
          error: "storageKey is required.",
        });
      }

      const storagePath = resolveManagedPersonaStoragePath(request.query.storageKey);
      const imageBuffer = await readFile(storagePath);

      reply.header("Content-Type", request.query.mimeType ?? "application/octet-stream");
      return reply.send(imageBuffer);
    } catch (error) {
      logger.error("runtime.persona.avatar_file_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(404).send({
        error: "Secretary portrait is unavailable.",
      });
    }
  });

  app.post("/runtime/persona/avatar", async (request, reply) => {
    try {
      const upload = await request.file();

      if (!upload) {
        return reply.status(400).send({
          error: "Portrait image is required.",
        });
      }

      if (!["image/jpeg", "image/png", "image/webp"].includes(upload.mimetype)) {
        return reply.status(400).send({
          error: "Portrait images must be JPG, PNG, or WebP.",
        });
      }

      const imageBuffer = await upload.toBuffer();

      if (imageBuffer.byteLength > 5 * 1024 * 1024) {
        return reply.status(400).send({
          error: "Portrait images must be 5 MB or smaller.",
        });
      }

      const extension =
        upload.filename?.split(".").pop()?.replace(/[^a-z0-9]/gi, "") ||
        (upload.mimetype === "image/png"
          ? "png"
          : upload.mimetype === "image/webp"
            ? "webp"
            : "jpg");
      const storageKey = createPersonaAvatarStorageKey(
        `${Date.now()}-secretary-portrait.${extension}`,
      );
      const storagePath = await ensurePersonaStoragePath(storageKey);
      await writeFile(storagePath, imageBuffer);

      const response: PersonaSettingsResponse = await updatePersonaAvatar({
        dbClient: infrastructure.dbClient,
        config,
        storageKey,
        mimeType: upload.mimetype,
      });

      return response;
    } catch (error) {
      logger.error("runtime.persona.avatar_update_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to update the secretary portrait.",
      });
    }
  });

  app.get("/runtime/inference", async (_, reply) => {
    try {
      const response: InferenceSettingsResponse = await loadInferenceSettings();
      return response;
    } catch (error) {
      logger.error("runtime.inference.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load inference settings.",
      });
    }
  });

  app.patch<{ Body: UpdateInferenceSettingsRequest }>("/runtime/inference", async (request, reply) => {
    try {
      const response: InferenceSettingsResponse = await updateInferenceSettings({
        request: request.body,
      });

      return response;
    } catch (error) {
      logger.error("runtime.inference.update_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to update inference settings.",
      });
    }
  });

  app.get<{
    Querystring: {
      providerId?: string;
    };
  }>("/runtime/inference/models", async (request, reply) => {
    try {
      const response: InferenceModelListResponse = await listInferenceModels(
        request.query.providerId as InferenceProviderId | undefined,
      );
      return response;
    } catch (error) {
      logger.error("runtime.inference.models_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error:
          error instanceof Error ? error.message : "Unable to fetch inference models.",
      });
    }
  });

  app.get("/runtime/export/settings", async (_, reply) => {
    try {
      const response: SettingsExportResponse = await exportSettingsSnapshot({
        config,
        dbClient: infrastructure.dbClient,
      });

      return response;
    } catch (error) {
      logger.error("runtime.export.settings_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to export settings snapshot.",
      });
    }
  });

  app.post<{ Body: SettingsImportRequest }>("/runtime/import/settings", async (request, reply) => {
    try {
      const response: SettingsImportResponse = await importSettingsSnapshot({
        config,
        dbClient: infrastructure.dbClient,
        request: request.body,
      });

      return response;
    } catch (error) {
      logger.error("runtime.import.settings_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to import settings snapshot.",
      });
    }
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

  app.get("/runtime/agent-jobs", async (_, reply) => {
    try {
      const response: AgentJobListResponse = await listAgentJobs(
        infrastructure.dbClient,
      );

      return response;
    } catch (error) {
      logger.error("runtime.agent_jobs.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load agent jobs.",
      });
    }
  });

  app.post<{ Body: CreateAgentJobRequest }>("/runtime/agent-jobs", async (request, reply) => {
    try {
      const job = await createAgentJob({
        config,
        dbClient: infrastructure.dbClient,
        queue: infrastructure.agentJobQueue,
        request: request.body,
      });

      return reply.status(201).send({
        job,
      });
    } catch (error) {
      logger.error("runtime.agent_job.create_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to create agent job.",
      });
    }
  });

  app.get<{
    Params: {
      jobId: string;
    };
  }>("/runtime/agent-jobs/:jobId", async (request, reply) => {
    try {
      const response: AgentJobDetailResponse | null = await getAgentJobDetail(
        infrastructure.dbClient,
        request.params.jobId,
      );

      if (!response) {
        return reply.status(404).send({
          error: "Agent job not found.",
        });
      }

      return response;
    } catch (error) {
      logger.error("runtime.agent_job.failed", {
        error: error instanceof Error ? error.message : error,
        jobId: request.params.jobId,
      });

      return reply.status(500).send({
        error: "Unable to load agent job.",
      });
    }
  });

  app.get<{
    Querystring: {
      storageKey?: string;
      mimeType?: string;
    };
  }>("/runtime/agent-jobs/artifacts/file", async (request, reply) => {
    try {
      if (!request.query.storageKey) {
        return reply.status(400).send({
          error: "storageKey is required.",
        });
      }

      const filePath = resolveManagedAgentJobArtifactPath(request.query.storageKey);
      const fileBuffer = await readFile(filePath);
      reply.header("Content-Type", request.query.mimeType ?? "application/octet-stream");
      return reply.send(fileBuffer);
    } catch (error) {
      logger.error("runtime.agent_job.artifact_file_failed", {
        error: error instanceof Error ? error.message : error,
        storageKey: request.query.storageKey ?? null,
      });

      return reply.status(404).send({
        error: "Agent job artifact is unavailable.",
      });
    }
  });

  app.post<{
    Params: {
      jobId: string;
    };
  }>("/runtime/agent-jobs/:jobId/resume", async (request, reply) => {
    try {
      const response: AgentJobActionResponse | null = await resumeAgentJob({
        config,
        dbClient: infrastructure.dbClient,
        queue: infrastructure.agentJobQueue,
        jobId: request.params.jobId,
      });

      if (!response) {
        return reply.status(404).send({
          error: "Agent job not found.",
        });
      }

      return response;
    } catch (error) {
      logger.error("runtime.agent_job.resume_failed", {
        error: error instanceof Error ? error.message : error,
        jobId: request.params.jobId,
      });

      return reply.status(500).send({
        error: "Unable to resume agent job.",
      });
    }
  });

  app.post<{
    Params: {
      jobId: string;
    };
  }>("/runtime/agent-jobs/:jobId/cancel", async (request, reply) => {
    try {
      const response: AgentJobActionResponse | null = await cancelAgentJob({
        config,
        dbClient: infrastructure.dbClient,
        jobId: request.params.jobId,
      });

      if (!response) {
        return reply.status(404).send({
          error: "Agent job not found.",
        });
      }

      return response;
    } catch (error) {
      logger.error("runtime.agent_job.cancel_failed", {
        error: error instanceof Error ? error.message : error,
        jobId: request.params.jobId,
      });

      return reply.status(500).send({
        error: "Unable to cancel agent job.",
      });
    }
  });

  app.post<{
    Params: {
      jobId: string;
      requirementId: string;
    };
    Body: AgentJobRequirementDecisionRequest;
  }>("/runtime/agent-jobs/:jobId/requirements/:requirementId/decision", async (request, reply) => {
    try {
      const response: AgentJobActionResponse | null = await decideAgentJobRequirement({
        config,
        dbClient: infrastructure.dbClient,
        queue: infrastructure.agentJobQueue,
        jobId: request.params.jobId,
        requirementId: request.params.requirementId,
        decision: request.body,
      });

      if (!response) {
        return reply.status(404).send({
          error: "Agent job requirement not found.",
        });
      }

      return response;
    } catch (error) {
      logger.error("runtime.agent_job.requirement_failed", {
        error: error instanceof Error ? error.message : error,
        jobId: request.params.jobId,
        requirementId: request.params.requirementId,
      });

      return reply.status(500).send({
        error: "Unable to update agent job requirement.",
      });
    }
  });

  app.get("/runtime/agent-job-settings", async (_, reply) => {
    try {
      const response: AgentJobSettingsResponse = await getAgentJobSettings();
      return response;
    } catch (error) {
      logger.error("runtime.agent_job_settings.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load agent job settings.",
      });
    }
  });

  app.patch<{ Body: UpdateAgentJobSettingsRequest }>("/runtime/agent-job-settings", async (request, reply) => {
    try {
      const response: AgentJobSettingsResponse = await updateAgentJobSettings(request.body);
      return response;
    } catch (error) {
      logger.error("runtime.agent_job_settings.update_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to update agent job settings.",
      });
    }
  });

  app.get("/runtime/admin/maintenance", async (_, reply) => {
    try {
      const response: AdminMaintenanceOverviewResponse = await getAdminMaintenanceSnapshot({
        config,
        infrastructure,
      });
      return response;
    } catch (error) {
      logger.error("runtime.admin_maintenance.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load admin maintenance status.",
      });
    }
  });

  app.post<{ Body: { action: AdminMaintenanceAction } }>("/runtime/admin/maintenance", async (request, reply) => {
    try {
      const response: AdminMaintenanceActionResponse = await runAdminMaintenanceAction({
        action: request.body.action,
        config,
        infrastructure,
      });
      return response;
    } catch (error) {
      logger.error("runtime.admin_maintenance.action_failed", {
        error: error instanceof Error ? error.message : error,
        action: request.body?.action ?? null,
      });

      return reply.status(500).send({
        error: "Unable to run admin maintenance action.",
      });
    }
  });

  app.get("/runtime/tools", async (_, reply) => {
    try {
      const response: ToolListResponse = await listTools(infrastructure.dbClient);
      return response;
    } catch (error) {
      logger.error("runtime.tools.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load tools.",
      });
    }
  });

  app.patch<{
    Params: {
      toolId: string;
    };
    Body: UpdateToolRequest;
  }>("/runtime/tools/:toolId", async (request, reply) => {
    try {
      const tool = await updateTool(
        infrastructure.dbClient,
        request.params.toolId,
        request.body,
      );

      if (!tool) {
        return reply.status(404).send({
          error: "Tool not found.",
        });
      }

      return {
        tool,
      };
    } catch (error) {
      logger.error("runtime.tool.update_failed", {
        error: error instanceof Error ? error.message : error,
        toolId: request.params.toolId,
      });

      return reply.status(500).send({
        error: "Unable to update tool.",
      });
    }
  });

  app.get<{
    Querystring: {
      approvalState?: string;
      conversationId?: string;
    };
  }>("/runtime/tool-executions", async (request, reply) => {
    try {
      const response: ToolExecutionListResponse = await listToolExecutions({
        approvalState: request.query.approvalState,
        conversationId: request.query.conversationId,
        dbClient: infrastructure.dbClient,
      });

      return response;
    } catch (error) {
      logger.error("runtime.tool_executions.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load tool executions.",
      });
    }
  });

  app.post<{
    Params: {
      executionId: string;
    };
  }>("/runtime/tool-executions/:executionId/approve", async (request, reply) => {
    const traceId = createTraceId();
    try {
      const response: ToolApprovalDecisionResponse | null = await decideToolExecution({
        approve: true,
        config,
        dbClient: infrastructure.dbClient,
        executionId: request.params.executionId,
        traceId,
      });

      if (!response) {
        return reply.status(404).send({
          error: "Tool execution not found.",
        });
      }

      return response;
    } catch (error) {
      logger.error("runtime.tool_execution.approve_failed", {
        error: error instanceof Error ? error.message : error,
        executionId: request.params.executionId,
      });

      return reply.status(500).send({
        error: "Unable to approve tool execution.",
      });
    }
  });

  app.post<{
    Params: {
      executionId: string;
    };
  }>("/runtime/tool-executions/:executionId/deny", async (request, reply) => {
    const traceId = createTraceId();
    try {
      const response: ToolApprovalDecisionResponse | null = await decideToolExecution({
        approve: false,
        config,
        dbClient: infrastructure.dbClient,
        executionId: request.params.executionId,
        traceId,
      });

      if (!response) {
        return reply.status(404).send({
          error: "Tool execution not found.",
        });
      }

      return response;
    } catch (error) {
      logger.error("runtime.tool_execution.deny_failed", {
        error: error instanceof Error ? error.message : error,
        executionId: request.params.executionId,
      });

      return reply.status(500).send({
        error: "Unable to deny tool execution.",
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

  app.get("/runtime/speech/status", async (_, reply) => {
    try {
      const response: SpeechServiceStatusResponse = await getSpeechServiceStatus(config);
      return response;
    } catch (error) {
      logger.error("runtime.speech.status_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load speech service status.",
      });
    }
  });

  app.get<{
    Querystring: {
      mimeType?: string;
      storageKey: string;
    };
  }>("/runtime/speech/file", async (request, reply) => {
    try {
      const storageKey = request.query.storageKey?.trim();

      if (!storageKey) {
        return reply.status(400).send({
          error: "storageKey is required.",
        });
      }

      const filePath = resolveManagedSpeechStoragePath(storageKey);
      const fileBuffer = await readFile(filePath);
      reply.header(
        "Content-Type",
        request.query.mimeType?.trim() || "application/octet-stream",
      );

      return reply.send(fileBuffer);
    } catch (error) {
      logger.error("runtime.speech.file_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(404).send({
        error: "Unable to load speech file.",
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

  app.post<{ Body: CreateVoiceProfileRequest }>("/runtime/voice/profiles", async (request, reply) => {
    try {
      const name = request.body.name?.trim();
      const engineId = request.body.engineId?.trim();

      if (!name || !engineId) {
        return reply.status(400).send({
          error: "Voice profile name and engineId are required.",
        });
      }

      const profile = await createVoiceProfile(infrastructure.dbClient, {
        ...request.body,
        engineId,
        name,
      });

      return {
        profile,
      };
    } catch (error) {
      logger.error("runtime.voice.profile_create_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to create voice profile.",
      });
    }
  });

  app.patch<{
    Params: {
      profileId: string;
    };
    Body: UpdateVoiceProfileRequest;
  }>("/runtime/voice/profiles/:profileId", async (request, reply) => {
    try {
      const profile = await updateVoiceProfile(
        infrastructure.dbClient,
        request.params.profileId,
        request.body,
      );

      if (!profile) {
        return reply.status(404).send({
          error: "Voice profile not found.",
        });
      }

      return {
        profile,
      };
    } catch (error) {
      logger.error("runtime.voice.profile_update_failed", {
        error: error instanceof Error ? error.message : error,
        profileId: request.params.profileId,
      });

      return reply.status(500).send({
        error: "Unable to update voice profile.",
      });
    }
  });

  app.post<{
    Params: {
      profileId: string;
    };
  }>("/runtime/voice/profiles/:profileId/sample", async (request, reply) => {
    try {
      const profile = await getVoiceProfileById(
        infrastructure.dbClient,
        request.params.profileId,
      );

      if (!profile) {
        return reply.status(404).send({
          error: "Voice profile not found.",
        });
      }

      const upload = await request.file();

      if (!upload) {
        return reply.status(400).send({
          error: "Sample audio file is required.",
        });
      }

      if (!upload.mimetype?.startsWith("audio/")) {
        return reply.status(400).send({
          error: "Voice samples must be uploaded as audio files.",
        });
      }

      const extension =
        upload.filename?.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "wav";
      const storageKey = createSpeechStorageKey(
        "profile",
        `${Date.now()}-${request.params.profileId}.${extension}`,
      );
      const storagePath = await ensureSpeechStoragePath(storageKey);
      const audioBuffer = await upload.toBuffer();

      if (audioBuffer.byteLength > 15 * 1024 * 1024) {
        return reply.status(400).send({
          error: "Voice samples must be 15 MB or smaller.",
        });
      }

      await writeFile(storagePath, audioBuffer);

      const sampleArtifactId = await createSpeechArtifact({
        dbClient: infrastructure.dbClient,
        conversationId: null,
        messageId: null,
        artifactKind: "voice_sample",
        status: "stored",
        storageKey,
        mimeType: upload.mimetype,
        durationMs: null,
        transcriptText: null,
        sourceChannel: "web",
        sourceRef: request.params.profileId,
        metadataJson: {
          filename: upload.filename,
          voiceProfileId: request.params.profileId,
        },
      });

      const updatedProfile = await attachVoiceProfileSample({
        dbClient: infrastructure.dbClient,
        profileId: request.params.profileId,
        sampleStorageKey: storageKey,
        mimeType: upload.mimetype,
      });

      await recordSpeechTrace({
        dbClient: infrastructure.dbClient,
        conversationId: null,
        eventName: "speech.voice_sample.stored",
        payload: {
          artifactId: sampleArtifactId,
          profileId: request.params.profileId,
          storageKey,
        },
      });

      return {
        artifactId: sampleArtifactId,
        profile: updatedProfile,
      };
    } catch (error) {
      logger.error("runtime.voice.profile_sample_failed", {
        error: error instanceof Error ? error.message : error,
        profileId: request.params.profileId,
      });

      return reply.status(500).send({
        error: "Unable to upload voice sample.",
      });
    }
  });

  app.post<{ Body: VoicePreviewRequest }>("/runtime/voice/preview", async (request, reply) => {
    try {
      const preview = await createVoicePreview({
        config,
        dbClient: infrastructure.dbClient,
        request: request.body,
        });

        reply.header("Content-Type", preview.mimeType);

        return reply.send(preview.audio);
    } catch (error) {
      logger.error("runtime.voice.preview_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error:
          error instanceof Error ? error.message : "Unable to generate voice preview.",
      });
    }
  });

  app.post("/runtime/speech/web-turn", async (request, reply) => {
    try {
      const upload = await request.file();

      if (!upload) {
        return reply.status(400).send({
          error: "Audio upload is required.",
        });
      }

      if (!upload.mimetype?.startsWith("audio/")) {
        return reply.status(400).send({
          error: "Web speech turns must be uploaded as audio files.",
        });
      }

      const audioBuffer = await upload.toBuffer();

      if (audioBuffer.byteLength > 20 * 1024 * 1024) {
        return reply.status(400).send({
          error: "Web speech audio must be 20 MB or smaller.",
        });
      }

      const conversationField = upload.fields.conversationId;
      const conversationId =
        conversationField &&
        "value" in conversationField &&
        typeof conversationField.value === "string" &&
        conversationField.value.trim().length > 0
          ? conversationField.value.trim()
          : null;
      const response: WebSpeechTurnResponse = await processWebSpeechTurn({
        audio: audioBuffer,
        agentJobQueue: infrastructure.agentJobQueue,
        config,
        conversationId,
        dbClient: infrastructure.dbClient,
        defaultPersonaId: config.defaultPersonaId,
        defaultUserId: config.defaultUserId,
        memoryQueue: infrastructure.memoryQueue,
        mimeType: upload.mimetype,
        originalFilename: upload.filename,
      });

      return response;
    } catch (error) {
      logger.error("runtime.speech.web_turn_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error:
          error instanceof Error ? error.message : "Unable to process web audio turn.",
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

  app.post<{ Body: TelegramPresenceUpdateRequest }>(
    "/runtime/integrations/telegram/presence",
    async (request, reply) => {
      try {
        const response: TelegramPresenceUpdateResponse = await touchTelegramWebPresence({
          dbClient: infrastructure.dbClient,
          config,
          request: request.body,
        });

        return response;
      } catch (error) {
        logger.error("runtime.integrations.telegram.presence_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error:
            error instanceof Error
              ? error.message
              : "Unable to update Telegram presence.",
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

  app.get("/runtime/integrations/discord", async (_, reply) => {
    try {
      const response: OutboundChannelStatusResponse = await getDiscordIntegrationStatus(
        infrastructure.dbClient,
        config,
      );
      return response;
    } catch (error) {
      logger.error("runtime.integrations.discord.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load Discord integration state.",
      });
    }
  });

  app.patch<{ Body: UpdateDiscordIntegrationRequest }>(
    "/runtime/integrations/discord",
    async (request, reply) => {
      try {
        const response: OutboundChannelStatusResponse =
          await updateDiscordIntegrationSettings({
            dbClient: infrastructure.dbClient,
            config,
            patch: request.body,
          });
        return response;
      } catch (error) {
        logger.error("runtime.integrations.discord.update_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error: "Unable to update Discord integration settings.",
        });
      }
    },
  );

  app.post<{ Body: DiscordTestMessageRequest }>(
    "/runtime/integrations/discord/test-message",
    async (request, reply) => {
      try {
        const response: DiscordTestMessageResponse = await sendDiscordTestMessage({
          dbClient: infrastructure.dbClient,
          config,
          request: request.body,
        });
        return response;
      } catch (error) {
        logger.error("runtime.integrations.discord.test_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error:
            error instanceof Error
              ? error.message
              : "Unable to send Discord test message.",
        });
      }
    },
  );

  app.get("/runtime/integrations/slack", async (_, reply) => {
    try {
      const response: OutboundChannelStatusResponse = await getSlackIntegrationStatus(
        infrastructure.dbClient,
        config,
      );
      return response;
    } catch (error) {
      logger.error("runtime.integrations.slack.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load Slack integration state.",
      });
    }
  });

  app.patch<{ Body: UpdateSlackIntegrationRequest }>(
    "/runtime/integrations/slack",
    async (request, reply) => {
      try {
        const response: OutboundChannelStatusResponse =
          await updateSlackIntegrationSettings({
            dbClient: infrastructure.dbClient,
            config,
            patch: request.body,
          });
        return response;
      } catch (error) {
        logger.error("runtime.integrations.slack.update_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error: "Unable to update Slack integration settings.",
        });
      }
    },
  );

  app.post<{ Body: SlackTestMessageRequest }>(
    "/runtime/integrations/slack/test-message",
    async (request, reply) => {
      try {
        const response: SlackTestMessageResponse = await sendSlackTestMessage({
          dbClient: infrastructure.dbClient,
          config,
          request: request.body,
        });
        return response;
      } catch (error) {
        logger.error("runtime.integrations.slack.test_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error:
            error instanceof Error
              ? error.message
              : "Unable to send Slack test message.",
        });
      }
    },
  );

  app.get("/runtime/integrations/email", async (_, reply) => {
    try {
      const response: OutboundChannelStatusResponse = await getEmailIntegrationStatus(
        infrastructure.dbClient,
        config,
      );
      return response;
    } catch (error) {
      logger.error("runtime.integrations.email.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load email integration state.",
      });
    }
  });

  app.patch<{ Body: UpdateEmailIntegrationRequest }>(
    "/runtime/integrations/email",
    async (request, reply) => {
      try {
        const response: OutboundChannelStatusResponse =
          await updateEmailIntegrationSettings({
            dbClient: infrastructure.dbClient,
            config,
            patch: request.body,
          });
        return response;
      } catch (error) {
        logger.error("runtime.integrations.email.update_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error: "Unable to update email integration settings.",
        });
      }
    },
  );

  app.post<{ Body: EmailTestMessageRequest }>(
    "/runtime/integrations/email/test-message",
    async (request, reply) => {
      try {
        const response: EmailTestMessageResponse = await sendEmailTestMessage({
          dbClient: infrastructure.dbClient,
          config,
          request: request.body,
        });
        return response;
      } catch (error) {
        logger.error("runtime.integrations.email.test_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error:
            error instanceof Error
              ? error.message
              : "Unable to send email test message.",
        });
      }
    },
  );

  app.get("/runtime/integrations/sms", async (_, reply) => {
    try {
      const response: OutboundChannelStatusResponse = await getSmsIntegrationStatus(
        infrastructure.dbClient,
        config,
      );
      return response;
    } catch (error) {
      logger.error("runtime.integrations.sms.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load SMS integration state.",
      });
    }
  });

  app.patch<{ Body: UpdateSmsIntegrationRequest }>(
    "/runtime/integrations/sms",
    async (request, reply) => {
      try {
        const response: OutboundChannelStatusResponse =
          await updateSmsIntegrationSettings({
            dbClient: infrastructure.dbClient,
            config,
            patch: request.body,
          });
        return response;
      } catch (error) {
        logger.error("runtime.integrations.sms.update_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error: "Unable to update SMS integration settings.",
        });
      }
    },
  );

  app.post<{ Body: SmsTestMessageRequest }>(
    "/runtime/integrations/sms/test-message",
    async (request, reply) => {
      try {
        const response: SmsTestMessageResponse = await sendSmsTestMessage({
          dbClient: infrastructure.dbClient,
          config,
          request: request.body,
        });
        return response;
      } catch (error) {
        logger.error("runtime.integrations.sms.test_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error:
            error instanceof Error
              ? error.message
              : "Unable to send SMS test message.",
        });
      }
    },
  );

  app.get("/runtime/integrations/heartbeat", async (_, reply) => {
    try {
      const response: HeartbeatIntegrationStatusResponse =
        await getHeartbeatIntegrationStatus(infrastructure.dbClient, config);
      return response;
    } catch (error) {
      logger.error("runtime.integrations.heartbeat.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load heartbeat integration state.",
      });
    }
  });

  app.patch<{ Body: UpdateHeartbeatIntegrationRequest }>(
    "/runtime/integrations/heartbeat",
    async (request, reply) => {
      try {
        const response: HeartbeatIntegrationStatusResponse =
          await updateHeartbeatIntegrationSettings({
            dbClient: infrastructure.dbClient,
            config,
            patch: request.body,
          });

        return response;
      } catch (error) {
        logger.error("runtime.integrations.heartbeat.update_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error: "Unable to update heartbeat settings.",
        });
      }
    },
  );

  app.post("/runtime/integrations/heartbeat/run", async (_, reply) => {
    try {
      const response: HeartbeatRunResponse = await runHeartbeat({
        config,
        infrastructure,
        reason: "manual",
      });

      return response;
    } catch (error) {
      logger.error("runtime.integrations.heartbeat.run_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: error instanceof Error ? error.message : "Unable to run heartbeat.",
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

  app.post<{ Body: RuntimeChatStreamRequest }>(
    "/runtime/chat/stream",
    async (request, reply) => {
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
                        model: replyMode === "model" ? streamPlan.model ?? null : null,
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
              mode:
                streamPlan.kind === "model"
                  ? streamPlan.guardState.mode
                  : streamPlan.mode,
              model:
                streamPlan.kind === "model" && streamPlan.guardState.mode === "fallback"
                  ? null
                  : streamPlan.model ?? null,
              providerError:
                streamPlan.kind === "model"
                  ? streamPlan.guardState.providerError
                  : streamPlan.providerError ?? null,
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

            return "Something went wrong while the secretary was replying.";
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
    },
  );

  return {
    app,
    config,
    infrastructure,
    logger,
  };
}
