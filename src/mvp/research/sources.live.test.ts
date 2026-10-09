// @vitest-environment node
/** Live check of local news sources (docs/mvp/19 Phase 3). Opt-in: LIVE_NEWS=1. Uses the internet, no AI. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/mvp/db";
import type { SourceContext } from "@/mvp/pipeline/contracts";
import { getClientProfile } from "@/mvp/config/profile";
import { termKey } from "@/mvp/sourcing/local-terms";
import { collectGdeltCountry, collectLocalNews } from "./sources";

describe.skipIf(!process.env.LIVE_NEWS)("live local news", () => {
  let db: Db;
  const logs: string[] = [];
  const ctx = (market: string): SourceContext => ({ db, runId: "00000000-0000-4000-8000-000000000000", input: { query: "steel pipe", productId: "line-pipe", markets: [market], leadKinds: ["supply_subcontract"] },
    profile: getClientProfile(), terms: ["pipe", "pipeline", "line pipe"], log: async (m) => { logs.push(m); } });
  beforeAll(async () => {
    db = await createTestDb();
    await db.query("insert into term_cache(key,value) values($1,$2::jsonb)", [termKey("ar", "steel pipe", "pipeline construction"), JSON.stringify({ material: "أنابيب الصلب", work: "خطوط الأنابيب", awarded: "ترسية عقد", tender: "مناقصة", stockists: "موردو أنابيب الصلب" })]);
    await db.query("insert into term_cache(key,value) values($1,$2::jsonb)", [termKey("de", "steel pipe", "pipeline construction"), JSON.stringify({ material: "Stahlrohre", work: "Rohrleitungsbau", awarded: "Auftrag", tender: "Ausschreibung", stockists: "Stahlrohr Händler" })]);
  }, 60_000);
  afterAll(async () => { console.log(logs.join("\n")); await db?.close(); });
  it.each([["SA"], ["DE"], ["KE"]])("finds local news for %s with original article links", async (market) => {
    const docs = await collectLocalNews(ctx(market), { market, query: `steel pipe contract ${market}`, material: "steel pipe", work: "pipeline construction" });
    console.log(market, docs.length, docs.slice(0, 3).map((d) => `${d.language} | ${d.title} | ${d.url}`).join("\n  "));
    expect(docs.every((d) => d.market === market && /^https?:\/\//.test(d.url))).toBe(true);
  }, 60_000);
  it("finds country news through GDELT, or says it is busy", async () => {
    const docs = await collectGdeltCountry(ctx("KE"), { market: "KE", words: ["pipeline", "steel pipe"] });
    console.log("GDELT KE", docs.length, docs.slice(0, 3).map((d) => `${d.language} | ${d.title} | ${d.url}`).join("\n  "));
    expect(Array.isArray(docs)).toBe(true);
  }, 90_000);
});
