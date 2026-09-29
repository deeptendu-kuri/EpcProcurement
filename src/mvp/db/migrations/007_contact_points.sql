-- 007 · Contacts across the chain (docs/mvp/15 §E): contact points of a person, and manual people.
create table if not exists contact_points (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people on delete cascade,
  kind text not null check (kind in ('email','phone','linkedin')),
  value text not null,
  source text not null default 'manual',          -- manual | provider:<name> | source
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists contact_points_uniq on contact_points (person_id, kind, value);

alter table people add column if not exists source text;            -- null = named in a source; 'manual' = added by a user
alter table people add column if not exists slot_id text;           -- buying-team slot the user added them for
alter table people add column if not exists notes text;
alter table people add column if not exists confirmed_at timestamptz; -- decision maker confirmed by a user
