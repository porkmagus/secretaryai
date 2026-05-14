import type { AppConfig } from "@secretary/config";
import type { ToolListResponse, UpdateToolRequest } from "@secretary/core-runtime";
import type { FastifyInstance } from "fastify";
import type { Infrastructure } from "../lib/infrastructure.js";
import { listTools, updateTool } from "../lib/tools-runtime.js";

export async function registerToolsRoutes(
  app: FastifyInstance,
  _config: AppConfig,
  infrastructure: Infrastructure,
  logger: ReturnType<typeof import("@secretary/observability").createLogger>,
): Promise<void> {
  app.get("/runtime/tools", async (_, reply) => {
    try {
      const response: ToolListResponse = await listTools(infrastructure.dbClient);
      return response;
    } catch (error) {
      logger.error("runtime.tools.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load tools.",
      });
    }
  });

  app.patch<{
    Params: {
      toolId: string;
    };
    Body: UpdateToolRequest;
  }>("/runtime/tools/:toolId", async (request, reply) => {
    try {
      const tool = await updateTool(infrastructure.dbClient, request.params.toolId, request.body);

      if (!tool) {
        return reply.status(404).send({
          error: "Tool not found.",
        });
      }

      return {
        tool,
      };
    } catch (error) {
      logger.error("runtime.tool.update_failed", {
        error: error instanceof Error ? error.message : error,
        toolId: request.params.toolId,
      });

      return reply.status(500).send({
        error: "Unable to update tool.",
      });
    }
  });
}
