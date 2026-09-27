alter table discovery_candidates
  add column if not exists awarded_contractors jsonb not null default '[]'::jsonb;

alter table converted_discovery_leads
  add column if not exists awarded_contractors jsonb not null default '[]'::jsonb;
