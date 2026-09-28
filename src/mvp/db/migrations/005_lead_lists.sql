-- 005 · Lead lists (docs/mvp/14 §10): named lists of buyers saved from SuperSearch.
create table if not exists lead_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lead_lists_updated_idx on lead_lists (updated_at desc);

create table if not exists lead_list_items (
  list_id uuid not null references lead_lists on delete cascade,
  lead_id uuid not null references leads on delete cascade,
  added_at timestamptz not null default now(),
  primary key (list_id, lead_id)
);
create index if not exists lead_list_items_lead_idx on lead_list_items (lead_id);
