import { and, asc, desc, eq, isNull, lte, or, not } from "drizzle-orm";
import type { AppConfig } from "@secretary/config";
import {
  activityTraces,
  integrations,
  tasks,
  type DbClient,
} from "@secretary/db";
import {
  createMessageId,
  type OutboundChannelKey,
  type TelegramReminderDispatchResponse,
} from "@secretary/core-runtime";
import {
  sendConfiguredDiscordMessage,
  sendConfiguredEmail,
  sendConfiguredSlackMessage,
  sendConfiguredSmsMessage,
} from "./outbound-channel-integrations.js";
import { maybeDeliverTelegramAssistantMessage } from "./telegram-integration.js";

type DeliverySource = "heartbeat" | "job" | "task";

type DeliverRuntimeMessageParams = {
  dbClient: DbClient;
  config: AppConfig;
  channelType: "telegram" | OutboundChannelKey;
  text: string;
  subject?: string | null;
  recipient?: string | null;
  targetLabel?: string | null;
  conversationId: string | null;
  messageId: string | null;
  importance: "important" | "normal";
  source: DeliverySource;
  traceId: string;
  ignoreDeliveryPolicy?: boolean;
};

function buildRecordTitle(params: {
  source: DeliverySource;
  channelType: "telegram" | OutboundChannelKey;
  importance: "important" | "normal";
}) {
  return `${params.source}.${params.channelType}.${params.importance}`;
}

async function recordDeliveryTrace(params: {
  dbClient: DbClient;
  conversationId: string | null;
  eventName: string;
  parentTraceId: string;
  payload: Record<string, unknown>;
}) {
  await params.dbClient.db.insert(activityTraces).values({
    id: createMessageId(),
    traceType: "integration",
    parentTraceId: params.parentTraceId,
    conversationId: params.conversationId,
    jobId: null,
    eventName: params.eventName,
    payloadJson: params.payload,
  });
}

async function listEnabledOutboundChannels(
  dbClient: DbClient,
): Promise<OutboundChannelKey[]> {
  const rows = await dbClient.db.query.integrations.findMany({
    where: and(
      eq(integrations.enabled, true),
      or(
        eq(integrations.integrationType, "discord"),
        eq(integrations.integrationType, "slack"),
        eq(integrations.integrationType, "email"),
        eq(integrations.integrationType, "sms"),
      ),
    ),
    orderBy: [asc(integrations.integrationType)],
  });

  return rows
    .map((row) => row.integrationType)
    .filter((value): value is OutboundChannelKey =>
      value === "discord" || value === "slack" || value === "email" || value === "sms",
    );
}

async function resolveStoredRecipient(params: {
  dbClient: DbClient;
  channelType: "email" | "sms";
}) {
  const record = await params.dbClient.db.query.integrations.findFirst({
    where: eq(integrations.id, params.channelType),
  });

  const configJson = record?.configJson ?? null;
  const candidate =
    typeof configJson?.defaultRecipient === "string" && configJson.defaultRecipient.trim()
      ? configJson.defaultRecipient.trim()
      : null;

  return candidate;
}

export async function deliverRuntimeMessage(
  params: DeliverRuntimeMessageParams,
) {
  switch (params.channelType) {
    case "telegram": {
      const delivery = await maybeDeliverTelegramAssistantMessage({
        dbClient: params.dbClient,
        config: params.config,
        conversationId: params.conversationId,
        messageId: params.messageId,
        text: params.text,
        importance: params.importance,
        source: params.source === "task" ? "web" : params.source,
        traceId: params.traceId,
        forceChatId: params.recipient ?? null,
        ignoreDeliveryPolicy: params.ignoreDeliveryPolicy,
      });

      return {
        delivered: delivery.delivered,
        reason: delivery.delivered ? null : delivery.reason,
        externalRef: delivery.delivered ? delivery.sentMessageIds[0] ?? null : null,
        deliveredTo: delivery.delivered ? delivery.chatId : params.recipient ?? null,
      } as const;
    }
    case "discord": {
      await sendConfiguredDiscordMessage({
        config: params.config,
        dbClient: params.dbClient,
        text: params.text,
      });
      await recordDeliveryTrace({
        dbClient: params.dbClient,
        conversationId: params.conversationId,
        parentTraceId: params.traceId,
        eventName: "discord.delivery.sent",
        payload: {
          kind: buildRecordTitle(params),
          targetLabel: params.targetLabel,
        },
      });
      return {
        delivered: true,
        reason: null,
        externalRef: null,
        deliveredTo: params.targetLabel ?? "Configured Discord webhook",
      } as const;
    }
    case "slack": {
      await sendConfiguredSlackMessage({
        config: params.config,
        dbClient: params.dbClient,
        text: params.text,
      });
      await recordDeliveryTrace({
        dbClient: params.dbClient,
        conversationId: params.conversationId,
        parentTraceId: params.traceId,
        eventName: "slack.delivery.sent",
        payload: {
          kind: buildRecordTitle(params),
          targetLabel: params.targetLabel,
        },
      });
      return {
        delivered: true,
        reason: null,
        externalRef: null,
        deliveredTo: params.targetLabel ?? "Configured Slack webhook",
      } as const;
    }
    case "email": {
      const delivery = await sendConfiguredEmail({
        config: params.config,
        dbClient: params.dbClient,
        recipient:
          params.recipient ??
          (await resolveStoredRecipient({
            dbClient: params.dbClient,
            channelType: "email",
          })) ??
          params.config.channels.email.defaultTo,
        subject: params.subject?.trim() || "Secretary update",
        text: params.text,
      });
      await recordDeliveryTrace({
        dbClient: params.dbClient,
        conversationId: params.conversationId,
        parentTraceId: params.traceId,
        eventName: "email.delivery.sent",
        payload: {
          kind: buildRecordTitle(params),
          recipient: delivery.recipient,
          messageId: delivery.messageId,
        },
      });
      return {
        delivered: true,
        reason: null,
        externalRef: delivery.messageId,
        deliveredTo: delivery.recipient,
      } as const;
    }
    case "sms": {
      const delivery = await sendConfiguredSmsMessage({
        config: params.config,
        dbClient: params.dbClient,
        recipient:
          params.recipient ??
          (await resolveStoredRecipient({
            dbClient: params.dbClient,
            channelType: "sms",
          })) ??
          params.config.channels.sms.defaultTo,
        text: params.text,
      });
      await recordDeliveryTrace({
        dbClient: params.dbClient,
        conversationId: params.conversationId,
        parentTraceId: params.traceId,
        eventName: "sms.delivery.sent",
        payload: {
          kind: buildRecordTitle(params),
          recipient: delivery.recipient,
          sid: delivery.sid,
        },
      });
      return {
        delivered: true,
        reason: null,
        externalRef: delivery.sid,
        deliveredTo: delivery.recipient,
      } as const;
    }
  }
}

export async function deliverImportantUpdateToEnabledChannels(params: {
  dbClient: DbClient;
  config: AppConfig;
  conversationId: string | null;
  messageId: string | null;
  text: string;
  subject: string;
  source: Exclude<DeliverySource, "task">;
  traceId: string;
}) {
  const channels = await listEnabledOutboundChannels(params.dbClient);
  const results: Array<{ channelType: OutboundChannelKey; delivered: boolean; detail: string | null }> = [];

  for (const channelType of channels) {
    try {
      const delivery = await deliverRuntimeMessage({
        dbClient: params.dbClient,
        config: params.config,
        channelType,
        text: params.text,
        subject: params.subject,
        conversationId: params.conversationId,
        messageId: params.messageId,
        importance: "important",
        source: params.source,
        traceId: params.traceId,
      });
      results.push({
        channelType,
        delivered: delivery.delivered,
        detail: delivery.deliveredTo,
      });
    } catch (error) {
      results.push({
        channelType,
        delivered: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

export async function dispatchDueTaskReminders(params: {
  dbClient: DbClient;
  config: AppConfig;
  channelFilter?: "telegram" | OutboundChannelKey | null;
}) {
  const dueTasks = await params.dbClient.db.query.tasks.findMany({
    where: and(
      params.channelFilter
        ? eq(tasks.deliveryChannelType, params.channelFilter)
        : not(isNull(tasks.deliveryChannelType)),
      not(isNull(tasks.reminderAt)),
      lte(tasks.reminderAt, new Date()),
      isNull(tasks.deliveredAt),
      or(eq(tasks.status, "open"), eq(tasks.status, "in_progress")),
    ),
    orderBy: [asc(tasks.reminderAt), desc(tasks.createdAt)],
    limit: 25,
  });

  const taskIds: string[] = [];
  const errors: string[] = [];
  let delivered = 0;
  let failed = 0;

  for (const task of dueTasks) {
    const channelType = task.deliveryChannelType;
    if (
      channelType !== "telegram" &&
      channelType !== "discord" &&
      channelType !== "slack" &&
      channelType !== "email" &&
      channelType !== "sms"
    ) {
      failed += 1;
      errors.push(`Task ${task.id} uses an unsupported delivery channel.`);
      await params.dbClient.db
        .update(tasks)
        .set({
          lastDeliveryError: "Unsupported delivery channel.",
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, task.id));
      continue;
    }

    const reminderText = [
      `Reminder: ${task.title}`,
      task.detail,
      task.reminderAt ? `Scheduled for ${task.reminderAt.toISOString()}.` : null,
    ]
      .filter(Boolean)
      .join("\n\n");
    const traceId = createMessageId();

    try {
      await deliverRuntimeMessage({
        dbClient: params.dbClient,
        config: params.config,
        channelType,
        text: reminderText,
        subject: `Reminder: ${task.title}`,
        recipient: task.deliveryTargetRef ?? null,
        conversationId: task.conversationId ?? null,
        messageId: null,
        importance: "important",
        source: "task",
        traceId,
        ignoreDeliveryPolicy: true,
      });

      await params.dbClient.db
        .update(tasks)
        .set({
          deliveredAt: new Date(),
          lastDeliveryError: null,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, task.id));

      await recordDeliveryTrace({
        dbClient: params.dbClient,
        conversationId: task.conversationId ?? null,
        parentTraceId: traceId,
        eventName: `${channelType}.reminder.sent`,
        payload: {
          taskId: task.id,
          title: task.title,
          deliveryTargetRef: task.deliveryTargetRef,
        },
      });

      delivered += 1;
      taskIds.push(task.id);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      await params.dbClient.db
        .update(tasks)
        .set({
          lastDeliveryError: errorText,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, task.id));

      await recordDeliveryTrace({
        dbClient: params.dbClient,
        conversationId: task.conversationId ?? null,
        parentTraceId: traceId,
        eventName: `${channelType}.reminder.failed`,
        payload: {
          taskId: task.id,
          title: task.title,
          errorText,
          deliveryTargetRef: task.deliveryTargetRef,
        },
      });

      failed += 1;
      errors.push(`Task ${task.id}: ${errorText}`);
    }
  }

  return {
    scanned: dueTasks.length,
    delivered,
    failed,
    taskIds,
    errors,
  } satisfies TelegramReminderDispatchResponse;
}
