import { writeFile } from "node:fs/promises";
import type { AppConfig } from "@secretary/config";
import type { DbClient } from "@secretary/db";
import {
  createTraceId,
  type RuntimeChatResponse,
  type VoicePreviewRequest,
  type WebSpeechTurnResponse,
} from "@secretary/core-runtime";
import {
  createQueuedMemoryJob,
  markMemoryJobEnqueueFailed,
  persistChatTurn,
} from "./chat-persistence.js";
import type { MemoryQueueAdapter } from "./memory-queue.js";
import {
  createSpeechArtifact,
  getActiveVoiceProfile,
  getVoiceProfileById,
  recordSpeechTrace,
  updateSpeechArtifact,
} from "./speech-runtime.js";
import { createSpeechStorageKey, ensureSpeechStoragePath } from "./speech-storage.js";
import { transcribeAudioFile } from "./stt-service.js";
import { synthesizeSpeech } from "./tts-service.js";

export async function createVoicePreview(params: {
  config: AppConfig;
  dbClient: DbClient;
  request: VoicePreviewRequest;
}) {
  const text = params.request.text.trim();

  if (!text) {
    throw new Error("Preview text is required.");
  }

  if (text.length > 1200) {
    throw new Error("Preview text must be 1200 characters or shorter.");
  }

  const voiceProfile = params.request.profileId
    ? await getVoiceProfileById(params.dbClient, params.request.profileId)
    : await getActiveVoiceProfile(params.dbClient);

  const synthesis = await synthesizeSpeech({
    config: params.config,
    text,
    engineId: voiceProfile?.engineId ?? "chatterbox",
    language: "en",
    speakerSampleStorageKey: voiceProfile?.sampleStorageKey ?? null,
  });

  if (!synthesis) {
    throw new Error("TTS_BASE_URL is not configured.");
  }

  const storageKey = createSpeechStorageKey(
    "tts",
    `${Date.now()}-voice-preview.wav`,
  );
  const storagePath = await ensureSpeechStoragePath(storageKey);
  await writeFile(storagePath, synthesis.audio);

  const artifactId = await createSpeechArtifact({
    dbClient: params.dbClient,
    conversationId: null,
    messageId: null,
    artifactKind: "tts_output",
    status: "synthesized",
    storageKey,
    mimeType: synthesis.mimeType,
    durationMs: synthesis.durationMs,
    transcriptText: text,
    sourceChannel: "web",
    sourceRef: voiceProfile?.id ?? "preview",
    metadataJson: {
      engineId: voiceProfile?.engineId ?? "chatterbox",
      modelName: synthesis.modelName,
      preview: true,
      voiceProfileId: voiceProfile?.id ?? null,
    },
  });

  await recordSpeechTrace({
    dbClient: params.dbClient,
    conversationId: null,
    eventName: "speech.preview.generated",
    payload: {
      artifactId,
      engineId: voiceProfile?.engineId ?? "chatterbox",
      voiceProfileId: voiceProfile?.id ?? null,
    },
  });

  return {
    artifactId,
    audio: synthesis.audio,
    mimeType: synthesis.mimeType ?? "audio/wav",
  };
}

export async function processWebSpeechTurn(params: {
  audio: Buffer;
  config: AppConfig;
  conversationId?: string | null;
  dbClient: DbClient;
  defaultPersonaId: string;
  defaultUserId: string;
  memoryQueue: MemoryQueueAdapter;
  mimeType?: string | null;
  originalFilename?: string | null;
}): Promise<WebSpeechTurnResponse> {
  if (!params.config.speech.sttBaseUrl) {
    throw new Error("STT_BASE_URL is not configured.");
  }

  if (params.audio.byteLength === 0) {
    throw new Error("Audio upload was empty.");
  }

  const traceId = createTraceId();
  const extension =
    params.originalFilename?.split(".").pop()?.replace(/[^a-z0-9]/gi, "") ||
    (params.mimeType?.includes("ogg")
      ? "ogg"
      : params.mimeType?.includes("webm")
        ? "webm"
        : params.mimeType?.includes("mpeg")
          ? "mp3"
          : "wav");
  const storageKey = createSpeechStorageKey(
    "web",
    `${Date.now()}-web-recording.${extension}`,
  );
  const storagePath = await ensureSpeechStoragePath(storageKey);
  await writeFile(storagePath, params.audio);

  const artifactId = await createSpeechArtifact({
    dbClient: params.dbClient,
    conversationId: params.conversationId ?? null,
    messageId: null,
    artifactKind: "web_recording",
    status: "stored",
    storageKey,
    mimeType: params.mimeType ?? "application/octet-stream",
    durationMs: null,
    transcriptText: null,
    sourceChannel: "web",
    sourceRef: params.originalFilename ?? null,
    metadataJson: {
      traceId,
      uploadedFrom: "voice_console",
    },
  });

  await recordSpeechTrace({
    dbClient: params.dbClient,
    conversationId: params.conversationId ?? null,
    parentTraceId: traceId,
    eventName: "speech.web_recording.stored",
    payload: {
      artifactId,
      mimeType: params.mimeType ?? null,
      storageKey,
    },
  });

  const transcription = await transcribeAudioFile({
    config: params.config,
    filePath: storagePath,
    mimeType: params.mimeType ?? null,
  });

  if (!transcription) {
    throw new Error("Local STT service is unavailable.");
  }

  await updateSpeechArtifact({
    dbClient: params.dbClient,
    artifactId,
    status: "transcribed",
    durationMs: transcription.durationMs,
    transcriptText: transcription.text,
  });

  await recordSpeechTrace({
    dbClient: params.dbClient,
    conversationId: params.conversationId ?? null,
    parentTraceId: traceId,
    eventName: "speech.web_recording.transcribed",
    payload: {
      artifactId,
      transcriptLength: transcription.text.length,
    },
  });

  const persistedTurn = await persistChatTurn({
    config: params.config,
    dbClient: params.dbClient,
    defaultPersonaId: params.defaultPersonaId,
    defaultUserId: params.defaultUserId,
    request: {
      conversationId: params.conversationId ?? undefined,
      channel: "web",
      userId: params.defaultUserId,
      message: {
        text: transcription.text,
        attachments: [
          {
            kind: "audio",
            mimeType: params.mimeType ?? "application/octet-stream",
            storageKey,
          },
        ],
      },
      metadata: {
        requestId: traceId,
      },
    },
    traceId,
  });

  await updateSpeechArtifact({
    dbClient: params.dbClient,
    artifactId,
    conversationId: persistedTurn.response.conversationId,
    messageId: persistedTurn.userMessageId,
  });

  const jobId = await createQueuedMemoryJob({
    dbClient: params.dbClient,
    payload: persistedTurn.memoryPayload,
    traceId,
  });

  try {
    await params.memoryQueue.enqueue(jobId, persistedTurn.memoryPayload);
  } catch (error) {
    await markMemoryJobEnqueueFailed(
      params.dbClient,
      jobId,
      error instanceof Error ? error.message : "Unknown enqueue error",
    );

    throw error;
  }

  return {
    artifactId,
    transcriptText: transcription.text,
    reply: persistedTurn.response as RuntimeChatResponse,
  };
}
