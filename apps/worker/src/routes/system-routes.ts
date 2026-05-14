import type { AppConfig } from "@secretary/config";
import type { OnboardingStatusResponse, SystemHealthResponse } from "@secretary/core-runtime";
import type { FastifyInstance } from "fastify";
import { getOnboardingStatus, getSystemHealth } from "../lib/admin-runtime-core.js";
import type { Infrastructure } from "../lib/infrastructure.js";

export async function registerSystemRoutes(
  app: FastifyInstance,
  config: AppConfig,
  infrastructure: Infrastructure,
  logger: ReturnType<typeof import("@secretary/observability").createLogger>,
): Promise<void> {
  app.get("/runtime/system/health", async (_, reply) => {
    try {
      const response: SystemHealthResponse = await getSystemHealth({
        config,
        infrastructure,
      });

      return response;
    } catch (error) {
      logger.error("runtime.system.health_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load system health.",
      });
    }
  });

  app.get("/runtime/onboarding", async (_, reply) => {
    try {
      const response: OnboardingStatusResponse = await getOnboardingStatus({
        config,
        infrastructure,
      });

      return response;
    } catch (error) {
      logger.error("runtime.onboarding.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load onboarding state.",
      });
    }
  });
}
