import type { AppConfig } from "@secretary/config";
import type { ActivityTraceResponse } from "@secretary/core-runtime";
import type { FastifyInstance } from "fastify";
import type { Infrastructure } from "../lib/infrastructure.js";
import { getConversationActivity } from "../lib/memory-engine.js";

export async function registerActivityRoutes(
  app: FastifyInstance,
  _config: AppConfig,
  infrastructure: Infrastructure,
  logger: ReturnType<typeof import("@secretary/observability").createLogger>,
): Promise<void> {
  app.get<{
    Params: {
      conversationId: string;
    };
  }>("/runtime/activity/:conversationId", async (request, reply) => {
    try {
      const response: ActivityTraceResponse = await getConversationActivity(
        infrastructure.dbClient,
        request.params.conversationId,
      );

      return response;
    } catch (error) {
      logger.error("runtime.activity.failed", {
        conversationId: request.params.conversationId,
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load activity traces.",
      });
    }
  });
}
