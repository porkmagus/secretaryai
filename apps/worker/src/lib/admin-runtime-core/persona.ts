import type { AppConfig } from "@secretary/config";
import type {
  PersonaAvatarRecord,
  PersonaGender,
  PersonaSettingsRecord,
  PersonaSettingsResponse,
  SecretaryCustomizationRecord,
  UpdatePersonaSettingsRequest,
} from "@secretary/core-runtime";
import { type DbClient, personas, users } from "@secretary/db";
import { eq } from "drizzle-orm";
import {
  defaultSecretaryName,
  defaultSecretaryPersonaProfile,
  defaultSecretarySoul,
  getSecretaryPersonaFilePath,
  getSecretarySoulFilePath,
  loadSecretaryPersonaProfile,
  loadSecretarySoul,
  saveSecretaryPersonaProfile,
  saveSecretarySoul,
} from "../persona-soul.js";
import {
  activateVoiceProfile,
  ensureGenderVoiceProfile,
  getVoiceProfileById,
  isBuiltInGenderVoiceProfileName,
  listVoiceProfiles,
} from "../speech-runtime.js";
import { getConversationEngineStatus } from "./maintenance.js";

export function normalizePersonaGender(value: unknown): PersonaGender {
  return value === "male" ? "male" : "female";
}

export function defaultSecretaryCustomization(): SecretaryCustomizationRecord {
  return {
    title: null,
    mode: "workday",
    relationshipRole: "private_secretary",
    presenceStyle: "composed",
    responseLength: "balanced",
    directness: "balanced",
    initiative: "balanced",
    planningStyle: "executive",
    greetingStyle: "minimal",
    closingStyle: "next_steps",
    clarifyingStyle: "sparing",
    reminderStyle: "gentle",
    addressPreference: null,
    avoidances: [],
    exampleReply: null,
    antiExampleReply: null,
  };
}

function parsePersonaAvatar(
  toneProfile: Record<string, unknown> | null | undefined,
): PersonaAvatarRecord | null {
  const avatar =
    toneProfile && typeof toneProfile.avatar === "object" && toneProfile.avatar
      ? (toneProfile.avatar as Record<string, unknown>)
      : null;

  if (!avatar || typeof avatar.storageKey !== "string" || avatar.storageKey.trim().length === 0) {
    return null;
  }

  return {
    storageKey: avatar.storageKey,
    mimeType: typeof avatar.mimeType === "string" ? avatar.mimeType : null,
    updatedAt: typeof avatar.updatedAt === "string" ? avatar.updatedAt : new Date().toISOString(),
  };
}

export function parseSecretaryCustomization(
  toneProfile: Record<string, unknown> | null | undefined,
): SecretaryCustomizationRecord {
  const defaults = defaultSecretaryCustomization();
  const customization =
    toneProfile && typeof toneProfile.customization === "object" && toneProfile.customization
      ? (toneProfile.customization as Record<string, unknown>)
      : null;

  if (!customization) {
    return defaults;
  }

  return {
    title:
      typeof customization.title === "string" && customization.title.trim().length > 0
        ? customization.title.trim()
        : null,
    mode:
      customization.mode === "personal" ||
      customization.mode === "travel" ||
      customization.mode === "deep_focus" ||
      customization.mode === "operator"
        ? customization.mode
        : defaults.mode,
    relationshipRole:
      customization.relationshipRole === "chief_of_staff" ||
      customization.relationshipRole === "operator" ||
      customization.relationshipRole === "companion" ||
      customization.relationshipRole === "household_coordinator"
        ? customization.relationshipRole
        : defaults.relationshipRole,
    presenceStyle:
      customization.presenceStyle === "warm" ||
      customization.presenceStyle === "playful" ||
      customization.presenceStyle === "formal" ||
      customization.presenceStyle === "assertive"
        ? customization.presenceStyle
        : defaults.presenceStyle,
    responseLength:
      customization.responseLength === "concise" || customization.responseLength === "expansive"
        ? customization.responseLength
        : defaults.responseLength,
    directness:
      customization.directness === "soft" || customization.directness === "direct"
        ? customization.directness
        : defaults.directness,
    initiative:
      customization.initiative === "reactive" || customization.initiative === "proactive"
        ? customization.initiative
        : defaults.initiative,
    planningStyle:
      customization.planningStyle === "checklist" || customization.planningStyle === "narrative"
        ? customization.planningStyle
        : defaults.planningStyle,
    greetingStyle:
      customization.greetingStyle === "name_forward" || customization.greetingStyle === "warm"
        ? customization.greetingStyle
        : defaults.greetingStyle,
    closingStyle:
      customization.closingStyle === "none" || customization.closingStyle === "summary"
        ? customization.closingStyle
        : defaults.closingStyle,
    clarifyingStyle:
      customization.clarifyingStyle === "balanced" || customization.clarifyingStyle === "proactive"
        ? customization.clarifyingStyle
        : defaults.clarifyingStyle,
    reminderStyle:
      customization.reminderStyle === "balanced" || customization.reminderStyle === "firm"
        ? customization.reminderStyle
        : defaults.reminderStyle,
    addressPreference:
      typeof customization.addressPreference === "string" &&
      customization.addressPreference.trim().length > 0
        ? customization.addressPreference.trim()
        : null,
    avoidances: Array.isArray(customization.avoidances)
      ? customization.avoidances
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter(Boolean)
      : defaults.avoidances,
    exampleReply:
      typeof customization.exampleReply === "string" && customization.exampleReply.trim().length > 0
        ? customization.exampleReply.trim()
        : null,
    antiExampleReply:
      typeof customization.antiExampleReply === "string" &&
      customization.antiExampleReply.trim().length > 0
        ? customization.antiExampleReply.trim()
        : null,
  };
}

export function toPersonaRecord(record: typeof personas.$inferSelect): PersonaSettingsRecord {
  return {
    id: record.id,
    name: record.name,
    promptTemplate: record.promptTemplate,
    toneMode: typeof record.toneProfile?.mode === "string" ? record.toneProfile.mode : null,
    gender: normalizePersonaGender(record.toneProfile?.gender),
    avatar: parsePersonaAvatar(record.toneProfile),
    customization: parseSecretaryCustomization(record.toneProfile),
    behaviorRules: record.behaviorRules,
    voiceProfileId: record.voiceProfileId ?? null,
    isDefault: record.isDefault,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
export async function ensureDefaultPersonaRecord(dbClient: DbClient, config: AppConfig) {
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
      name: defaultSecretaryName,
      toneProfile: {
        mode: "calm",
        gender: "female",
        customization: defaultSecretaryCustomization(),
      },
      behaviorRules: [
        "Be warm, competent, and calm.",
        "Answer naturally instead of narrating internal system state unless the user asks for it.",
        "Protect local-first privacy defaults.",
      ],
      promptTemplate: defaultSecretarySoul,
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
  const customization = parseSecretaryCustomization(persona.toneProfile);
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
          customization,
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
  const gender = normalizePersonaGender(params.request.gender ?? persona.toneProfile?.gender);
  const toneMode =
    params.request.toneMode?.trim() ||
    (typeof persona.toneProfile?.mode === "string" ? persona.toneProfile.mode : "calm");
  let voiceProfileId = persona.voiceProfileId ?? null;
  const currentCustomization = parseSecretaryCustomization(persona.toneProfile);
  const nextCustomization = {
    ...currentCustomization,
    ...(params.request.customization ?? {}),
    title:
      params.request.customization?.title !== undefined
        ? params.request.customization.title?.trim() || null
        : currentCustomization.title,
    addressPreference:
      params.request.customization?.addressPreference !== undefined
        ? params.request.customization.addressPreference?.trim() || null
        : currentCustomization.addressPreference,
    avoidances:
      params.request.customization?.avoidances !== undefined
        ? params.request.customization.avoidances.map((entry) => entry.trim()).filter(Boolean)
        : currentCustomization.avoidances,
    exampleReply:
      params.request.customization?.exampleReply !== undefined
        ? params.request.customization.exampleReply?.trim() || null
        : currentCustomization.exampleReply,
    antiExampleReply:
      params.request.customization?.antiExampleReply !== undefined
        ? params.request.customization.antiExampleReply?.trim() || null
        : currentCustomization.antiExampleReply,
  };
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
        customization: nextCustomization,
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

export async function updatePersonaAvatar(params: {
  dbClient: DbClient;
  config: AppConfig;
  storageKey: string;
  mimeType: string | null;
}) {
  const persona = await ensureDefaultPersonaRecord(params.dbClient, params.config);

  await params.dbClient.db
    .update(personas)
    .set({
      toneProfile: {
        ...(persona.toneProfile ?? {}),
        avatar: {
          storageKey: params.storageKey,
          mimeType: params.mimeType,
          updatedAt: new Date().toISOString(),
        },
      },
      updatedAt: new Date(),
    })
    .where(eq(personas.id, persona.id));

  return getPersonaSettings(params.dbClient, params.config);
}
