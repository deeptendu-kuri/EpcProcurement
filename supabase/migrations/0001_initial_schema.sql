create extension if not exists pgcrypto;

create type app_role as enum ('ADMIN', 'ANALYST', 'SALES', 'VIEWER');
create type source_status as enum ('DISCOVERED', 'SCRAPED', 'CLASSIFIED', 'EXTRACTED', 'FAILED', 'SKIPPED');
create type signal_type as enum (
  'NEW_PROJECT',
  'EPC_AWARD',
  'TENDER_RELEASED',
  'PROCUREMENT_REQUIREMENT',
  'PRODUCT_SPECIFICATION',
  'CAPEX_ANNOUNCEMENT',
  'EXPANSION',
  'HIRING',
  'COMPANY_NEWS',
  'FIRST_PARTY_ACTIVITY',
  'TRADE_HISTORY',
  'INTENT_SIGNAL'
);
create type job_status as enum ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRYING', 'SKIPPED');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role app_role not null default 'VIEWER',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table companies (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  domain text,
  industry text,
  sub_industry text,
  country text,
  region text,
  city text,
  employee_range text,
  revenue_range text,
  description text,
  last_checked_at timestamptz,
  last_signal_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (canonical_name, coalesce(country, ''))
);

create table company_aliases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  alias text not null,
  confidence numeric not null default 1 check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  unique (company_id, alias)
);

create table sources (
  id uuid primary key default gen_random_uuid(),
  url text not null unique,
  normalized_url text not null unique,
  source_domain text not null,
  source_type text not null,
  reliability text not null default 'UNKNOWN',
  title text,
  published_at timestamptz,
  discovered_at timestamptz not null default now(),
  scraped_at timestamptz,
  content_hash text,
  status source_status not null default 'DISCOVERED',
  raw_text_reference text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company_id uuid references companies(id) on delete set null,
  project_type text,
  country text,
  location text,
  estimated_value numeric,
  project_stage text,
  announcement_date date,
  start_date date,
  expected_completion_date date,
  description text,
  confidence numeric not null default 0.5 check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table tenders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  title text not null,
  reference_number text,
  country text,
  issue_date date,
  closing_date date,
  status text,
  description text,
  source_id uuid references sources(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table product_requirements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  tender_id uuid references tenders(id) on delete set null,
  source_id uuid references sources(id) on delete set null,
  product_category text not null,
  product_type text,
  standard text,
  grade text,
  diameter text,
  wall_thickness text,
  coating text,
  quantity numeric,
  unit text,
  material text,
  specification text,
  confidence numeric not null default 0.5 check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now()
);

create table signals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  tender_id uuid references tenders(id) on delete set null,
  source_id uuid references sources(id) on delete set null,
  signal_type signal_type not null,
  signal_strength integer not null check (signal_strength between 0 and 100),
  signal_date date not null,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  metadata jsonb not null default '{}',
  event_fingerprint text not null,
  created_at timestamptz not null default now(),
  unique (company_id, signal_type, event_fingerprint)
);

create table buyer_scores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  score integer not null check (score between 0 and 100),
  confidence text not null check (confidence in ('Low', 'Medium', 'High')),
  product_fit_score integer not null default 0,
  project_score integer not null default 0,
  tender_score integer not null default 0,
  timing_score integer not null default 0,
  trade_score integer not null default 0,
  intent_score integer not null default 0,
  relationship_score integer not null default 0,
  calculated_at timestamptz not null default now(),
  explanation jsonb not null
);

create table search_configs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country text,
  product text,
  keyword_group text not null,
  source_type text not null,
  language text not null default 'en',
  frequency text not null default 'daily',
  priority integer not null default 3,
  enabled boolean not null default true,
  queries text[] not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table processing_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  status job_status not null default 'PENDING',
  payload jsonb not null default '{}',
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table usage_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  operation text not null,
  units integer not null default 1,
  tokens integer,
  cost_estimate numeric,
  success boolean not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
alter table companies enable row level security;
alter table company_aliases enable row level security;
alter table sources enable row level security;
alter table projects enable row level security;
alter table tenders enable row level security;
alter table product_requirements enable row level security;
alter table signals enable row level security;
alter table buyer_scores enable row level security;
alter table search_configs enable row level security;
alter table processing_jobs enable row level security;
alter table usage_events enable row level security;

create policy "authenticated read profiles" on profiles for select to authenticated using (auth.uid() = id);
create policy "authenticated read companies" on companies for select to authenticated using (true);
create policy "authenticated read aliases" on company_aliases for select to authenticated using (true);
create policy "authenticated read sources" on sources for select to authenticated using (true);
create policy "authenticated read projects" on projects for select to authenticated using (true);
create policy "authenticated read tenders" on tenders for select to authenticated using (true);
create policy "authenticated read requirements" on product_requirements for select to authenticated using (true);
create policy "authenticated read signals" on signals for select to authenticated using (true);
create policy "authenticated read buyer scores" on buyer_scores for select to authenticated using (true);
create policy "analysts manage search configs" on search_configs for all to authenticated using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role in ('ADMIN', 'ANALYST'))) with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role in ('ADMIN', 'ANALYST')));
create policy "analysts read jobs" on processing_jobs for select to authenticated using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role in ('ADMIN', 'ANALYST')));
create policy "analysts read usage" on usage_events for select to authenticated using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role in ('ADMIN', 'ANALYST')));

create index companies_country_idx on companies(country);
create index sources_content_hash_idx on sources(content_hash);
create index signals_company_date_idx on signals(company_id, signal_date desc);
create index buyer_scores_company_date_idx on buyer_scores(company_id, calculated_at desc);
create index jobs_status_idx on processing_jobs(status, created_at);
