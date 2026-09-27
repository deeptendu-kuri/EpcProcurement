create type discovery_candidate_stage as enum ('New', 'Researching', 'Contact Needed', 'Qualified', 'Rejected');
create type discovery_enrichment_status as enum ('Not Started', 'Decision Maker Search Queued', 'Decision Makers Found');
create type discovery_email_status as enum ('Email Not Found', 'Search Queued', 'Verification Pending', 'Verified', 'Risky');

create table saved_discovery_searches (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  query text,
  regions text[] not null default '{}',
  keywords text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table discovery_candidates (
  id text primary key,
  company_name text not null,
  country text,
  project_name text,
  signal_type text,
  stage discovery_candidate_stage not null default 'New',
  notes text,
  confidence numeric check (confidence >= 0 and confidence <= 1),
  requirement_summary text,
  source_url text not null,
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table converted_discovery_leads (
  id text primary key references discovery_candidates(id) on delete cascade,
  company_name text not null,
  country text,
  project_name text,
  signal_type text,
  crm_status discovery_candidate_stage not null default 'Contact Needed',
  enrichment_status discovery_enrichment_status not null default 'Not Started',
  email_status discovery_email_status not null default 'Email Not Found',
  target_roles text[] not null default '{}',
  notes text,
  confidence numeric check (confidence >= 0 and confidence <= 1),
  requirement_summary text,
  source_url text not null,
  converted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table saved_discovery_searches enable row level security;
alter table discovery_candidates enable row level security;
alter table converted_discovery_leads enable row level security;

create policy "authenticated read saved discovery searches" on saved_discovery_searches for select to authenticated using (true);
create policy "authenticated read discovery candidates" on discovery_candidates for select to authenticated using (true);
create policy "authenticated read converted discovery leads" on converted_discovery_leads for select to authenticated using (true);

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on saved_discovery_searches to authenticated, service_role;
grant select, insert, update, delete on discovery_candidates to authenticated, service_role;
grant select, insert, update, delete on converted_discovery_leads to authenticated, service_role;

create index discovery_candidates_stage_idx on discovery_candidates(stage, saved_at desc);
create index discovery_candidates_country_idx on discovery_candidates(country);
create index converted_discovery_leads_status_idx on converted_discovery_leads(crm_status, converted_at desc);
create index converted_discovery_leads_email_idx on converted_discovery_leads(email_status);
