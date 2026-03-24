export type RuntimeChatRequest = {
  conversationId?: string;
  channel: "web" | "telegram";
  userId: string;
  message: {
    text: string;
    attachments?: Array<{
      kind: "audio" | "image" | "file";
      mimeType: string;
      storageKey: string;
    }>;
  };
  metadata?: {
    requestId?: string;
    sourceMessageId?: string;
    telegramChatId?: string;
  };
};

export type RuntimeChatResponse = {
  conversationId: string;
  messageId: string;
  outputText: string;
  traceId: string;
  actions?: Array<{
    kind: "memory_candidate_queued";
    payload: Record<string, string>;
  }>;
};

export type MemoryCandidateJobPayload = {
  conversationId: string;
  messageId: string;
  traceId: string;
  userId: string;
  source: "web" | "telegram";
  text: string;
};

export type ConversationHistoryMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool" | "specialist";
  text: string;
  createdAt: string;
};

export type ConversationHistoryResponse = {
  conversationId: string;
  messages: ConversationHistoryMessage[];
};

export type RuntimeContextMessage = {
  role: "user" | "assistant" | "system" | "tool" | "specialist";
  text: string;
};

export type RuntimeTurnContext = {
  conversationId: string;
  recentMessages: RuntimeContextMessage[];
  userDisplayName?: string;
};

export function createTraceId() {
  return `trace_${crypto.randomUUID()}`;
}

export function createConversationId() {
  return `conv_${crypto.randomUUID()}`;
}

export function createMessageId() {
  return `msg_${crypto.randomUUID()}`;
}

function cleanText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function isGreeting(text: string) {
  return /^(hi|hello|hey|good morning|good afternoon|good evening)\b/i.test(
    text,
  );
}

function isMemoryIntent(text: string) {
  return /\b(remember|note this|save this|don't forget|do not forget)\b/i.test(
    text,
  );
}

function isStatusQuestion(text: string) {
  return /\b(status|what can you do|what do you do|current scope|phase 1)\b/i.test(
    text,
  );
}

function summarizeRecentContext(recentMessages: RuntimeContextMessage[]) {
  const nonSystem = recentMessages.filter((message) => message.role !== "system");
  const lastUserMessage = [...nonSystem]
    .reverse()
    .find((message) => message.role === "user");
  const earlierUserCount = Math.max(
    nonSystem.filter((message) => message.role === "user").length - 1,
    0,
  );

  return {
    earlierUserCount,
    hasPriorContext: nonSystem.length > 1,
    lastUserMessage: lastUserMessage?.text,
  };
}

export function generateSecretaryReply(
  request: RuntimeChatRequest,
  context: RuntimeTurnContext,
) {
  const text = cleanText(request.message.text);
  const lower = text.toLowerCase();
  const { earlierUserCount, hasPriorContext } = summarizeRecentContext(
    context.recentMessages,
  );

  const contextLead = hasPriorContext
    ? `I'm keeping this in the same conversation and I can see ${earlierUserCount} earlier user turn${
        earlierUserCount === 1 ? "" : "s"
      } in context.`
    : "I'm treating this as the start of a new conversation thread.";

  if (isGreeting(text)) {
    return `${contextLead} I'm ready to help with planning, note-taking, and keeping local conversation state during Phase 1.`;
  }

  if (isMemoryIntent(text)) {
    return `${contextLead} I've noted this as something worth carrying forward. In the current Phase 1 build, your message is persisted locally and a memory-candidate job is queued for later processing.`;
  }

  if (isStatusQuestion(text)) {
    return `${contextLead} Right now I can keep our conversation history in PostgreSQL, read that history back into the Desk, and queue placeholder memory work in Redis. Tools, Telegram, voice, and deeper reasoning come later in the plan.`;
  }

  const trimmedPreview =
    text.length > 160 ? `${text.slice(0, 157).trimEnd()}...` : text;
  const questionLead = lower.includes("?")
    ? "You've asked something specific, so I've kept the exact request in the conversation record."
    : "I've captured your latest note in the conversation record.";

  return `${contextLead} ${questionLead} For now my response logic is deterministic rather than model-driven, but I can already preserve the thread and hand this turn off to the memory queue. Latest message: "${trimmedPreview}"`;
}

export function createTurnResponse(
  request: RuntimeChatRequest,
  context: RuntimeTurnContext,
  traceId = createTraceId(),
): RuntimeChatResponse {
  const conversationId = request.conversationId ?? context.conversationId;

  return {
    conversationId,
    messageId: createMessageId(),
    outputText: generateSecretaryReply(request, context),
    traceId,
    actions: [
      {
        kind: "memory_candidate_queued",
        payload: {
          source: request.channel,
          status: "placeholder",
        },
      },
    ],
  };
}
