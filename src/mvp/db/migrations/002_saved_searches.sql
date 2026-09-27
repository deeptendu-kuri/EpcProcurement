-- 002 · Saved searches with auto-refresh (docs/mvp/13 §7).
-- refresh_hours: 6 | 12 | 24, or null = manual only. The scheduler (src/mvp/scheduler) runs any
-- active search whose last_run_at + refresh_hours has passed, one run at a time.
create table saved_searches (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  query text not null,
  markets text[] not null default '{}',
  lead_kinds text[] not null default '{}',
  refresh_hours int check (refresh_hours in (6, 12, 24)),
  active boolean not null default true,
  last_run_at timestamptz,
  last_run_id uuid references runs on delete set null,
  created_at timestamptz not null default now()
);
create index saved_searches_created_idx on saved_searches (created_at desc);

-- Overview and "Updated x min ago" read the latest finished run.
create index if not exists runs_finished_idx on runs (finished_at desc) where finished_at is not null;
-- Leads "Latest" sort and the "Added" filter.
create index if not exists leads_created_idx on leads (created_at desc);
