// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/mvp/db";
import type { LLMProvider } from "@/mvp/llm/types";
import { consistentRating, heuristicRating, parseRatings, rateCandidates, ratingPrompt, ruleRating } from "./shortlist";
import { listFoundCompanies } from "./found";

describe("shortlist rating rules (docs/mvp/18 §5)", () => {
  it("rates page furniture and sellers of the material without AI", () => {
    expect(ruleRating("ASME", "ASME", "steel plates")?.rating).toBe(0);
    expect(ruleRating("Hindustan Steel Corporation", "At Hindustan Steel Corporation, we supply high-strength steel plates", "steel plates"))
      .toMatchObject({ rating: 3, role: "Seller of steel plates" });
    expect(ruleRating("KRR Engineering", "one of India's most trusted pressure vessel manufacturers", "steel plates")).toBeNull();
  });
  it("falls back to a plain heuristic that keeps fuel traders out and fabricators in", () => {
    expect(heuristicRating("KRR Engineering", "pressure vessel manufacturers", null, "steel plates")).toMatchObject({ role: "Process equipment fabricator", source: "rules" });
    expect(heuristicRating("PETRO GOLD LUBRICANT AND GREASE LLC", "PETRO GOLD LUBRICANT AND GREASE LLC", null, "steel plates").rating).toBeLessThan(25);
    expect(heuristicRating("Octave", null, null, "steel plates")).toMatchObject({ rating: 30, role: "Not clear yet" });
  });
  it("asks only about buying, from the given words, and bounds the answer", () => {
    const rows = [{ id: "a", company: "KRR Engineering", identity_quote: "pressure vessel manufacturers", title: null }, { id: "b", company: "Lubrex FZE", identity_quote: null, title: null }];
    const prompt = ratingPrompt("plates", rows);
    expect(prompt.system).toMatch(/BUY/);
    expect(prompt.system).toMatch(/Do not invent/);
    expect(JSON.parse(prompt.user).companies.map((c: { id: string }) => c.id)).toEqual(["c1", "c2"]);
    const parsed = parseRatings(JSON.stringify({ companies: [
      { id: "c1", rating: 140, role: "Pressure vessel fabricator", reason: "Rolls plates into vessel shells.", also: ["plates", "flanges", "made-up"] },
      { id: "c2", rating: 2, role: "Lubricant trader", reason: "Sells lubricants." },
      { id: "c9", rating: 90 },
    ] }), rows, "plates");
    expect(parsed).toEqual([
      { id: "a", rating: 100, role: "Pressure vessel fabricator", reason: "Rolls plates into vessel shells.", also: ["flanges"], source: "ai" },
      { id: "b", rating: 2, role: "Lubricant trader", reason: "Sells lubricants.", also: [], source: "ai" },
    ]);
  });
});

describe("ratings stay consistent with their own words (9 Oct steel plates findings)", () => {
  const r = (rating: number, role: string, reason = "") => ({ rating, role, reason, also: [] });
  it("caps sellers of the material and self-declared non-buyers", () => {
    expect(consistentRating(r(90, "Steel plate manufacturer", "Produces stainless steel plates, not a buyer of steel plates."), { company: "New Castle Stainless Plate", identity_quote: "turn raw slab into plate" }, "steel plates")).toBe(5);
    expect(consistentRating(r(70, "Steel plate supplier", "Sells SA516 plates for boilers"), { company: "Navgraha Steels INC", identity_quote: "Navgraha Steels INC" }, "steel plates")).toBe(5);
  });
  it("keeps a bare name without any work in it below Strong", () => {
    expect(consistentRating(r(90, "Pressure vessel fabricator"), { company: "STAR GATE ENERGY", identity_quote: "STAR GATE ENERGY" }, "steel plates")).toBe(50);
    expect(consistentRating(r(60, "Pressure vessel fabricator"), { company: "Prime Petrolium FZE", identity_quote: "Prime Petrolium FZE" }, "steel plates")).toBe(10);
    expect(consistentRating(r(60, "Composite pressure vessel fabricator"), { company: "Hexagon Industries", identity_quote: "Hexagon Industries" }, "steel plates")).toBe(30);
    expect(consistentRating(r(50, "Gas cylinder manufacturer", "Makes composite cylinders; steel plates may be used"), { company: "Luxfer Gas Cylinders", identity_quote: "Luxfer Gas Cylinders" }, "steel plates")).toBe(30);
    expect(consistentRating(r(50, "Vessel design verification", "Provides software for pressure vessel design"), { company: "Octave", identity_quote: "" }, "steel plates")).toBe(20);
    expect(consistentRating(r(90, "Pressure vessel fabricator"), { company: "Uni-Vessels Engineering", identity_quote: "Uni-Vessels Engineering" }, "steel plates")).toBe(90);
    expect(consistentRating(r(90, "Pressure vessel fabricator"), { company: "KRR Engineering", identity_quote: "one of India's most trusted pressure vessel manufacturers" }, "steel plates")).toBe(90);
  });
  it("sets place names aside without AI", () => {
    expect(ruleRating("JURF AJMAN UAE", "JURF AJMAN UAE", "steel plates")).toMatchObject({ rating: 0, reason: "A place name, not a company." });
    expect(ruleRating("Rukn Al Mizan Metal", "Rukn Al Mizan Metal", "steel plates")).toBeNull();
  });
  it("never takes a company's role from the page title", () => {
    expect(heuristicRating("FM Regulations", "FM Regulations 1970", "Pressure Vessel Registration Malaysia", "steel plates").rating).toBe(30);
  });
});

describe("rating a search's companies", () => {
  let db: Db;
  let run: string;
  beforeAll(async () => {
    db = await createTestDb();
    run = (await db.query<{ id: string }>("insert into runs (status, adhoc_query) values ('running', $1::jsonb) returning id", [JSON.stringify({ query: "steel plates", productId: "plates", markets: ["IN"] })])).rows[0].id;
    await db.query("insert into research_sessions (run_id, budget) values ($1, '{}'::jsonb)", [run]);
    for (const [key, company, quote] of [["krr", "KRR Engineering Pvt. Ltd.", "KRR Engineering is one of India's most trusted pressure vessel manufacturers"],
      ["lub", "Lubrex FZE", "Lubrex FZE"], ["asme", "ASME", "ASME"], ["hsc", "Hindustan Steel Corporation", "we supply high-strength steel plates"]]) {
      const id = (await db.query<{ id: string }>("insert into research_candidates (run_id, key, company, identity_quote, state) values ($1,$2,$3,$4,'review') returning id", [run, key, company, quote])).rows[0].id;
      await db.query("insert into research_jobs (run_id, stage, key, payload, priority) values ($1, 'collect', $2, '{}'::jsonb, 760)", [run, `official:${id}`]);
    }
  }, 60_000);
  afterAll(async () => { await db?.close(); });

  it("rates with one AI call, saves the answer and checks the best rated first", async () => {
    const calls: string[] = [];
    const provider: LLMProvider = { name: "groq", model: "test", async complete(request) {
      calls.push(request.purpose ?? "");
      const companies = JSON.parse(request.user).companies as { id: string; name: string }[];
      return { tokensIn: 100, tokensOut: 50, text: JSON.stringify({ companies: companies.map((c) => /KRR/.test(c.name)
        ? { id: c.id, rating: 82, role: "Pressure vessel fabricator", reason: "Uses steel plates for vessel shells and heads.", also: ["flanges", "welding-consumables"] }
        : { id: c.id, rating: 4, role: "Lubricant trader", reason: "Trades lubricants; does not use plates." }) }) };
    } };
    const result = await rateCandidates(db, run, { productId: "plates" }, () => provider);
    expect(calls).toEqual(["shortlist_rating"]); // the two rule-rated names never reach the AI
    expect(result.rated).toHaveLength(4);
    const found = await listFoundCompanies(db, run);
    expect(found[0]).toMatchObject({ name: "KRR Engineering Pvt. Ltd.", rating: 82, ratingRole: "Pressure vessel fabricator", relevant: true });
    expect(found[0].alsoBuys.length).toBe(2);
    expect(found.find((f) => f.name === "Lubrex FZE")).toMatchObject({ rating: 4, relevant: false });
    expect(found.find((f) => f.name === "Hindustan Steel Corporation")).toMatchObject({ rating: 3, relevant: false });
    const jobs = (await db.query<{ company: string; priority: number }>(`select c.company, j.priority from research_jobs j join research_candidates c on j.key = 'official:' || c.id where j.run_id=$1 order by j.priority desc`, [run])).rows;
    expect(jobs[0]).toEqual({ company: "KRR Engineering Pvt. Ltd.", priority: 782 });
    expect(jobs.slice(1).every((j) => j.priority === 5)).toBe(true);
    expect((await rateCandidates(db, run, { productId: "plates" }, () => provider)).rated).toHaveLength(0); // never rated twice
  });

  it("asks again for names the first answer skipped, before falling back to rules", async () => {
    for (const [key, company] of [["kawan", "Kawan Engineering Sdn Bhd"], ["mset", "MSET Engineering Corporation Sdn Bhd"]])
      await db.query("insert into research_candidates (run_id, key, company, identity_quote, state) values ($1,$2,$3,$3,'review')", [run, key, company]);
    const asked: string[][] = [];
    const provider: LLMProvider = { name: "groq", model: "test", async complete(request) {
      const companies = JSON.parse(request.user).companies as { id: string; name: string }[];
      asked.push(companies.map((c) => c.name));
      // The first answer skips the second company; the retry answers it.
      const answer = (asked.length === 1 ? companies.slice(0, 1) : companies).map((c) => ({ id: c.id, rating: 64, role: "Pressure vessel fabricator", reason: "Listed among pressure vessel makers." }));
      return { tokensIn: 10, tokensOut: 10, text: JSON.stringify({ companies: answer }) };
    } };
    const result = await rateCandidates(db, run, { productId: "plates" }, () => provider);
    expect(asked).toEqual([["Kawan Engineering Sdn Bhd", "MSET Engineering Corporation Sdn Bhd"], ["MSET Engineering Corporation Sdn Bhd"]]);
    expect(result.rated.map((x) => x.source)).toEqual(["ai", "ai"]);
  });
});
