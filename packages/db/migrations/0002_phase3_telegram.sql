ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel_ref text,
  ADD COLUMN IF NOT EXISTS channel_label text;

CREATE INDEX IF NOT EXISTS conversations_channel_lookup_idx
  ON conversations (channel_type, channel_ref, last_message_at DESC);

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS delivery_channel_type text,
  ADD COLUMN IF NOT EXISTS delivery_target_ref text,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_delivery_error text;

CREATE INDEX IF NOT EXISTS tasks_delivery_idx
  ON tasks (delivery_channel_type, delivery_target_ref, reminder_at, delivered_at);

CREATE TABLE IF NOT EXISTS integrations (
  id text PRIMARY KEY,
  integration_type text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  health_status text NOT NULL DEFAULT 'not_configured',
  last_checked_at timestamptz,
  last_error_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integrations_type_enabled_idx
  ON integrations (integration_type, enabled, updated_at DESC);
