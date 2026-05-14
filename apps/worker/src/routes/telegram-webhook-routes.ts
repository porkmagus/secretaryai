import type { AppConfig } from "@secretary/config";
import type { TelegramUpdate } from "@secretary/integrations";
import type { FastifyInstance } from "fastify";
import type { Infrastructure } from "../lib/infrastructure.js";
import { handleTelegramWebhookUpdate } from "../lib/telegram-integration.js";

export async function registerTelegramWebhookRoutes(
  app: FastifyInstance,
  config: AppConfig,
  infrastructure: Infrastructure,
  logger: ReturnType<typeof import("@secretary/observability").createLogger>,
): Promise<void> {
  app.post<{ Body: TelegramUpdate }>("/integrations/telegram/webhook", async (request, reply) => {
    const expectedSecret = config.telegram.webhookSecret;
    const receivedSecret = request.headers["x-telegram-bot-api-secret-token"];

    if (expectedSecret && receivedSecret !== expectedSecret) {
      return reply.status(403).send({
        error: "Invalid Telegram webhook secret.",
      });
    }

    try {
      const result = await handleTelegramWebhookUpdate({
        config,
        infrastructure,
        update: request.body,
      });

      return {
        ok: true,
        ...result,
      };
    } catch (error) {
      logger.error("integrations.telegram.webhook_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to process Telegram webhook event.",
      });
    }
  });
}
