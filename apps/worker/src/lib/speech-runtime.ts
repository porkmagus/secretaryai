import { eq } from "drizzle-orm";
import {
  activityTraces,
  speechArtifacts,
  voiceProfiles,
  type DbClient,
} from "@secretary/db";
import {
  createMessageId,
  type SpeechArtifactListResponse,
  type SpeechArtifactRecord,
  type VoiceProfileListResponse,
  type VoiceProfileRecord,
} from "@secretary/core-runtime";

function toSpeechArtifactRecord(
  record: typeof speechArtifacts.$inferSelect,
): SpeechArtifactRecord {
  return {
    id: record.id,
    conversationId: record.conversationId,
    messageId: record.messageId,
    artifactKind: record.artifactKind as SpeechArtifactRecord["artifactKind"],
    status: record.status as SpeechArtifactRecord["status"],
    storageKey: record.storageKey,
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
    sampleStorageKey: record.sampleStorageKey,
    sampleMimeType: record.sampleMimeType,
    sampleDurationMs: record.sampleDurationMs,
    qualityPreset: record.qualityPreset,
    speakingStyle: record.speakingStyle,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function ensureDefaultVoiceProfile(dbClient: DbClient) {
  const existing = await dbClient.db.query.voiceProfiles.findFirst({
    where: eq(voiceProfiles.isActive, true),
  });

  if (existing) {
    return existing;
  }

  const id = createMessageId();

  await dbClient.db.insert(voiceProfiles).values({
    id,
    name: "Secretary Default Voice",
    engineId: "local-placeholder",
    sampleStorageKey: null,
    sampleMimeType: null,
    sampleDurationMs: null,
    qualityPreset: "balanced",
    speakingStyle: "calm and warm",
    isActive: true,
  });

  return dbClient.db.query.voiceProfiles.findFirst({
    where: eq(voiceProfiles.id, id),
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
    profiles: records.map(toVoiceProfileRecord),
  };
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

  return {
    artifacts: records.map(toSpeechArtifactRecord),
  };
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
