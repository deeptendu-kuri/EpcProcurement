-- Work-based buyer search (docs/mvp/20): for each award or company page read in a work-search run, whether the
-- work needs the searched item, and each company's role in it with the exact sentence. Only verdict 'lead'
-- becomes a lead; 'owner' companies buy through their contractors; 'rejected' keeps the reason for review.
create table if not exists need_checks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references research_sessions(run_id) on delete cascade,
  document_id uuid not null references source_documents(id) on delete cascade,
  company_name text not null,
  role text not null,
  package text,
  quote text,
  quote_verified boolean not null default false,
  work_date text,
  project text,
  project_country text,
  market text,
  use_name text,
  needs_item text not null check (needs_item in ('yes','no','unclear')),
  need_why text,
  verdict text not null check (verdict in ('lead','owner','rejected')),
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists need_checks_run_verdict on need_checks(run_id, verdict);
create index if not exists need_checks_document on need_checks(run_id, document_id);
