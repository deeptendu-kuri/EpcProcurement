-- Demo delivery is separate from the legacy "marked as sent externally" action.
alter table outreach_drafts
  add column demo_only boolean not null default false,
  add column delivery_state text check (delivery_state in ('sending', 'sent', 'failed')),
  add column delivery_recipient text,
  add column delivery_from text,
  add column provider_message_id text,
  add column delivery_error text,
  add column delivery_first_attempt_at timestamptz,
  add column delivery_attempted_at timestamptz,
  add column delivery_sent_at timestamptz;

create index outreach_drafts_delivery_idx on outreach_drafts (delivery_first_attempt_at)
  where delivery_first_attempt_at is not null;
