-- Preserve historic recipients: configuration changes must never retarget frozen messages.
alter table demo_campaigns drop constraint demo_campaigns_recipient_check;
alter table demo_campaigns add constraint demo_campaigns_recipient_check
  check (recipient ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$');
alter table funnel_suppressions drop constraint funnel_suppressions_recipient_check;
alter table funnel_suppressions add constraint funnel_suppressions_recipient_check
  check (recipient ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$');
alter table funnel_threads add column recipient text not null default 'deeptendukuri@gmail.com';
alter table funnel_threads add column mode text not null default 'buyer' check (mode in ('buyer','email_test'));
alter table funnel_threads add column test_product text;
alter table funnel_threads alter column opportunity_id drop not null;
alter table funnel_threads alter column company_id drop not null;
alter table funnel_threads add constraint funnel_thread_context_check check (
  (mode='buyer' and opportunity_id is not null and company_id is not null and test_product is null)
  or (mode='email_test' and opportunity_id is null and company_id is null and test_product is not null)
);
create unique index funnel_single_email_test_idx on funnel_threads(recipient) where mode='email_test';
create table contact_verification_requests (
  id uuid primary key default gen_random_uuid(), provider text not null check (provider='emailable'),
  email_hash text not null, status text not null check (status in ('running','completed','failed')),
  result jsonb, created_at timestamptz not null default now(), expires_at timestamptz not null
);
create index contact_verification_lookup_idx on contact_verification_requests(provider,email_hash,expires_at);
