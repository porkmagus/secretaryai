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

export type RuntimeChatStreamRequest = {
  conversationId?: string;
  messageId?: string;
  text?: string;
};

export type DeskChatMessageMetadata = {
  conversationId: string;
  traceId: string;
  replyMode: "model" | "fallback" | "tool";
  model: string | null;
  providerError: string | null;
  pendingApproval?: RuntimeChatResponse["pendingApproval"] | null;
  contextSummary: {
    memories: RuntimeMemoryContextItem[];
    tasks: RuntimeTaskContextItem[];
    research?: ResearchSpecialistResult;
  };
  totalTokens?: number;
};

export type MemoryType = "semantic" | "episodic" | "project" | "relationship" | "operational";

export type SpeechArtifactKind =
  | "telegram_voice_note"
  | "web_recording"
  | "stt_transcript"
  | "tts_output"
  | "voice_sample";

export type SpeechArtifactStatus = "received" | "stored" | "transcribed" | "synthesized" | "failed";

export type MemoryCandidateJobPayload = {
  conversationId: string;
  messageId: string;
  traceId: string;
  userId: string;
  source: "web" | "telegram";
  text: string;
  telegramChatId?: string | null;
  inference?: {
    selectedProviderId: string;
    baseUrl: string;
    model: string;
    apiKey: string;
    maxOutputTokens?: string | null;
    reasoningEffort?: "minimal" | "low" | "medium" | "high" | null;
  } | null;
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
export type ToolExecutionStatus = "awaiting_approval" | "completed" | "denied" | "failed";

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
  assistantMessage: {
    id: string;
    text: string;
  } | null;
};

export type AgentJobStatus =
  | "queued"
  | "planning"
  | "running"
  | "waiting_for_approval"
  | "waiting_for_runtime"
  | "blocked"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentJobApprovalMode = "restrictive" | "builder" | "full_access";
export type AgentExecutionBackend = "host_native" | "wsl_bash" | "docker_sandbox";

export type AgentJobStepKind =
  | "plan"
  | "analyze"
  | "edit"
  | "command"
  | "install"
  | "build"
  | "test"
  | "verify"
  | "runtime_request"
  | "approval"
  | "finalize";

export type AgentJobStepStatus =
  | "pending"
  | "ready"
  | "running"
  | "waiting_for_approval"
  | "waiting_for_runtime"
  | "blocked"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentJobArtifactKind =
  | "plan"
  | "note"
  | "command_log"
  | "file_patch"
  | "file_snapshot"
  | "verification"
  | "result_summary";

export type AgentJobRequirementKind =
  | "runtime"
  | "package_manager"
  | "service"
  | "credential"
  | "approval"
  | "network"
  | "port";

export type AgentJobRequirementStatus = "pending" | "satisfied" | "rejected";

export type AgentJobRecord = {
  id: string;
  jobType: "agent.build";
  title: string;
  goal: string;
  workspacePath: string;
  requestedByUserId: string;
  conversationId: string | null;
  status: AgentJobStatus;
  approvalMode: AgentJobApprovalMode;
  blockerSummary: string | null;
  currentStepId: string | null;
  resultSummary: string | null;
  payloadJson: Record<string, unknown>;
  resultJson: Record<string, unknown> | null;
  scheduledFor: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorText: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentJobStepRecord = {
  id: string;
  jobId: string;
  parentStepId: string | null;
  stepKey: string;
  title: string;
  detail: string | null;
  kind: AgentJobStepKind;
  status: AgentJobStepStatus;
  sequence: number;
  dependsOnStepIds: string[];
  toolKey: string | null;
  inputJson: Record<string, unknown>;
  outputJson: Record<string, unknown> | null;
  summary: string | null;
  errorText: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentJobArtifactRecord = {
  id: string;
  jobId: string;
  stepId: string | null;
  kind: AgentJobArtifactKind;
  label: string;
  storageKey: string | null;
  contentText: string | null;
  mimeType: string | null;
  metadataJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type AgentJobRequirementRecord = {
  id: string;
  jobId: string;
  stepId: string | null;
  kind: AgentJobRequirementKind;
  label: string;
  detail: string | null;
  status: AgentJobRequirementStatus;
  resolutionText: string | null;
  metadataJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CreateAgentJobRequest = {
  title: string;
  goal: string;
  workspacePath: string;
  conversationId?: string | null;
  approvalMode?: AgentJobApprovalMode;
  constraints?: string[];
  deliverables?: string[];
};

export type UpdateAgentJobRequest = {
  status?: AgentJobStatus;
  blockerSummary?: string | null;
  currentStepId?: string | null;
  resultSummary?: string | null;
  errorText?: string | null;
};

export type AgentJobListResponse = {
  jobs: AgentJobRecord[];
};

export type AgentJobDetailResponse = {
  job: AgentJobRecord;
  steps: AgentJobStepRecord[];
  artifacts: AgentJobArtifactRecord[];
  requirements: AgentJobRequirementRecord[];
};

export type AgentJobRequirementDecisionRequest = {
  approved: boolean;
  reason?: string | null;
};

export type AgentJobActionResponse = {
  job: AgentJobRecord;
};

export type AgentJobSettingsRecord = {
  defaultWorkspacePath: string | null;
  defaultApprovalMode: AgentJobApprovalMode;
  executionBackend: AgentExecutionBackend;
  maxAgentSteps: number;
  maxCommandTimeoutSeconds: number;
  maxVerificationAttempts: number;
  maxJobRuntimeMinutes: number;
  allowNetworkAccess: boolean;
  browserVerificationEnabled: boolean;
  redactSecretsInArtifacts: boolean;
  allowedWorkspaceRoots: string[];
};

export type AgentJobSettingsResponse = {
  settings: AgentJobSettingsRecord;
};

export type AdminMaintenanceAction =
  | "clear_stale_agent_jobs"
  | "clear_stale_speech_media"
  | "clear_finished_agent_jobs"
  | "cancel_active_agent_jobs"
  | "flush_agent_queue"
  | "run_health_sweep"
  | "reset_secretary_onboarding"
  | "wipe_runtime_state";

export type UpdateAgentJobSettingsRequest = {
  defaultWorkspacePath?: string | null;
  defaultApprovalMode?: AgentJobApprovalMode;
  executionBackend?: AgentExecutionBackend;
  maxAgentSteps?: number;
  maxCommandTimeoutSeconds?: number;
  maxVerificationAttempts?: number;
  maxJobRuntimeMinutes?: number;
  allowNetworkAccess?: boolean;
  browserVerificationEnabled?: boolean;
  redactSecretsInArtifacts?: boolean;
  allowedWorkspaceRoots?: string[];
};

export type PersonaGender = "male" | "female";

export type SecretaryMode = "workday" | "personal" | "travel" | "deep_focus" | "operator";

export type SecretaryRelationshipRole =
  | "private_secretary"
  | "chief_of_staff"
  | "operator"
  | "companion"
  | "household_coordinator";

export type SecretaryPresenceStyle = "composed" | "warm" | "playful" | "formal" | "assertive";

export type SecretaryResponseLength = "concise" | "balanced" | "expansive";
export type SecretaryDirectness = "soft" | "balanced" | "direct";
export type SecretaryInitiative = "reactive" | "balanced" | "proactive";
export type SecretaryPlanningStyle = "checklist" | "narrative" | "executive";
export type SecretaryGreetingStyle = "minimal" | "name_forward" | "warm";
export type SecretaryClosingStyle = "none" | "next_steps" | "summary";
export type SecretaryClarifyingStyle = "sparing" | "balanced" | "proactive";
export type SecretaryReminderStyle = "gentle" | "balanced" | "firm";

export type SecretaryCustomizationRecord = {
  title: string | null;
  mode: SecretaryMode;
  relationshipRole: SecretaryRelationshipRole;
  presenceStyle: SecretaryPresenceStyle;
  responseLength: SecretaryResponseLength;
  directness: SecretaryDirectness;
  initiative: SecretaryInitiative;
  planningStyle: SecretaryPlanningStyle;
  greetingStyle: SecretaryGreetingStyle;
  closingStyle: SecretaryClosingStyle;
  clarifyingStyle: SecretaryClarifyingStyle;
  reminderStyle: SecretaryReminderStyle;
  addressPreference: string | null;
  avoidances: string[];
  exampleReply: string | null;
  antiExampleReply: string | null;
};

export type PersonaSettingsRecord = {
  id: string;
  name: string;
  promptTemplate: string;
  toneMode: string | null;
  gender: PersonaGender | null;
  avatar: PersonaAvatarRecord | null;
  customization: SecretaryCustomizationRecord;
  behaviorRules: string[];
  voiceProfileId: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PersonaAvatarRecord = {
  storageKey: string;
  mimeType: string | null;
  updatedAt: string;
};

export type PersonaSettingsResponse = {
  conversationEngine: {
    mode: "deterministic_fallback" | "provider";
    provider: InferenceProviderId | null;
    model: string | null;
    summary: string;
  };
  persona: PersonaSettingsRecord;
  personaProfile: string;
  personaFilePath: string | null;
  soulFilePath: string | null;
  voiceProfiles: VoiceProfileRecord[];
};

export type InferenceProviderId = string;

export type InferenceProviderAuthMode =
  | "api_key"
  | "none"
  | "account_authorized"
  | "api_key_or_account";

export type InferenceTarget = "provider" | "local";
export type InferenceProviderCatalogFamily = "ai_sdk_provider" | "openai_compatible" | "community";
export type InferenceProviderCatalogAccessMode =
  | "direct_api"
  | "linked_account"
  | "local_runtime"
  | "mcp_client";
export type InferenceProviderCatalogEntry = {
  id: string;
  label: string;
  docsUrl: string;
  packageName: string | null;
  providerFamily: InferenceProviderCatalogFamily;
  accessMode: InferenceProviderCatalogAccessMode;
  availableInApp: boolean;
  summary: string;
  source: "sdk_docs";
};

export type InferenceProviderRecord = {
  id: InferenceProviderId;
  label: string;
  description: string;
  authMode: InferenceProviderAuthMode;
  docsUrl: string;
  packageName: string | null;
  providerFamily: InferenceProviderCatalogFamily;
  accessMode: InferenceProviderCatalogAccessMode;
  availableInApp: boolean;
  baseUrl: string | null;
  model: string | null;
  maxOutputTokens: number | null;
  apiKeyConfigured: boolean;
  supportsModelFetch: boolean;
  supportsReasoningEffort: boolean;
  isSelected: boolean;
  summary: string;
};

export type InferenceSettingsResponse = {
  settings: {
    enabled: boolean;
    mode: "deterministic_fallback" | "provider";
    activeTarget: InferenceTarget;
    selectedProviderId: InferenceProviderId | null;
    reasoningEffort: "minimal" | "low" | "medium" | "high";
    source: "file" | "env" | "default";
    summary: string;
  };
  providers: InferenceProviderRecord[];
};

export type UpdateInferenceSettingsRequest = {
  enabled?: boolean;
  activeTarget?: InferenceTarget;
  selectedProviderId?: InferenceProviderId | null;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  providerConfig?: {
    id: InferenceProviderId;
    baseUrl?: string | null;
    model?: string | null;
    maxOutputTokens?: number | null;
    apiKey?: string | null;
  };
};

export type InferenceModelListResponse = {
  providerId: InferenceProviderId;
  source: "remote" | "static";
  models: Array<{
    id: string;
    name?: string | null;
    ownedBy?: string | null;
    description?: string | null;
  }>;
};

export type UpdatePersonaSettingsRequest = {
  name?: string;
  promptTemplate?: string;
  toneMode?: string | null;
  gender?: PersonaGender | null;
  behaviorRules?: string[];
  personaProfile?: string;
  voiceProfileId?: string | null;
  customization?: Partial<SecretaryCustomizationRecord>;
};

export type SystemHealthResponse = {
  generatedAt: string;
  services: {
    worker: {
      status: "ok";
      summary: string;
    };
    conversation: {
      status: "ok" | "attention";
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
    heartbeat: {
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

export type AdminMaintenanceOverviewResponse = {
  generatedAt: string;
  defaultWorkspacePath: string | null;
  jobs: {
    active: number;
    waiting: number;
    finished: number;
    staleWorkspaceJobs: number;
    staleWorkspaceLaunchIntents: number;
  };
  speech: {
    staleArtifacts: number;
    staleProfileSamples: number;
  };
  queue: {
    wait: number;
    active: number;
    delayed: number;
    paused: number;
    failed: number;
    completed: number;
    prioritized: number;
  };
  health: SystemHealthResponse;
};

export type AdminMaintenanceActionResponse = {
  action: AdminMaintenanceAction;
  ranAt: string;
  summary: string;
  details: Record<string, number | string | boolean | null>;
  overview: AdminMaintenanceOverviewResponse;
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
  clearSample?: boolean;
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

export type RuntimePersonaContext = {
  name: string;
  personaProfile?: string;
  soul: string;
  toneMode?: string | null;
  gender?: PersonaGender | null;
  customization?: SecretaryCustomizationRecord;
  behaviorRules: string[];
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
  persona?: RuntimePersonaContext;
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
    mode: "webhook" | "polling";
    deliveryMode: TelegramDeliveryMode;
    idleTimeoutMinutes: number;
    envConfigured: boolean;
    botConfigured: boolean;
    healthStatus: string;
    healthSummary: string;
    lastCheckedAt: string | null;
    lastError: string | null;
    lastWebPresenceAt: string | null;
    webhookUrl: string | null;
    desiredWebhookUrl: string | null;
    pendingUpdateCount: number | null;
    defaultChatId: string | null;
    botUser: {
      id: string;
      username: string | null;
      displayName: string;
    } | null;
    conversationCount: number;
    messageCount: number;
    dueReminderCount: number;
    deliveredReminderCount: number;
  };
};

export type TelegramDeliveryMode =
  | "web_only"
  | "mirror_all"
  | "telegram_when_away"
  | "important_only";

export type UpdateTelegramIntegrationRequest = {
  enabled?: boolean;
  mode?: "webhook" | "polling";
  webhookUrl?: string | null;
  defaultChatId?: string | null;
  deliveryMode?: TelegramDeliveryMode;
  idleTimeoutMinutes?: number;
};

export type TelegramPresenceUpdateRequest = {
  surface: "desk";
};

export type TelegramPresenceUpdateResponse = {
  ok: boolean;
  lastWebPresenceAt: string;
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

export type OutboundChannelKey = "discord" | "slack" | "email" | "sms";

export type OutboundChannelHealthStatus = "ok" | "disabled" | "degraded" | "not_configured";

export type OutboundChannelStatusRecord = {
  channelKey: OutboundChannelKey;
  label: string;
  enabled: boolean;
  envConfigured: boolean;
  healthStatus: OutboundChannelHealthStatus;
  healthSummary: string;
  lastCheckedAt: string | null;
  lastError: string | null;
  providerLabel: string;
  supportsSubject: boolean;
  supportsRichText: boolean;
  targetLabel: string | null;
  defaultRecipient: string | null;
  senderIdentity: string | null;
  deliverySummary: string;
};

export type OutboundChannelStatusResponse = {
  integration: OutboundChannelStatusRecord;
};

export type UpdateDiscordIntegrationRequest = {
  enabled?: boolean;
  targetLabel?: string | null;
};

export type DiscordTestMessageRequest = {
  text?: string | null;
};

export type DiscordTestMessageResponse = {
  ok: boolean;
  deliveredTo: string;
};

export type UpdateSlackIntegrationRequest = {
  enabled?: boolean;
  targetLabel?: string | null;
};

export type SlackTestMessageRequest = {
  text?: string | null;
};

export type SlackTestMessageResponse = {
  ok: boolean;
  deliveredTo: string;
};

export type UpdateEmailIntegrationRequest = {
  enabled?: boolean;
  defaultRecipient?: string | null;
};

export type EmailTestMessageRequest = {
  to?: string | null;
  subject?: string | null;
  text?: string | null;
};

export type EmailTestMessageResponse = {
  ok: boolean;
  messageId: string | null;
  recipient: string;
};

export type UpdateSmsIntegrationRequest = {
  enabled?: boolean;
  defaultRecipient?: string | null;
  senderLabel?: string | null;
};

export type SmsTestMessageRequest = {
  to?: string | null;
  text?: string | null;
};

export type SmsTestMessageResponse = {
  ok: boolean;
  recipient: string;
  sid: string | null;
};

export type HeartbeatIntegrationStatusResponse = {
  integration: {
    enabled: boolean;
    healthStatus: "ok" | "disabled" | "degraded";
    healthSummary: string;
    intervalMinutes: number;
    prompt: string;
    conversationId: string | null;
    lastRunAt: string | null;
    nextRunAt: string | null;
    lastCheckedAt: string | null;
    lastError: string | null;
  };
};

export type UpdateHeartbeatIntegrationRequest = {
  enabled?: boolean;
  intervalMinutes?: number;
  prompt?: string | null;
};

export type HeartbeatRunResponse = {
  ok: boolean;
  traceId: string;
  conversationId: string;
  assistantMessageId: string;
  outputPreview: string;
  nextRunAt: string | null;
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

function firstSentence(text: string | undefined) {
  const normalized = cleanText(text ?? "");

  if (!normalized) {
    return "";
  }

  const match = normalized.match(/[^.!?]+[.!?]?/);
  return match?.[0]?.trim() ?? normalized;
}

function _isGreeting(text: string) {
  return /^(hi|hello|hey|good morning|good afternoon|good evening)\b/i.test(text);
}

function _soulStyleLead(context: RuntimeTurnContext) {
  const personaName = context.persona?.name?.trim() || "Secretary";
  const tone = context.persona?.toneMode?.trim();
  const soulLine = firstSentence(context.persona?.soul);
  const customization = context.persona?.customization;

  return {
    customization,
    personaName,
    soulLine,
    tone,
  };
}

function _pickReplyShape<T>(
  context: RuntimeTurnContext,
  options: {
    concise: T;
    balanced: T;
    expansive?: T;
  },
) {
  const preference = context.persona?.customization?.responseLength ?? "balanced";

  if (preference === "concise") {
    return options.concise;
  }

  if (preference === "expansive") {
    return options.expansive ?? options.balanced;
  }

  return options.balanced;
}

function _pickDirectness<T>(
  context: RuntimeTurnContext,
  options: {
    soft: T;
    balanced: T;
    direct: T;
  },
) {
  const preference = context.persona?.customization?.directness ?? "balanced";
  return options[preference];
}

export type SecretaryFallbackReason =
  | "no_inference"
  | "provider_error"
  | "guarded_output"
  | "unknown";

type SecretaryFallbackOptions = {
  reason?: SecretaryFallbackReason;
  providerError?: string | null;
};

export function generateSecretaryReply(
  request: RuntimeChatRequest,
  context: RuntimeTurnContext,
  options: SecretaryFallbackOptions = {},
) {
  void request;
  void context;
  void options.providerError;

  const reason = options.reason ?? "unknown";

  if (reason === "guarded_output") {
    return "Response unavailable due to a safety guard. Please try again.";
  }

  return `Inference provider unavailable. Update your provider settings to continue. (${new Date().toLocaleTimeString()})`;
}

export function createTurnResponseFromText(params: {
  request: RuntimeChatRequest;
  context: RuntimeTurnContext;
  outputText: string;
  traceId?: string;
}): RuntimeChatResponse {
  const traceId = params.traceId ?? createTraceId();
  const conversationId = params.request.conversationId ?? params.context.conversationId;
  const actions: RuntimeChatResponse["actions"] = [
    {
      kind: "memory_candidate_queued",
      payload: {
        source: params.request.channel,
        status: "queued",
      },
    },
  ];

  if (params.context.researchResult) {
    actions.push({
      kind: "research_specialist_used",
      payload: {
        mode: params.context.researchResult.mode,
        specialist: params.context.researchResult.specialist,
      },
    });
  }

  return {
    conversationId,
    messageId: createMessageId(),
    outputText: params.outputText,
    traceId,
    contextSummary: {
      memories: params.context.relevantMemories,
      tasks: params.context.activeTasks,
      research: params.context.researchResult ?? undefined,
    },
    actions,
  };
}
