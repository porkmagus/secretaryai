import { spawn } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import type { AppConfig } from "@secretary/config";
import type { DbClient } from "@secretary/db";
import { createSpeechStorageKey, ensureSpeechStoragePath } from "./speech-storage.js";
import {
  createSpeechArtifact,
  getActiveVoiceProfile,
  recordSpeechTrace,
} from "./speech-runtime.js";
import { synthesizeSpeech } from "./tts-service.js";

function resolveFfmpegCommand() {
  return process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(resolveFfmpegCommand(), args, {
      stdio: "ignore",
      shell: false,
    });

    child.on("error", (error) => {
      rejectPromise(error);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`ffmpeg exited with ${code}`));
    });
  });
}

async function convertWavToTelegramVoice(inputPath: string, outputPath: string) {
  await runFfmpeg([
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-c:a",
    "libopus",
    "-b:a",
    "32k",
    outputPath,
  ]);

  return readFile(outputPath);
}

export async function createTelegramVoiceReply(params: {
  assistantMessageId: string;
  config: AppConfig;
  conversationId: string;
  dbClient: DbClient;
  parentTraceId: string;
  replyText: string;
}) {
  if (!params.config.speech.ttsBaseUrl) {
    return null;
  }

  const activeVoiceProfile = await getActiveVoiceProfile(params.dbClient);
  const engineId = activeVoiceProfile?.engineId ?? "kokoro";
  const synthesis = await synthesizeSpeech({
    config: params.config,
    text: params.replyText,
    engineId,
    language: "en",
    speakerSampleStorageKey: activeVoiceProfile?.sampleStorageKey ?? null,
  });

  if (!synthesis) {
    return null;
  }

  const wavStorageKey = createSpeechStorageKey(
    "tts",
    `${Date.now()}-${params.assistantMessageId}.wav`,
  );
  const wavStoragePath = await ensureSpeechStoragePath(wavStorageKey);
  await writeFile(wavStoragePath, synthesis.audio);

  const artifactId = await createSpeechArtifact({
    dbClient: params.dbClient,
    conversationId: params.conversationId,
    messageId: params.assistantMessageId,
    artifactKind: "tts_output",
    status: "synthesized",
    storageKey: wavStorageKey,
    mimeType: synthesis.mimeType,
    durationMs: synthesis.durationMs,
    transcriptText: params.replyText,
    sourceChannel: "telegram",
    sourceRef: params.assistantMessageId,
    metadataJson: {
      engineId,
      modelName: synthesis.modelName,
      voiceProfileId: activeVoiceProfile?.id ?? null,
    },
  });

  await recordSpeechTrace({
    dbClient: params.dbClient,
    conversationId: params.conversationId,
    parentTraceId: params.parentTraceId,
    eventName: "speech.tts.completed",
    payload: {
      artifactId,
      durationMs: synthesis.durationMs,
      engineId,
      modelName: synthesis.modelName,
      storageKey: wavStorageKey,
    },
  });

  const telegramVoicePath = wavStoragePath.replace(/\.wav$/i, ".ogg");

  try {
    const audio = await convertWavToTelegramVoice(wavStoragePath, telegramVoicePath);

    await recordSpeechTrace({
      dbClient: params.dbClient,
      conversationId: params.conversationId,
      parentTraceId: params.parentTraceId,
      eventName: "speech.tts.telegram_voice_ready",
      payload: {
        artifactId,
        filename: basename(telegramVoicePath),
      },
    });

    return {
      artifactId,
      audio,
      deliveryKind: "voice" as const,
      durationMs: synthesis.durationMs,
      filename: basename(telegramVoicePath),
      mimeType: "audio/ogg",
    };
  } catch (error) {
    await recordSpeechTrace({
      dbClient: params.dbClient,
      conversationId: params.conversationId,
      parentTraceId: params.parentTraceId,
      eventName: "speech.tts.telegram_voice_fallback",
      payload: {
        artifactId,
        error: error instanceof Error ? error.message : String(error),
      },
    });

    return {
      artifactId,
      audio: synthesis.audio,
      deliveryKind: "audio" as const,
      durationMs: synthesis.durationMs,
      filename: basename(wavStoragePath),
      mimeType: synthesis.mimeType ?? "audio/wav",
    };
  } finally {
    await unlink(telegramVoicePath).catch(() => undefined);
  }
}
