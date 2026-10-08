-- Discovery seeds are research records, not qualified buyers or verified contacts.
create table research_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references research_sessions(run_id) on delete cascade,
  key text not null, company text not null, domain_hint text,
  identity_document_id uuid references source_documents(id), identity_quote text,
  state text not null default 'investigating' check (state in ('investigating','qualified','review','unreadable')),
  reason text, document_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(run_id,key)
);
create table research_bundle_cache (
  candidate_id uuid not null references research_candidates(id) on delete cascade,
  content_hash text not null, product_id text not null, version int not null,
  result jsonb not null, created_at timestamptz not null default now(),
  primary key(candidate_id,content_hash,product_id,version)
);
