// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/mvp/db";
import type { LLMProvider } from "@/mvp/llm";
import { briefKey, briefPrompt, catalogueBrief, getSearchBrief, parseBrief, seedFacts, usesFor } from "./brief";

const answer = (over: Record<string, unknown> = {}) => JSON.stringify({
  item: "Stud bolts and spiral wound gaskets", mustHave: ["ASME B16.20", "2 inch to 24 inch", "high-temperature service"], buying: "both",
  uses: [
    { name: "gas processing plant", newsWords: ["gas plant", "NGL"], why: "Every flanged joint needs bolting and a gasket.", countries: ["AE", "SA"] },
    { name: "flanged pipe assembly", newsWords: ["flange", "bolts", "gaskets"], why: "Parts, not work.", countries: ["AE"] },
    { name: "plant maintenance contract", newsWords: ["maintenance", "shutdown"], why: "Joints are re-made at every shutdown.", countries: ["SA", "QA"] },
  ],
  buyerRoles: ["EPC contractors"], notBuyers: ["fastener traders"], owners: ["ADNOC", "Saudi Aramco"],
  places: { AE: ["الإمارات", "Ruwais", "Abu Dhabi"], SA: ["السعودية", "Jubail"] }, ...over,
});

describe("search brief checks (docs/mvp/20 §4, rules from the 10 Oct proof runs)", () => {
  it("keeps the work's headline words, never the item's own words (rule 6)", () => {
    const brief = parseBrief(answer(), "Stud bolts and spiral wound gaskets", ["AE", "SA"], "stud-bolts")!;
    expect(brief.uses.map((u) => u.name)).toEqual(["gas processing plant", "flanged pipe assembly", "plant maintenance contract"]);
    // "bolts" and "gaskets" are the item; only "flange" survives for the parts entry.
    expect(brief.uses[1].newsWords).toEqual(["flange"]);
    expect(brief.uses[0].newsWords).toEqual(["gas plant", "NGL"]);
  });
  it("keeps conditions as must-haves, never sizes (check 4)", () => {
    expect(parseBrief(answer(), "Stud bolts and spiral wound gaskets", ["AE", "SA"], null)!.mustHave).toEqual(["ASME B16.20", "high-temperature service"]);
  });
  it("keeps countries to the chosen markets and local words to non-English countries (rule 12)", () => {
    const brief = parseBrief(answer({ uses: [
      { name: "municipal water network", newsWords: ["water network"], why: "Distribution mains.", countries: ["NO", "XX"], localWords: { NO: ["vann", "avløp", "rør"], IN: ["paani"] } },
      { name: "fish farming", newsWords: ["aquaculture"], why: "Cage rings.", countries: ["no"], localWords: { NO: ["oppdrett"] } },
    ] }), "HDPE pipe PE100", ["IN", "NO"], "hdpe-pipe")!;
    expect(brief.uses[0].countries).toEqual(["NO"]);
    expect(brief.uses[1].countries).toEqual(["NO"]);
    // "rør" (pipe) is the item's own word in Norwegian? No: only words of the typed item are removed.
    expect(brief.uses[0].localWords).toEqual({ NO: ["vann", "avløp", "rør"] });
    expect(usesFor(brief, "NO").map((u) => u.name)).toEqual(["municipal water network", "fish farming"]);
    expect(usesFor(brief, "IN").map((u) => u.name)).toEqual(["municipal water network", "fish farming"]);
  });
  it("is rejected when fewer than two uses survive the checks", () => {
    expect(parseBrief(answer({ uses: [{ name: "bolting", newsWords: ["bolts", "gaskets"], why: "" }] }), "Stud bolts and spiral wound gaskets", ["AE"], null)).toBeNull();
    expect(parseBrief("not json", "x", ["AE"], null)).toBeNull();
  });
  it("seeds the AI with the catalogue's knowledge of who buys the nearest item (rule 11)", () => {
    const seed = seedFacts("stud-bolts");
    expect(seed.length).toBeGreaterThan(0);
    const prompt = briefPrompt("Stud bolts", ["IN", "NO"], ["- 2026-08 ADNOC awards gas plant EPC: …"], seed);
    expect(prompt.user).toMatch(/never a part, assembly or component/);
    expect(prompt.user).toMatch(/Never list work where a different material is standard/);
    expect(prompt.user).toMatch(/"NO": \[2-4 words local news in Norway/);
    // India's news is English: no local words asked (the UAE counts as Arabic, so it would get them).
    expect(prompt.user).not.toMatch(/"IN": \[2-4 words local news/);
    expect(prompt.user).toContain(seed[0]);
  });
  it("falls back to today's catalogue knowledge without AI", () => {
    const brief = catalogueBrief("Carbon steel pipe ASTM A106", ["AE"], "cs-process-pipe");
    expect(brief.source).toBe("catalogue");
    expect(brief.uses.length).toBeGreaterThan(0);
    expect(brief.uses.every((u) => u.newsWords.length > 0)).toBe(true);
  });
  it("uses one cache key per wording and set of countries", () => {
    expect(briefKey("Cryogenic  Valves ", ["SA", "AE", "ae"])).toBe(briefKey("cryogenic valves", ["AE", "SA"]));
    expect(briefKey("cryogenic valves", ["AE"])).not.toBe(briefKey("cryogenic valves", ["AE", "SA"]));
  });
});

describe("getSearchBrief", () => {
  let db: Db;
  beforeAll(async () => { db = await createTestDb(); }, 60_000);
  afterAll(async () => { await db.close(); });
  it("writes the brief once with grounding, then reuses it from the cache", async () => {
    const asked: string[] = [];
    const provider: LLMProvider = { name: "groq", model: "test", async complete(request) { asked.push(request.user); return { text: answer(), tokensIn: 10, tokensOut: 10 }; } };
    const grounded: string[] = [];
    const ground = async (query: string) => { grounded.push(query); return [{ title: "ADNOC awards gas plant EPC", snippet: "Example snippet", date: "2026-08-17" }]; };
    const first = await getSearchBrief(db, { material: "Stud bolts and spiral wound gaskets", markets: ["AE", "SA"], productId: "stud-bolts" }, provider, ground);
    expect(first.source).toBe("ai");
    expect(grounded).toEqual(["Stud bolts and spiral wound gaskets project United Arab Emirates", "Stud bolts and spiral wound gaskets project Saudi Arabia"]);
    expect(asked[0]).toContain("ADNOC awards gas plant EPC");
    const again = await getSearchBrief(db, { material: "stud bolts and spiral wound gaskets", markets: ["SA", "AE"], productId: "stud-bolts" }, provider, ground);
    expect(again).toEqual(first);
    expect(asked).toHaveLength(1);
  });
  it("falls back to the catalogue brief (not cached) when the AI is unavailable or answers badly", async () => {
    const failing: LLMProvider = { name: "groq", model: "test", async complete() { throw new Error("groq 429"); } };
    const brief = await getSearchBrief(db, { material: "Line pipe", markets: ["AE"], productId: "line-pipe" }, failing, null);
    expect(brief.source).toBe("catalogue");
    expect((await db.query("select 1 from search_briefs where key=$1", [briefKey("Line pipe", ["AE"])])).rows).toHaveLength(0);
    expect((await getSearchBrief(db, { material: "Line pipe", markets: ["AE"], productId: "line-pipe" }, null, null)).source).toBe("catalogue");
  });
});

describe("matching the AI's use to the brief (smoke test, 10 Oct)", async () => {
  const { matchUse } = await import("./brief");
  const b = parseBrief(answer(), "Stud bolts and spiral wound gaskets", ["AE", "SA"], "stud-bolts")!;
  it("accepts the same work in other words, never none", () => {
    expect(matchUse(b, "Gas Processing Plant")?.name).toBe("gas processing plant");
    expect(matchUse(b, "gas processing plant (Habshan)")?.name).toBe("gas processing plant");
    expect(matchUse(b, "NGL train")?.name).toBe("gas processing plant");
    expect(matchUse(b, null)).toBeNull();
    expect(matchUse(b, "none")).toBeNull();
    expect(matchUse(b, "road construction")).toBeNull();
  });
});
