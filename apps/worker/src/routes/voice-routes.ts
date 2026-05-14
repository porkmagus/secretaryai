import { writeFile } from "node:fs/promises";
import type { AppConfig } from "@secretary/config";
import type {
  CreateVoiceProfileRequest,
  UpdateVoiceProfileRequest,
  VoicePreviewRequest,
  VoiceProfileListResponse,
} from "@secretary/core-runtime";
import type { FastifyInstance } from "fastify";
import type { Infrastructure } from "../lib/infrastructure.js";
import {
  attachVoiceProfileSample,
  createSpeechArtifact,
  createVoiceProfile,
  getVoiceProfileById,
  listVoiceProfiles,
  recordSpeechTrace,
  updateVoiceProfile,
} from "../lib/speech-runtime.js";
import { createSpeechStorageKey, ensureSpeechStoragePath } from "../lib/speech-storage.js";
import { createVoicePreview } from "../lib/web-speech.js";

export async function registerVoiceRoutes(
  app: FastifyInstance,
  config: AppConfig,
  infrastructure: Infrastructure,
  logger: ReturnType<typeof import("@secretary/observability").createLogger>,
): Promise<void> {
  app.get("/runtime/voice/profiles", async (_, reply) => {
    try {
      const response: VoiceProfileListResponse = await listVoiceProfiles(infrastructure.dbClient);

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

  app.post<{ Body: CreateVoiceProfileRequest }>(
    "/runtime/voice/profiles",
    async (request, reply) => {
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
    },
  );

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
      const profile = await getVoiceProfileById(infrastructure.dbClient, request.params.profileId);

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
        upload.filename
          ?.split(".")
          .pop()
          ?.replace(/[^a-z0-9]/gi, "") || "wav";
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
        error: error instanceof Error ? error.message : "Unable to generate voice preview.",
      });
    }
  });
}
