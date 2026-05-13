import { boolean, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  defaultPersonaId: text("default_persona_id"),
  ...timestamps,
});

export const personas = pgTable("personas", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  toneProfile: jsonb("tone_profile").$type<Record<string, unknown>>().notNull(),
  behaviorRules: jsonb("behavior_rules").$type<string[]>().notNull(),
  voiceProfileId: text("voice_profile_id"),
  promptTemplate: text("prompt_template").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  ...timestamps,
});

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  channelType: text("channel_type").notNull(),
  channelRef: text("channel_ref"),
  channelLabel: text("channel_label"),
  title: text("title"),
  status: text("status").notNull().default("active"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  ...timestamps,
});

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  contentText: text("content_text").notNull(),
  contentJson: jsonb("content_json").$type<Record<string, unknown> | null>(),
  channelMessageId: text("channel_message_id"),
  parentMessageId: text("parent_message_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memoryEntries = pgTable("memory_entries", {
  id: text("id").primaryKey(),
  memoryType: text("memory_type").notNull(),
  title: text("title"),
  summary: text("summary"),
  contentText: text("content_text").notNull(),
  contentJson: jsonb("content_json").$type<Record<string, unknown>>().notNull(),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  canonicalKey: text("canonical_key"),
  importanceScore: integer("importance_score").notNull().default(0),
  confidenceScore: integer("confidence_score").notNull().default(0),
  sourceKind: text("source_kind"),
  sourceRef: text("source_ref"),
  lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
  pinned: boolean("pinned").notNull().default(false),
  suppressed: boolean("suppressed").notNull().default(false),
  ...timestamps,
});

export const memoryLinks = pgTable("memory_links", {
  id: text("id").primaryKey(),
  memoryEntryId: text("memory_entry_id")
    .notNull()
    .references(() => memoryEntries.id, { onDelete: "cascade" }),
  linkType: text("link_type").notNull(),
  linkedEntityType: text("linked_entity_type").notNull(),
  linkedEntityId: text("linked_entity_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  conversationId: text("conversation_id").references(() => conversations.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  detail: text("detail"),
  status: text("status").notNull().default("open"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  reminderAt: timestamp("reminder_at", { withTimezone: true }),
  deliveryChannelType: text("delivery_channel_type"),
  deliveryTargetRef: text("delivery_target_ref"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  lastDeliveryError: text("last_delivery_error"),
  sourceKind: text("source_kind"),
  sourceRef: text("source_ref"),
  ...timestamps,
});

export const integrations = pgTable("integrations", {
  id: text("id").primaryKey(),
  integrationType: text("integration_type").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  configJson: jsonb("config_json").$type<Record<string, unknown>>().notNull().default({}),
  healthStatus: text("health_status").notNull().default("not_configured"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastErrorText: text("last_error_text"),
  ...timestamps,
});

export const tools = pgTable("tools", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  approvalMode: text("approval_mode").notNull().default("ask_first"),
  configSchemaJson: jsonb("config_schema_json")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  healthStatus: text("health_status").notNull().default("ok"),
  ...timestamps,
});

export const toolExecutions = pgTable("tool_executions", {
  id: text("id").primaryKey(),
  toolId: text("tool_id")
    .notNull()
    .references(() => tools.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").references(() => conversations.id, {
    onDelete: "set null",
  }),
  requestedBy: text("requested_by").notNull(),
  executionStatus: text("execution_status").notNull(),
  approvalState: text("approval_state").notNull(),
  requestJson: jsonb("request_json").$type<Record<string, unknown>>().notNull(),
  responseJson: jsonb("response_json").$type<Record<string, unknown> | null>(),
  summary: text("summary").notNull(),
  errorText: text("error_text"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  ...timestamps,
});

export const voiceProfiles = pgTable("voice_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  engineId: text("engine_id").notNull(),
  sampleStorageKey: text("sample_storage_key"),
  sampleMimeType: text("sample_mime_type"),
  sampleDurationMs: integer("sample_duration_ms"),
  qualityPreset: text("quality_preset"),
  speakingStyle: text("speaking_style"),
  isActive: boolean("is_active").notNull().default(false),
  ...timestamps,
});

export const speechArtifacts = pgTable("speech_artifacts", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").references(() => conversations.id, {
    onDelete: "cascade",
  }),
  messageId: text("message_id").references(() => messages.id, {
    onDelete: "set null",
  }),
  artifactKind: text("artifact_kind").notNull(),
  status: text("status").notNull(),
  storageKey: text("storage_key").notNull(),
  mimeType: text("mime_type"),
  durationMs: integer("duration_ms"),
  transcriptText: text("transcript_text"),
  sourceChannel: text("source_channel").notNull(),
  sourceRef: text("source_ref"),
  metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export const jobs = pgTable("jobs", {
  id: text("id").primaryKey(),
  jobType: text("job_type").notNull(),
  status: text("status").notNull(),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
  resultJson: jsonb("result_json").$type<Record<string, unknown> | null>(),
  parentJobId: text("parent_job_id"),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  errorText: text("error_text"),
  ...timestamps,
});

export const agentJobs = pgTable("agent_jobs", {
  jobId: text("job_id")
    .primaryKey()
    .references(() => jobs.id, { onDelete: "cascade" }),
  requestedByUserId: text("requested_by_user_id")
    .notNull()
    .references(() => users.id),
  conversationId: text("conversation_id").references(() => conversations.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  goal: text("goal").notNull(),
  workspacePath: text("workspace_path").notNull(),
  approvalMode: text("approval_mode").notNull().default("builder"),
  blockerSummary: text("blocker_summary"),
  currentStepId: text("current_step_id"),
  resultSummary: text("result_summary"),
});

export const agentJobLaunchIntents = pgTable("agent_job_launch_intents", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  requestedByUserId: text("requested_by_user_id")
    .notNull()
    .references(() => users.id),
  sourceMessageId: text("source_message_id"),
  status: text("status").notNull(),
  title: text("title").notNull(),
  goal: text("goal").notNull(),
  workspacePath: text("workspace_path").notNull(),
  approvalMode: text("approval_mode").notNull().default("builder"),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull().default({}),
  resolutionText: text("resolution_text"),
  ...timestamps,
});

export const agentJobSteps = pgTable("agent_job_steps", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  parentStepId: text("parent_step_id"),
  stepKey: text("step_key").notNull(),
  title: text("title").notNull(),
  detail: text("detail"),
  stepKind: text("step_kind").notNull(),
  status: text("status").notNull(),
  sequence: integer("sequence").notNull().default(0),
  dependsOnStepIds: jsonb("depends_on_step_ids").$type<string[]>().notNull().default([]),
  toolKey: text("tool_key"),
  inputJson: jsonb("input_json").$type<Record<string, unknown>>().notNull().default({}),
  outputJson: jsonb("output_json").$type<Record<string, unknown> | null>(),
  summary: text("summary"),
  errorText: text("error_text"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  ...timestamps,
});

export const agentJobArtifacts = pgTable("agent_job_artifacts", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  stepId: text("step_id").references(() => agentJobSteps.id, {
    onDelete: "set null",
  }),
  artifactKind: text("artifact_kind").notNull(),
  label: text("label").notNull(),
  storageKey: text("storage_key"),
  contentText: text("content_text"),
  mimeType: text("mime_type"),
  metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export const agentJobRequirements = pgTable("agent_job_requirements", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  stepId: text("step_id").references(() => agentJobSteps.id, {
    onDelete: "set null",
  }),
  requirementKind: text("requirement_kind").notNull(),
  label: text("label").notNull(),
  detail: text("detail"),
  status: text("status").notNull(),
  resolutionText: text("resolution_text"),
  metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export const activityTraces = pgTable("activity_traces", {
  id: text("id").primaryKey(),
  traceType: text("trace_type").notNull(),
  parentTraceId: text("parent_trace_id"),
  conversationId: text("conversation_id").references(() => conversations.id, {
    onDelete: "cascade",
  }),
  jobId: text("job_id").references(() => jobs.id, {
    onDelete: "set null",
  }),
  eventName: text("event_name").notNull(),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const phaseOneTables = [
  "users",
  "personas",
  "conversations",
  "messages",
  "memory_entries",
  "jobs",
  "activity_traces",
] as const;

export const phaseTwoTables = [...phaseOneTables, "memory_links", "tasks"] as const;

export const phaseThreeTables = [...phaseTwoTables, "integrations"] as const;

export const phaseFourTables = [...phaseThreeTables, "voice_profiles", "speech_artifacts"] as const;

export const phaseFiveTables = [...phaseFourTables, "tools", "tool_executions"] as const;

export const phaseSixTables = [
  ...phaseFiveTables,
  "agent_jobs",
  "agent_job_launch_intents",
  "agent_job_steps",
  "agent_job_artifacts",
  "agent_job_requirements",
] as const;

export type PhaseOneTable = (typeof phaseOneTables)[number];
export type PhaseTwoTable = (typeof phaseTwoTables)[number];
export type PhaseThreeTable = (typeof phaseThreeTables)[number];
export type PhaseFourTable = (typeof phaseFourTables)[number];
export type PhaseFiveTable = (typeof phaseFiveTables)[number];
export type PhaseSixTable = (typeof phaseSixTables)[number];
