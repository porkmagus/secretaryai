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
