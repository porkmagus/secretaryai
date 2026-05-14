import type { AppConfig } from "@secretary/config";
import type {
  ConversationHistoryResponse,
  ConversationListResponse,
} from "@secretary/core-runtime";
import type { FastifyInstance } from "fastify";
import { getConversationMessages, listRecentConversations } from "../lib/chat-persistence.js";
import type { Infrastructure } from "../lib/infrastructure.js";

export async function registerConversationsRoutes(
  app: FastifyInstance,
  _config: AppConfig,
  infrastructure: Infrastructure,
  logger: ReturnType<typeof import("@secretary/observability").createLogger>,
): Promise<void> {
  app.get<{
    Params: {
      conversationId: string;
    };
  }>("/runtime/conversations/:conversationId", async (request, reply) => {
    try {
      const storedMessages = await getConversationMessages(
        infrastructure.dbClient,
        request.params.conversationId,
      );

      const response: ConversationHistoryResponse = {
        conversationId: request.params.conversationId,
        messages: storedMessages.map((message) => ({
          id: message.id,
          role: message.role as "assistant" | "specialist" | "system" | "tool" | "user",
          text: message.contentText,
          createdAt: message.createdAt.toISOString(),
        })),
      };

      return response;
    } catch (error) {
      logger.error("runtime.conversation.failed", {
        conversationId: request.params.conversationId,
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load conversation history.",
      });
    }
  });

  app.get("/runtime/conversations", async (_, reply) => {
    try {
      const response: ConversationListResponse = await listRecentConversations(
        infrastructure.dbClient,
      );

      return response;
    } catch (error) {
      logger.error("runtime.conversations.failed", {
        error: error instanceof Error ? error.message : error,
      });

      return reply.status(500).send({
        error: "Unable to load conversations.",
      });
    }
  });
}
