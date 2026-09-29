-- 006 · Company directory (docs/mvp/15 §C): what a company makes / stocks / does, and where.
--   supplier_type = a supply-map type key (pipe_maker, stockist …); item_id = catalogue item or null.
--   source: observed (seen in our data) | seed (well-known maker, cited from its own website) | user.
create table if not exists company_capabilities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies on delete cascade,
  supplier_type text not null,
  item_id text,
  country text,
  source text not null check (source in ('observed','seed','user')),
  evidence_id uuid references evidence on delete set null,
  url text,
  note text,
  created_at timestamptz not null default now()
);
create unique index if not exists company_capabilities_uniq
  on company_capabilities (company_id, supplier_type, coalesce(item_id, ''), source);
create index if not exists company_capabilities_type_idx on company_capabilities (supplier_type, country);
