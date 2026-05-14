import type { AppConfig } from "@secretary/config";
import type { MemoryListResponse, UpdateMemoryRequest } from "@secretary/core-runtime";
import type { FastifyInstance } from "fastify";
import type { Infrastructure } from "../lib/infrastructure.js";
import { listMemories, updateMemory } from "../lib/memory-engine/index.js";

export async function registerMemoriesRoutes(
  app: FastifyInstance,
  _config: AppConfig,
  infrastructure: Infrastructure,
  logger: ReturnType<typeof import("@secretary/observability").createLogger>,
): Promise<void> {
  app.get<{
    Querystring: {
      search?: string;
      type?: string;
      includeSuppressed?: string;
    };
  }>("/runtime/memories", async (request, reply) => {
    try {
      const response: MemoryListResponse = await listMemories(infrastructure.dbClient, {
        search: request.query.search,
        memoryType: request.query.type,
        includeSuppressed: request.query.includeSuppressed === "true",
      });

      return response;
    } catch (error) {
      logger.error("runtime.memories.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load memories.",
      });
    }
  });

  app.patch<{
    Params: {
      memoryId: string;
    };
    Body: UpdateMemoryRequest;
  }>("/runtime/memories/:memoryId", async (request, reply) => {
    try {
      const updated = await updateMemory(
        infrastructure.dbClient,
        request.params.memoryId,
        request.body,
      );

      if (!updated) {
        return reply.status(404).send({
          error: "Memory entry not found.",
        });
      }

      return {
        memory: {
          id: updated.id,
          memoryType: updated.memoryType,
          title: updated.title,
          summary: updated.summary,
          contentText: updated.contentText,
          importanceScore: updated.importanceScore,
          confidenceScore: updated.confidenceScore,
          pinned: updated.pinned,
          suppressed: updated.suppressed,
          sourceKind: updated.sourceKind,
          sourceRef: updated.sourceRef,
          tags: updated.tags ?? [],
          lastAccessedAt: updated.lastAccessedAt?.toISOString() ?? null,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        },
      };
    } catch (error) {
      logger.error("runtime.memory.update_failed", {
        error: error instanceof Error ? error.message : error,
        memoryId: request.params.memoryId,
      });

      return reply.status(500).send({
        error: "Unable to update memory entry.",
      });
    }
  });
}
