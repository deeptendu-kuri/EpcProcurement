create table if not exists discovery_crm_activities (
  id text primary key,
  lead_id text not null references converted_discovery_leads(id) on delete cascade,
  contact_id text references discovery_decision_makers(id) on delete set null,
  activity_type text not null check (activity_type in ('note', 'call', 'email', 'meeting', 'status_change', 'verification', 'task')),
  title text not null,
  body text,
  outcome text,
  next_step text,
  due_at timestamptz,
  source_url text,
  created_at timestamptz not null default now()
);

alter table discovery_crm_activities enable row level security;

create policy "authenticated read discovery crm activities" on discovery_crm_activities for select to authenticated using (true);

grant select, insert, update, delete on discovery_crm_activities to authenticated, service_role;

create index if not exists discovery_crm_activities_lead_idx on discovery_crm_activities(lead_id, created_at desc);
create index if not exists discovery_crm_activities_contact_idx on discovery_crm_activities(contact_id, created_at desc);
create index if not exists discovery_crm_activities_type_idx on discovery_crm_activities(activity_type, created_at desc);
