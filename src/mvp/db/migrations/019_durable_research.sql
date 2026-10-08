-- Durable research is independent from email/contact readiness. Existing runs/data are preserved.
create table research_sessions (
  run_id uuid primary key references runs(id) on delete cascade,
  state text not null default 'active' check(state in ('active','partial','done','cancelled','failed')),
  budget jsonb not null, generation int not null default 0,
  stop_reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table research_jobs (
  id uuid primary key default gen_random_uuid(), run_id uuid not null references research_sessions(run_id) on delete cascade,
  stage text not null check(stage in ('collect','read','analyse','finish')),
  key text not null, payload jsonb not null default '{}', result jsonb,
  state text not null default 'queued' check(state in ('queued','running','done','paused','failed','cancelled')),
  priority int not null default 0, attempts int not null default 0,
  available_at timestamptz not null default now(), lease_token uuid, lease_until timestamptz,
  error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(run_id,stage,key)
);
create index research_jobs_due on research_jobs(state,available_at,priority);
create table research_budget_reservations (
  run_id uuid not null references research_sessions(run_id) on delete cascade,
  kind text not null, key text not null, units int not null check(units>=0),
  outcome text not null default 'reserved' check(outcome in ('reserved','completed','unknown')),
  created_at timestamptz not null default now(), primary key(run_id,kind,key)
);
create table research_outbox (
  id uuid primary key default gen_random_uuid(), run_id uuid references research_sessions(run_id) on delete cascade,
  job_id uuid references research_jobs(id) on delete cascade,
  kind text not null default 'research' check(kind in ('research','funnel')),
  dedupe_key text not null unique, state text not null default 'pending' check(state in ('pending','publishing','published')),
  lease_token uuid, lease_until timestamptz, available_at timestamptz not null default now(),
  attempts int not null default 0, provider_id text, error text, created_at timestamptz not null default now()
);
create table provider_webhook_receipts (
  provider text not null, event_id text not null, event_type text not null, resource_id text,
  received_at timestamptz not null default now(), processed_at timestamptz,
  primary key(provider,event_id)
);
