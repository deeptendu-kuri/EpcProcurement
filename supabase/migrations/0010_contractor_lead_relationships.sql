alter table discovery_candidates
  add column if not exists lead_type text not null default 'owner',
  add column if not exists parent_lead_id text,
  add column if not exists parent_company_name text,
  add column if not exists parent_project_name text,
  add column if not exists contractor_role text,
  add column if not exists contractor_scope text,
  add column if not exists package_hint text;

alter table converted_discovery_leads
  add column if not exists lead_type text not null default 'owner',
  add column if not exists parent_lead_id text,
  add column if not exists parent_company_name text,
  add column if not exists parent_project_name text,
  add column if not exists contractor_role text,
  add column if not exists contractor_scope text,
  add column if not exists package_hint text;

create index if not exists discovery_candidates_parent_lead_idx on discovery_candidates(parent_lead_id);
create index if not exists converted_discovery_leads_parent_lead_idx on converted_discovery_leads(parent_lead_id);
