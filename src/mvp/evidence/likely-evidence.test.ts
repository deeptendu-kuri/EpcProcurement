// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, setDbForTests, type Db } from "@/mvp/db";
import type { RawDoc } from "@/mvp/pipeline/contracts";
import type { RunInput } from "@/mvp/types";
import { storeDocument } from "@/mvp/pipeline/read";
import { saveLikelyBuyers } from "@/mvp/research/likely";
import { companyEvidence, opportunityEvidence } from "./index";

const input: RunInput = { query: "line pipe", productId: "line-pipe", markets: ["AE"], leadKinds: ["supply_subcontract"] };
const list: RawDoc & { text: string } = { sourceKey: "test", sourceName: "List", tier: "C", url: "https://example.com/epc-contractors-uae", title: "Top EPC contractors in the UAE",
  publishedAt: null, isSample: false, text: "Top EPC contractors in the UAE.\nExample Offshore Contractors\nOther names." };

describe("evidence panel for a likely lead (not verified yet)", () => {
  let db: Db;
  let run: string;
  beforeAll(async () => {
    db = await createTestDb();
    setDbForTests(db);
    run = (await db.query<{ id: string }>("insert into runs (status, adhoc_query) values ('running', $1::jsonb) returning id", [JSON.stringify(input)])).rows[0].id;
    await db.query("insert into research_sessions (run_id, budget) values ($1, '{}'::jsonb)", [run]);
    const d = await storeDocument(db, run, list);
    await db.query(`insert into research_candidates (run_id, key, company, identity_document_id, identity_quote, state, rating, rating_role, rating_reason, rating_buyer_type, rating_source)
      values ($1,'example-offshore','Example Offshore Contractors',$2,'Example Offshore Contractors','review',70,'Offshore EPC contractor','Builds offshore pipelines that use line pipe.','contractor','ai')`, [run, d.id]);
    expect((await saveLikelyBuyers(db, run, input)).saved).toBe(1);
  }, 60_000);
  afterAll(async () => { setDbForTests(undefined); await db?.close(); });

  it("opens with why it was rated, where it was found and a Verify action, instead of 'evidence not found'", async () => {
    const opp = (await db.query<{ id: string; company_id: string }>("select id, company_id from search_opportunities where run_id=$1", [run])).rows[0];
    for (const view of [await companyEvidence(opp.company_id, run, db), await opportunityEvidence(opp.id, db)]) {
      expect(view).not.toBeNull();
      expect(view!.proof?.level).toBe("likely");
      expect(view!.rating).toMatchObject({ role: "Offshore EPC contractor", reason: "Builds offshore pipelines that use line pipe.", buyerType: "contractor", runId: run });
      expect(view!.why).toBe("Builds offshore pipelines that use line pipe.");
      expect(view!.sources[0]).toMatchObject({ url: list.url, title: list.title });
      expect(view!.sources[0].quotes[0].highlight).toBe("Example Offshore Contractors");
      expect(view!.recent).toEqual([]);
      expect(view!.rating?.checkable).toBe(true); // a saved likely lead can be verified
    }
  });
});
