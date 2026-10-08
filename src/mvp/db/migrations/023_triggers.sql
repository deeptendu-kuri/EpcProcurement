-- Hybrid provenance; applied only by the isolated/local PGlite workflow in this package.
create table company_triggers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies on delete cascade,
  run_id uuid references runs on delete set null,
  product_id text,
  kind text not null check (kind in ('award','order','tender','subcontract','capability')),
  role text not null check (role in ('contractor','subcontractor','supplier','owner')),
  project_id uuid references projects,
  title text not null,
  value_usd numeric, value_text text,
  event_date date,
  date_precision text check (date_precision in ('day','month','year','unknown')),
  country text,
  evidence_ids uuid[] not null,
  strength text not null check (strength in ('confirmed','likely','possible')),
  created_at timestamptz default now()
);
create index on company_triggers (company_id, event_date desc);
alter table search_opportunities add column trigger_id uuid references company_triggers;
alter table search_opportunities add column trigger_kind text;
alter table search_opportunities add column trigger_date date;
alter table search_opportunities add column operating_country text;
alter table companies add column operating_countries text[] not null default '{}';
alter table research_candidates add column found_via jsonb;
alter table chain_links add column strength text not null default 'possible' check(strength in ('confirmed','likely','possible'));
alter table chain_links add column evidence_ids uuid[] not null default '{}';
alter table chain_links add column project_id uuid references projects;
-- Preserve WP4's separately verified operating-country facts, never backfill from HQ or a query.
update companies c set operating_countries=array(
  select distinct split_part(fe.field,':',2) from fact_evidence fe
  join evidence e on e.id=fe.evidence_id join source_documents d on d.id=e.document_id
  where fe.entity_type='company' and fe.entity_id=c.id and fe.field like 'operating_country:%'
    and e.quote_verified=true and position(e.quote in d.text)>0
);
