// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type Db } from "@/mvp/db";
import type { RunInput } from "@/mvp/types";
import { chainQuery, planChainSearches } from "./chain";

describe("following contractors down their chain (docs/mvp/19 Phase 5)", () => {
  let db: Db;
  let run: string;
  const input: RunInput = { query: "line pipe", productId: "line-pipe", markets: ["AE"], leadKinds: ["supply_subcontract"] };
  beforeAll(async () => {
    db = await createTestDb();
    run = (await db.query<{ id: string }>("insert into runs (status, adhoc_query) values ('running', $1::jsonb) returning id", [JSON.stringify(input)])).rows[0].id;
    await db.query("insert into research_sessions (run_id, budget) values ($1, '{}'::jsonb)", [run]);
    const rows: [string, number, string][] = [["McDermott", 95, "contractor"], ["ADNOC", 85, "owner"], ["Gulf Spools", 80, "end_user"], ["Weak EPC", 40, "contractor"], ["Welspun", 5, "competitor"]];
    for (const [company, rating, type] of rows)
      await db.query("insert into research_candidates (run_id, key, company, rating, rating_buyer_type, rating_source) values ($1,$2,$2,$3,$4,'ai')", [run, company, rating, type]);
  }, 60_000);
  afterAll(async () => { await db?.close(); vi.unstubAllEnvs(); });

  it("searches once for the subcontractors of each well-rated contractor and owner", async () => {
    expect(await planChainSearches(db, run, input)).toBe(0); // no web search configured
    vi.stubEnv("TAVILY_API_KEY", "test-key");
    expect(await planChainSearches(db, run, input)).toBe(2);
    expect(await planChainSearches(db, run, input)).toBe(0); // never twice
    const jobs = (await db.query<{ priority: number; payload: { query: { query: string }; chainParent: { company: string } } }>("select priority,payload from research_jobs where run_id=$1 and key like 'chain:%' order by payload->'chainParent'->>'company'", [run])).rows;
    expect(jobs.map((j) => [j.payload.chainParent.company, j.payload.query.query, j.priority])).toEqual([
      ["ADNOC", '"ADNOC" pipeline construction subcontractor', 900],
      ["McDermott", '"McDermott" pipeline construction subcontractor', 900],
    ]);
  });
  it("uses the work that needs the exact variant", () => {
    expect(chainQuery("Metito", { productId: "ss-duplex-pipe", query: "welded stainless steel pipe" })).toBe('"Metito" water treatment and desalination plants subcontractor');
  });
});
