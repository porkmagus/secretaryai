import type { AppConfig } from "@secretary/config";
import type {
  SettingsExportResponse,
  SettingsImportRequest,
  SettingsImportResponse,
} from "@secretary/core-runtime";
import type { FastifyInstance } from "fastify";
import { exportSettingsSnapshot, importSettingsSnapshot } from "../lib/admin-runtime-core/index.js";
import type { Infrastructure } from "../lib/infrastructure.js";

export async function registerSettingsRoutes(
  app: FastifyInstance,
  config: AppConfig,
  infrastructure: Infrastructure,
  logger: ReturnType<typeof import("@secretary/observability").createLogger>,
): Promise<void> {
  app.get("/runtime/export/settings", async (_, reply) => {
    try {
      const response: SettingsExportResponse = await exportSettingsSnapshot({
        config,
        dbClient: infrastructure.dbClient,
      });

      return response;
    } catch (error) {
      logger.error("runtime.export.settings_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to export settings snapshot.",
      });
    }
  });

  app.post<{ Body: SettingsImportRequest }>("/runtime/import/settings", async (request, reply) => {
    try {
      const response: SettingsImportResponse = await importSettingsSnapshot({
        config,
        dbClient: infrastructure.dbClient,
        request: request.body,
      });

      return response;
    } catch (error) {
      logger.error("runtime.import.settings_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to import settings snapshot.",
      });
    }
  });
}
