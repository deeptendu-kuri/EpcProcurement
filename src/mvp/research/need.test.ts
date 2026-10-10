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
    expect(workDate("Won this year.", "2026-03", "2026-07-01")).toBe("2026-03");
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
