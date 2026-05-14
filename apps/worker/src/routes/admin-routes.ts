import type { AppConfig } from "@secretary/config";
import type {
  AdminMaintenanceAction,
  AdminMaintenanceActionResponse,
  AdminMaintenanceOverviewResponse,
} from "@secretary/core-runtime";
import type { FastifyInstance } from "fastify";
import {
  getAdminMaintenanceSnapshot,
  runAdminMaintenanceAction,
} from "../lib/admin-runtime-core.js";
import type { Infrastructure } from "../lib/infrastructure.js";

export async function registerAdminRoutes(
  app: FastifyInstance,
  config: AppConfig,
  infrastructure: Infrastructure,
  logger: ReturnType<typeof import("@secretary/observability").createLogger>,
): Promise<void> {
  app.get("/runtime/admin/maintenance", async (_, reply) => {
    try {
      const response: AdminMaintenanceOverviewResponse = await getAdminMaintenanceSnapshot({
        config,
        infrastructure,
      });
      return response;
    } catch (error) {
      logger.error("runtime.admin_maintenance.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load admin maintenance status.",
      });
    }
  });

  app.post<{ Body: { action: AdminMaintenanceAction } }>(
    "/runtime/admin/maintenance",
    async (request, reply) => {
      try {
        const response: AdminMaintenanceActionResponse = await runAdminMaintenanceAction({
          action: request.body.action,
          config,
          infrastructure,
        });
        return response;
      } catch (error) {
        logger.error("runtime.admin_maintenance.action_failed", {
          error: error instanceof Error ? error.message : error,
          action: request.body?.action ?? null,
        });

        return reply.status(500).send({
          error: "Unable to run admin maintenance action.",
        });
      }
    },
  );
}
