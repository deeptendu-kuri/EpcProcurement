-- Local-language search terms (docs/mvp/19 Phase 3): one AI translation per material and language,
-- reused by every later search.
create table if not exists term_cache (
  key text primary key,
  value jsonb not null,
  created_at timestamptz not null default now()
);
