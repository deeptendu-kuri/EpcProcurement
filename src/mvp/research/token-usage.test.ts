// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/mvp/db";
import { aiTokensUsed, reserveAnalysis } from "./store";
import type { ResearchBudget } from "./store";

describe("AI token budget counts real use (docs/mvp/18 §8)", () => {
  let db: Db;
  let run: string;
  beforeAll(async () => {
    db = await createTestDb();
    run = (await db.query<{ id: string }>("insert into runs (status, adhoc_query) values ('running', '{}'::jsonb) returning id")).rows[0].id;
    await db.query("insert into research_sessions (run_id, budget) values ($1, '{}'::jsonb)", [run]);
  }, 60_000);
  afterAll(async () => { await db?.close(); });

  it("charges finished calls their reported tokens and in-flight calls their estimate", async () => {
    await db.query(`insert into research_budget_reservations (run_id, kind, key, units, outcome) values
      ($1,'ai_tokens','done-1',20000,'completed'), ($1,'ai_tokens','done-2',20000,'completed'), ($1,'ai_tokens','flying',9000,'reserved')`, [run]);
    expect(await aiTokensUsed(db, run)).toBe(49000); // no provider records yet: estimates stand in
    await db.query("insert into llm_usage (provider, model, purpose, tokens_in, tokens_out, run_id) values ('groq','m','buyer_discovery',7000,1500,$1),('groq','m','buyer_discovery',6000,1000,$1)", [run]);
    expect(await aiTokensUsed(db, run)).toBe(9000 + 15500);
    const budget = { maxAiPages: 10, maxAiTokens: 40000 } as ResearchBudget;
    expect(await reserveAnalysis(db, run, "next", 15000, budget)).toBe("reserved"); // 24.5k + 15k fits in 40k; the old sum (49k) refused it
    expect(await reserveAnalysis(db, run, "after", 2000, budget)).toBe("exhausted");
  });
});
