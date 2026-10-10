// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/mvp/db";
import { claimJob, completeJob } from "./store";
import { autoPauseIfDue, finishResearchNow, pauseResearchRun, resumePausedRun } from "./control";

let db: Db;
beforeAll(async () => { db = await createTestDb(); }, 60_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => { await db.exec("truncate runs cascade;"); });

async function search(input: Record<string, unknown> = {}) {
  const id = (await db.query<{ id: string }>("insert into runs (status, adhoc_query) values ('running', $1::jsonb) returning id", [JSON.stringify(input)])).rows[0].id;
  await db.query("insert into research_sessions (run_id, budget) values ($1, '{}'::jsonb)", [id]);
  await db.query("insert into research_jobs (run_id, stage, key, state) values ($1,'collect','a','queued'),($1,'read','b','queued')", [id]);
  return id;
}
const sessionState = async (id: string) => (await db.query<{ state: string }>("select state from research_sessions where run_id=$1", [id])).rows[0].state;
async function addLead(run: string, n: number) {
  const company = (await db.query<{ id: string }>("insert into companies (canonical_name, normalized_name) values ($1,$1) returning id", [`Example Co ${n}`])).rows[0].id;
  const lead = (await db.query<{ id: string }>("insert into leads(kind,buyer_company_id,score_breakdown,gate_results,class,reasons,scoring_version,is_sample) values('supply_subcontract',$1,'{}','[]','research','[]',1,false) returning id", [company])).rows[0].id;
  await db.query("insert into search_opportunities(run_id,lead_id,company_id,keyword,product_id,product_name,buying_reason,evidence_ids) values($1,$2,$3,'pipe','line-pipe','Line pipe','Example','{}')", [run, lead, company]);
}

describe("pause, resume and finish a search", () => {
  it("pauses without losing work: nothing new starts, a running step still finishes, resume carries on", async () => {
    const id = await search();
    const running = (await claimJob(db, id))!;
    expect(await pauseResearchRun(db, id)).toBe(true);
    expect(await sessionState(id)).toBe("paused");
    expect(await claimJob(db, id, undefined, 4)).toBeNull();
    expect(await completeJob(db, running, { ok: true })).toBe(true);
    expect((await db.query<{ status: string; counters: { researchState: string } }>("select status, counters from runs where id=$1", [id])).rows[0])
      .toMatchObject({ status: "running", counters: { researchState: "paused" } });
    expect(await pauseResearchRun(db, id)).toBe(false);
    expect(await resumePausedRun(db, id)).toBe(true);
    expect(await sessionState(id)).toBe("active");
    expect((await claimJob(db, id))?.key).toBe("b");
    expect(await resumePausedRun(db, id)).toBe(false);
  });

  it("finishes now: the rest is cancelled, the search is done and what was found is kept", async () => {
    const id = await search({ query: "line pipe" });
    await addLead(id, 1);
    await pauseResearchRun(db, id);
    expect(await finishResearchNow(db, id)).toBe(true);
    expect((await db.query<{ status: string }>("select status from runs where id=$1", [id])).rows[0].status).toBe("done");
    expect(await sessionState(id)).toBe("done");
    expect((await db.query<{ state: string }>("select distinct state from research_jobs where run_id=$1", [id])).rows).toEqual([{ state: "cancelled" }]);
    expect((await db.query("select 1 from search_opportunities where run_id=$1", [id])).rows).toHaveLength(1);
    expect(await finishResearchNow(db, id)).toBe(false);
  });

  it("pauses on its own once the leads asked for are saved, only once", async () => {
    const id = await search({ query: "line pipe", pauseAfter: 2 });
    await addLead(id, 1);
    expect(await autoPauseIfDue(db, id)).toBe(false);
    await addLead(id, 2);
    expect(await autoPauseIfDue(db, id)).toBe(true);
    expect(await sessionState(id)).toBe("paused");
    expect((await db.query<{ message: string }>("select message from run_events where run_id=$1 order by id desc limit 1", [id])).rows[0].message).toMatch(/Paused at 2 leads/);
    await resumePausedRun(db, id);
    await addLead(id, 3);
    expect(await autoPauseIfDue(db, id)).toBe(false);
    expect(await sessionState(id)).toBe("active");
  });

  it("does nothing to a search without a lead target", async () => {
    const id = await search({ query: "line pipe" });
    await addLead(id, 1);
    expect(await autoPauseIfDue(db, id)).toBe(false);
  });
});
