import { readFile, writeFile } from "node:fs/promises";
import type { AppConfig } from "@secretary/config";
import type {
  PersonaSettingsResponse,
  UpdatePersonaSettingsRequest,
} from "@secretary/core-runtime";
import type { FastifyInstance } from "fastify";
import {
  getPersonaSettings,
  updatePersonaAvatar,
  updatePersonaSettings,
} from "../lib/admin-runtime-core/index.js";
import type { Infrastructure } from "../lib/infrastructure.js";
import {
  createPersonaAvatarStorageKey,
  ensurePersonaStoragePath,
  resolveManagedPersonaStoragePath,
} from "../lib/persona-soul.js";

export async function registerPersonaRoutes(
  app: FastifyInstance,
  config: AppConfig,
  infrastructure: Infrastructure,
  logger: ReturnType<typeof import("@secretary/observability").createLogger>,
): Promise<void> {
  app.get("/runtime/persona", async (_, reply) => {
    try {
      const response: PersonaSettingsResponse = await getPersonaSettings(
        infrastructure.dbClient,
        config,
      );

      return response;
    } catch (error) {
      logger.error("runtime.persona.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load persona settings.",
      });
    }
  });

  app.patch<{ Body: UpdatePersonaSettingsRequest }>("/runtime/persona", async (request, reply) => {
    try {
      const response: PersonaSettingsResponse = await updatePersonaSettings({
        dbClient: infrastructure.dbClient,
        config,
        request: request.body,
      });

      return response;
    } catch (error) {
      logger.error("runtime.persona.update_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to update persona settings.",
      });
    }
  });

  app.get<{
    Querystring: {
      storageKey?: string;
      mimeType?: string;
    };
  }>("/runtime/persona/avatar/file", async (request, reply) => {
    try {
      if (!request.query.storageKey) {
        return reply.status(400).send({
          error: "storageKey is required.",
        });
      }

      const storagePath = resolveManagedPersonaStoragePath(request.query.storageKey);
      const imageBuffer = await readFile(storagePath);

      reply.header("Content-Type", request.query.mimeType ?? "application/octet-stream");
      return reply.send(imageBuffer);
    } catch (error) {
      logger.error("runtime.persona.avatar_file_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(404).send({
        error: "Secretary portrait is unavailable.",
      });
    }
  });

  app.post("/runtime/persona/avatar", async (request, reply) => {
    try {
      const upload = await request.file();

      if (!upload) {
        return reply.status(400).send({
          error: "Portrait image is required.",
        });
      }

      if (!["image/jpeg", "image/png", "image/webp"].includes(upload.mimetype)) {
        return reply.status(400).send({
          error: "Portrait images must be JPG, PNG, or WebP.",
        });
      }

      const imageBuffer = await upload.toBuffer();

      if (imageBuffer.byteLength > 5 * 1024 * 1024) {
        return reply.status(400).send({
          error: "Portrait images must be 5 MB or smaller.",
        });
      }

      const extension =
        upload.filename
          ?.split(".")
          .pop()
          ?.replace(/[^a-z0-9]/gi, "") ||
        (upload.mimetype === "image/png"
          ? "png"
          : upload.mimetype === "image/webp"
            ? "webp"
            : "jpg");
      const storageKey = createPersonaAvatarStorageKey(
        `${Date.now()}-secretary-portrait.${extension}`,
      );
      const storagePath = await ensurePersonaStoragePath(storageKey);
      await writeFile(storagePath, imageBuffer);

      const response: PersonaSettingsResponse = await updatePersonaAvatar({
        dbClient: infrastructure.dbClient,
        config,
        storageKey,
        mimeType: upload.mimetype,
      });

      return response;
    } catch (error) {
      logger.error("runtime.persona.avatar_update_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to update the secretary portrait.",
      });
    }
  });
}
