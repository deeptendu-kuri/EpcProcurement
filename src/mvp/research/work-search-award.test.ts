// @vitest-environment node
/**
 * docs/mvp/20 steps 3–4 end to end: in a work-based search an award winner becomes a lead only when the need
 * check accepts its work for the searched item (the Dovre case, 10 Oct), and the lead's reason is its own sentence.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type Db } from "@/mvp/db";
import type { RunInput } from "@/mvp/types";
import type { RawDoc } from "@/mvp/pipeline/contracts";
import { saveBuyer } from "@/mvp/discovery";
import type { LLMProvider } from "@/mvp/llm";
import { briefKey, type SearchBrief } from "@/mvp/discovery/brief";
import fixtures from "@/mvp/sourcing/fixtures/baseline-pages.json";
import { createResearchRun, sessionFor } from "./store";
import { processResearchTick, type ResearchDeps } from "./engine";

const article = fixtures.documents.find((d) => d.url.includes("businessline"))!;
const raw: RawDoc = { sourceKey: "saved-evaluation", sourceName: "thehindubusinessline.com", tier: "B", url: article.url, title: article.title, text: article.text, publishedAt: null, isSample: false };
const QUOTE = "Kalpataru Projects International Limited (KPIL) on Monday announced it has received a Letter of Award (LoA) for the engineering, procurement and construction (EPC) of a gas pipeline project in the United Arab Emirates";
const brief = (item: string, uses: SearchBrief["uses"]): SearchBrief => ({ version: 1, item, mustHave: [], buying: "project", uses, buyerRoles: [], notBuyers: [],
  owners: [], places: { AE: ["Abu Dhabi"] }, source: "ai", productId: "line-pipe" });
const verdict = (o: Record<string, unknown>) => JSON.stringify({ project: "UAE gas pipeline", country: "United Arab Emirates", date: "2026-09", companies: [
  { name: "Kalpataru Projects International Limited", role: "epc", package: "EPC of the gas pipeline", quote: QUOTE, since: "2026-09" }], ...o });

let db: Db;
beforeAll(async () => { db = await createTestDb(); }, 120_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  vi.stubEnv("TAVILY_API_KEY", ""); vi.stubEnv("GROQ_API_KEY", ""); vi.stubEnv("CLOUDFLARE_API_TOKEN", ""); vi.stubEnv("MVP_RESEARCH_NEWS", "off"); vi.stubEnv("MVP_WORK_SEARCH", "on");
  await db.exec("truncate runs, source_documents, companies, search_briefs cascade");
});
afterEach(() => { vi.unstubAllEnvs(); });

async function run(query: string, b: SearchBrief, need: string, productId = "line-pipe") {
  const input: RunInput = { query, productId, markets: ["AE"], leadKinds: ["supply_subcontract"], researchMode: "batch" };
  await db.query("insert into search_briefs(key,material,markets,brief,source) values($1,$2,$3,$4::jsonb,'ai')", [briefKey(query, ["AE"]), query, ["AE"], JSON.stringify(b)]);
  const id = await createResearchRun(input, db);
  const needProvider: LLMProvider = { name: "groq", model: "test", async complete() { return { text: need, tokensIn: 1, tokensOut: 1 }; } };
  const deps: ResearchDeps = { collect: vi.fn(async () => [raw]), read: vi.fn(), discover: vi.fn(), save: saveBuyer, needProvider };
  for (let tick = 0; tick < 150 && (await sessionFor(db, id))?.state === "active"; tick++) await processResearchTick(db, deps, id);
  return id;
}

describe("award winners in a work-based search", () => {
  it("saves the contractor whose work needs the item, with its own sentence as the reason", async () => {
    const id = await run("Line pipe API 5L", brief("Line pipe", [
      { name: "gas pipeline construction", newsWords: ["gas pipeline"], why: "A gas pipeline is built from line pipe.", countries: ["AE"], localWords: {} },
      { name: "water transmission line", newsWords: ["water transmission"], why: "Large water lines use line pipe.", countries: ["AE"], localWords: {} }]),
      verdict({ use: "gas pipeline construction", needsItem: "yes", needWhy: "A gas pipeline is built from line pipe." }));
    const checks = (await db.query<{ company_name: string; verdict: string; market: string }>("select company_name, verdict, market from need_checks where run_id=$1", [id])).rows;
    expect(checks).toEqual([{ company_name: "Kalpataru Projects International Limited", verdict: "lead", market: "AE" }]);
    const opp = (await db.query<{ buying_reason: string }>("select buying_reason from search_opportunities where run_id=$1", [id])).rows;
    expect(opp).toHaveLength(1);
    expect(opp[0].buying_reason).toContain("received a Letter of Award (LoA) for the engineering, procurement and construction (EPC) of a gas pipeline project");
    expect(opp[0].buying_reason).toContain("Why it needs");
    expect(opp[0].buying_reason).not.toContain("Potential need");
  }, 60_000);
  it("follows the accepted project to its subcontracts, packages and suppliers' orders (stage 6)", async () => {
    vi.stubEnv("TAVILY_API_KEY", "test-key-not-used");
    const id = await run("Line pipe API 5L", brief("Line pipe", [
      { name: "gas pipeline construction", newsWords: ["gas pipeline"], why: "A gas pipeline is built from line pipe.", countries: ["AE"], localWords: {} },
      { name: "water transmission line", newsWords: ["water transmission"], why: "Large water lines use line pipe.", countries: ["AE"], localWords: {} }]),
      verdict({ use: "gas pipeline construction", needsItem: "yes", needWhy: "A gas pipeline is built from line pipe." }));
    const follow = (await db.query<{ key: string; payload: { query: { query: string } } }>("select key, payload from research_jobs where run_id=$1 and key like 'follow:%' order by key", [id])).rows;
    expect(follow.map((j) => j.payload.query.query)).toEqual(["UAE gas pipeline subcontract awarded", "UAE gas pipeline package contract awarded", "UAE gas pipeline Line pipe supply order"]);
  }, 60_000);
  it("does not save a contract winner whose work does not need the item (the Dovre case)", async () => {
    const id = await run("Cryogenic Valves", brief("Cryogenic valves", [
      { name: "LNG liquefaction plant", newsWords: ["LNG"], why: "LNG is handled at −162 °C.", countries: ["AE"], localWords: {} },
      { name: "NGL fractionation plant", newsWords: ["NGL", "gas"], why: "Ethane recovery runs below −90 °C.", countries: ["AE"], localWords: {} }]),
      verdict({ use: null, needsItem: "no", needWhy: "A gas transmission pipeline runs at ambient temperature; no cryogenic service." }), "gate-globe-check");
    const checks = (await db.query<{ verdict: string; reason: string }>("select verdict, reason from need_checks where run_id=$1", [id])).rows;
    expect(checks[0].verdict).toBe("rejected");
    expect(checks[0].reason).toMatch(/the work is not one of the uses/);
    expect((await db.query("select 1 from search_opportunities where run_id=$1", [id])).rows).toHaveLength(0);
    expect((await db.query("select 1 from research_candidates where run_id=$1 and company ilike 'kalpataru%'", [id])).rows).toHaveLength(0);
    const said = (await db.query<{ message: string }>("select message from run_events where run_id=$1", [id])).rows.map((r) => r.message).join("\n");
    expect(said).toMatch(/no buyer of Cryogenic valves/);
  }, 60_000);
});
