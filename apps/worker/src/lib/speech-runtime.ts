import { access } from "node:fs/promises";
import { eq } from "drizzle-orm";
import {
  activityTraces,
  speechArtifacts,
  voiceProfiles,
  type DbClient,
} from "@secretary/db";
import {
  createMessageId,
  type CreateVoiceProfileRequest,
  type PersonaGender,
  type SpeechArtifactListResponse,
  type SpeechArtifactRecord,
  type UpdateVoiceProfileRequest,
  type VoiceProfileListResponse,
  type VoiceProfileRecord,
} from "@secretary/core-runtime";
import {
  normalizeSpeechStorageKey,
  resolveManagedSpeechStoragePath,
} from "./speech-storage.js";

const builtInVoiceProfiles: Record<
  PersonaGender,
  {
    name: string;
    qualityPreset: string;
    speakingStyle: string;
  }
> = {
  female: {
    name: "Secretary Female Voice",
    qualityPreset: "balanced",
    speakingStyle: "speaks with warmth and natural ease, like someone you trust",
  },
  male: {
    name: "Secretary Male Voice",
    qualityPreset: "balanced",
    speakingStyle: "speaks with calm confidence, grounded and approachable",
  },
};

export function isBuiltInGenderVoiceProfileName(name: string) {
  return Object.values(builtInVoiceProfiles).some((profile) => profile.name === name);
}

function toSpeechArtifactRecord(
  record: typeof speechArtifacts.$inferSelect,
): SpeechArtifactRecord {
  return {
    id: record.id,
    conversationId: record.conversationId,
    messageId: record.messageId,
    artifactKind: record.artifactKind as SpeechArtifactRecord["artifactKind"],
    status: record.status as SpeechArtifactRecord["status"],
    storageKey: normalizeSpeechStorageKey(record.storageKey),
    mimeType: record.mimeType,
    durationMs: record.durationMs,
    transcriptText: record.transcriptText,
    sourceChannel: record.sourceChannel as "telegram" | "web",
    sourceRef: record.sourceRef,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toVoiceProfileRecord(
  record: typeof voiceProfiles.$inferSelect,
): VoiceProfileRecord {
  return {
    id: record.id,
    name: record.name,
    engineId: record.engineId,
    sampleStorageKey: record.sampleStorageKey
      ? normalizeSpeechStorageKey(record.sampleStorageKey)
      : null,
    sampleMimeType: record.sampleMimeType,
    sampleDurationMs: record.sampleDurationMs,
    qualityPreset: record.qualityPreset,
    speakingStyle: record.speakingStyle,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

async function hasManagedSpeechFile(storageKey: string) {
  try {
    await access(resolveManagedSpeechStoragePath(storageKey));
    return true;
  } catch {
    return false;
  }
}

async function sanitizeVoiceProfileRecord(
  dbClient: DbClient,
  record: typeof voiceProfiles.$inferSelect,
): Promise<VoiceProfileRecord> {
  const normalizedRecord = toVoiceProfileRecord(record);

  if (!normalizedRecord.sampleStorageKey) {
    return normalizedRecord;
  }

  const sampleExists = await hasManagedSpeechFile(normalizedRecord.sampleStorageKey);

  if (sampleExists) {
    return normalizedRecord;
  }

  await dbClient.db
    .update(voiceProfiles)
    .set({
      sampleStorageKey: null,
      sampleMimeType: null,
      sampleDurationMs: null,
      updatedAt: new Date(),
    })
    .where(eq(voiceProfiles.id, record.id));

  return {
    ...normalizedRecord,
    sampleStorageKey: null,
    sampleMimeType: null,
    sampleDurationMs: null,
  };
}

export async function ensureDefaultVoiceProfile(dbClient: DbClient) {
  const existing = await dbClient.db.query.voiceProfiles.findFirst({
    where: eq(voiceProfiles.isActive, true),
  });

  if (existing) {
    return existing;
  }

  const profile = await ensureGenderVoiceProfile(dbClient, "female");
  await activateVoiceProfile(dbClient, profile.id);

  return dbClient.db.query.voiceProfiles.findFirst({
    where: eq(voiceProfiles.id, profile.id),
  });
}

export async function listVoiceProfiles(
  dbClient: DbClient,
): Promise<VoiceProfileListResponse> {
  await ensureDefaultVoiceProfile(dbClient);

  const records = await dbClient.db.query.voiceProfiles.findMany({
    orderBy: (fields, { desc }) => [desc(fields.isActive), desc(fields.updatedAt)],
    limit: 20,
  });

  return {
    profiles: await Promise.all(records.map((record) => sanitizeVoiceProfileRecord(dbClient, record))),
  };
}

export async function getActiveVoiceProfile(dbClient: DbClient) {
  await ensureDefaultVoiceProfile(dbClient);

  return dbClient.db.query.voiceProfiles.findFirst({
    where: eq(voiceProfiles.isActive, true),
  });
}

export async function getVoiceProfileById(dbClient: DbClient, profileId: string) {
  return dbClient.db.query.voiceProfiles.findFirst({
    where: eq(voiceProfiles.id, profileId),
  });
}

export async function ensureGenderVoiceProfile(
  dbClient: DbClient,
  gender: PersonaGender,
) {
  const definition = builtInVoiceProfiles[gender];
  const existing = await dbClient.db.query.voiceProfiles.findFirst({
    where: eq(voiceProfiles.name, definition.name),
  });

  if (existing) {
    return existing;
  }

  const id = createMessageId();

  await dbClient.db.insert(voiceProfiles).values({
    id,
    name: definition.name,
    engineId: "kokoro",
    sampleStorageKey: null,
    sampleMimeType: null,
    sampleDurationMs: null,
    qualityPreset: definition.qualityPreset,
    speakingStyle: definition.speakingStyle,
    isActive: false,
  });

  const profile = await dbClient.db.query.voiceProfiles.findFirst({
    where: eq(voiceProfiles.id, id),
  });

  if (!profile) {
    throw new Error(`Unable to create the built-in ${gender} voice profile.`);
  }

  return profile;
}

export async function activateVoiceProfile(dbClient: DbClient, profileId: string) {
  await dbClient.db.update(voiceProfiles).set({
    isActive: false,
    updatedAt: new Date(),
  });

  await dbClient.db
    .update(voiceProfiles)
    .set({
      isActive: true,
      updatedAt: new Date(),
    })
    .where(eq(voiceProfiles.id, profileId));
}

export async function createVoiceProfile(
  dbClient: DbClient,
  request: CreateVoiceProfileRequest,
) {
  const id = createMessageId();

  if (request.isActive) {
    await dbClient.db.update(voiceProfiles).set({
      isActive: false,
      updatedAt: new Date(),
    });
  }

  await dbClient.db.insert(voiceProfiles).values({
    id,
    name: request.name,
    engineId: request.engineId,
    sampleStorageKey: null,
    sampleMimeType: null,
    sampleDurationMs: null,
    qualityPreset: request.qualityPreset ?? null,
    speakingStyle: request.speakingStyle ?? null,
    isActive: request.isActive ?? false,
  });

  return dbClient.db.query.voiceProfiles.findFirst({
    where: eq(voiceProfiles.id, id),
  });
}

export async function updateVoiceProfile(
  dbClient: DbClient,
  profileId: string,
  request: UpdateVoiceProfileRequest,
) {
  const existing = await dbClient.db.query.voiceProfiles.findFirst({
    where: eq(voiceProfiles.id, profileId),
  });

  if (!existing) {
    return null;
  }

  if (request.isActive) {
    await dbClient.db.update(voiceProfiles).set({
      isActive: false,
      updatedAt: new Date(),
    });
  }

  await dbClient.db
    .update(voiceProfiles)
    .set({
      name: request.name ?? existing.name,
      engineId: request.engineId ?? existing.engineId,
      sampleStorageKey: request.clearSample ? null : existing.sampleStorageKey,
      sampleMimeType: request.clearSample ? null : existing.sampleMimeType,
      sampleDurationMs: request.clearSample ? null : existing.sampleDurationMs,
      qualityPreset:
        request.qualityPreset !== undefined ? request.qualityPreset : existing.qualityPreset,
      speakingStyle:
        request.speakingStyle !== undefined ? request.speakingStyle : existing.speakingStyle,
      isActive: request.isActive ?? existing.isActive,
      updatedAt: new Date(),
    })
    .where(eq(voiceProfiles.id, profileId));

  return dbClient.db.query.voiceProfiles.findFirst({
    where: eq(voiceProfiles.id, profileId),
  });
}

export async function attachVoiceProfileSample(params: {
  dbClient: DbClient;
  profileId: string;
  durationMs?: number | null;
  mimeType?: string | null;
  sampleStorageKey: string;
}) {
  await params.dbClient.db
    .update(voiceProfiles)
    .set({
      sampleStorageKey: params.sampleStorageKey,
      sampleMimeType: params.mimeType ?? null,
      sampleDurationMs: params.durationMs ?? null,
      updatedAt: new Date(),
    })
    .where(eq(voiceProfiles.id, params.profileId));

  return params.dbClient.db.query.voiceProfiles.findFirst({
    where: eq(voiceProfiles.id, params.profileId),
  });
}

export async function listSpeechArtifacts(
  dbClient: DbClient,
  conversationId?: string,
): Promise<SpeechArtifactListResponse> {
  const records = await dbClient.db.query.speechArtifacts.findMany({
    where: conversationId ? eq(speechArtifacts.conversationId, conversationId) : undefined,
    orderBy: (fields, { desc }) => [desc(fields.createdAt)],
    limit: 50,
  });

  const artifacts = await Promise.all(
    records.map(async (record) => {
      const artifact = toSpeechArtifactRecord(record);

      if (!artifact.mimeType?.startsWith("audio/")) {
        return artifact;
      }

      const exists = await hasManagedSpeechFile(artifact.storageKey);
      return exists ? artifact : null;
    }),
  );

  return {
    artifacts: artifacts.filter((artifact): artifact is SpeechArtifactRecord => artifact !== null),
  };
}

export async function getSpeechArtifactById(dbClient: DbClient, artifactId: string) {
  return dbClient.db.query.speechArtifacts.findFirst({
    where: eq(speechArtifacts.id, artifactId),
  });
}

export async function recordSpeechTrace(params: {
  dbClient: DbClient;
  conversationId: string | null;
  eventName: string;
  payload: Record<string, unknown>;
  parentTraceId?: string | null;
}) {
  await params.dbClient.db.insert(activityTraces).values({
    id: createMessageId(),
    traceType: "speech",
    parentTraceId: params.parentTraceId ?? null,
    conversationId: params.conversationId,
    jobId: null,
    eventName: params.eventName,
    payloadJson: params.payload,
  });
}

export async function createSpeechArtifact(params: {
  dbClient: DbClient;
  conversationId: string | null;
  messageId: string | null;
  artifactKind: SpeechArtifactRecord["artifactKind"];
  status: SpeechArtifactRecord["status"];
  storageKey: string;
  mimeType?: string | null;
  durationMs?: number | null;
  transcriptText?: string | null;
  sourceChannel: SpeechArtifactRecord["sourceChannel"];
  sourceRef?: string | null;
  metadataJson?: Record<string, unknown>;
}) {
  const id = createMessageId();

  await params.dbClient.db.insert(speechArtifacts).values({
    id,
    conversationId: params.conversationId,
    messageId: params.messageId,
    artifactKind: params.artifactKind,
    status: params.status,
    storageKey: params.storageKey,
    mimeType: params.mimeType ?? null,
    durationMs: params.durationMs ?? null,
    transcriptText: params.transcriptText ?? null,
    sourceChannel: params.sourceChannel,
    sourceRef: params.sourceRef ?? null,
    metadataJson: params.metadataJson ?? {},
  });

  return id;
}

export async function updateSpeechArtifact(params: {
  dbClient: DbClient;
  artifactId: string;
  conversationId?: string | null;
  messageId?: string | null;
  status?: SpeechArtifactRecord["status"];
  durationMs?: number | null;
  transcriptText?: string | null;
}) {
  const updatePayload: Partial<typeof speechArtifacts.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (params.conversationId !== undefined) {
    updatePayload.conversationId = params.conversationId;
  }

  if (params.messageId !== undefined) {
    updatePayload.messageId = params.messageId;
  }

  if (params.status !== undefined) {
    updatePayload.status = params.status;
  }

  if (params.durationMs !== undefined) {
    updatePayload.durationMs = params.durationMs;
  }

  if (params.transcriptText !== undefined) {
    updatePayload.transcriptText = params.transcriptText;
  }

  await params.dbClient.db
    .update(speechArtifacts)
    .set(updatePayload)
    .where(eq(speechArtifacts.id, params.artifactId));
}
