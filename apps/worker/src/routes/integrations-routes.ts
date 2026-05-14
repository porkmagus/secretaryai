import type { AppConfig } from "@secretary/config";
import type {
  DiscordTestMessageRequest,
  DiscordTestMessageResponse,
  EmailTestMessageRequest,
  EmailTestMessageResponse,
  HeartbeatIntegrationStatusResponse,
  HeartbeatRunResponse,
  OutboundChannelStatusResponse,
  SlackTestMessageRequest,
  SlackTestMessageResponse,
  SmsTestMessageRequest,
  SmsTestMessageResponse,
  TelegramPresenceUpdateRequest,
  TelegramPresenceUpdateResponse,
  TelegramTestMessageRequest,
  UpdateDiscordIntegrationRequest,
  UpdateEmailIntegrationRequest,
  UpdateHeartbeatIntegrationRequest,
  UpdateSlackIntegrationRequest,
  UpdateSmsIntegrationRequest,
  UpdateTelegramIntegrationRequest,
} from "@secretary/core-runtime";
import type { FastifyInstance } from "fastify";
import { dispatchDueTaskReminders } from "../lib/channel-delivery.js";
import {
  getHeartbeatIntegrationStatus,
  runHeartbeat,
  updateHeartbeatIntegrationSettings,
} from "../lib/heartbeat-runtime.js";
import type { Infrastructure } from "../lib/infrastructure.js";
import {
  getDiscordIntegrationStatus,
  getEmailIntegrationStatus,
  getSlackIntegrationStatus,
  getSmsIntegrationStatus,
  sendDiscordTestMessage,
  sendEmailTestMessage,
  sendSlackTestMessage,
  sendSmsTestMessage,
  updateDiscordIntegrationSettings,
  updateEmailIntegrationSettings,
  updateSlackIntegrationSettings,
  updateSmsIntegrationSettings,
} from "../lib/outbound-channel-integrations.js";
import {
  dispatchDueTelegramReminders,
  getTelegramIntegrationStatus,
  sendTelegramTestMessage,
  syncTelegramWebhook,
  touchTelegramWebPresence,
  updateTelegramIntegrationSettings,
} from "../lib/telegram-integration.js";

export async function registerIntegrationsRoutes(
  app: FastifyInstance,
  config: AppConfig,
  infrastructure: Infrastructure,
  logger: ReturnType<typeof import("@secretary/observability").createLogger>,
): Promise<void> {
  app.get("/runtime/integrations/telegram", async (_, reply) => {
    try {
      return await getTelegramIntegrationStatus(infrastructure.dbClient, config);
    } catch (error) {
      logger.error("runtime.integrations.telegram.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load Telegram integration state.",
      });
    }
  });

  app.patch<{ Body: UpdateTelegramIntegrationRequest }>(
    "/runtime/integrations/telegram",
    async (request, reply) => {
      try {
        return await updateTelegramIntegrationSettings({
          dbClient: infrastructure.dbClient,
          config,
          patch: request.body,
        });
      } catch (error) {
        logger.error("runtime.integrations.telegram.update_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error: "Unable to update Telegram integration settings.",
        });
      }
    },
  );

  app.post("/runtime/integrations/telegram/sync-webhook", async (_, reply) => {
    try {
      return await syncTelegramWebhook({
        dbClient: infrastructure.dbClient,
        config,
      });
    } catch (error) {
      logger.error("runtime.integrations.telegram.sync_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: error instanceof Error ? error.message : "Unable to sync Telegram webhook.",
      });
    }
  });

  app.post<{ Body: TelegramTestMessageRequest }>(
    "/runtime/integrations/telegram/test-message",
    async (request, reply) => {
      try {
        return await sendTelegramTestMessage({
          dbClient: infrastructure.dbClient,
          config,
          request: request.body,
        });
      } catch (error) {
        logger.error("runtime.integrations.telegram.test_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error: error instanceof Error ? error.message : "Unable to send Telegram test message.",
        });
      }
    },
  );

  app.post<{ Body: TelegramPresenceUpdateRequest }>(
    "/runtime/integrations/telegram/presence",
    async (request, reply) => {
      try {
        const response: TelegramPresenceUpdateResponse = await touchTelegramWebPresence({
          dbClient: infrastructure.dbClient,
          config,
          request: request.body,
        });

        return response;
      } catch (error) {
        logger.error("runtime.integrations.telegram.presence_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error: error instanceof Error ? error.message : "Unable to update Telegram presence.",
        });
      }
    },
  );

  app.post("/runtime/integrations/telegram/deliver-reminders", async (_, reply) => {
    try {
      return await dispatchDueTelegramReminders({
        dbClient: infrastructure.dbClient,
        config,
      });
    } catch (error) {
      logger.error("runtime.integrations.telegram.reminders_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: error instanceof Error ? error.message : "Unable to deliver Telegram reminders.",
      });
    }
  });

  app.post("/runtime/integrations/reminders/deliver", async (_, reply) => {
    try {
      return await dispatchDueTaskReminders({
        dbClient: infrastructure.dbClient,
        config,
      });
    } catch (error) {
      logger.error("runtime.integrations.reminders_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: error instanceof Error ? error.message : "Unable to deliver due reminders.",
      });
    }
  });

  app.get("/runtime/integrations/discord", async (_, reply) => {
    try {
      const response: OutboundChannelStatusResponse = await getDiscordIntegrationStatus(
        infrastructure.dbClient,
        config,
      );
      return response;
    } catch (error) {
      logger.error("runtime.integrations.discord.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load Discord integration state.",
      });
    }
  });

  app.patch<{ Body: UpdateDiscordIntegrationRequest }>(
    "/runtime/integrations/discord",
    async (request, reply) => {
      try {
        const response: OutboundChannelStatusResponse = await updateDiscordIntegrationSettings({
          dbClient: infrastructure.dbClient,
          config,
          patch: request.body,
        });
        return response;
      } catch (error) {
        logger.error("runtime.integrations.discord.update_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error: "Unable to update Discord integration settings.",
        });
      }
    },
  );

  app.post<{ Body: DiscordTestMessageRequest }>(
    "/runtime/integrations/discord/test-message",
    async (request, reply) => {
      try {
        const response: DiscordTestMessageResponse = await sendDiscordTestMessage({
          dbClient: infrastructure.dbClient,
          config,
          request: request.body,
        });
        return response;
      } catch (error) {
        logger.error("runtime.integrations.discord.test_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error: error instanceof Error ? error.message : "Unable to send Discord test message.",
        });
      }
    },
  );

  app.get("/runtime/integrations/slack", async (_, reply) => {
    try {
      const response: OutboundChannelStatusResponse = await getSlackIntegrationStatus(
        infrastructure.dbClient,
        config,
      );
      return response;
    } catch (error) {
      logger.error("runtime.integrations.slack.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load Slack integration state.",
      });
    }
  });

  app.patch<{ Body: UpdateSlackIntegrationRequest }>(
    "/runtime/integrations/slack",
    async (request, reply) => {
      try {
        const response: OutboundChannelStatusResponse = await updateSlackIntegrationSettings({
          dbClient: infrastructure.dbClient,
          config,
          patch: request.body,
        });
        return response;
      } catch (error) {
        logger.error("runtime.integrations.slack.update_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error: "Unable to update Slack integration settings.",
        });
      }
    },
  );

  app.post<{ Body: SlackTestMessageRequest }>(
    "/runtime/integrations/slack/test-message",
    async (request, reply) => {
      try {
        const response: SlackTestMessageResponse = await sendSlackTestMessage({
          dbClient: infrastructure.dbClient,
          config,
          request: request.body,
        });
        return response;
      } catch (error) {
        logger.error("runtime.integrations.slack.test_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error: error instanceof Error ? error.message : "Unable to send Slack test message.",
        });
      }
    },
  );

  app.get("/runtime/integrations/email", async (_, reply) => {
    try {
      const response: OutboundChannelStatusResponse = await getEmailIntegrationStatus(
        infrastructure.dbClient,
        config,
      );
      return response;
    } catch (error) {
      logger.error("runtime.integrations.email.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load email integration state.",
      });
    }
  });

  app.patch<{ Body: UpdateEmailIntegrationRequest }>(
    "/runtime/integrations/email",
    async (request, reply) => {
      try {
        const response: OutboundChannelStatusResponse = await updateEmailIntegrationSettings({
          dbClient: infrastructure.dbClient,
          config,
          patch: request.body,
        });
        return response;
      } catch (error) {
        logger.error("runtime.integrations.email.update_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error: "Unable to update email integration settings.",
        });
      }
    },
  );

  app.post<{ Body: EmailTestMessageRequest }>(
    "/runtime/integrations/email/test-message",
    async (request, reply) => {
      try {
        const response: EmailTestMessageResponse = await sendEmailTestMessage({
          dbClient: infrastructure.dbClient,
          config,
          request: request.body,
        });
        return response;
      } catch (error) {
        logger.error("runtime.integrations.email.test_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error: error instanceof Error ? error.message : "Unable to send email test message.",
        });
      }
    },
  );

  app.get("/runtime/integrations/sms", async (_, reply) => {
    try {
      const response: OutboundChannelStatusResponse = await getSmsIntegrationStatus(
        infrastructure.dbClient,
        config,
      );
      return response;
    } catch (error) {
      logger.error("runtime.integrations.sms.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load SMS integration state.",
      });
    }
  });

  app.patch<{ Body: UpdateSmsIntegrationRequest }>(
    "/runtime/integrations/sms",
    async (request, reply) => {
      try {
        const response: OutboundChannelStatusResponse = await updateSmsIntegrationSettings({
          dbClient: infrastructure.dbClient,
          config,
          patch: request.body,
        });
        return response;
      } catch (error) {
        logger.error("runtime.integrations.sms.update_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error: "Unable to update SMS integration settings.",
        });
      }
    },
  );

  app.post<{ Body: SmsTestMessageRequest }>(
    "/runtime/integrations/sms/test-message",
    async (request, reply) => {
      try {
        const response: SmsTestMessageResponse = await sendSmsTestMessage({
          dbClient: infrastructure.dbClient,
          config,
          request: request.body,
        });
        return response;
      } catch (error) {
        logger.error("runtime.integrations.sms.test_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error: error instanceof Error ? error.message : "Unable to send SMS test message.",
        });
      }
    },
  );

  app.get("/runtime/integrations/heartbeat", async (_, reply) => {
    try {
      const response: HeartbeatIntegrationStatusResponse = await getHeartbeatIntegrationStatus(
        infrastructure.dbClient,
        config,
      );
      return response;
    } catch (error) {
      logger.error("runtime.integrations.heartbeat.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load heartbeat integration state.",
      });
    }
  });

  app.patch<{ Body: UpdateHeartbeatIntegrationRequest }>(
    "/runtime/integrations/heartbeat",
    async (request, reply) => {
      try {
        const response: HeartbeatIntegrationStatusResponse =
          await updateHeartbeatIntegrationSettings({
            dbClient: infrastructure.dbClient,
            config,
            patch: request.body,
          });

        return response;
      } catch (error) {
        logger.error("runtime.integrations.heartbeat.update_failed", {
          error: error instanceof Error ? error.message : error,
        });

        return reply.status(500).send({
          error: "Unable to update heartbeat settings.",
        });
      }
    },
  );

  app.post("/runtime/integrations/heartbeat/run", async (_, reply) => {
    try {
      const response: HeartbeatRunResponse = await runHeartbeat({
        config,
        infrastructure,
        reason: "manual",
      });

      return response;
    } catch (error) {
      logger.error("runtime.integrations.heartbeat.run_failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: error instanceof Error ? error.message : "Unable to run heartbeat.",
      });
    }
  });
}
