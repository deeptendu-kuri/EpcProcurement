create table if not exists discovery_contact_enrichment_jobs (
  id text primary key,
  lead_id text not null references converted_discovery_leads(id) on delete cascade,
  company_name text not null,
  project_name text,
  target_roles text[] not null default '{}',
  status text not null default 'Queued',
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  result jsonb not null default '{}',
  error text
);

create table if not exists discovery_email_verification_jobs (
  id text primary key,
  lead_id text not null references converted_discovery_leads(id) on delete cascade,
  company_name text not null,
  project_name text,
  email_status discovery_email_status not null default 'Search Queued',
  status text not null default 'Queued',
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  result jsonb not null default '{}',
  error text
);

alter table discovery_contact_enrichment_jobs enable row level security;
alter table discovery_email_verification_jobs enable row level security;

create policy "authenticated read discovery contact enrichment jobs" on discovery_contact_enrichment_jobs for select to authenticated using (true);
create policy "authenticated read discovery email verification jobs" on discovery_email_verification_jobs for select to authenticated using (true);

grant select, insert, update, delete on discovery_contact_enrichment_jobs to authenticated, service_role;
grant select, insert, update, delete on discovery_email_verification_jobs to authenticated, service_role;

create index if not exists discovery_contact_enrichment_jobs_lead_idx on discovery_contact_enrichment_jobs(lead_id, queued_at desc);
create index if not exists discovery_email_verification_jobs_lead_idx on discovery_email_verification_jobs(lead_id, queued_at desc);
create index if not exists discovery_contact_enrichment_jobs_status_idx on discovery_contact_enrichment_jobs(status, queued_at desc);
create index if not exists discovery_email_verification_jobs_status_idx on discovery_email_verification_jobs(status, queued_at desc);
