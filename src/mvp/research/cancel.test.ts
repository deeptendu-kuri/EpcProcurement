// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/mvp/db";
import { cancelResearchRun } from "./store";

describe("stopping a search", () => {
  let db: Db;
  let run: string;
  beforeAll(async () => {
    db = await createTestDb();
    run = (await db.query<{ id: string }>("insert into runs (status, adhoc_query) values ('running', '{}'::jsonb) returning id")).rows[0].id;
    await db.query("insert into research_sessions (run_id, budget) values ($1, '{}'::jsonb)", [run]);
    await db.query("insert into research_jobs (run_id, stage, key, state) values ($1,'collect','a','queued'),($1,'read','b','running'),($1,'read','c','done')", [run]);
    await db.query("insert into research_candidates (run_id, key, company) values ($1,'krr','KRR Engineering')", [run]);
  }, 60_000);
  afterAll(async () => { await db?.close(); });

  it("cancels unfinished work, keeps what was found and says so", async () => {
    expect(await cancelResearchRun(db, run)).toBe(true);
    expect((await db.query<{ status: string; error: string }>("select status, error from runs where id=$1", [run])).rows[0]).toEqual({ status: "cancelled", error: "Stopped by you." });
    expect((await db.query<{ state: string }>("select state from research_sessions where run_id=$1", [run])).rows[0].state).toBe("cancelled");
    expect((await db.query<{ key: string; state: string }>("select key, state from research_jobs where run_id=$1 order by key", [run])).rows)
      .toEqual([{ key: "a", state: "cancelled" }, { key: "b", state: "cancelled" }, { key: "c", state: "done" }]);
    expect((await db.query("select 1 from research_candidates where run_id=$1", [run])).rows).toHaveLength(1);
    expect((await db.query<{ message: string }>("select message from run_events where run_id=$1", [run])).rows[0].message).toMatch(/stopped by you/i);
    expect(await cancelResearchRun(db, run)).toBe(false); // already stopped
  });
});

describe("parallel steps (docs/mvp/19 Phase 4)", () => {
  it("lets several steps of one search run at once, but only one AI analysis", async () => {
    const { claimJob } = await import("./store");
    const db2 = await createTestDb();
    try {
      const id = (await db2.query<{ id: string }>("insert into runs (status, adhoc_query) values ('running', '{}'::jsonb) returning id")).rows[0].id;
      await db2.query("insert into research_sessions (run_id, budget) values ($1, '{}'::jsonb)", [id]);
      await db2.query(`insert into research_jobs (run_id, stage, key, priority) values ($1,'collect','ae-news',100),($1,'collect','de-news',100),($1,'read','page',90),
        ($1,'analyse','a1',80),($1,'analyse','a2',80)`, [id]);
      // Sequential default: one at a time.
      expect(await claimJob(db2, id)).not.toBeNull();
      expect(await claimJob(db2, id)).toBeNull();
      // Four slots: the other news search and the page read start too, plus one analysis, never two.
      const claimed = [await claimJob(db2, id, undefined, 4), await claimJob(db2, id, undefined, 4), await claimJob(db2, id, undefined, 4), await claimJob(db2, id, undefined, 4)];
      expect(claimed.filter(Boolean).map((j) => j!.stage).sort()).toEqual(["analyse", "collect", "read"]);
    } finally { await db2.close(); }
  }, 60_000);
});
