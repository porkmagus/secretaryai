import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { asc, eq } from "drizzle-orm";
import type { AppConfig } from "@secretary/config";
import {
  createMessageId,
  type OnboardingStatusResponse,
  type PersonaGender,
  type PersonaSettingsRecord,
  type PersonaSettingsResponse,
  type SettingsExportResponse,
  type SettingsImportRequest,
  type SettingsImportResponse,
  type SystemHealthResponse,
  type UpdatePersonaSettingsRequest,
} from "@secretary/core-runtime";
import {
  integrations,
  personas,
  tools,
  users,
  voiceProfiles,
  type DbClient,
} from "@secretary/db";
import { getSpeechServiceStatus } from "./speech-health.js";
import {
  defaultSecretaryPersonaProfile,
  defaultSecretarySoul,
  getSecretaryPersonaFilePath,
  getSecretarySoulFilePath,
  loadSecretaryPersonaProfile,
  loadSecretarySoul,
  saveSecretaryPersonaProfile,
  saveSecretarySoul,
} from "./persona-soul.js";
import {
  activateVoiceProfile,
  ensureGenderVoiceProfile,
  getVoiceProfileById,
  isBuiltInGenderVoiceProfileName,
  listVoiceProfiles,
} from "./speech-runtime.js";
import { getTelegramIntegrationStatus } from "./telegram-integration.js";
import { listTools } from "./tools-runtime.js";
import type { Infrastructure } from "./infrastructure.js";
import { loadInferenceSettings } from "./inference-settings.js";
import { getHeartbeatIntegrationStatus } from "./heartbeat-runtime.js";

const repoRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));

function normalizePersonaGender(value: unknown): PersonaGender {
  return value === "male" ? "male" : "female";
}

function toPersonaRecord(record: typeof personas.$inferSelect): PersonaSettingsRecord {
  return {
    id: record.id,
    name: record.name,
    promptTemplate: record.promptTemplate,
    toneMode:
      typeof record.toneProfile?.mode === "string" ? record.toneProfile.mode : null,
    gender: normalizePersonaGender(record.toneProfile?.gender),
    behaviorRules: record.behaviorRules,
    voiceProfileId: record.voiceProfileId ?? null,
    isDefault: record.isDefault,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

async function getConversationEngineStatus(config: AppConfig) {
  const inference = await loadInferenceSettings();

  if (
    inference.settings.mode === "provider" &&
    inference.settings.selectedProviderId
  ) {
    return {
      mode: "provider" as const,
      provider: inference.settings.selectedProviderId,
      model:
        inference.providers.find(
          (provider) => provider.id === inference.settings.selectedProviderId,
        )?.model ?? null,
      summary: inference.settings.summary,
    };
  }

  return {
    mode: "deterministic_fallback" as const,
    provider: null,
    model: null,
    summary: inference.settings.summary,
  };
}

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureDefaultPersonaRecord(dbClient: DbClient, config: AppConfig) {
  await dbClient.db
    .insert(users)
    .values({
      id: config.defaultUserId,
      displayName: "Local Owner",
      defaultPersonaId: config.defaultPersonaId,
    })
    .onConflictDoNothing();

  await dbClient.db
    .insert(personas)
    .values({
      id: config.defaultPersonaId,
      name: "Secretary",
      toneProfile: {
        mode: "calm",
        gender: "female",
      },
      behaviorRules: [
        "Be warm, competent, and calm.",
        "Answer naturally instead of narrating internal system state unless the user asks for it.",
        "Protect local-first privacy defaults.",
      ],
      promptTemplate:
        defaultSecretarySoul,
      isDefault: true,
      voiceProfileId: null,
    })
    .onConflictDoNothing();

  await dbClient.db
    .update(users)
    .set({
      defaultPersonaId: config.defaultPersonaId,
      updatedAt: new Date(),
    })
    .where(eq(users.id, config.defaultUserId));

  let persona =
    (await dbClient.db.query.personas.findFirst({
      where: eq(personas.id, config.defaultPersonaId),
    })) ??
    (await dbClient.db.query.personas.findFirst({
      where: eq(personas.isDefault, true),
    }));

  if (!persona) {
    throw new Error("Default persona could not be ensured.");
  }

  const soulText = await loadSecretarySoul(persona.promptTemplate);

  if (soulText !== persona.promptTemplate) {
    await dbClient.db
      .update(personas)
      .set({
        promptTemplate: soulText,
        updatedAt: new Date(),
      })
      .where(eq(personas.id, persona.id));

    const refreshed = await dbClient.db.query.personas.findFirst({
      where: eq(personas.id, persona.id),
    });

    if (refreshed) {
      persona = refreshed;
    }
  }

  const gender = normalizePersonaGender(persona.toneProfile?.gender);
  const toneMode =
    typeof persona.toneProfile?.mode === "string" && persona.toneProfile.mode.trim().length > 0
      ? persona.toneProfile.mode
      : "calm";
  let voiceProfileId = persona.voiceProfileId ?? null;

  if (voiceProfileId) {
    const selectedProfile = await getVoiceProfileById(dbClient, voiceProfileId);

    if (selectedProfile) {
      await activateVoiceProfile(dbClient, selectedProfile.id);
    } else {
      voiceProfileId = null;
    }
  }

  if (!voiceProfileId) {
    const defaultVoiceProfile = await ensureGenderVoiceProfile(dbClient, gender);
    voiceProfileId = defaultVoiceProfile.id;
    await activateVoiceProfile(dbClient, defaultVoiceProfile.id);
  }

  const needsNormalization =
    persona.toneProfile?.gender !== gender ||
    persona.toneProfile?.mode !== toneMode ||
    persona.voiceProfileId !== voiceProfileId;

  if (needsNormalization) {
    await dbClient.db
      .update(personas)
      .set({
        toneProfile: {
          ...(persona.toneProfile ?? {}),
          mode: toneMode,
          gender,
        },
        voiceProfileId,
        updatedAt: new Date(),
      })
      .where(eq(personas.id, persona.id));

    const refreshedPersona = await dbClient.db.query.personas.findFirst({
      where: eq(personas.id, persona.id),
    });

    if (refreshedPersona) {
      return refreshedPersona;
    }
  }

  return persona;
}

export async function getPersonaSettings(
  dbClient: DbClient,
  config: AppConfig,
): Promise<PersonaSettingsResponse> {
  const persona = await ensureDefaultPersonaRecord(dbClient, config);
  const voiceList = await listVoiceProfiles(dbClient);
  const personaProfile = await loadSecretaryPersonaProfile(defaultSecretaryPersonaProfile);
  const conversationEngine = await getConversationEngineStatus(config);

  return {
    conversationEngine,
    persona: toPersonaRecord(persona),
    personaFilePath: getSecretaryPersonaFilePath(),
    personaProfile,
    soulFilePath: getSecretarySoulFilePath(),
    voiceProfiles: voiceList.profiles,
  };
}

export async function updatePersonaSettings(params: {
  dbClient: DbClient;
  config: AppConfig;
  request: UpdatePersonaSettingsRequest;
}) {
  const persona = await ensureDefaultPersonaRecord(params.dbClient, params.config);
  const currentGender = normalizePersonaGender(persona.toneProfile?.gender);
  const gender = normalizePersonaGender(
    params.request.gender ?? persona.toneProfile?.gender,
  );
  const toneMode =
    params.request.toneMode?.trim() ||
    (typeof persona.toneProfile?.mode === "string" ? persona.toneProfile.mode : "calm");
  let voiceProfileId = persona.voiceProfileId ?? null;
  const nextSoul = params.request.promptTemplate?.trim() || persona.promptTemplate;
  const nextPersonaProfile =
    params.request.personaProfile?.trim() ||
    (await loadSecretaryPersonaProfile(defaultSecretaryPersonaProfile));

  if (params.request.voiceProfileId !== undefined) {
    voiceProfileId = params.request.voiceProfileId?.trim() || null;
  }

  if (voiceProfileId) {
    const selectedProfile = await getVoiceProfileById(params.dbClient, voiceProfileId);

    if (selectedProfile) {
      const shouldSwitchBuiltInVoice =
        gender !== currentGender &&
        persona.voiceProfileId === selectedProfile.id &&
        isBuiltInGenderVoiceProfileName(selectedProfile.name);

      if (shouldSwitchBuiltInVoice) {
        voiceProfileId = null;
      } else {
        await activateVoiceProfile(params.dbClient, selectedProfile.id);
      }
    } else {
      voiceProfileId = null;
    }
  }

  if (!voiceProfileId) {
    const defaultVoiceProfile = await ensureGenderVoiceProfile(params.dbClient, gender);
    voiceProfileId = defaultVoiceProfile.id;
    await activateVoiceProfile(params.dbClient, defaultVoiceProfile.id);
  }

  await params.dbClient.db
    .update(personas)
    .set({
      name: params.request.name?.trim() || persona.name,
      promptTemplate: nextSoul,
      toneProfile: {
        ...(persona.toneProfile ?? {}),
        mode: toneMode,
        gender,
      },
      behaviorRules:
        params.request.behaviorRules?.map((rule) => rule.trim()).filter(Boolean) ??
        persona.behaviorRules,
      voiceProfileId,
      updatedAt: new Date(),
    })
    .where(eq(personas.id, persona.id));

  await saveSecretarySoul(nextSoul);
  await saveSecretaryPersonaProfile(nextPersonaProfile);

  return getPersonaSettings(params.dbClient, params.config);
}

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
        status:
          heartbeatStatus.integration.enabled
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
      status:
        toolsResponse.tools.some((tool) => tool.approvalMode === "ask_first")
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

export async function exportSettingsSnapshot(params: {
  config: AppConfig;
  dbClient: DbClient;
}): Promise<SettingsExportResponse> {
  const [personaSettings, integrationsList, toolsList, voiceList, user] = await Promise.all([
    getPersonaSettings(params.dbClient, params.config),
    params.dbClient.db.query.integrations.findMany({
      orderBy: asc(integrations.integrationType),
    }),
    listTools(params.dbClient),
    listVoiceProfiles(params.dbClient),
    params.dbClient.db.query.users.findFirst({
      where: eq(users.id, params.config.defaultUserId),
    }),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    snapshot: {
      userDefaultPersonaId: user?.defaultPersonaId ?? null,
      personas: [personaSettings.persona],
      integrations: integrationsList.map((integration) => ({
        id: integration.id,
        integrationType: integration.integrationType,
        enabled: integration.enabled,
        configJson: integration.configJson,
        healthStatus: integration.healthStatus,
      })),
      tools: toolsList.tools.map((tool) => ({
        id: tool.id,
        key: tool.key,
        enabled: tool.enabled,
        approvalMode: tool.approvalMode,
      })),
      voiceProfiles: voiceList.profiles,
    },
  };
}

export async function importSettingsSnapshot(params: {
  config: AppConfig;
  dbClient: DbClient;
  request: SettingsImportRequest;
}): Promise<SettingsImportResponse> {
  const snapshot = params.request.snapshot;

  await params.dbClient.db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values({
        id: params.config.defaultUserId,
        displayName: "Local Owner",
        defaultPersonaId: snapshot.userDefaultPersonaId ?? params.config.defaultPersonaId,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          defaultPersonaId: snapshot.userDefaultPersonaId ?? params.config.defaultPersonaId,
          updatedAt: new Date(),
        },
      });

    for (const persona of snapshot.personas) {
      await tx
        .insert(personas)
        .values({
          id: persona.id,
          name: persona.name,
          promptTemplate: persona.promptTemplate,
          toneProfile: {
            mode: persona.toneMode ?? "calm",
            gender: normalizePersonaGender(persona.gender),
          },
          behaviorRules: persona.behaviorRules,
          voiceProfileId: persona.voiceProfileId,
          isDefault: persona.isDefault,
        })
        .onConflictDoUpdate({
          target: personas.id,
          set: {
            name: persona.name,
            promptTemplate: persona.promptTemplate,
            toneProfile: {
              mode: persona.toneMode ?? "calm",
              gender: normalizePersonaGender(persona.gender),
            },
            behaviorRules: persona.behaviorRules,
            voiceProfileId: persona.voiceProfileId,
            isDefault: persona.isDefault,
            updatedAt: new Date(),
          },
        });
    }

    for (const integration of snapshot.integrations) {
      const existing = await tx.query.integrations.findFirst({
        where: eq(integrations.integrationType, integration.integrationType),
      });

      if (existing) {
        await tx
          .update(integrations)
          .set({
            enabled: integration.enabled,
            configJson: integration.configJson,
            healthStatus: integration.healthStatus,
            updatedAt: new Date(),
          })
          .where(eq(integrations.id, existing.id));
      } else {
        await tx.insert(integrations).values({
          id: integration.id || createMessageId(),
          integrationType: integration.integrationType,
          enabled: integration.enabled,
          configJson: integration.configJson,
          healthStatus: integration.healthStatus,
        });
      }
    }

    for (const tool of snapshot.tools) {
      const existing = await tx.query.tools.findFirst({
        where: eq(tools.key, tool.key),
      });

      if (existing) {
        await tx
          .update(tools)
          .set({
            enabled: tool.enabled,
            approvalMode: tool.approvalMode,
            updatedAt: new Date(),
          })
          .where(eq(tools.id, existing.id));
      } else {
        await tx.insert(tools).values({
          id: tool.id || createMessageId(),
          key: tool.key,
          name: tool.key,
          description: `${tool.key} imported from settings snapshot.`,
          enabled: tool.enabled,
          approvalMode: tool.approvalMode,
          configSchemaJson: {},
          healthStatus: "ok",
        });
      }
    }

    for (const voiceProfile of snapshot.voiceProfiles) {
      await tx
        .insert(voiceProfiles)
        .values({
          id: voiceProfile.id,
          name: voiceProfile.name,
          engineId: voiceProfile.engineId,
          sampleStorageKey: voiceProfile.sampleStorageKey,
          sampleMimeType: voiceProfile.sampleMimeType,
          sampleDurationMs: voiceProfile.sampleDurationMs,
          qualityPreset: voiceProfile.qualityPreset,
          speakingStyle: voiceProfile.speakingStyle,
          isActive: voiceProfile.isActive,
        })
        .onConflictDoUpdate({
          target: voiceProfiles.id,
          set: {
            name: voiceProfile.name,
            engineId: voiceProfile.engineId,
            sampleStorageKey: voiceProfile.sampleStorageKey,
            sampleMimeType: voiceProfile.sampleMimeType,
            sampleDurationMs: voiceProfile.sampleDurationMs,
            qualityPreset: voiceProfile.qualityPreset,
            speakingStyle: voiceProfile.speakingStyle,
            isActive: voiceProfile.isActive,
            updatedAt: new Date(),
          },
        });
    }
  });

  const persona = await getPersonaSettings(params.dbClient, params.config);
  await saveSecretarySoul(persona.persona.promptTemplate);

  return {
    importedAt: new Date().toISOString(),
    persona: persona.persona,
  };
}
