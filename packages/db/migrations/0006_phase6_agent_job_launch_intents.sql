create table if not exists agent_job_launch_intents (
  id text primary key,
  conversation_id text not null references conversations(id) on delete cascade,
  requested_by_user_id text not null references users(id),
  source_message_id text,
  status text not null,
  title text not null,
  goal text not null,
  workspace_path text not null,
  approval_mode text not null default 'builder',
  payload_json jsonb not null default '{}'::jsonb,
  resolution_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_job_launch_intents_conversation_id_idx
  on agent_job_launch_intents (conversation_id);
create index if not exists agent_job_launch_intents_requested_by_user_id_idx
  on agent_job_launch_intents (requested_by_user_id);
create unique index if not exists agent_job_launch_intents_pending_conversation_idx
  on agent_job_launch_intents (conversation_id)
  where status = 'pending';
