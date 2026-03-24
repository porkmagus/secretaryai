create table if not exists tools (
  id text primary key,
  key text not null,
  name text not null,
  description text not null,
  enabled boolean not null default true,
  approval_mode text not null default 'ask_first',
  config_schema_json jsonb not null default '{}'::jsonb,
  health_status text not null default 'ok',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tools_key_idx on tools (key);

create table if not exists tool_executions (
  id text primary key,
  tool_id text not null references tools (id) on delete cascade,
  conversation_id text references conversations (id) on delete set null,
  requested_by text not null,
  execution_status text not null,
  approval_state text not null,
  request_json jsonb not null,
  response_json jsonb,
  summary text not null,
  error_text text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tool_executions_tool_id_idx on tool_executions (tool_id);
create index if not exists tool_executions_conversation_id_idx on tool_executions (conversation_id);
create index if not exists tool_executions_approval_state_idx on tool_executions (approval_state);
