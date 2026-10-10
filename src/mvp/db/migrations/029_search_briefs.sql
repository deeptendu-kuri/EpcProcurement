-- Work-based buyer search (docs/mvp/20): the search brief for a typed material and set of countries — which
-- work uses the item, in which countries, with which headline words, who is not a buyer. One AI call per new
-- wording; reused by later searches and saved-search refreshes so they search the same way.
create table if not exists search_briefs (
  key text primary key,
  material text not null,
  markets text[] not null,
  brief jsonb not null,
  source text not null check (source in ('ai','catalogue')),
  created_at timestamptz not null default now()
);
