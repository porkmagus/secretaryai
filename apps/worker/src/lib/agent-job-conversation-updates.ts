import type { AppConfig } from "@secretary/config";
import { createMessageId } from "@secretary/core-runtime";
import { activityTraces, conversations, type DbClient, messages } from "@secretary/db";
import { eq } from "drizzle-orm";
import {
  deliverImportantUpdateToEnabledChannels,
  deliverRuntimeMessage,
} from "./channel-delivery.js";
import { attachExternalMessageIdToMessage } from "./chat-persistence.js";

type PostAgentJobConversationUpdateParams = {
  dbClient: DbClient;
  config: AppConfig;
  conversationId: string | null;
  jobId: string;
  eventName: string;
  text: string;
  importance?: "important" | "normal";
  metadataJson?: Record<string, unknown>;
};

export function buildAgentJobLocationHint(jobId: string) {
  return `Open Activity > Jobs and select ${jobId} for the full detail.`;
}

export async function postAgentJobConversationUpdate(params: PostAgentJobConversationUpdateParams) {
  if (!params.conversationId) {
    return null;
  }

  const conversation = await params.dbClient.db.query.conversations.findFirst({
    where: eq(conversations.id, params.conversationId),
  });

  if (!conversation) {
    return null;
  }

  const messageId = createMessageId();

  await params.dbClient.db.transaction(async (tx) => {
    await tx.insert(messages).values({
      id: messageId,
      conversationId: conversation.id,
      role: "assistant",
      contentText: params.text,
      contentJson: {
        kind: "agent_job_update",
        jobId: params.jobId,
        eventName: params.eventName,
        importance: params.importance ?? "normal",
        ...(params.metadataJson ?? {}),
      },
      channelMessageId: null,
      parentMessageId: null,
    });

    await tx
      .update(conversations)
      .set({
        updatedAt: new Date(),
        lastMessageAt: new Date(),
      })
      .where(eq(conversations.id, conversation.id));

    await tx.insert(activityTraces).values({
      id: createMessageId(),
      traceType: "runtime",
      parentTraceId: null,
      conversationId: conversation.id,
      jobId: params.jobId,
      eventName: params.eventName,
      payloadJson: {
        messageId,
        importance: params.importance ?? "normal",
        ...(params.metadataJson ?? {}),
      },
    });
  });

  if (
    conversation.channelType === "telegram" &&
    conversation.channelRef &&
    params.config.telegram.botToken
  ) {
    try {
      const delivery = await deliverRuntimeMessage({
        dbClient: params.dbClient,
        config: params.config,
        channelType: "telegram",
        conversationId: conversation.id,
        messageId,
        text: params.text,
        importance: params.importance ?? "normal",
        source: "job",
        traceId: createMessageId(),
        recipient: conversation.channelRef,
        ignoreDeliveryPolicy: true,
      });

      if (delivery.delivered && delivery.externalRef) {
        await attachExternalMessageIdToMessage(params.dbClient, messageId, delivery.externalRef);
      }
    } catch {
      // Keep lifecycle updates durable even when an external chat channel is unavailable.
    }
  }

  if ((params.importance ?? "normal") === "important") {
    try {
      await deliverImportantUpdateToEnabledChannels({
        dbClient: params.dbClient,
        config: params.config,
        conversationId: conversation.id,
        messageId,
        text: params.text,
        subject: `Build job update: ${params.jobId}`,
        source: "job",
        traceId: createMessageId(),
      });
    } catch {
      // Important job updates should still remain durable in the conversation even if external delivery fails.
    }
  }

  return {
    conversationId: conversation.id,
    messageId,
  };
}
