import { readFile } from "node:fs/promises";
import type { AppConfig } from "@secretary/config";
import type {
  SpeechArtifactListResponse,
  SpeechServiceStatusResponse,
  WebSpeechTurnResponse,
} from "@secretary/core-runtime";
import type { FastifyInstance } from "fastify";
import type { Infrastructure } from "../lib/infrastructure.js";
import { getSpeechServiceStatus } from "../lib/speech-health.js";
import { listSpeechArtifacts } from "../lib/speech-runtime.js";
import { resolveManagedSpeechStoragePath } from "../lib/speech-storage.js";
import { processWebSpeechTurn } from "../lib/web-speech.js";

export async function registerSpeechRoutes(
  app: FastifyInstance,
  config: AppConfig,
  infrastructure: Infrastructure,
  logger: ReturnType<typeof import("@secretary/observability").createLogger>,
): Promise<void> {
  app.get<{
    Querystring: {
      conversationId?: string;
    };
  }>("/runtime/speech/artifacts", async (request, reply) => {
    try {
      const response: SpeechArtifactListResponse = await listSpeechArtifacts(
        infrastructure.dbClient,
        request.query.conversationId,
      );

      return response;
    } catch (error) {
      logger.error("runtime.speech.artifacts.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load speech artifacts.",
      });
    }
  });

  app.get("/runtime/speech/status", async (_, reply) => {
    try {
      const response: SpeechServiceStatusResponse = await getSpeechServiceStatus(config);
      return response;
    } catch (error) {
      logger.error("runtime.speech.status_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load speech service status.",
      });
    }
  });

  app.get<{
    Querystring: {
      mimeType?: string;
      storageKey: string;
    };
  }>("/runtime/speech/file", async (request, reply) => {
    try {
      const storageKey = request.query.storageKey?.trim();

      if (!storageKey) {
        return reply.status(400).send({
          error: "storageKey is required.",
        });
      }

      const filePath = resolveManagedSpeechStoragePath(storageKey);
      const fileBuffer = await readFile(filePath);
      reply.header("Content-Type", request.query.mimeType?.trim() || "application/octet-stream");

      return reply.send(fileBuffer);
    } catch (error) {
      logger.error("runtime.speech.file_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(404).send({
        error: "Unable to load speech file.",
      });
    }
  });

  app.post("/runtime/speech/web-turn", async (request, reply) => {
    try {
      const upload = await request.file();

      if (!upload) {
        return reply.status(400).send({
          error: "Audio upload is required.",
        });
      }

      if (!upload.mimetype?.startsWith("audio/")) {
        return reply.status(400).send({
          error: "Web speech turns must be uploaded as audio files.",
        });
      }

      const audioBuffer = await upload.toBuffer();

      if (audioBuffer.byteLength > 20 * 1024 * 1024) {
        return reply.status(400).send({
          error: "Web speech audio must be 20 MB or smaller.",
        });
      }

      const conversationField = upload.fields.conversationId;
      const conversationId =
        conversationField &&
        "value" in conversationField &&
        typeof conversationField.value === "string" &&
        conversationField.value.trim().length > 0
          ? conversationField.value.trim()
          : null;
      const response: WebSpeechTurnResponse = await processWebSpeechTurn({
        audio: audioBuffer,
        agentJobQueue: infrastructure.agentJobQueue,
        config,
        conversationId,
        dbClient: infrastructure.dbClient,
        defaultPersonaId: config.defaultPersonaId,
        defaultUserId: config.defaultUserId,
        memoryQueue: infrastructure.memoryQueue,
        mimeType: upload.mimetype,
        originalFilename: upload.filename,
      });

      return response;
    } catch (error) {
      logger.error("runtime.speech.web_turn_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: error instanceof Error ? error.message : "Unable to process web audio turn.",
      });
    }
  });
}
