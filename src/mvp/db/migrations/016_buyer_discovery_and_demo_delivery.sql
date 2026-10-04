alter table search_opportunities add column discovery_kind text not null default 'project'
  check (discovery_kind in ('project','company'));
alter table search_opportunities add column fit_score integer not null default 0 check (fit_score between 0 and 100);
create table buyer_discovery_cache (
  document_id uuid not null references source_documents on delete cascade,
  content_hash text not null, product_id text not null, version integer not null,
  result jsonb not null, created_at timestamptz not null default now(),
  primary key(document_id,content_hash,product_id,version)
);
alter table funnel_threads drop constraint funnel_threads_mode_check;
alter table funnel_threads add constraint funnel_threads_mode_check check (mode in ('buyer','email_test','prospect_demo'));
alter table funnel_threads drop constraint funnel_thread_context_check;
alter table funnel_threads add constraint funnel_thread_context_check check (
  (mode in ('buyer','prospect_demo') and opportunity_id is not null and company_id is not null and test_product is null)
  or (mode='email_test' and opportunity_id is null and company_id is null and test_product is not null)
);
