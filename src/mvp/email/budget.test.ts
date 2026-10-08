// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/mvp/db";
import { archiveDemoAttempts, demoAttemptsToday } from "./budget";

let db: Db;
let thread: string;
let lead: string;
beforeAll(async () => { db = await createTestDb(); }, 120_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("delete from funnel_messages; delete from funnel_threads; delete from outreach_drafts; delete from leads; delete from companies; delete from provider_webhook_receipts;");
  thread = (await db.query<{id:string}>(`insert into funnel_threads
    (mode,recipient,product_id,test_product,reply_token)
    values('email_test','example@example.com','line-pipe','Example line pipe',gen_random_uuid()::text) returning id`)).rows[0].id;
  const company = (await db.query<{id:string}>("insert into companies(canonical_name,normalized_name) values('Example Buyer','example buyer') returning id")).rows[0].id;
  lead = (await db.query<{id:string}>(`insert into leads(kind,buyer_company_id,score_breakdown,gate_results,class,reasons,scoring_version)
    values('supply_subcontract',$1,'{}','[]','research','[]',1) returning id`, [company])).rows[0].id;
});
async function message(at: "today" | "yesterday" | "none" = "today", direction = "out") {
  return (await db.query<{id:string}>(`insert into funnel_messages
    (thread_id,direction,kind,dedup_key,subject,body,state,first_attempt_at)
    values($1,$2,'initial',gen_random_uuid()::text,'Example subject','Example body','review',
      case $3 when 'today' then now() when 'yesterday' then date_trunc('day',now())-interval '1 hour' else null end) returning id`, [thread, direction, at])).rows[0].id;
}
async function draft() {
  await db.query("insert into outreach_drafts(lead_id,subject,body,delivery_first_attempt_at) values($1,'Example subject','Example body',now())", [lead]);
}

describe("reset-safe shared demo delivery budget", () => {
  it("counts attempted messages and drafts, including failures, but not inbound or unsent mail", async () => {
    await message(); await draft(); await message("none"); await message("today", "in");
    expect(await demoAttemptsToday(db)).toBe(2);
  });
  it("keeps the same daily count after both histories are deleted", async () => {
    await message(); await draft();
    await db.tx(async tx => {
      await archiveDemoAttempts(tx);
      await tx.exec("delete from funnel_messages; delete from outreach_drafts;");
      expect(await demoAttemptsToday(tx)).toBe(2);
    });
    expect(await demoAttemptsToday(db)).toBe(2);
  });
  it("never double-counts archived attempts still present in live history", async () => {
    await message(); await draft(); await archiveDemoAttempts(db); await archiveDemoAttempts(db);
    expect(await demoAttemptsToday(db)).toBe(2);
    expect((await db.query("select * from provider_webhook_receipts")).rows).toHaveLength(2);
  });
  it("counts new attempts after a reset without losing previous attempts", async () => {
    await message(); await archiveDemoAttempts(db); await db.exec("delete from funnel_messages;");
    await message(); await archiveDemoAttempts(db);
    expect(await demoAttemptsToday(db)).toBe(2);
  });
  it("does not carry yesterday's archived attempts into today's allowance", async () => {
    await message("yesterday"); await archiveDemoAttempts(db); await db.exec("delete from funnel_messages;");
    expect(await demoAttemptsToday(db)).toBe(0);
  });
  it("ignores actual provider webhooks and unrelated internal receipts", async () => {
    await db.query(`insert into provider_webhook_receipts(provider,event_id,event_type)
      values('resend','Example webhook','email.delivered'),('demo-reset-audit','Example unrelated','other')`);
    expect(await demoAttemptsToday(db)).toBe(0);
  });
  it("archives only attempt identities and timestamps, with no recipient, subject or body", async () => {
    const id = await message(); await draft(); await message("none"); await message("today", "in");
    await archiveDemoAttempts(db);
    const rows = (await db.query("select * from provider_webhook_receipts order by event_id")).rows;
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual(expect.objectContaining({event_id:`funnel:${id}`,resource_id:null}));
    expect(JSON.stringify(rows)).not.toMatch(/example@example.com|Example subject|Example body/);
  });
  it("rolls back the archive and deletion together on a failed reset", async () => {
    await message();
    await expect(db.tx(async tx => {
      await archiveDemoAttempts(tx); await tx.exec("delete from funnel_messages;");
      throw new Error("Example reset interrupted");
    })).rejects.toThrow("Example reset interrupted");
    expect((await db.query("select * from provider_webhook_receipts")).rows).toHaveLength(0);
    expect(await demoAttemptsToday(db)).toBe(1);
  });
});
