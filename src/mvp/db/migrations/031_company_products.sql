-- docs/mvp/22 §3.15: the client's own products ("Our products" in Settings, shortcuts on the Dashboard).
-- Context for outreach emails and one-click searches only: the search itself never reads this list, so any
-- product can still be searched in any country.
create table if not exists company_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null unique,
  created_at timestamptz not null default now()
);

-- What the client asked for (14 Oct); editable in Settings.
insert into company_products(name, normalized_name) values
  ('Pressure Vessels', 'pressure vessels'),
  ('Separators', 'separators'),
  ('Centrifugal Fans', 'centrifugal fans'),
  ('Axial Fans', 'axial fans'),
  ('Blowers', 'blowers'),
  ('Heat Exchangers', 'heat exchangers'),
  ('API 660 Heat Exchangers', 'api 660 heat exchangers')
on conflict (normalized_name) do nothing;
