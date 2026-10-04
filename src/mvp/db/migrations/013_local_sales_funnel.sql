-- Separate, opt-in demo workflow. Never changes the legacy approved-email queue.
create table funnel_control (
  id integer primary key check (id = 1), enabled boolean not null default false,
  enabled_at timestamptz, worker_lease uuid, worker_until timestamptz,
  last_tick_at timestamptz, last_error text
);
insert into funnel_control (id) values (1);
create table funnel_threads (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null unique references search_opportunities on delete cascade,
  company_id uuid not null references companies, product_id text not null,
  person_id uuid references people, reply_token text not null unique,
  state text not null default 'qualifying' check (state in
    ('qualifying','needs_contact','active','engaged','awaiting_time','meeting_pending','meeting_booked','stopped','review')),
  paused boolean not null default false, reason text not null default '',
  next_action_at timestamptz not null default now(), followups integer not null default 0,
  offered_slots jsonb not null default '[]', meeting_start timestamptz, event_id text, meet_url text,
  summary text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (company_id, product_id)
);
create table funnel_messages (
  id uuid primary key default gen_random_uuid(), thread_id uuid not null references funnel_threads on delete cascade,
  direction text not null check (direction in ('in','out')), kind text not null,
  dedup_key text not null unique, subject text not null, body text not null,
  state text not null check (state in ('received','queued','sending','accepted','cancelled','review')),
  provider_id text unique, rfc_message_id text, in_reply_to text, reply_to text, sender text,
  attempts integer not null default 0, first_attempt_at timestamptz,
  error text, analysed_at timestamptz, created_at timestamptz not null default now(),
  check (direction <> 'out' or sender is null)
);
create index funnel_messages_work_idx on funnel_messages(thread_id, state, created_at);
create table funnel_suppressions (
  recipient text primary key check (recipient = 'deeptendukuri@gmail.com'),
  reason text not null, created_at timestamptz not null default now()
);
create table funnel_integrations (
  provider text primary key check (provider = 'google'), account text not null,
  encrypted_refresh_token text not null, connected_at timestamptz not null default now()
);
create table funnel_oauth_states (
  digest text primary key, expires_at timestamptz not null
);
