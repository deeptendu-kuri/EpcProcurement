-- Company switchboards/inboxes are not people and never qualify for Verified CRM.
create table if not exists public_company_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies on delete cascade,
  domain text not null,
  kind text not null check (kind in ('email','phone')),
  value text not null,
  source_url text not null,
  quote text not null,
  observed_at timestamptz not null default now(),
  unique (company_id, domain, kind, value, source_url)
);
