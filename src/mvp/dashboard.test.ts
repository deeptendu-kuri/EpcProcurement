// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, setDbForTests, type Db } from "@/mvp/db";
import { dashboardData } from "./dashboard";

let db: Db;
beforeAll(async () => { db = await createTestDb(); setDbForTests(db); }, 60_000);
afterAll(async () => { setDbForTests(undefined); await db?.close(); });

describe("dashboard read model (docs/mvp/18 §9)", () => {
  it("counts verified and likely leads per company, lists the week's best leads and reads the AI allowance", async () => {
    const run = (await db.query<{ id: string }>("insert into runs(status, adhoc_query, counters) values ('done', $1::jsonb, '{}'::jsonb) returning id",
      [JSON.stringify({ query: "steel pipe", productId: "line-pipe", markets: ["SA"], leadKinds: ["supply_subcontract"] })])).rows[0].id;
    const lead = async (name: string, verification: string, product = "line-pipe") => {
      const company = (await db.query<{ id: string }>("select id from companies where canonical_name=$1", [name])).rows[0]?.id
        ?? (await db.query<{ id: string }>("insert into companies(canonical_name, normalized_name) values ($1, lower($1)) returning id", [name])).rows[0].id;
      const l = (await db.query<{ id: string }>("select id from leads where buyer_company_id=$1", [company])).rows[0]?.id ?? (await db.query<{ id: string }>("insert into leads(kind,buyer_company_id,score_breakdown,gate_results,class,reasons,scoring_version,is_sample) values('supply_subcontract',$1,'{}','[]','research','[]',1,false) returning id", [company])).rows[0].id;
      await db.query("insert into search_opportunities(run_id,lead_id,company_id,keyword,product_id,product_name,buying_reason,evidence_ids,fit_score,verification) values($1,$2,$3,'pipe',$4,'Line pipe','Example',$5,70,$6)",
        [run, l, company, product, [], verification]);
    };
    await lead("Example Verified EPC", "website");
    await lead("Example Likely Owner", "rating");
    // One company saved twice (two products): counted once, as Leads counts it.
    await lead("Example Likely Owner", "rating", "valves");
    await db.query("insert into llm_usage(provider, model, purpose, tokens_in, tokens_out, ok) values ('groq','openai/gpt-oss-20b','test',150000,0,true)");
    const data = await dashboardData();
    const search = data.searches.find((s) => s.run.id === run)!;
    expect({ verified: search.verified, likely: search.likely }).toEqual({ verified: 1, likely: 1 });
    expect(data.pipeline).toMatchObject({ verified: 1, likely: 1 });
    expect(data.topLeads.map((l) => l.verification).sort()).toEqual(["rating", "rating", "website"]);
    if (data.allowance.models.length) expect(data.allowance.models.find((m) => m.model === "openai/gpt-oss-20b")?.used).toBe(150_000);
  });
});
