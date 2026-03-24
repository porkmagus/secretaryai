import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
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
  behaviorRules: jsonb("behavior_rules")
    .$type<string[]>()
    .notNull(),
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
  title: text("title"),
  status: text("status").notNull().default("active"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
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
  sourceKind: text("source_kind"),
  sourceRef: text("source_ref"),
  ...timestamps,
});

export const jobs = pgTable("jobs", {
  id: text("id").primaryKey(),
  jobType: text("job_type").notNull(),
  status: text("status").notNull(),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
  resultJson: jsonb("result_json").$type<Record<string, unknown> | null>(),
  parentJobId: text("parent_job_id"),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true })
    .notNull()
    .defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  errorText: text("error_text"),
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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
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

export const phaseTwoTables = [
  ...phaseOneTables,
  "memory_links",
  "tasks",
] as const;

export type PhaseOneTable = (typeof phaseOneTables)[number];
export type PhaseTwoTable = (typeof phaseTwoTables)[number];
