alter table discovery_decision_makers
  add column if not exists phone text,
  add column if not exists phone_status text not null default 'Not Found',
  add column if not exists phone_source_url text,
  add column if not exists linkedin_status text not null default 'Not Found',
  add column if not exists data_source_type text not null default 'Manual research',
  add column if not exists confidence integer not null default 50,
  add column if not exists evidence_notes text,
  add column if not exists email_candidate_type text not null default 'unknown';

create index if not exists discovery_decision_makers_linkedin_status_idx on discovery_decision_makers(linkedin_status);
create index if not exists discovery_decision_makers_phone_status_idx on discovery_decision_makers(phone_status);
