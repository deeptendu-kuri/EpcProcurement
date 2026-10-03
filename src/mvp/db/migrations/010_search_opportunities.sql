-- Search provenance is immutable; a lead may appear in more than one product/search.
create table run_documents (
  run_id uuid not null references runs on delete cascade,
  document_id uuid not null references source_documents on delete cascade,
  primary key (run_id, document_id)
);
create table search_opportunities (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs on delete cascade,
  lead_id uuid not null references leads on delete cascade,
  company_id uuid not null references companies,
  keyword text not null,
  product_id text not null,
  product_name text not null,
  contact_role text not null default 'buyer',
  buying_reason text not null,
  evidence_ids uuid[] not null,
  qualification text not null default 'pending' check (qualification in ('pending','approved','rejected')),
  summary text not null default '',
  owner_name text not null default '',
  next_action text not null default '',
  follow_up_at timestamptz,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (run_id, company_id, product_id)
);
create index search_opportunities_lead_idx on search_opportunities (lead_id);
create table opportunity_events (
  id bigserial primary key,
  opportunity_id uuid not null references search_opportunities on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
alter table outreach_drafts add column opportunity_id uuid references search_opportunities on delete set null;
create index outreach_drafts_opportunity_idx on outreach_drafts (opportunity_id, created_at desc);
alter table saved_searches add column product_id text;
alter table saved_searches add column contact_role text;
-- Do not guess a product for historic runs. These stay in the explicitly labelled legacy view.
