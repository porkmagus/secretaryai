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
  contextSummary?: {
    memories: RuntimeMemoryContextItem[];
    tasks: RuntimeTaskContextItem[];
    research?: ResearchSpecialistResult;
  };
  actions?: Array<{
    kind: "memory_candidate_queued" | "research_specialist_used";
    payload: Record<string, string>;
  }>;
};

export type MemoryType =
  | "semantic"
  | "episodic"
  | "project"
  | "relationship"
  | "operational";

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

export type RuntimeMemoryContextItem = {
  id: string;
  memoryType: MemoryType;
  title: string | null;
  summary: string | null;
  contentText: string;
  importanceScore: number;
  confidenceScore: number;
  pinned: boolean;
  sourceRef: string | null;
  tags: string[];
};

export type RuntimeTaskContextItem = {
  id: string;
  title: string;
  detail: string | null;
  status: string;
  dueAt: string | null;
  reminderAt: string | null;
};

export type ResearchSpecialistResult = {
  specialist: "research";
  mode: "comparison" | "research_brief";
  summary: string;
  focusAreas: string[];
  suggestedNextStep: string | null;
};

export type RuntimeTurnContext = {
  conversationId: string;
  recentMessages: RuntimeContextMessage[];
  userDisplayName?: string;
  relevantMemories: RuntimeMemoryContextItem[];
  activeTasks: RuntimeTaskContextItem[];
  researchResult?: ResearchSpecialistResult | null;
};

export type MemoryRecord = {
  id: string;
  memoryType: MemoryType;
  title: string | null;
  summary: string | null;
  contentText: string;
  importanceScore: number;
  confidenceScore: number;
  pinned: boolean;
  suppressed: boolean;
  sourceKind: string | null;
  sourceRef: string | null;
  tags: string[];
  lastAccessedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MemoryListResponse = {
  memories: MemoryRecord[];
};

export type UpdateMemoryRequest = {
  title?: string | null;
  summary?: string | null;
  contentText?: string;
  memoryType?: MemoryType;
  pinned?: boolean;
  suppressed?: boolean;
  tags?: string[];
};

export type ActivityTraceRecord = {
  id: string;
  traceType: string;
  eventName: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type ActivityTraceResponse = {
  conversationId: string;
  traces: ActivityTraceRecord[];
};

export type TaskRecord = {
  id: string;
  title: string;
  detail: string | null;
  status: string;
  dueAt: string | null;
  reminderAt: string | null;
};

export type TaskListResponse = {
  tasks: TaskRecord[];
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
  return /\b(remember (?:that|this)|please remember|note this|save this|don't forget|do not forget)\b/i.test(
    text,
  );
}

function isStatusQuestion(text: string) {
  return /\b(status|what can you do|what do you do|current scope|phase 1)\b/i.test(
    text,
  );
}

function isResearchIntent(text: string) {
  return /\b(research|compare|comparison|look up|investigate|options|tradeoffs|pros and cons)\b/i.test(
    text,
  );
}

function isMemoryRecallIntent(text: string) {
  return /\b(what do you remember|what do you know about|remind me what|based on what you remember)\b/i.test(
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
  const relevantMemories = context.relevantMemories.slice(0, 3);
  const activeTasks = context.activeTasks.slice(0, 3);

  const contextLead = hasPriorContext
    ? `I'm keeping this in the same conversation and I can see ${earlierUserCount} earlier user turn${
        earlierUserCount === 1 ? "" : "s"
      } in context.`
    : "I'm treating this as the start of a new conversation thread.";
  const memoryLead =
    relevantMemories.length > 0
      ? `Relevant memory in play: ${relevantMemories
          .map((memory) => memory.title ?? memory.summary ?? memory.contentText)
          .join(" | ")}.`
      : "I don't have a strong stored memory match for this turn yet.";
  const taskLead =
    activeTasks.length > 0
      ? `Open reminders/tasks: ${activeTasks.map((task) => task.title).join(", ")}.`
      : "";

  if (context.researchResult) {
    const focus = context.researchResult.focusAreas.length > 0
      ? ` Focus areas: ${context.researchResult.focusAreas.join(", ")}.`
      : "";
    const nextStep = context.researchResult.suggestedNextStep
      ? ` Suggested next step: ${context.researchResult.suggestedNextStep}.`
      : "";

    return `${contextLead} I delegated an internal research pass before responding. ${context.researchResult.summary}.${focus}${nextStep}`;
  }

  if (isGreeting(text)) {
    return `${contextLead} ${memoryLead} I'm ready to help with planning, note-taking, and carrying memory forward between conversations.`;
  }

  if (isMemoryRecallIntent(text)) {
    return `${contextLead} ${memoryLead} ${taskLead}`.trim();
  }

  if (isMemoryIntent(text)) {
    return `${contextLead} ${memoryLead} I've marked this as something worth carrying forward. Your message is persisted locally and the Memory Specialist queue will turn it into longer-term context.`;
  }

  if (isStatusQuestion(text)) {
    return `${contextLead} ${memoryLead} Right now I can keep conversation history in PostgreSQL, retrieve relevant memory during chat, process memory jobs through Redis, and route structured internal research before composing a reply.`;
  }

  const trimmedPreview =
    text.length > 160 ? `${text.slice(0, 157).trimEnd()}...` : text;
  const questionLead = lower.includes("?")
    ? "You've asked something specific, so I've kept the exact request in the conversation record."
    : "I've captured your latest note in the conversation record.";

  const memoryAwareLead =
    relevantMemories.length > 0 || activeTasks.length > 0
      ? `${memoryLead} ${taskLead}`.trim()
      : "I'm responding from the current thread without a strong long-term memory match yet.";
  const researchLead = isResearchIntent(text)
    ? "This request looks research-shaped, so a delegated research pass would be appropriate."
    : "";

  return `${contextLead} ${memoryAwareLead} ${questionLead} ${researchLead} Latest message: "${trimmedPreview}"`.trim();
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
    contextSummary: {
      memories: context.relevantMemories,
      tasks: context.activeTasks,
      research: context.researchResult ?? undefined,
    },
    actions: [
      {
        kind: "memory_candidate_queued",
        payload: {
          source: request.channel,
          status: "queued",
        },
      },
      ...(context.researchResult
        ? [
            {
              kind: "research_specialist_used" as const,
              payload: {
                mode: context.researchResult.mode,
                specialist: context.researchResult.specialist,
              },
            },
          ]
        : []),
    ],
  };
}
