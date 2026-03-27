create table if not exists agent_jobs (
  job_id text primary key references jobs (id) on delete cascade,
  requested_by_user_id text not null references users (id),
  conversation_id text references conversations (id) on delete set null,
  title text not null,
  goal text not null,
  workspace_path text not null,
  approval_mode text not null default 'builder',
  blocker_summary text,
  current_step_id text,
  result_summary text
);

create index if not exists agent_jobs_requested_by_user_id_idx
  on agent_jobs (requested_by_user_id);
create index if not exists agent_jobs_conversation_id_idx
  on agent_jobs (conversation_id);
create index if not exists agent_jobs_approval_mode_idx
  on agent_jobs (approval_mode);

create table if not exists agent_job_steps (
  id text primary key,
  job_id text not null references jobs (id) on delete cascade,
  parent_step_id text references agent_job_steps (id) on delete set null,
  step_key text not null,
  title text not null,
  detail text,
  step_kind text not null,
  status text not null,
  sequence integer not null default 0,
  depends_on_step_ids jsonb not null default '[]'::jsonb,
  tool_key text,
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb,
  summary text,
  error_text text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists agent_job_steps_job_id_step_key_idx
  on agent_job_steps (job_id, step_key);
create index if not exists agent_job_steps_job_id_status_idx
  on agent_job_steps (job_id, status);
create index if not exists agent_job_steps_job_id_sequence_idx
  on agent_job_steps (job_id, sequence);

create table if not exists agent_job_artifacts (
  id text primary key,
  job_id text not null references jobs (id) on delete cascade,
  step_id text references agent_job_steps (id) on delete set null,
  artifact_kind text not null,
  label text not null,
  storage_key text,
  content_text text,
  mime_type text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_job_artifacts_job_id_idx
  on agent_job_artifacts (job_id);
create index if not exists agent_job_artifacts_step_id_idx
  on agent_job_artifacts (step_id);
create index if not exists agent_job_artifacts_kind_idx
  on agent_job_artifacts (artifact_kind);

create table if not exists agent_job_requirements (
  id text primary key,
  job_id text not null references jobs (id) on delete cascade,
  step_id text references agent_job_steps (id) on delete set null,
  requirement_kind text not null,
  label text not null,
  detail text,
  status text not null,
  resolution_text text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_job_requirements_job_id_idx
  on agent_job_requirements (job_id);
create index if not exists agent_job_requirements_status_idx
  on agent_job_requirements (status);
