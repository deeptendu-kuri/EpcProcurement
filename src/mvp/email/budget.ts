import type { Queryable } from "@/mvp/db";
/** All demo paths share a small combined cap, including failed first attempts. */
export const DEMO_DAILY_LIMIT = 10;
export async function demoAttemptsToday(db: Queryable) {
  return (await db.query<{count:number}>(`select ((select count(*) from funnel_messages where direction='out' and first_attempt_at>=date_trunc('day',now()))
    +(select count(*) from outreach_drafts where delivery_first_attempt_at>=date_trunc('day',now())))::int as count`)).rows[0].count;
}
