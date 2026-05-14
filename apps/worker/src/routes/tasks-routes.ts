import type { AppConfig } from "@secretary/config";
import type { TaskListResponse } from "@secretary/core-runtime";
import type { FastifyInstance } from "fastify";
import type { Infrastructure } from "../lib/infrastructure.js";
import { listTasksForUser } from "../lib/memory-engine/index.js";

export async function registerTasksRoutes(
  app: FastifyInstance,
  config: AppConfig,
  infrastructure: Infrastructure,
  logger: ReturnType<typeof import("@secretary/observability").createLogger>,
): Promise<void> {
  app.get("/runtime/tasks", async (_, reply) => {
    try {
      const response: TaskListResponse = await listTasksForUser(
        infrastructure.dbClient,
        config.defaultUserId,
      );

      return response;
    } catch (error) {
      logger.error("runtime.tasks.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load tasks.",
      });
    }
  });
}
