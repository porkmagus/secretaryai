import type { AppConfig } from "@secretary/config";
import type { FastifyInstance } from "fastify";
import type { Infrastructure } from "../lib/infrastructure.js";

export async function registerHealthRoutes(
  app: FastifyInstance,
  _config: AppConfig,
  infrastructure: Infrastructure,
  _logger: ReturnType<typeof import("@secretary/observability").createLogger>,
): Promise<void> {
  app.get("/health/live", async () => ({
    ok: true,
    service: "worker",
  }));

  app.get("/health/ready", async (_, reply) => {
    const dependencies = await infrastructure.checkHealth();
    const ok = dependencies.postgres === "ok" && dependencies.redis === "ok";

    return reply.status(ok ? 200 : 503).send({
      ok,
      service: "worker",
      dependencies,
    });
  });
}
