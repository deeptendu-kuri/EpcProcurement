-- Priority is explainable ranking, never proof of an actual purchasing requirement.
alter table search_opportunities add column if not exists material_fit_kind text not null default 'potential'
  check (material_fit_kind in ('explicit','potential'));
alter table search_opportunities add column if not exists activity_status text not null default 'unknown'
  check (activity_status in ('recent','ongoing','capability_only','historic','unknown'));
alter table search_opportunities add column if not exists activity_date date;
alter table search_opportunities add column if not exists activity_quote text;
alter table search_opportunities add column if not exists priority_components jsonb not null default '{}';
alter table search_opportunities add column if not exists discovery_version integer not null default 0;
