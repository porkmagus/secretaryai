CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  default_persona_id text
);

CREATE TABLE IF NOT EXISTS personas (
  id text PRIMARY KEY,
  name text NOT NULL,
  tone_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  behavior_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  voice_profile_id text,
  prompt_template text NOT NULL DEFAULT '',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  channel_type text NOT NULL,
  title text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL,
  content_text text NOT NULL,
  content_json jsonb,
  channel_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  parent_message_id text REFERENCES messages(id)
);

CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
  ON messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS memory_entries (
  id text PRIMARY KEY,
  memory_type text NOT NULL,
  title text,
  content_text text NOT NULL,
  content_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  importance_score integer NOT NULL DEFAULT 0,
  confidence_score integer NOT NULL DEFAULT 0,
  source_kind text,
  source_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_accessed_at timestamptz,
  pinned boolean NOT NULL DEFAULT false,
  suppressed boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  job_type text NOT NULL,
  status text NOT NULL,
  payload_json jsonb NOT NULL,
  result_json jsonb,
  parent_job_id text REFERENCES jobs(id),
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_type_status_idx
  ON jobs (job_type, status, scheduled_for);

CREATE TABLE IF NOT EXISTS activity_traces (
  id text PRIMARY KEY,
  trace_type text NOT NULL,
  parent_trace_id text,
  conversation_id text REFERENCES conversations(id) ON DELETE CASCADE,
  job_id text REFERENCES jobs(id) ON DELETE SET NULL,
  event_name text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_traces_conversation_idx
  ON activity_traces (conversation_id, created_at);
