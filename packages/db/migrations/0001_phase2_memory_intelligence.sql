ALTER TABLE memory_entries
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS canonical_key text;

CREATE INDEX IF NOT EXISTS memory_entries_state_idx
  ON memory_entries (memory_type, pinned, suppressed, importance_score);

CREATE INDEX IF NOT EXISTS memory_entries_canonical_key_idx
  ON memory_entries (canonical_key);

CREATE TABLE IF NOT EXISTS memory_links (
  id text PRIMARY KEY,
  memory_entry_id text NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
  link_type text NOT NULL,
  linked_entity_type text NOT NULL,
  linked_entity_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memory_links_entry_idx
  ON memory_links (memory_entry_id, linked_entity_type, linked_entity_id);

CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  conversation_id text REFERENCES conversations(id) ON DELETE SET NULL,
  title text NOT NULL,
  detail text,
  status text NOT NULL DEFAULT 'open',
  due_at timestamptz,
  reminder_at timestamptz,
  source_kind text,
  source_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_user_status_idx
  ON tasks (user_id, status, reminder_at, due_at);
