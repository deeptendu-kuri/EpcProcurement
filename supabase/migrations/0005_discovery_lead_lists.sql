create table if not exists discovery_lead_lists (
  id text primary key,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists discovery_lead_list_members (
  id text primary key,
  list_id text not null references discovery_lead_lists(id) on delete cascade,
  member_type text not null check (member_type in ('converted-lead', 'decision-maker')),
  lead_id text references converted_discovery_leads(id) on delete cascade,
  contact_id text references discovery_decision_makers(id) on delete cascade,
  added_at timestamptz not null default now(),
  check (lead_id is not null or contact_id is not null)
);

alter table discovery_lead_lists enable row level security;
alter table discovery_lead_list_members enable row level security;

create policy "authenticated read discovery lead lists" on discovery_lead_lists for select to authenticated using (true);
create policy "authenticated read discovery lead list members" on discovery_lead_list_members for select to authenticated using (true);

grant select, insert, update, delete on discovery_lead_lists to authenticated, service_role;
grant select, insert, update, delete on discovery_lead_list_members to authenticated, service_role;

create index if not exists discovery_lead_lists_created_idx on discovery_lead_lists(created_at desc);
create index if not exists discovery_lead_list_members_list_idx on discovery_lead_list_members(list_id, added_at desc);
create index if not exists discovery_lead_list_members_lead_idx on discovery_lead_list_members(lead_id);
create index if not exists discovery_lead_list_members_contact_idx on discovery_lead_list_members(contact_id);
