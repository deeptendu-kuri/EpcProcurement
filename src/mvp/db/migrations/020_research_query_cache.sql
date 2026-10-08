-- Successful targeted queries are replayable within their original research run.
-- Empty responses are cached too; transient/provider failures are never successes.
create table research_query_cache (
  run_id uuid not null references runs on delete cascade,
  query_key text not null,
  result jsonb not null,
  completed_at timestamptz not null default now(),
  primary key (run_id, query_key)
);
