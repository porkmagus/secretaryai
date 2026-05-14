import { resolve } from "node:path";
import type { AppConfig } from "@secretary/config";
import type { OnboardingStatusResponse, SystemHealthResponse } from "@secretary/core-runtime";
import { getHeartbeatIntegrationStatus } from "../heartbeat-runtime.js";
import type { Infrastructure } from "../infrastructure.js";
import { defaultSecretarySoul } from "../persona-soul.js";
import { getSpeechServiceStatus } from "../speech-health.js";
import { listVoiceProfiles } from "../speech-runtime.js";
import { getTelegramIntegrationStatus } from "../telegram-integration.js";
import { listTools } from "../tools/index.js";
import { pathExists, repoRoot } from "../utils.js";
import { getConversationEngineStatus } from "./maintenance.js";
import { getPersonaSettings } from "./persona.js";

export async function getSystemHealth(params: {
  config: AppConfig;
  infrastructure: Infrastructure;
}): Promise<SystemHealthResponse> {
  const dependencyHealth = await params.infrastructure.checkHealth();
  const [speechStatus, telegramStatus, heartbeatStatus] = await Promise.all([
    getSpeechServiceStatus(params.config),
    getTelegramIntegrationStatus(params.infrastructure.dbClient, params.config),
    getHeartbeatIntegrationStatus(params.infrastructure.dbClient, params.config),
  ]);
  const conversationEngine = await getConversationEngineStatus(params.config);

  const [
    conversationsCount,
    messagesCount,
    memoriesCount,
    tasksCount,
    toolExecutionsCount,
    voiceProfilesCount,
  ] = await Promise.all([
    params.infrastructure.dbClient.pool.query("select count(*)::int as count from conversations"),
    params.infrastructure.dbClient.pool.query("select count(*)::int as count from messages"),
    params.infrastructure.dbClient.pool.query("select count(*)::int as count from memory_entries"),
    params.infrastructure.dbClient.pool.query("select count(*)::int as count from tasks"),
    params.infrastructure.dbClient.pool.query("select count(*)::int as count from tool_executions"),
    params.infrastructure.dbClient.pool.query("select count(*)::int as count from voice_profiles"),
  ]);

  const storage = await Promise.all(
    [
      { label: "Postgres data", path: resolve(repoRoot, "runtime/postgres/data") },
      { label: "Redis data", path: resolve(repoRoot, "runtime/redis/data") },
      { label: "Speech storage", path: resolve(repoRoot, "runtime/speech") },
      { label: "Speech profiles", path: resolve(repoRoot, "runtime/speech/profiles") },
      { label: "Backups", path: resolve(repoRoot, "runtime/backups") },
      { label: "Exports", path: resolve(repoRoot, "runtime/exports") },
    ].map(async (entry) => ({
      ...entry,
      exists: await pathExists(entry.path),
    })),
  );

  return {
    generatedAt: new Date().toISOString(),
    services: {
      worker: {
        status: "ok",
        summary: "Worker runtime is responding.",
      },
      conversation: {
        status: conversationEngine.mode === "provider" ? "ok" : "attention",
        summary: conversationEngine.summary,
      },
      postgres: {
        status: dependencyHealth.postgres === "ok" ? "ok" : "degraded",
        summary:
          dependencyHealth.postgres === "ok"
            ? "PostgreSQL is reachable."
            : String(dependencyHealth.postgres),
      },
      redis: {
        status: dependencyHealth.redis === "ok" ? "ok" : "degraded",
        summary:
          dependencyHealth.redis === "ok" ? "Redis is reachable." : String(dependencyHealth.redis),
      },
      telegram: {
        status:
          telegramStatus.integration.healthStatus === "ok"
            ? "ok"
            : telegramStatus.integration.healthStatus === "not_configured"
              ? "not_configured"
              : "degraded",
        summary: telegramStatus.integration.healthSummary,
      },
      heartbeat: {
        status: heartbeatStatus.integration.enabled
          ? heartbeatStatus.integration.healthStatus === "degraded"
            ? "degraded"
            : "ok"
          : "not_configured",
        summary: heartbeatStatus.integration.healthSummary,
      },
      stt: {
        status: speechStatus.services.stt.healthStatus,
        summary: speechStatus.services.stt.summary,
      },
      tts: {
        status: speechStatus.services.tts.healthStatus,
        summary: speechStatus.services.tts.summary,
      },
      ffmpeg: {
        status: speechStatus.services.ffmpeg.available ? "ok" : "degraded",
        summary: speechStatus.services.ffmpeg.summary,
      },
    },
    storage,
    stats: {
      conversations: conversationsCount.rows[0]?.count ?? 0,
      memories: memoriesCount.rows[0]?.count ?? 0,
      messages: messagesCount.rows[0]?.count ?? 0,
      tasks: tasksCount.rows[0]?.count ?? 0,
      toolExecutions: toolExecutionsCount.rows[0]?.count ?? 0,
      voiceProfiles: voiceProfilesCount.rows[0]?.count ?? 0,
    },
  };
}

export async function getOnboardingStatus(params: {
  config: AppConfig;
  infrastructure: Infrastructure;
}): Promise<OnboardingStatusResponse> {
  const [health, persona, toolsResponse, telegramStatus, voiceList] = await Promise.all([
    getSystemHealth(params),
    getPersonaSettings(params.infrastructure.dbClient, params.config),
    listTools(params.infrastructure.dbClient),
    getTelegramIntegrationStatus(params.infrastructure.dbClient, params.config),
    listVoiceProfiles(params.infrastructure.dbClient),
  ]);
  const conversationEngine = await getConversationEngineStatus(params.config);

  const activeVoice = voiceList.profiles.find((profile) => profile.isActive);

  const steps: OnboardingStatusResponse["steps"] = [
    {
      id: "install",
      title: "Local stack is healthy",
      status:
        health.services.postgres.status === "ok" && health.services.redis.status === "ok"
          ? "complete"
          : "attention",
      detail:
        health.services.postgres.status === "ok" && health.services.redis.status === "ok"
          ? "Worker, Postgres, and Redis are all reachable."
          : "Bring the local stack fully online before relying on daily use.",
      href: "/health",
    },
    {
      id: "conversation",
      title: "Conversation engine is chosen",
      status: conversationEngine.mode === "provider" ? "complete" : "attention",
      detail: conversationEngine.summary,
      href: "/persona",
    },
    {
      id: "persona",
      title: "Secretary persona is customized",
      status:
        persona.persona.promptTemplate.trim() === defaultSecretarySoul.trim() &&
        persona.persona.name === "Secretary"
          ? "attention"
          : "complete",
      detail:
        persona.persona.name === "Secretary"
          ? `Default persona still uses the starter identity (${persona.persona.gender ?? "female"}).`
          : `Current persona is "${persona.persona.name}" (${persona.persona.gender ?? "female"}).`,
      href: "/persona",
    },
    {
      id: "telegram",
      title: "Telegram channel is configured",
      status:
        telegramStatus.integration.enabled && telegramStatus.integration.botConfigured
          ? "complete"
          : telegramStatus.integration.envConfigured
            ? "attention"
            : "not_started",
      detail: telegramStatus.integration.healthSummary,
      href: "/channels",
    },
    {
      id: "tools",
      title: "Tool approval baseline is reviewed",
      status: toolsResponse.tools.some((tool) => tool.approvalMode === "ask_first")
        ? "complete"
        : "attention",
      detail: `${toolsResponse.tools.length} tools are registered for review.`,
      href: "/tools",
    },
    {
      id: "voice",
      title: "Voice profile and speech services are ready",
      status:
        activeVoice && health.services.tts.status !== "not_configured"
          ? "complete"
          : activeVoice
            ? "attention"
            : "not_started",
      detail: activeVoice
        ? `Active profile: ${activeVoice.name}.`
        : "No active voice profile has been selected yet.",
      href: "/voice",
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    completedSteps: steps.filter((step) => step.status === "complete").length,
    totalSteps: steps.length,
    steps,
  };
}
