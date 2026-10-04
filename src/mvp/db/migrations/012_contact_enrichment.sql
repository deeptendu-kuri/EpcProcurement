-- Provider observations remain candidates until role/employment review and email validation.
alter table companies add column if not exists domain_confirmed_at timestamptz;
alter table contact_points add column if not exists validation_status text;
alter table contact_points add column if not exists validation_checked_at timestamptz;

create table enrichment_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies on delete cascade,
  opportunity_id uuid not null references search_opportunities on delete cascade,
  action text not null check (action in ('search','find','verify')),
  input_hash text not null,
  status text not null default 'running' check (status in ('running','completed','failed')),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '5 minutes'
);
create unique index enrichment_running_uniq on enrichment_requests (company_id, action, input_hash) where status = 'running';
create index enrichment_cache_idx on enrichment_requests (company_id, action, input_hash, expires_at);
create index enrichment_quota_idx on enrichment_requests (created_at);
