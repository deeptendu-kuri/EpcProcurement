// @vitest-environment node
/** docs/mvp/20 step 2: the search brief is a run's first step, and the searches are planned from its work. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type Db } from "@/mvp/db";
import type { RunInput } from "@/mvp/types";
import { briefKey, type SearchBrief } from "@/mvp/discovery/brief";
import { sourcePlan } from "@/mvp/sourcing/plan";
import { createResearchRun, sessionFor } from "./store";
import { processResearchTick, type ResearchDeps } from "./engine";
import type { LLMProvider } from "@/mvp/llm";
import type { RawDoc } from "@/mvp/pipeline/contracts";

const brief = (over: Partial<SearchBrief> = {}): SearchBrief => ({
  version: 1, item: "Cryogenic valves", mustHave: ["−196 °C service"], buying: "project", source: "ai", productId: "gate-globe-check",
  uses: [
    { name: "LNG liquefaction plant", newsWords: ["LNG", "liquefaction"], why: "LNG is handled at −162 °C.", countries: ["AE"], localWords: { AE: ["الغاز الطبيعي المسال"] } },
    { name: "NGL fractionation plant", newsWords: ["NGL", "fractionation"], why: "Ethane recovery runs below −90 °C.", countries: ["AE", "SA"], localWords: {} },
    { name: "air separation plant", newsWords: ["air separation"], why: "Liquid oxygen and nitrogen are stored at −196 °C.", countries: ["SA"], localWords: {} },
  ],
  buyerRoles: ["EPC contractors"], notBuyers: ["water networks", "valve traders"], owners: ["ADNOC Gas", "Saudi Aramco"],
  places: { AE: ["الإمارات", "Ruwais"], SA: ["السعودية", "Jubail"] }, ...over,
});

describe("search plan from a brief", () => {
  it("searches each country for its own work, never the product name alone", () => {
    const plan = sourcePlan({ productId: "gate-globe-check", keyword: "Cryogenic Valves", markets: ["AE", "SA"], mode: "preview", brief: brief() });
    const award = (m: string) => plan.filter((t) => t.market === m && t.source === "bing-query").map((t) => t.query);
    expect(award("AE")).toEqual(["LNG liquefaction contract awarded United Arab Emirates", "NGL fractionation contract awarded United Arab Emirates"]);
    expect(award("SA")).toEqual(["NGL fractionation contract awarded Saudi Arabia", "air separation contract awarded Saudi Arabia"]);
    const news = plan.filter((t) => t.lane === "trigger" && t.source === "tavily").map((t) => t.query);
    expect(news.join(" ")).not.toMatch(/cryogenic valves/i);
    expect(plan.find((t) => t.market === "AE" && t.source === "local-news")).toMatchObject({ localQuery: "الغاز الطبيعي المسال الإمارات" });
    expect(plan.find((t) => t.market === "SA" && t.source === "gdelt-country")?.words).toEqual(["NGL", "fractionation", "air separation"]);
    expect(plan.filter((t) => t.lane === "capability").map((t) => t.query)).toContain("LNG liquefaction plant contractor United Arab Emirates projects");
  });
  it("adds the owners' maintenance contracts for steadily bought items (rule 7)", () => {
    const plan = sourcePlan({ productId: "stud-bolts", keyword: "stud bolts", markets: ["AE", "SA"], mode: "preview", brief: brief({ buying: "both" }) });
    const queries = plan.map((t) => t.query ?? "");
    expect(queries).toContain("ADNOC Gas maintenance services contract awarded");
    expect(queries).toContain("shutdown turnaround maintenance contract Saudi Arabia");
    // Owners are searched once, not once per country.
    expect(queries.filter((q) => q === "ADNOC Gas maintenance services contract awarded")).toHaveLength(1);
  });
  it("keeps the catalogue plan without a brief", () => {
    const plan = sourcePlan({ productId: "line-pipe", keyword: "line pipe", markets: ["SA"], mode: "preview" });
    expect(plan.filter((t) => t.source === "bing-query").map((t) => t.query)).toContain("EPC contract awarded Saudi Arabia");
  });
});

describe("the brief as a run's first step (MVP_WORK_SEARCH=on)", () => {
  let db: Db;
  beforeAll(async () => { db = await createTestDb(); }, 120_000);
  afterAll(async () => { await db.close(); });
  beforeEach(async () => { vi.stubEnv("TAVILY_API_KEY", ""); vi.stubEnv("MVP_WORK_SEARCH", "on"); await db.exec("truncate runs cascade; truncate search_briefs;"); });
  afterEach(() => vi.unstubAllEnvs());
  const input: RunInput = { query: "Cryogenic Valves", productId: "gate-globe-check", markets: ["AE", "SA"], leadKinds: ["supply_subcontract"] };
  const deps: ResearchDeps = { collect: vi.fn(async () => []), read: vi.fn(), discover: vi.fn(), save: vi.fn() };

  it("starts with the brief only, then plans the searches from the cached brief", async () => {
    await db.query("insert into search_briefs(key,material,markets,brief,source) values($1,$2,$3,$4::jsonb,'ai')",
      [briefKey("Cryogenic Valves", ["AE", "SA"]), "Cryogenic Valves", ["AE", "SA"], JSON.stringify(brief())]);
    const id = await createResearchRun(input, db);
    const jobs = async () => (await db.query<{ stage: string; key: string; state: string }>("select stage,key,state from research_jobs where run_id=$1 order by priority desc,key", [id])).rows;
    expect(await jobs()).toEqual([{ stage: "analyse", key: "brief", state: "queued" }]);
    await processResearchTick(db, deps, id);
    const after = await jobs();
    expect(after[0]).toMatchObject({ key: "brief", state: "done" });
    expect(after.filter((j) => j.stage === "collect").map((j) => j.key)).toContain("hybrid-v2:gate-globe-check:AE:trigger:bing-query:0");
    const stored = (await db.query<{ adhoc_query: RunInput }>("select adhoc_query from runs where id=$1", [id])).rows[0].adhoc_query;
    expect(stored.brief?.uses.map((u) => u.name)).toEqual(["LNG liquefaction plant", "NGL fractionation plant", "air separation plant"]);
    const said = (await db.query<{ message: string }>("select message from run_events where run_id=$1", [id])).rows.map((r) => r.message).join("\n");
    expect(said).toMatch(/Looking for companies doing: LNG liquefaction plant · NGL fractionation plant · air separation plant\. Not: water networks · valve traders/);
    expect((await sessionFor(db, id))?.state).toBe("active");
  });
  it("falls back to the catalogue brief without AI, and still plans searches", async () => {
    const id = await createResearchRun(input, db);
    await processResearchTick(db, deps, id);
    const stored = (await db.query<{ adhoc_query: RunInput }>("select adhoc_query from runs where id=$1", [id])).rows[0].adhoc_query;
    expect(stored.brief?.source).toBe("catalogue");
    expect((await db.query("select 1 from research_jobs where run_id=$1 and stage='collect'", [id])).rows.length).toBeGreaterThan(0);
  });
  it("grounds a fresh brief, reads the grounding pages and still stores the brief and the plan (Render, 11 Oct)", async () => {
    vi.stubEnv("TAVILY_API_KEY", "test-key-not-used");
    const page: RawDoc = { sourceKey: "tavily", sourceName: "News", tier: "B", url: "https://news.example/ruwais-lng-epc", title: "Technip Energies wins Ruwais LNG EPC",
      text: "ADNOC awarded the Ruwais LNG EPC to Technip Energies, JGC and NMDC Energy.", publishedAt: "2026-09-01", isSample: false };
    const collect = vi.fn(async (_source: string, _ctx: unknown, payload: Record<string, unknown>) =>
      String((payload.query as { key?: string } | undefined)?.key ?? "").startsWith("brief-ground:") ? [page] : []);
    const briefProvider: LLMProvider = { name: "groq", model: "test", async complete() { return { tokensIn: 1, tokensOut: 1, text: JSON.stringify({
      item: "Cryogenic valves", mustHave: ["−196 °C service"], buying: "project",
      uses: [{ name: "LNG liquefaction plant", newsWords: ["LNG", "liquefaction"], why: "LNG is handled at −162 °C.", countries: ["AE", "SA"] },
        { name: "NGL fractionation plant", newsWords: ["NGL"], why: "Ethane recovery runs below −90 °C.", countries: ["SA"] }],
      buyerRoles: ["EPC contractors"], notBuyers: ["water networks"], owners: ["ADNOC"], places: { AE: ["Ruwais"], SA: ["Jubail"] } }) }; } };
    const id = await createResearchRun(input, db);
    await processResearchTick(db, { ...deps, collect, briefProvider }, id);
    const job = (await db.query<{ state: string; result: { brief?: { source: string } } }>("select state, result from research_jobs where run_id=$1 and key='brief'", [id])).rows[0];
    expect(job).toMatchObject({ state: "done", result: { brief: { source: "ai" } } });
    const stored = (await db.query<{ adhoc_query: RunInput }>("select adhoc_query from runs where id=$1", [id])).rows[0].adhoc_query;
    expect(stored.brief?.source).toBe("ai");
    expect((await db.query("select 1 from research_jobs where run_id=$1 and stage='collect'", [id])).rows.length).toBeGreaterThan(0);
    expect((await db.query("select 1 from research_jobs where run_id=$1 and stage='read' and key=$2", [id, page.url])).rows).toHaveLength(1);
    expect((await db.query("select 1 from search_briefs")).rows).toHaveLength(1);
    expect(collect.mock.calls.filter((c) => String((c[2].query as { key?: string }).key).startsWith("brief-ground:"))).toHaveLength(2);
  });
  it("keeps today's behaviour when the switch is off", async () => {
    vi.stubEnv("MVP_WORK_SEARCH", "");
    const id = await createResearchRun(input, db);
    expect((await db.query("select 1 from research_jobs where run_id=$1 and stage='analyse'", [id])).rows).toHaveLength(0);
    expect((await db.query("select 1 from research_jobs where run_id=$1 and stage='collect'", [id])).rows.length).toBeGreaterThan(0);
  });
});
