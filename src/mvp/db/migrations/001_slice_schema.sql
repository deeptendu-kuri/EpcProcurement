-- 001 · Showcase slice schema (docs/mvp/12 §4, columns per docs/mvp/04 minus embeddings).
-- Portable to PGlite and Postgres/Supabase: text + check constraints instead of enums,
-- uuid ids with gen_random_uuid() (core since PG13).
--
-- Slice-specific deviations from 04 (documented here so builders do not have to guess):
--   * There is no `sources`, `tenders`, `client_profile` or `client_products` table in the slice.
--     Sources are identified by `source_key` text; tenders by `tender_ref` text; client products by
--     the `id` string of a product in src/mvp/config/client-profile.json.
--   * `is_sample` marks rows derived from offline fixtures (UI shows a "Sample data" badge).
--   * leads get `closing_date`, `signal_ids`, `reject_reason` and `updated_at` for the inbox.
--   * outreach_drafts gets `blocked_reason`; llm_usage gets `error`.

-- ───────────────────────── runs and progress ─────────────────────────
create table runs (
  id uuid primary key default gen_random_uuid(),
  adhoc_query jsonb,                                  -- RunInput for "Search now"
  status text not null default 'queued'
    check (status in ('queued','running','done','failed','cancelled')),
  started_at timestamptz,
  finished_at timestamptz,
  counters jsonb not null default '{}',               -- RunCounters (src/mvp/types.ts)
  error text,
  created_at timestamptz not null default now()
);
create index runs_created_idx on runs (created_at desc);

create table run_events (
  id bigserial primary key,
  run_id uuid not null references runs on delete cascade,
  ts timestamptz not null default now(),
  stage text not null
    check (stage in ('collect','read','filter','extract','check','resolve','signals','score','research','done','error','info')),
  message text not null,
  counters jsonb
);
create index run_events_run_idx on run_events (run_id, id);

-- ───────────────────────── sources and documents ─────────────────────────
create table source_documents (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,                           -- 'ted' | 'gdelt' | 'rss:<host>' | 'fixture'
  source_name text,                                   -- human label, e.g. "EU TED"
  tier text not null default 'C' check (tier in ('A','B','C')),
  publisher_key text not null,                        -- normalised domain group
  url text not null,
  canonical_url text not null unique,
  title text,
  language text,
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  content_hash text not null,
  text text,                                          -- cleaned full text (slice stores it inline)
  status text not null default 'new'
    check (status in ('new','filtered_out','queued','extracted','failed')),
  filter_reason text,
  run_id uuid references runs on delete set null,
  is_sample boolean not null default false,
  created_at timestamptz not null default now()
);
create index source_documents_status_idx on source_documents (status, fetched_at desc);
create index source_documents_hash_idx on source_documents (content_hash);
create index source_documents_run_idx on source_documents (run_id);

-- ───────────────────────── evidence and provenance ─────────────────────────
create table evidence (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references source_documents on delete cascade,
  url text not null,
  quote text not null,
  char_start int,
  char_end int,
  extracted_by text not null,                         -- 'rule:<name>' | 'model:<provider>/<model>' | 'structured:<source>'
  quote_verified boolean not null,
  agreement text check (agreement in ('both','single','rule')),
  tier text not null check (tier in ('A','B','C')),
  publisher_key text not null,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index evidence_document_idx on evidence (document_id);

create table fact_evidence (
  entity_type text not null
    check (entity_type in ('company','project','package','requirement','tender','person','person_role',
                           'project_party','relationship','contact_point','signal','project_stage_event')),
  entity_id uuid not null,
  field text not null,                                -- column name, or '*' for the whole row
  evidence_id uuid not null references evidence on delete cascade,
  primary key (entity_type, entity_id, field, evidence_id)
);
create index fact_evidence_evidence_idx on fact_evidence (evidence_id);

-- ───────────────────────── companies, projects, packages ─────────────────────────
create table companies (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  normalized_name text not null,
  country text,
  types text[] not null default '{}',                 -- CompanyType[]
  registry_source text,
  registry_id text,
  lei text,
  domain text,
  parent_company_id uuid references companies,
  listed_exchange text,
  ticker text,
  status text,                                        -- active | struck_off | unknown
  size_band text,
  match_certainty numeric not null default 0.6 check (match_certainty between 0 and 1),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create unique index companies_registry_uniq on companies (registry_source, registry_id) where registry_id is not null;
create index companies_normalized_idx on companies (normalized_name, country);
create index companies_domain_idx on companies (domain) where domain is not null;

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  owner_company_id uuid references companies,
  country text,
  site text,
  region text,
  sector text,                                        -- oil_gas | water | power | petrochemical | infrastructure | mining | other
  project_type text,
  current_stage text check (current_stage in ('concept','feasibility','feed','prequalification','epc_tender','awarded',
    'detailed_engineering','procurement','construction','commissioning','operations','on_hold','cancelled','completed')),
  estimated_value numeric,
  currency text,
  value_usd numeric,
  funding_status text,                                -- announced | budgeted | fid | awarded | unknown
  start_date date,
  end_date date,
  specs jsonb not null default '{}',
  status text not null default 'active' check (status in ('active','cancelled','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index projects_normalized_idx on projects (normalized_name, country);
create index projects_owner_idx on projects (owner_company_id);

create table project_stage_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  stage text not null check (stage in ('concept','feasibility','feed','prequalification','epc_tender','awarded',
    'detailed_engineering','procurement','construction','commissioning','operations','on_hold','cancelled','completed')),
  event_date date,
  evidence_id uuid references evidence on delete set null,
  created_at timestamptz not null default now()
);
create index project_stage_events_project_idx on project_stage_events (project_id, event_date);

create table packages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  discipline text not null check (discipline in ('civil_structural','static_equipment','rotating_equipment','piping','pipeline',
    'electrical','instrumentation_control','telecom','hvac','fire_safety','insulation_painting','logistics_heavy_lift',
    'procurement_services','construction_services','commissioning_services','engineering_services','other')),
  name text not null,
  scope_text text,
  package_owner_company_id uuid references companies,
  procurement_route text check (procurement_route in ('open_tender','prequal','approved_vendor_list','direct','unknown')),
  status text check (status in ('planned','tendering','awarded','in_progress','closed')),
  estimated_value numeric,
  currency text,
  value_usd numeric,
  needed_by date,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index packages_project_idx on packages (project_id);

create table requirements (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages on delete cascade,
  item_category text not null,
  client_product_id text,                             -- id of a product in client-profile.json
  spec jsonb not null default '{}',
  quantity numeric,
  unit text,
  needed_by date,
  delivery_site text,
  delivery_port text,
  incoterm text,
  transport_mode text,
  hs_code text,
  created_at timestamptz not null default now()
);
create index requirements_package_idx on requirements (package_id);

create table project_parties (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  company_id uuid not null references companies,
  role text not null check (role in ('owner','pmc','consultant','main_epc','consortium_member','subcontractor',
    'supplier','logistics','financier')),
  package_id uuid references packages on delete set null,
  scope_text text,
  contract_value numeric,
  currency text,
  value_usd numeric,
  award_date date,
  status text check (status in ('announced','awarded','active','completed','terminated')),
  created_at timestamptz not null default now()
);
create index project_parties_project_idx on project_parties (project_id);
create index project_parties_company_idx on project_parties (company_id, award_date);

-- ───────────────────────── people ─────────────────────────
create table people (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  normalized_name text not null,
  current_company_id uuid references companies,
  title text,
  department text,
  seniority text check (seniority in ('executive','director','manager','specialist')),
  country text,
  profile_url text,
  created_at timestamptz not null default now()
);
create index people_company_idx on people (current_company_id);
create index people_normalized_idx on people (normalized_name);

create table person_roles (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people on delete cascade,
  company_id uuid references companies,
  project_id uuid references projects on delete cascade,
  package_id uuid references packages on delete cascade,
  buying_role text not null check (buying_role in ('decision_maker','project_director','procurement_lead','package_manager',
    'technical_evaluator','discipline_lead','expediting','logistics_coordinator','tender_contact','executive','other')),
  works_with_person_id uuid references people on delete set null,
  start_date date,
  end_date date,
  created_at timestamptz not null default now()
);
create index person_roles_person_idx on person_roles (person_id);
create index person_roles_project_idx on person_roles (project_id);

-- ───────────────────────── relationship graph ─────────────────────────
create table relationships (
  id uuid primary key default gen_random_uuid(),
  from_company_id uuid not null references companies,
  to_company_id uuid not null references companies,
  type text not null check (type in ('awarded_to','subcontracted_to','supplied_by','partnered_with','approved_vendor_of')),
  project_id uuid references projects on delete cascade,
  package_id uuid references packages on delete set null,
  discipline text check (discipline in ('civil_structural','static_equipment','rotating_equipment','piping','pipeline',
    'electrical','instrumentation_control','telecom','hvac','fire_safety','insulation_painting','logistics_heavy_lift',
    'procurement_services','construction_services','commissioning_services','engineering_services','other')),
  event_date date,
  value_usd numeric,
  created_at timestamptz not null default now()
);
create index relationships_from_idx on relationships (from_company_id, type);
create index relationships_to_idx on relationships (to_company_id, type);

-- ───────────────────────── signals and leads ─────────────────────────
create table signals (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('capex_plan','project_announced','feed_awarded','permit_approved',
    'prequalification_opened','tender_released','tender_closing_soon','bid_results_published','contract_awarded',
    'subcontract_awarded','supply_order_announced','vendor_registration_opened','approved_vendor_listed',
    'hiring_project_roles','import_shipment','engagement')),
  signal_date date not null,
  company_id uuid references companies,
  project_id uuid references projects on delete cascade,
  package_id uuid references packages on delete set null,
  tender_ref text,
  summary text not null,
  fingerprint text not null unique,
  evidence_ids uuid[] not null default '{}',
  run_id uuid references runs on delete set null,
  created_at timestamptz not null default now()
);
create index signals_company_idx on signals (company_id, signal_date desc);
create index signals_project_idx on signals (project_id, signal_date desc);

create table leads (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('bid','supply_subcontract')),
  buyer_company_id uuid not null references companies,
  project_id uuid references projects on delete cascade,
  package_id uuid references packages on delete cascade,
  tender_ref text,
  client_product_ids text[] not null default '{}',
  signal_ids uuid[] not null default '{}',
  score int check (score between 0 and 100),
  score_breakdown jsonb not null,                     -- ScoreBreakdown
  gate_results jsonb not null,                        -- GateResult[]
  confidence numeric check (confidence between 0 and 1),
  confidence_band text check (confidence_band in ('high','medium','low')),
  class text not null check (class in ('genuine','research','watch','rejected')),
  reasons jsonb not null,                             -- Reason[]
  status text not null default 'new'
    check (status in ('new','accepted','rejected','contacted','rfq','quoted','won','lost')),
  reject_reason text,
  owner_user_id text,
  next_action text,
  closing_date date,
  scoring_version int not null,
  is_sample boolean not null default false,
  run_id uuid references runs on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint leads_candidate_uniq unique nulls not distinct (buyer_company_id, project_id, package_id, kind)
);
create index leads_class_idx on leads (class, score desc, created_at desc);
create index leads_status_idx on leads (status);
create index leads_run_idx on leads (run_id);

create table lead_score_history (
  id bigserial primary key,
  lead_id uuid not null references leads on delete cascade,
  scored_at timestamptz not null default now(),
  score int,
  confidence numeric,
  class text check (class in ('genuine','research','watch','rejected')),
  scoring_version int
);
create index lead_score_history_lead_idx on lead_score_history (lead_id, scored_at desc);

-- ───────────────────────── workflow ─────────────────────────
create table activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads on delete cascade,
  person_id uuid references people on delete set null,
  type text not null check (type in ('note','status_change','email_draft','email_sent','call','meeting')),
  body text,
  user_id text,
  created_at timestamptz not null default now()
);
create index activities_lead_idx on activities (lead_id, created_at desc);

create table outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads on delete cascade,
  person_id uuid references people on delete set null,
  subject text,
  body text,
  language text,
  status text not null default 'draft' check (status in ('draft','approved','sent_externally')),
  blocked_reason text,
  model text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index outreach_drafts_lead_idx on outreach_drafts (lead_id, created_at desc);

create table llm_usage (
  id bigserial primary key,
  ts timestamptz not null default now(),
  provider text not null,
  model text,
  purpose text,                                       -- LLMRole or finer purpose
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  run_id uuid,
  ok boolean not null default true,
  error text
);
create index llm_usage_provider_ts_idx on llm_usage (provider, ts);
