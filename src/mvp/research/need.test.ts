// @vitest-environment node
/** docs/mvp/20 §7b: the need check rules, on the cases the 10 Oct proof runs found. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/mvp/db";
import type { LLMProvider } from "@/mvp/llm";
import type { SearchBrief } from "@/mvp/discovery/brief";
import { checkNeed, judgeNeed, needAccepted, needProofs, workDate, workMarket } from "./need";

const brief = (over: Partial<SearchBrief> = {}): SearchBrief => ({
  version: 1, item: "Cryogenic valves", mustHave: ["−196 °C service"], buying: "project", source: "ai", productId: "gate-globe-check",
  uses: [
    { name: "NGL fractionation plant", newsWords: ["NGL"], why: "Ethane recovery runs below −90 °C.", countries: [], localWords: {} },
    { name: "LNG liquefaction plant", newsWords: ["LNG"], why: "LNG is handled at −162 °C.", countries: [], localWords: {} },
  ],
  buyerRoles: [], notBuyers: ["water networks"], owners: ["ADNOC Gas"], places: { AE: ["Ruwais", "Habshan"], SA: ["Jubail"] }, ...over,
});
const now = new Date("2026-10-10T00:00:00Z");
const page = (text: string, publishedAt = "2026-08-17") => ({ text, publishedAt });
const answer = (o: Record<string, unknown>) => JSON.stringify({ project: "Ruwais NGL train 5", country: "United Arab Emirates", date: "2026-08", use: "NGL fractionation plant", needsItem: "yes", needWhy: "NGL fractionation runs at cryogenic temperatures.", companies: [], ...o });
const co = (name: string, role: string, quote: string, extra: Record<string, unknown> = {}) => ({ name, role, package: "EPC for the fifth NGL train", quote, since: null, ...extra });

describe("judging one article", () => {
  const text = "ADNOC Gas awarded a $4.3 billion EPC contract to Tecnimont for its fifth NGL fractionation train at Ruwais. Umm Shaif is being developed alongside TotalEnergies and Eni. Technip Energies has secured a detailed engineering contract for the project. AMPO will supply cryogenic ball valves.";
  it("accepts the contractor doing work that needs the item, with its verified sentence", () => {
    const r = judgeNeed(answer({ companies: [co("Tecnimont", "epc", "ADNOC Gas awarded a $4.3 billion EPC contract to Tecnimont for its fifth NGL fractionation train at Ruwais.")] }), page(text), brief(), ["AE", "SA"], now)!;
    expect(r.market).toBe("AE");
    expect(r.companies[0]).toMatchObject({ name: "Tecnimont", verdict: "lead", quoteVerified: true });
  });
  it("keeps owners and equity partners as owners, never contractors (rules 4, 13)", () => {
    const r = judgeNeed(answer({ companies: [co("ADNOC Gas", "owner", "ADNOC Gas awarded a $4.3 billion EPC contract to Tecnimont for its fifth NGL fractionation train at Ruwais.", { package: "owner" }),
      co("Eni", "owner", "Umm Shaif is being developed alongside TotalEnergies and Eni.", { package: "field partner" })] }), page(text), brief(), ["AE"], now)!;
    expect(r.companies.map((c) => c.verdict)).toEqual(["owner", "owner"]);
  });
  it("rejects engineering-only work, competitors and sentences that are not in the source (rules 9, 14)", () => {
    const r = judgeNeed(answer({ companies: [
      co("Technip Energies", "subcontractor", "Technip Energies has secured a detailed engineering contract for the project.", { package: "detailed engineering" }),
      co("AMPO", "seller_of_item", "AMPO will supply cryogenic ball valves.", { package: "valve supply" }),
      co("Example EPC", "epc", "Example EPC won the main contract for the train."),
    ] }), page(text), brief(), ["AE"], now)!;
    expect(r.companies.map((c) => [c.name, c.verdict, c.reason])).toEqual([
      ["Technip Energies", "rejected", "engineering only, buys no material"],
      ["AMPO", "rejected", "sells the item (a competitor)"],
      ["Example EPC", "rejected", "sentence not found in the source"],
    ]);
  });
  it("rejects a company whose own package does not buy the item, on work that does (smoke test: the LNG jetty)", () => {
    const jetty = "ITD Cementation India has won a contract for jetty construction work on the Ruwais LNG project.";
    const r = judgeNeed(answer({ project: "Ruwais LNG", companies: [co("ITD Cementation India", "subcontractor", jetty, { package: "jetty construction", buysItem: "no" }),
      co("Example LNG EPC", "epc", jetty.replace("ITD Cementation India has", "Example LNG EPC has"), { buysItem: "yes" })] }), page(`${jetty} ${jetty.replace("ITD Cementation India has", "Example LNG EPC has")}`), brief(), ["AE"], now)!;
    expect(r.companies.map((c) => [c.name, c.verdict, c.reason])).toEqual([
      ["ITD Cementation India", "rejected", "its own package does not buy the item"],
      ["Example LNG EPC", "lead", "does work that needs the item"]]);
  });
  it("rejects work that does not need the item, whoever wins it (Dovre's sewer job for cryogenic valves)", () => {
    const sewer = "Dovre Entreprenør AS won the contract for new pavement and water and sewage work in Trondheim.";
    const r = judgeNeed(answer({ project: "Hans Finnes gate", country: "Norway", use: null, needsItem: "no", needWhy: "Water and sewage pipes are not cryogenic service.",
      companies: [co("Dovre Entreprenør AS", "epc", sewer, { package: "roads and water and sewage" })] }), page(sewer), brief({ places: { NO: ["Norge", "Trondheim"] } }), ["NO"], now)!;
    expect(r.companies[0].verdict).toBe("rejected");
    expect(r.companies[0].reason).toMatch(/the work is not one of the uses/);
  });
  it("rejects work outside his countries and work dated by its sentence, not the article (rules 3, 12)", () => {
    const old = "In 2005, a group including Tenaga Nasional Berhad was selected to build the Shuaibah plant.";
    const r = judgeNeed(answer({ project: "Shuaibah", country: "Saudi Arabia", companies: [co("Tenaga Nasional Berhad", "epc", old)] }), page(old, "2025-11-26"), brief(), ["SA"], now)!;
    expect(r.companies[0].reason).toMatch(/older than 18 months \(2005-06\)/);
    const moz = "JGC won the Coral North FLNG contract in Mozambique.";
    expect(judgeNeed(answer({ project: "Coral North", country: "Mozambique", companies: [co("JGC", "epc", moz)] }), page(moz), brief(), ["AE", "SA"], now)!.companies[0].reason)
      .toMatch(/outside the chosen countries \(Mozambique\)/);
  });
  it("finds the country from the brief's own place names (rule 12)", () => {
    expect(workMarket("Jubail Industrial City", brief(), ["AE", "SA"])).toBe("SA");
    expect(workMarket("Habshan complex", brief(), ["AE", "SA"])).toBe("AE");
    expect(workMarket(null, brief(), ["AE"])).toBeNull();
    expect(workDate("Signed in 2019 under the first phase.", null, "2026-07-01")).toBe("2019-06");
    expect(workDate("Won in March 2026.", "2026-03", "2026-07-01")).toBe("2026-03");
    // A "since" the sentence does not back is not used: the article's date is.
    expect(workDate("Won the contract.", "2026-03", "2026-07-01")).toBe("2026-07-01");
  });
});

describe("checkNeed storage", () => {
  let db: Db;
  beforeAll(async () => { db = await createTestDb(); }, 60_000);
  afterAll(async () => { await db.close(); });
  it("stores each company's verdict and answers lead questions by company name", async () => {
    const run = (await db.query<{ id: string }>("insert into runs (status, adhoc_query) values ('running', '{}'::jsonb) returning id")).rows[0].id;
    await db.query("insert into research_sessions (run_id, budget) values ($1, '{}'::jsonb)", [run]);
    const text = "ADNOC Gas awarded a $4.3 billion EPC contract to Tecnimont for its fifth NGL fractionation train at Ruwais.";
    const doc = (await db.query<{ id: string }>("insert into source_documents(source_key,publisher_key,url,canonical_url,content_hash,text) values('t','t','https://n.example/a','https://n.example/a','h',$1) returning id", [text])).rows[0].id;
    let calls = 0;
    const provider: LLMProvider = { name: "groq", model: "test", async complete() { calls++; return { tokensIn: 1, tokensOut: 1, text: answer({ companies: [co("Tecnimont S.p.A.", "epc", text)] }) }; } };
    const first = await checkNeed(db, run, doc, { text, url: "https://n.example/a", title: null, publishedAt: "2026-08-17" }, brief(), ["AE"], provider);
    expect(first.result?.companies[0].verdict).toBe("lead");
    // A replay uses the saved answer: no second AI call, rows replaced, not duplicated.
    await checkNeed(db, run, doc, { text, url: "https://n.example/a", title: null, publishedAt: "2026-08-17" }, brief(), ["AE"], provider, first.answer);
    expect(calls).toBe(1);
    expect((await db.query("select 1 from need_checks where run_id=$1", [run])).rows).toHaveLength(1);
    expect(await needAccepted(db, run, "Tecnimont")).toBe(true);
    expect(await needAccepted(db, run, "Wison Engineering")).toBe(false);
    expect((await needProofs(db, run, "Tecnimont"))[0]).toMatchObject({ why: "NGL fractionation runs at cryogenic temperatures.", use: "NGL fractionation plant", market: "AE", url: "https://n.example/a" });
  });
});

describe("following accepted projects (stage 6)", () => {
  it("asks for the project's subcontracts, packages and suppliers' orders", async () => {
    const { followUpQueries } = await import("./need");
    expect(followUpQueries("Ruwais LNG", "Cryogenic valves")).toEqual(["Ruwais LNG subcontract awarded", "Ruwais LNG package contract awarded", "Ruwais LNG Cryogenic valves supply order"]);
  });
  it("follows needed work in a chosen country only, at most two projects per country, never twice", async () => {
    const { projectsToFollow, followKey } = await import("./need");
    const db = await createTestDb();
    try {
      const run = (await db.query<{ id: string }>("insert into runs (status, adhoc_query) values ('running', '{}'::jsonb) returning id")).rows[0].id;
      await db.query("insert into research_sessions (run_id, budget) values ($1, '{}'::jsonb)", [run]);
      const result = (project: string, o: Record<string, unknown> = {}) => ({ project, country: "UAE", market: "AE", date: "2026-08", use: "LNG liquefaction plant", needsItem: "yes" as const, needWhy: "",
        companies: [{ name: "Example EPC", role: "epc" as const, package: "EPC", quote: "", quoteVerified: true, since: null, verdict: "lead" as const, reason: "" }], ...o });
      expect(await projectsToFollow(db, run, result("Ruwais LNG", { needsItem: "no" }))).toEqual([]);
      expect(await projectsToFollow(db, run, result("Ruwais LNG", { market: null }))).toEqual([]);
      expect(await projectsToFollow(db, run, result("Ruwais LNG"))).toEqual([{ project: "Ruwais LNG", market: "AE" }]);
      const add = (project: string) => db.query("insert into research_jobs(run_id,stage,key,payload) values($1,'collect',$2,'{}'::jsonb)", [run, followKey("AE", project, 0)]);
      await add("Ruwais LNG");
      expect(await projectsToFollow(db, run, result("Ruwais LNG"))).toEqual([]);
      await add("Habshan RGD");
      expect(await projectsToFollow(db, run, result("Das Island IGD"))).toEqual([]);
      expect(await projectsToFollow(db, run, result("Riyas NGL", { market: "SA" }))).toEqual([{ project: "Riyas NGL", market: "SA" }]);
    } finally { await db.close(); }
  }, 60_000);
});

describe("need-proven companies become leads (smoke test, 10 Oct)", () => {
  it("saves a company the need check accepted, whatever its shortlist rating, with its sentence and dated work", async () => {
    const { saveLikelyBuyers } = await import("./likely");
    const { registerCandidate } = await import("./investigation");
    const db = await createTestDb();
    try {
      const b = brief();
      const run = (await db.query<{ id: string }>("insert into runs (status, adhoc_query) values ('running', $1::jsonb) returning id", [JSON.stringify({ query: "Cryogenic valves", productId: "gate-globe-check", markets: ["AE"], brief: b })])).rows[0].id;
      await db.query("insert into research_sessions (run_id, budget) values ($1, '{}'::jsonb)", [run]);
      const text = "ADNOC Gas awarded a $4.3 billion EPC contract to Tecnimont for its fifth NGL fractionation train at Ruwais.";
      const doc = (await db.query<{ id: string }>("insert into source_documents(source_key,publisher_key,url,canonical_url,content_hash,text) values('t','t','https://n.example/b','https://n.example/b','h2',$1) returning id", [text])).rows[0].id;
      const provider: LLMProvider = { name: "groq", model: "test", async complete() { return { tokensIn: 1, tokensOut: 1, text: answer({ companies: [co("Tecnimont", "epc", text, { since: "2026-08" })] }) }; } };
      await checkNeed(db, run, doc, { text, url: "https://n.example/b", title: null, publishedAt: "2026-08-17" }, b, ["AE"], provider);
      await db.tx((tx) => registerCandidate(tx, run, "Tecnimont", null, doc, text));
      // The shortlist held it back (the AI's use name did not match the brief's wording).
      await db.query("update research_candidates set rating=30, rating_source='ai', rating_reason='Not this work: …', rating_buyer_type='contractor' where run_id=$1", [run]);
      const saved = await saveLikelyBuyers(db, run, { productId: "gate-globe-check", query: "Cryogenic valves", brief: b });
      expect(saved.saved).toBe(1);
      const opp = (await db.query<{ buying_reason: string; verification: string; fit_score: number }>("select buying_reason, verification, fit_score from search_opportunities where run_id=$1", [run])).rows[0];
      expect(opp.verification).toBe("listing");
      expect(opp.buying_reason.startsWith(`${text} Why it needs `)).toBe(true);
      expect(opp.buying_reason.endsWith(": NGL fractionation runs at cryogenic temperatures.")).toBe(true);
      expect(Number(opp.fit_score)).toBe(75);
      const trig = (await db.query<{ kind: string; event_date: string | null; title: string; strength: string }>("select kind, to_char(event_date, 'YYYY-MM') as event_date, title, strength from company_triggers where run_id=$1", [run])).rows[0];
      expect(trig).toMatchObject({ kind: "award", title: text, strength: "confirmed" });
      // The engine keeps a trigger date only when the sentence states it; this one does not.
      expect(trig.event_date).toBeNull();
    } finally { await db.close(); }
  }, 60_000);
});
