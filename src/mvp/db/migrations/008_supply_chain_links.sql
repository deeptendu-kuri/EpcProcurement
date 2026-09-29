-- 008 · Supply-chain links set by users, and derived buyers (docs/mvp/15 §B, §D).
--   A user sets (action 'set') or removes (action 'removed') the company that supplies a parent
--   company in one supplier type. The latest row per (parent, type, company) wins.
create table if not exists chain_links (
  id uuid primary key default gen_random_uuid(),
  parent_company_id uuid not null references companies on delete cascade,
  supplier_type text not null,
  company_id uuid not null references companies on delete cascade,
  action text not null check (action in ('set','removed')),
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists chain_links_parent_idx on chain_links (parent_company_id, supplier_type, created_at desc);

-- A lead materialised from a derived (tier 2 / 3) buyer keeps its tier and the tier-1 deal it came from.
alter table leads add column if not exists chain_tier int check (chain_tier between 1 and 3);
alter table leads add column if not exists found_via_lead_id uuid references leads on delete set null;
