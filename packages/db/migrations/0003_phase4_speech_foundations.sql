CREATE TABLE IF NOT EXISTS voice_profiles (
  id text PRIMARY KEY,
  name text NOT NULL,
  engine_id text NOT NULL,
  sample_storage_key text,
  sample_mime_type text,
  sample_duration_ms integer,
  quality_preset text,
  speaking_style text,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS voice_profiles_active_idx
  ON voice_profiles (is_active, updated_at DESC);

CREATE TABLE IF NOT EXISTS speech_artifacts (
  id text PRIMARY KEY,
  conversation_id text REFERENCES conversations(id) ON DELETE CASCADE,
  message_id text REFERENCES messages(id) ON DELETE SET NULL,
  artifact_kind text NOT NULL,
  status text NOT NULL,
  storage_key text NOT NULL,
  mime_type text,
  duration_ms integer,
  transcript_text text,
  source_channel text NOT NULL,
  source_ref text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS speech_artifacts_conversation_idx
  ON speech_artifacts (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS speech_artifacts_status_idx
  ON speech_artifacts (artifact_kind, status, updated_at DESC);
