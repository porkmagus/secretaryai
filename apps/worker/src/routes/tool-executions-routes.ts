import type { AppConfig } from "@secretary/config";
import {
  createTraceId,
  type ToolApprovalDecisionResponse,
  type ToolExecutionListResponse,
} from "@secretary/core-runtime";
import type { FastifyInstance } from "fastify";
import type { Infrastructure } from "../lib/infrastructure.js";
import { decideToolExecution, listToolExecutions } from "../lib/tools/index.js";

export async function registerToolExecutionsRoutes(
  app: FastifyInstance,
  config: AppConfig,
  infrastructure: Infrastructure,
  logger: ReturnType<typeof import("@secretary/observability").createLogger>,
): Promise<void> {
  app.get<{
    Querystring: {
      approvalState?: string;
      conversationId?: string;
    };
  }>("/runtime/tool-executions", async (request, reply) => {
    try {
      const response: ToolExecutionListResponse = await listToolExecutions({
        approvalState: request.query.approvalState,
        conversationId: request.query.conversationId,
        dbClient: infrastructure.dbClient,
      });

      return response;
    } catch (error) {
      logger.error("runtime.tool_executions.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load tool executions.",
      });
    }
  });

  app.post<{
    Params: {
      executionId: string;
    };
  }>("/runtime/tool-executions/:executionId/approve", async (request, reply) => {
    const traceId = createTraceId();
    try {
      const response: ToolApprovalDecisionResponse | null = await decideToolExecution({
        approve: true,
        config,
        dbClient: infrastructure.dbClient,
        executionId: request.params.executionId,
        traceId,
      });

      if (!response) {
        return reply.status(404).send({
          error: "Tool execution not found.",
        });
      }

      return response;
    } catch (error) {
      logger.error("runtime.tool_execution.approve_failed", {
        error: error instanceof Error ? error.message : error,
        executionId: request.params.executionId,
      });

      return reply.status(500).send({
        error: "Unable to approve tool execution.",
      });
    }
  });

  app.post<{
    Params: {
      executionId: string;
    };
  }>("/runtime/tool-executions/:executionId/deny", async (request, reply) => {
    const traceId = createTraceId();
    try {
      const response: ToolApprovalDecisionResponse | null = await decideToolExecution({
        approve: false,
        config,
        dbClient: infrastructure.dbClient,
        executionId: request.params.executionId,
        traceId,
      });

      if (!response) {
        return reply.status(404).send({
          error: "Tool execution not found.",
        });
      }

      return response;
    } catch (error) {
      logger.error("runtime.tool_execution.deny_failed", {
        error: error instanceof Error ? error.message : error,
        executionId: request.params.executionId,
      });

      return reply.status(500).send({
        error: "Unable to deny tool execution.",
      });
    }
  });
}
