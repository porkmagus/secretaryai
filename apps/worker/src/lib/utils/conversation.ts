import type { RuntimeChatRequest } from "@secretary/core-runtime";
import type { DbClient } from "@secretary/db";
import { findConversationIdByChannelRef } from "../chat-persistence.js";

/**
 * Resolve conversation ID from request, handling both explicit IDs and channel refs.
 * Used across multiple handlers (tool approvals, job launches, requirements).
 */
export async function resolveConversationId(
  dbClient: DbClient,
  request: RuntimeChatRequest,
): Promise<string | null> {
  if (request.conversationId) {
    return request.conversationId;
  }

  if (request.channel === "telegram" && request.metadata?.telegramChatId) {
    return findConversationIdByChannelRef(dbClient, "telegram", request.metadata.telegramChatId);
  }

  return null;
}
