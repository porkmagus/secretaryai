import type { AppConfig } from "@secretary/config";
import type {
  SettingsExportResponse,
  SettingsImportRequest,
  SettingsImportResponse,
} from "@secretary/core-runtime";
import { createMessageId } from "@secretary/core-runtime";
import { type DbClient, integrations, personas, tools, users, voiceProfiles } from "@secretary/db";
import { asc, eq, sql } from "drizzle-orm";
import { saveSecretarySoul } from "../persona-soul.js";
import { listVoiceProfiles } from "../speech-runtime.js";
import { listTools } from "../tools/index.js";
import { getPersonaSettings, normalizePersonaGender } from "./persona.js";

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

    if (snapshot.personas.length > 0) {
      const now = new Date();
      await tx
        .insert(personas)
        .values(
          snapshot.personas.map((persona) => ({
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
          })),
        )
        .onConflictDoUpdate({
          target: personas.id,
          set: {
            name: sql`excluded.name`,
            promptTemplate: sql`excluded.prompt_template`,
            toneProfile: sql`excluded.tone_profile`,
            behaviorRules: sql`excluded.behavior_rules`,
            voiceProfileId: sql`excluded.voice_profile_id`,
            isDefault: sql`excluded.is_default`,
            updatedAt: now,
          },
        });
    }

    if (snapshot.integrations.length > 0) {
      const existingIntegrations = await tx.select().from(integrations);
      const integrationMap = new Map(existingIntegrations.map((i) => [i.integrationType, i]));
      const now = new Date();

      await tx
        .insert(integrations)
        .values(
          snapshot.integrations.map((integration) => {
            const existing = integrationMap.get(integration.integrationType);
            return {
              id: existing?.id || integration.id || createMessageId(),
              integrationType: integration.integrationType,
              enabled: integration.enabled,
              configJson: integration.configJson,
              healthStatus: integration.healthStatus,
            };
          }),
        )
        .onConflictDoUpdate({
          target: integrations.id,
          set: {
            enabled: sql`excluded.enabled`,
            configJson: sql`excluded.config_json`,
            healthStatus: sql`excluded.health_status`,
            updatedAt: now,
          },
        });
    }

    if (snapshot.tools.length > 0) {
      const now = new Date();
      await tx
        .insert(tools)
        .values(
          snapshot.tools.map((tool) => ({
            id: tool.id || createMessageId(),
            key: tool.key,
            name: tool.key,
            description: `${tool.key} imported from settings snapshot.`,
            enabled: tool.enabled,
            approvalMode: tool.approvalMode,
            configSchemaJson: {},
            healthStatus: "ok",
          })),
        )
        .onConflictDoUpdate({
          target: tools.key,
          set: {
            enabled: sql`excluded.enabled`,
            approvalMode: sql`excluded.approval_mode`,
            updatedAt: now,
          },
        });
    }

    if (snapshot.voiceProfiles.length > 0) {
      const now = new Date();
      await tx
        .insert(voiceProfiles)
        .values(
          snapshot.voiceProfiles.map((vp) => ({
            id: vp.id,
            name: vp.name,
            engineId: vp.engineId,
            sampleStorageKey: vp.sampleStorageKey,
            sampleMimeType: vp.sampleMimeType,
            sampleDurationMs: vp.sampleDurationMs,
            qualityPreset: vp.qualityPreset,
            speakingStyle: vp.speakingStyle,
            isActive: vp.isActive,
          })),
        )
        .onConflictDoUpdate({
          target: voiceProfiles.id,
          set: {
            name: sql`excluded.name`,
            engineId: sql`excluded.engine_id`,
            sampleStorageKey: sql`excluded.sample_storage_key`,
            sampleMimeType: sql`excluded.sample_mime_type`,
            sampleDurationMs: sql`excluded.sample_duration_ms`,
            qualityPreset: sql`excluded.quality_preset`,
            speakingStyle: sql`excluded.speaking_style`,
            isActive: sql`excluded.is_active`,
            updatedAt: now,
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
