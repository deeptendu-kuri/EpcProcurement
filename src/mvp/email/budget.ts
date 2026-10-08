import type { Queryable } from "@/mvp/db";
/** All demo paths share a small combined cap, including failed first attempts. */
export const DEMO_DAILY_LIMIT = 10;

// Internal audit namespace in the existing durable-receipts store, not a provider webhook.
// Retain only attempt identity/time when an operator clears demo conversations. No email PII.
const RESET_AUDIT_PROVIDER = "demo-reset-audit";
const RESET_AUDIT_EVENT = "outbound_first_attempt";

export async function demoAttemptsToday(db: Queryable) {
  return (await db.query<{count:number}>(`select count(*)::int as count from (
    select 'funnel:' || id::text as attempt from funnel_messages
      where direction='out' and first_attempt_at>=date_trunc('day',now())
    union
    select 'draft:' || id::text from outreach_drafts
      where delivery_first_attempt_at>=date_trunc('day',now())
    union
    select event_id from provider_webhook_receipts
      where provider=$1 and event_type=$2 and received_at>=date_trunc('day',now())
  ) attempts`, [RESET_AUDIT_PROVIDER, RESET_AUDIT_EVENT])).rows[0].count;
}

/** Call within the operator's reset transaction, after workers drain and before deleting history. */
export async function archiveDemoAttempts(db: Queryable): Promise<void> {
  await db.query(`insert into provider_webhook_receipts
    (provider,event_id,event_type,received_at,processed_at)
    select $1,'funnel:' || id::text,$2,first_attempt_at,now() from funnel_messages
      where direction='out' and first_attempt_at is not null
    union all
    select $1,'draft:' || id::text,$2,delivery_first_attempt_at,now() from outreach_drafts
      where delivery_first_attempt_at is not null
    on conflict (provider,event_id) do nothing`, [RESET_AUDIT_PROVIDER, RESET_AUDIT_EVENT]);
}
