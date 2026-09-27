alter table discovery_decision_makers
  add column if not exists confidence_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists evidence_signals text[] not null default '{}'::text[];
