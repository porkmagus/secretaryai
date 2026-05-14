import type { AppConfig } from "@secretary/config";
import type {
  InferenceModelListResponse,
  InferenceProviderId,
  InferenceSettingsResponse,
  UpdateInferenceSettingsRequest,
} from "@secretary/core-runtime";
import type { FastifyInstance } from "fastify";
import {
  listInferenceModels,
  loadInferenceSettings,
  updateInferenceSettings,
} from "../lib/inference-settings.js";
import type { Infrastructure } from "../lib/infrastructure.js";

export async function registerInferenceRoutes(
  app: FastifyInstance,
  _config: AppConfig,
  _infrastructure: Infrastructure,
  logger: ReturnType<typeof import("@secretary/observability").createLogger>,
): Promise<void> {
  app.get("/runtime/inference", async (_, reply) => {
    try {
      const response: InferenceSettingsResponse = await loadInferenceSettings();
      return response;
    } catch (error) {
      logger.error("runtime.inference.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load inference settings.",
      });
    }
  });

  app.patch<{ Body: UpdateInferenceSettingsRequest }>(
    "/runtime/inference",
    async (request, reply) => {
      try {
        const response: InferenceSettingsResponse = await updateInferenceSettings({
          request: request.body,
        });

        return response;
      } catch (error) {
        logger.error("runtime.inference.update_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error: "Unable to update inference settings.",
        });
      }
    },
  );

  app.get<{
    Querystring: {
      providerId?: string;
    };
  }>("/runtime/inference/models", async (request, reply) => {
    try {
      const response: InferenceModelListResponse = await listInferenceModels(
        request.query.providerId as InferenceProviderId | undefined,
      );
      return response;
    } catch (error) {
      logger.error("runtime.inference.models_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: error instanceof Error ? error.message : "Unable to fetch inference models.",
      });
    }
  });
}
