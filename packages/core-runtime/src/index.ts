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
    telegramChatLabel?: string;
    telegramUserDisplayName?: string;
  };
};

export type RuntimeChatResponse = {
  conversationId: string;
  messageId: string;
  outputText: string;
  traceId: string;
  pendingApproval?: {
    executionId: string;
    toolId: string;
    toolKey: string;
    toolName: string;
    summary: string;
  } | null;
  contextSummary?: {
    memories: RuntimeMemoryContextItem[];
    tasks: RuntimeTaskContextItem[];
    research?: ResearchSpecialistResult;
  };
  actions?: Array<{
    kind:
      | "approval_requested"
      | "memory_candidate_queued"
      | "research_specialist_used"
      | "task_created"
      | "tool_executed";
    payload: Record<string, string>;
  }>;
};

export type MemoryType =
  | "semantic"
  | "episodic"
  | "project"
  | "relationship"
  | "operational";

export type SpeechArtifactKind =
  | "telegram_voice_note"
  | "web_recording"
  | "stt_transcript"
  | "tts_output"
  | "voice_sample";

export type SpeechArtifactStatus =
  | "received"
  | "stored"
  | "transcribed"
  | "synthesized"
  | "failed";

export type MemoryCandidateJobPayload = {
  conversationId: string;
  messageId: string;
  traceId: string;
  userId: string;
  source: "web" | "telegram";
  text: string;
  telegramChatId?: string | null;
};

export type SpeechArtifactRecord = {
  id: string;
  conversationId: string | null;
  messageId: string | null;
  artifactKind: SpeechArtifactKind;
  status: SpeechArtifactStatus;
  storageKey: string;
  mimeType: string | null;
  durationMs: number | null;
  transcriptText: string | null;
  sourceChannel: "telegram" | "web";
  sourceRef: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VoiceProfileRecord = {
  id: string;
  name: string;
  engineId: string;
  sampleStorageKey: string | null;
  sampleMimeType: string | null;
  sampleDurationMs: number | null;
  qualityPreset: string | null;
  speakingStyle: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SpeechArtifactJobPayload = {
  artifactId: string;
  conversationId: string;
  sourceChannel: "telegram" | "web";
  traceId: string;
  voiceReplyRequested: boolean;
};

export type VoiceProfileListResponse = {
  profiles: VoiceProfileRecord[];
};

export type SpeechArtifactListResponse = {
  artifacts: SpeechArtifactRecord[];
};

export type SpeechServiceStatusResponse = {
  services: {
    ffmpeg: {
      available: boolean;
      configuredPath: string | null;
      summary: string;
    };
    stt: {
      configured: boolean;
      healthStatus: "ok" | "degraded" | "not_configured";
      summary: string;
      url: string | null;
    };
    tts: {
      configured: boolean;
      healthStatus: "ok" | "degraded" | "not_configured";
      summary: string;
      url: string | null;
    };
  };
};

export type ToolApprovalMode = "always_allow" | "ask_first" | "deny";
export type ToolApprovalState =
  | "not_required"
  | "pending"
  | "approved"
  | "denied"
  | "policy_denied";
export type ToolExecutionStatus =
  | "awaiting_approval"
  | "completed"
  | "denied"
  | "failed";

export type ToolRecord = {
  id: string;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  approvalMode: ToolApprovalMode;
  healthStatus: string;
  createdAt: string;
  updatedAt: string;
};

export type ToolExecutionRecord = {
  id: string;
  toolId: string;
  toolKey: string;
  toolName: string;
  conversationId: string | null;
  requestedBy: string;
  executionStatus: ToolExecutionStatus;
  approvalState: ToolApprovalState;
  requestJson: Record<string, unknown>;
  responseJson: Record<string, unknown> | null;
  summary: string;
  errorText: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ToolListResponse = {
  tools: ToolRecord[];
};

export type ToolExecutionListResponse = {
  executions: ToolExecutionRecord[];
};

export type UpdateToolRequest = {
  approvalMode?: ToolApprovalMode;
  enabled?: boolean;
};

export type ToolApprovalDecisionResponse = {
  execution: ToolExecutionRecord;
  conversationId: string | null;
  assistantMessage:
    | {
        id: string;
        text: string;
      }
    | null;
};

export type PersonaSettingsRecord = {
  id: string;
  name: string;
  promptTemplate: string;
  toneMode: string | null;
  behaviorRules: string[];
  voiceProfileId: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PersonaSettingsResponse = {
  persona: PersonaSettingsRecord;
  voiceProfiles: VoiceProfileRecord[];
};

export type UpdatePersonaSettingsRequest = {
  name?: string;
  promptTemplate?: string;
  toneMode?: string | null;
  behaviorRules?: string[];
  voiceProfileId?: string | null;
};

export type SystemHealthResponse = {
  generatedAt: string;
  services: {
    worker: {
      status: "ok";
      summary: string;
    };
    postgres: {
      status: "ok" | "degraded";
      summary: string;
    };
    redis: {
      status: "ok" | "degraded";
      summary: string;
    };
    telegram: {
      status: "ok" | "degraded" | "not_configured";
      summary: string;
    };
    stt: {
      status: "ok" | "degraded" | "not_configured";
      summary: string;
    };
    tts: {
      status: "ok" | "degraded" | "not_configured";
      summary: string;
    };
    ffmpeg: {
      status: "ok" | "degraded";
      summary: string;
    };
  };
  storage: Array<{
    label: string;
    path: string;
    exists: boolean;
  }>;
  stats: {
    conversations: number;
    memories: number;
    messages: number;
    tasks: number;
    toolExecutions: number;
    voiceProfiles: number;
  };
};

export type OnboardingStatusResponse = {
  generatedAt: string;
  completedSteps: number;
  totalSteps: number;
  steps: Array<{
    id: string;
    title: string;
    status: "complete" | "attention" | "not_started";
    detail: string;
    href: string;
  }>;
};

export type SettingsExportSnapshot = {
  userDefaultPersonaId: string | null;
  personas: PersonaSettingsRecord[];
  integrations: Array<{
    id: string;
    integrationType: string;
    enabled: boolean;
    configJson: Record<string, unknown>;
    healthStatus: string;
  }>;
  tools: Array<{
    id: string;
    key: string;
    enabled: boolean;
    approvalMode: ToolApprovalMode;
  }>;
  voiceProfiles: VoiceProfileRecord[];
};

export type SettingsExportResponse = {
  exportedAt: string;
  snapshot: SettingsExportSnapshot;
};

export type SettingsImportRequest = {
  snapshot: SettingsExportSnapshot;
};

export type SettingsImportResponse = {
  importedAt: string;
  persona: PersonaSettingsRecord;
};

export type CreateVoiceProfileRequest = {
  name: string;
  engineId: string;
  qualityPreset?: string | null;
  speakingStyle?: string | null;
  isActive?: boolean;
};

export type UpdateVoiceProfileRequest = {
  name?: string;
  engineId?: string;
  qualityPreset?: string | null;
  speakingStyle?: string | null;
  isActive?: boolean;
};

export type VoicePreviewRequest = {
  text: string;
  profileId?: string | null;
};

export type VoicePreviewResponse = {
  artifactId: string;
  mimeType: string;
};

export type WebSpeechTurnResponse = {
  artifactId: string;
  transcriptText: string;
  reply: RuntimeChatResponse;
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

export type ConversationListItem = {
  id: string;
  title: string | null;
  status: string;
  channelType: string;
  lastMessageAt: string;
  messageCount: number;
  lastMessagePreview: string | null;
};

export type ConversationListResponse = {
  conversations: ConversationListItem[];
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
  deliveredAt: string | null;
  deliveryChannelType: string | null;
  deliveryTargetRef: string | null;
  lastDeliveryError: string | null;
};

export type TaskListResponse = {
  tasks: TaskRecord[];
};

export type TelegramIntegrationStatusResponse = {
  integration: {
    enabled: boolean;
    envConfigured: boolean;
    botConfigured: boolean;
    healthStatus: string;
    healthSummary: string;
    lastCheckedAt: string | null;
    lastError: string | null;
    webhookUrl: string | null;
    desiredWebhookUrl: string | null;
    pendingUpdateCount: number | null;
    defaultChatId: string | null;
    botUser:
      | {
          id: string;
          username: string | null;
          displayName: string;
        }
      | null;
    conversationCount: number;
    messageCount: number;
    dueReminderCount: number;
    deliveredReminderCount: number;
  };
};

export type UpdateTelegramIntegrationRequest = {
  enabled?: boolean;
  webhookUrl?: string | null;
  defaultChatId?: string | null;
};

export type TelegramTestMessageRequest = {
  chatId?: string | null;
  text?: string | null;
};

export type TelegramTestMessageResponse = {
  ok: boolean;
  chatId: string;
  sentMessageIds: string[];
};

export type TelegramSyncWebhookResponse = {
  ok: boolean;
  webhookUrl: string | null;
};

export type TelegramReminderDispatchResponse = {
  scanned: number;
  delivered: number;
  failed: number;
  taskIds: string[];
  errors: string[];
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
