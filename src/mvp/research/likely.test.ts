// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, setDbForTests, type Db } from "@/mvp/db";
import type { RawDoc } from "@/mvp/pipeline/contracts";
import type { RunInput } from "@/mvp/types";
import { storeDocument } from "@/mvp/pipeline/read";
import { buyerPriority } from "@/mvp/discovery/activity";
import { saveLikelyBuyers } from "./likely";
import { listFoundCompanies } from "./found";
import { minimumBuyers } from "./limits";

const input: RunInput = { query: "line pipe", productId: "line-pipe", markets: ["AE"], leadKinds: ["supply_subcontract"] };
const list: RawDoc & { text: string } = { sourceKey: "test", sourceName: "List", tier: "C", url: "https://example.com/pipeline-contractors-uae", title: "Top pipeline contractors in the UAE",
  publishedAt: null, isSample: false, text: "Top pipeline contractors in the UAE.\nGulf Pipeline Builders LLC carries out gas pipeline construction and line pipe installation across the UAE.\nDesert Mechanical LLC.\nOther names." };

describe("likely buyers become leads (docs/mvp/19 §6)", () => {
  let db: Db;
  let run: string;
  beforeAll(async () => {
    db = await createTestDb();
    setDbForTests(db);
    run = (await db.query<{ id: string }>("insert into runs (status, adhoc_query) values ('running', $1::jsonb) returning id", [JSON.stringify(input)])).rows[0].id;
    await db.query("insert into research_sessions (run_id, budget) values ($1, '{}'::jsonb)", [run]);
    const d = await storeDocument(db, run, list);
    const add = async (company: string, quote: string, rating: number, type: string, source = "ai") =>
      db.query(`insert into research_candidates (run_id, key, company, identity_document_id, identity_quote, state, rating, rating_role, rating_reason, rating_buyer_type, rating_source)
        values ($1,$2,$2,$3,$4,'review',$5,'Pipeline contractor','Builds gas pipelines.',$6,$7)`, [run, company, d.id, quote, rating, type, source]);
    await add("Gulf Pipeline Builders LLC", "Gulf Pipeline Builders LLC carries out gas pipeline construction and line pipe installation across the UAE.", 82, "contractor");
    await add("Desert Mechanical LLC", "Desert Mechanical LLC.", 60, "subcontractor");
    await add("Rule Guess Contracting", "Rule Guess Contracting.", 50, "contractor", "rules");
    await add("Welspun Corp", "Welspun Corp makes line pipe.", 70, "competitor");
    await add("Weak Works", "Weak Works.", 30, "end_user");
  }, 60_000);
  afterAll(async () => { setDbForTests(undefined); await db?.close(); });

  it("saves rated buyers as leads, with listed work as evidence when the list describes it", async () => {
    expect(await saveLikelyBuyers(db, run, input)).toEqual({ saved: 2, listing: 1 });
    const rows = (await db.query<{ name: string; verification: string; evidence: number; fit_score: number; buyer_type: string }>(`select c.canonical_name as name,o.verification,cardinality(o.evidence_ids)::int as evidence,o.fit_score,l.buyer_type
      from search_opportunities o join companies c on c.id=o.company_id join leads l on l.id=o.lead_id where o.run_id=$1 order by o.fit_score desc`, [run])).rows;
    expect(rows).toEqual([
      { name: "Gulf Pipeline Builders LLC", verification: "listing", evidence: 1, fit_score: 82, buyer_type: "epc_contractor" },
      { name: "Desert Mechanical LLC", verification: "rating", evidence: 0, fit_score: 50, buyer_type: "subcontractor" },
    ]);
    const found = await listFoundCompanies(db, run);
    expect(found.find((f) => f.name === "Desert Mechanical LLC")).toMatchObject({ status: "saved", statusText: "Lead · likely, not verified", verification: "rating" });
    expect(found.find((f) => f.name === "Welspun Corp")?.opportunityId).toBeNull(); // competitors are never leads
    expect(found.find((f) => f.name === "Rule Guess Contracting")?.opportunityId).toBeNull(); // a rule guess needs evidence
    expect(await saveLikelyBuyers(db, run, input)).toEqual({ saved: 0, listing: 0 }); // never twice
  });
  it("keeps searching until the search's own target, not 2 buyers", () => {
    expect(minimumBuyers(20)).toBe(20);
    expect(minimumBuyers(undefined)).toBe(10);
    expect(minimumBuyers(1)).toBe(2);
  });
  it("scores a regular buyer that names the material well without an award; an award is a bonus", () => {
    expect(buyerPriority("explicit", "capability_only", "B").score).toBe(82);
    expect(buyerPriority("application", "capability_only", "B").score).toBe(67);
    expect(buyerPriority("explicit", "recent", "B").score - buyerPriority("explicit", "capability_only", "B").score).toBe(10);
  });
});
