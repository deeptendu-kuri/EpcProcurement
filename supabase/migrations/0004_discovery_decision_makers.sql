create table if not exists discovery_decision_makers (
  id text primary key,
  lead_id text not null references converted_discovery_leads(id) on delete cascade,
  company_name text not null,
  name text not null,
  title text not null,
  department text not null,
  seniority text not null,
  location text,
  linkedin_url text,
  email text,
  email_status discovery_email_status not null default 'Email Not Found',
  verification_source text,
  source_url text,
  status text not null default 'Found',
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table discovery_decision_makers enable row level security;

create policy "authenticated read discovery decision makers" on discovery_decision_makers for select to authenticated using (true);

grant select, insert, update, delete on discovery_decision_makers to authenticated, service_role;

create index if not exists discovery_decision_makers_lead_idx on discovery_decision_makers(lead_id, created_at desc);
create index if not exists discovery_decision_makers_company_idx on discovery_decision_makers(company_name);
create index if not exists discovery_decision_makers_email_idx on discovery_decision_makers(email_status);
