-- Additive queue: never migrate, relabel or send historic drafts automatically.
create table demo_campaigns (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null unique references outreach_drafts on delete cascade,
  opportunity_id uuid not null references search_opportunities on delete cascade,
  company_id uuid not null references companies,
  product_id text not null,
  contact_key text not null,
  recipient text not null check (recipient = 'deeptendukuri@gmail.com'),
  status text not null default 'queued' check (status in ('queued','sending','accepted','paused','cancelled','review')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  locked_until timestamptz,
  last_error text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Same company/product/contact found in two searches must not receive duplicate campaigns.
create unique index demo_campaign_contact_idx on demo_campaigns (company_id, product_id, contact_key) where status <> 'cancelled';
create index demo_campaign_due_idx on demo_campaigns (next_attempt_at) where status in ('queued','sending');
