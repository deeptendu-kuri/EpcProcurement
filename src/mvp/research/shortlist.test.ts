// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/mvp/db";
import type { LLMProvider } from "@/mvp/llm/types";
import { consistentRating, consistentReason, consistentType, heuristicRating, parseRatings, rateCandidates, ratingPrompt, ruleRating } from "./shortlist";
import { listFoundCompanies } from "./found";

describe("shortlist rating rules (docs/mvp/18 §5)", () => {
  it("rates page furniture and sellers of the material without AI", () => {
    expect(ruleRating("ASME", "ASME", "steel plates")?.rating).toBe(0);
    // Without resellers a seller is a competitor by rule; with resellers the AI tells a stockist from a mill.
    expect(ruleRating("Hindustan Steel Corporation", "At Hindustan Steel Corporation, we supply high-strength steel plates", "steel plates", { resellers: false }))
      .toMatchObject({ rating: 3, role: "Seller of steel plates", buyerType: "competitor" });
    expect(ruleRating("Hindustan Steel Corporation", "At Hindustan Steel Corporation, we supply high-strength steel plates", "steel plates")).toBeNull();
    expect(ruleRating("KRR Engineering", "one of India's most trusted pressure vessel manufacturers", "steel plates")).toBeNull();
  });
  it("falls back to a plain heuristic that keeps fuel traders out and fabricators in", () => {
    expect(heuristicRating("KRR Engineering", "pressure vessel manufacturers", null, "steel plates")).toMatchObject({ role: "Process equipment fabricator", source: "rules" });
    expect(heuristicRating("PETRO GOLD LUBRICANT AND GREASE LLC", "PETRO GOLD LUBRICANT AND GREASE LLC", null, "steel plates").rating).toBeLessThan(25);
    expect(heuristicRating("Octave", null, null, "steel plates")).toMatchObject({ rating: 30, role: "Not clear yet" });
    expect(heuristicRating("ZenWeb", "ZenWeb is a digital marketing agency for metal fabricators in Malaysia.", null, "steel plates")).toMatchObject({ rating: 8, role: "Service company" });
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
      { id: "a", rating: 100, role: "Pressure vessel fabricator", reason: "Rolls plates into vessel shells.", also: ["flanges"], source: "ai", raw: 100, buyerType: null, match: null },
      { id: "b", rating: 2, role: "Lubricant trader", reason: "Sells lubricants.", also: [], source: "ai", raw: 2, buyerType: null, match: null },
    ]);
  });
});

describe("ratings stay consistent with their own words (9 Oct steel plates findings)", () => {
  const r = (rating: number, role: string, reason = "") => ({ rating, role, reason, also: [] });
  it("caps sellers of the material and self-declared non-buyers", () => {
    expect(consistentRating(r(90, "Steel plate manufacturer", "Produces stainless steel plates, not a buyer of steel plates."), { company: "New Castle Stainless Plate", identity_quote: "turn raw slab into plate" }, "steel plates")).toBe(5);
    // A stockist is a reseller buyer (ranked below end users) when he sells wholesale, else a competitor.
    const stockist = r(70, "Steel plate supplier", "Sells SA516 plates for boilers");
    const navgraha = { company: "Navgraha Steels INC", identity_quote: "Navgraha Steels INC" };
    // A bare name is not enough to be a likely reseller: it must say itself that it stocks or supplies.
    expect([consistentRating(stockist, navgraha, "steel plates"), consistentType(stockist, navgraha, "steel plates")]).toEqual([40, "reseller"]);
    expect(consistentRating(stockist, { company: "Navgraha Steels INC", identity_quote: "Navgraha Steels is a stockist and supplier of SA516 plates to fabricators" }, "steel plates")).toBe(65);
    expect([consistentRating(stockist, navgraha, "steel plates", { resellers: false }), consistentType(stockist, navgraha, "steel plates", { resellers: false })]).toEqual([5, "competitor"]);
    expect(consistentType(r(90, "Steel plate manufacturer"), navgraha, "steel plates")).toBe("competitor");
    expect(consistentRating(r(70, "Wind farm EPC contractor", "DEME installed turbines, not line pipe buyer."), { company: "DEME", identity_quote: "DEME installed turbines" }, "line pipe")).toBe(5);
    expect(consistentRating(r(70, "Subsea contractor", "Supplies control umbilicals, not line pipe; rating low."), { company: "OneSubsea", identity_quote: "OneSubsea supplies umbilicals" }, "line pipe")).toBe(5);
  });
  it("keeps a bare name without any work in it below Strong", () => {
    expect(consistentRating(r(90, "Pressure vessel fabricator"), { company: "STAR GATE ENERGY", identity_quote: "STAR GATE ENERGY" }, "steel plates")).toBe(50);
    expect(consistentRating(r(60, "Pressure vessel fabricator"), { company: "Prime Petrolium FZE", identity_quote: "Prime Petrolium FZE" }, "steel plates")).toBe(10);
    expect(consistentRating(r(90, "Oil and gas company", "Aramco owns pipelines and buys line pipe."), { company: "Saudi Arabian Oil Company (Aramco)", identity_quote: "Aramco awarded the pipeline contract" }, "line pipe")).toBe(90);
    expect(consistentRating(r(60, "Composite pressure vessel fabricator"), { company: "Hexagon Industries", identity_quote: "Hexagon Industries" }, "steel plates")).toBe(30);
    expect(consistentRating(r(50, "Gas cylinder manufacturer", "Makes composite cylinders; steel plates may be used"), { company: "Luxfer Gas Cylinders", identity_quote: "Luxfer Gas Cylinders" }, "steel plates")).toBe(30);
    expect(consistentRating(r(50, "Vessel design verification", "Provides software for pressure vessel design"), { company: "Octave", identity_quote: "" }, "steel plates")).toBe(20);
    expect(consistentRating(r(90, "Pressure vessel fabricator"), { company: "Uni-Vessels Engineering", identity_quote: "Uni-Vessels Engineering" }, "steel plates")).toBe(90);
    expect(consistentRating(r(90, "Pressure vessel fabricator"), { company: "KRR Engineering", identity_quote: "one of India's most trusted pressure vessel manufacturers" }, "steel plates")).toBe(90);
  });
  it("sets project names aside: the project's owner or contractor is the buyer", () => {
    for (const name of ["Ichthys LNG Project", "North Field Expansion Project", "Marjan Increment Project – Package 4 Offshore Gas Facilities", "Scarborough FPU", "TenneT BorWin 6 OSS", "Umm Shaif Field Development"])
      expect(ruleRating(name, name, "line pipe")?.rating).toBe(0);
    for (const name of ["McDermott", "Subsea 7", "Petronas", "Larsen & Toubro", "Project Engineering Co LLC"]) expect(ruleRating(name, name, "line pipe")).toBeNull();
    expect(ruleRating("Natural Gas Development Project Offshore Brunei", "", "line pipe")?.rating).toBe(0);
    expect(consistentRating({ rating: 85, role: "EPC contractor", reason: "Requires line pipe.", also: [] }, { company: "Ichthys LNG Project", identity_quote: "Ichthys LNG Project" }, "line pipe")).toBe(0);
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
    expect(calls).toEqual(["shortlist_rating"]); // furniture is rule-rated and never reaches the AI
    expect(result.rated).toHaveLength(4);
    const found = await listFoundCompanies(db, run);
    expect(found[0]).toMatchObject({ name: "KRR Engineering Pvt. Ltd.", rating: 82, ratingRole: "Pressure vessel fabricator", relevant: true });
    expect(found[0].alsoBuys.length).toBe(2);
    expect(found.find((f) => f.name === "Lubrex FZE")).toMatchObject({ rating: 4, relevant: false });
    expect(found.find((f) => f.name === "Hindustan Steel Corporation")).toMatchObject({ relevant: false });
    const jobs = (await db.query<{ company: string; priority: number }>(`select c.company, j.priority from research_jobs j join research_candidates c on j.key = 'official:' || c.id where j.run_id=$1 order by j.priority desc`, [run])).rows;
    expect(jobs[0]).toEqual({ company: "KRR Engineering Pvt. Ltd.", priority: 1182 }); // a likely buyer is checked before more list searches (1000)
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

  it("lets AI re-rate plain-rule guesses later, but keeps definite rule decisions", async () => {
    await db.query("insert into research_candidates (run_id, key, company, identity_quote, state, rating, rating_source, rating_role) values ($1,'guess','Bina Fabricators','Bina Fabricators','review',66,'rules','Steel fabricator'),($1,'cert','DNV','DNV','review',0,'rules','Not a buyer')", [run]);
    const seen: string[] = [];
    const provider: LLMProvider = { name: "groq", model: "test", async complete(request) {
      const companies = JSON.parse(request.user).companies as { id: string; name: string }[];
      seen.push(...companies.map((c) => c.name));
      return { tokensIn: 1, tokensOut: 1, text: JSON.stringify({ companies: companies.map((c) => ({ id: c.id, rating: 78, role: "Structural steel fabricator", reason: "Fabricates steel structures from plate." })) }) };
    } };
    expect((await rateCandidates(db, run, { productId: "plates" }, null)).rated).toHaveLength(0); // no AI: guesses stay
    await rateCandidates(db, run, { productId: "plates" }, () => provider);
    expect(seen).toEqual(["Bina Fabricators"]);
    const found = await listFoundCompanies(db, run);
    expect(found.find((f) => f.name === "Bina Fabricators")).toMatchObject({ rating: 78, guessed: false });
  });
});

describe("buyer types and the exact variant (docs/mvp/19 Phase 2)", () => {
  const rows = [{ id: "a", company: "Gulf Water Engineering", identity_quote: "builds desalination plants", title: null },
    { id: "b", company: "Al Noor Steel Trading", identity_quote: "stockist of stainless steel pipes supplying contractors", title: null },
    { id: "c", company: "Ratnamani Metals", identity_quote: "manufacturer of welded stainless steel pipes", title: null }];
  it("tells the AI what exactly is sold, who uses that variant and how resellers count", () => {
    const on = ratingPrompt("ss-duplex-pipe", rows, { query: "Welded Stainless Steel Pipes 316L A312" });
    expect(on.system).toMatch(/sells: Welded, 316L, ASTM A312 stainless/);
    expect(on.system).toMatch(/water treatment and desalination plants/);
    expect(on.system).toMatch(/reseller: a stockist, trader or distributor that buys/);
    expect(ratingPrompt("ss-duplex-pipe", rows, { resellers: false }).system).toMatch(/are competitors here/);
  });
  it("keeps buyer type and match, and applies the reseller setting", () => {
    const text = JSON.stringify({ companies: [
      { id: "c1", rating: 82, type: "end_user", match: "work", role: "Desalination plant builder", reason: "Uses welded SS pipe for RO plants." },
      { id: "c2", rating: 75, type: "reseller", match: "product", role: "Stainless pipe stockist", reason: "Stocks SS pipe for contractors." },
      { id: "c3", rating: 60, type: "competitor", match: "named", role: "Welded stainless pipe manufacturer", reason: "Makes the product." },
    ] });
    expect(parseRatings(text, rows, "ss-duplex-pipe").map((r) => [r.rating, r.buyerType, r.match])).toEqual([[82, "end_user", "work"], [65, "reseller", "product"], [5, "competitor", null]]);
    expect(parseRatings(text, rows, "ss-duplex-pipe", { resellers: false }).map((r) => [r.rating, r.buyerType])).toEqual([[82, "end_user"], [5, "competitor"], [5, "competitor"]]);
  });
  it("labels plain-rule guesses with a buyer type", () => {
    expect(heuristicRating("Al Noor Steel Trading", "stockist of stainless steel pipes", null, "stainless pipe")).toMatchObject({ buyerType: "reseller", rating: 40 });
    expect(heuristicRating("Al Noor Steel Trading", "stockist of stainless steel pipes", null, "stainless pipe", { resellers: false })).toMatchObject({ buyerType: "competitor" });
    expect(heuristicRating("Gulf Mech", "mechanical subcontractor", null, "stainless pipe")).toMatchObject({ buyerType: "subcontractor" });
  });
});

describe("fixes from the per-company eval (docs/mvp/19 §5)", () => {
  const rows = ["Lubrex FZe", "Ayla International LLC", "MAGIC OIL", "Gulf Fabricators"].map((company, i) => ({ id: String(i), company, identity_quote: company, title: "Top Steel Tank Fabrication Manufacturer In UAE" }));
  it("treats one reason repeated for 3+ bare names as the page's subject, not their work", () => {
    const text = JSON.stringify({ companies: rows.map((_, i) => ({ id: `c${i + 1}`, rating: 90, type: "end_user", role: "Pressure vessel fabricator", reason: i < 3 ? "Manufactures steel tanks and pressure vessels" : "Fabricates steel tanks for oil terminals" })) });
    const rated = parseRatings(text, rows, "plates");
    expect(rated.slice(0, 3).map((r) => [r.rating, r.reason.startsWith("Page context only")])).toEqual([[30, true], [30, true], [30, true]]);
    expect(rated[3].rating).toBe(90); // its own distinct reason, and "Fabricators" names its work
  });
  it("caps companies whose page or role names a different material", () => {
    const judged = { rating: 70, role: "Pressure vessel fabricator", reason: "Makes pressure vessels" };
    expect(consistentRating(judged, { company: "NPROXX", identity_quote: "NPROXX", title: "Top 10 Composite Pressure Vessel Manufacturers" }, "steel plates")).toBe(30);
    expect(consistentRating(judged, { company: "PolyPipe Works", identity_quote: "PolyPipe Works fabricates HDPE pipelines", title: "HDPE pipe contractors" }, "HDPE pipe")).toBe(70);
  });
  it("calls a maker a competitor from its own words or its name", () => {
    expect(consistentType({ rating: 70, role: "stainless steel pipe supplier", reason: "Supplies pipe", buyerType: "reseller" },
      { company: "Metallica", identity_quote: "Metallica is one of the biggest stainless steel pipe suppliers and manufacturers in India" }, "stainless / duplex pipe")).toBe("competitor");
    expect(consistentType({ rating: 45, role: "EPC contractor", reason: "Secured a pipe contract", buyerType: "contractor" },
      { company: "East Pipes Integrated Company", identity_quote: "EPIC secured a steel pipe contract" }, "line pipe")).toBe("competitor");
    expect(consistentType({ rating: 80, role: "Pipeline contractor", reason: "Lays pipelines", buyerType: "contractor" },
      { company: "Gulf Pipeline Builders", identity_quote: "Gulf Pipeline Builders lays gas pipelines" }, "line pipe")).toBe("contractor");
  });
  it("tells the AI that owners commissioning projects buy the material", () => {
    expect(ratingPrompt("line-pipe", rows).system).toMatch(/owner-furnished material/);
  });
});

describe("fixes from the per-company eval, round 2", () => {
  it("does not treat a real list of fabricators as page context", () => {
    const rows = ["Kawan Engineering Sdn Bhd", "Kejuruteraan Jade Star Sdn Bhd", "MSET Engineering Corporation Sdn Bhd"].map((company, i) => ({ id: String(i), company, identity_quote: company, title: "Pressure Vessel Manufacturers in Malaysia" }));
    const text = JSON.stringify({ companies: rows.map((_, i) => ({ id: `c${i + 1}`, rating: 70, type: "end_user", role: "Pressure vessel fabricator", reason: "Listed as a pressure vessel manufacturer" })) });
    expect(parseRatings(text, rows, "plates").map((r) => r.rating)).toEqual([70, 70, 70]);
  });
  it("caps a rating whose own reason doubts it", () => {
    expect(consistentRating({ rating: 45, role: "Wind farm EPC contractor", reason: "No indication of pipe usage" }, { company: "Unison", identity_quote: "Unison builds wind farms" }, "line pipe")).toBe(30);
    expect(consistentRating({ rating: 45, role: "Subsea contractor", reason: "Only umbilicals mentioned" }, { company: "OneSubsea", identity_quote: "OneSubsea supplies umbilicals" }, "line pipe")).toBe(30);
  });
  it("treats the product in a company's name as a maker unless the name names its work", () => {
    const judged = { rating: 70, role: "Stainless plate user", reason: "Uses plates", buyerType: "end_user" as const };
    expect(consistentType(judged, { company: "New Castle Stainless Plate", identity_quote: "New Castle Stainless Plate" }, "steel plates")).toBe("competitor");
    expect(consistentType(judged, { company: "Gulf Plate Fabricators", identity_quote: "Gulf Plate Fabricators" }, "steel plates")).toBe("end_user");
  });
  it("tells the AI a client commissioning projects is a buyer", () => {
    expect(ratingPrompt("line-pipe", []).system).toMatch(/a client that commissions projects .* buys the material/);
  });
});

describe("fixes from the live Saudi search, 10 Oct", () => {
  const product = "stainless / duplex pipe";
  it("rates an owner the AI called a competitor as a buyer when its own reason says it uses the material", () => {
    const judged = { rating: 5, role: "Water utility", reason: "Commissioning water treatment projects, likely uses stainless/duplex pipe", buyerType: "competitor" as const };
    const row = { company: "Saudi Water Authority", identity_quote: "Saudi Water Authority awarded the desalination contract" };
    expect(consistentType(judged, row, product)).toBe("owner");
    expect(consistentRating(judged, row, product)).toBe(50);
  });
  it("keeps a pipe maker a competitor and does not show the AI's 'likely to buy'", () => {
    const judged = { rating: 70, role: "Pipe company", reason: "EPIC is the same entity as c11, likely to buy stainless/duplex pipe", buyerType: "end_user" as const };
    const row = { company: "East Pipes Integrated Company for Industry (EPIC)", identity_quote: "East Pipes Integrated Company for Industry (EPIC)" };
    expect(consistentType(judged, row, product)).toBe("competitor");
    expect(consistentRating(judged, row, product)).toBe(5);
    expect(consistentReason(judged, row, product)).toBe("Makes or sells stainless / duplex pipe: a competitor for it, not a buyer.");
  });
  it("keeps a real maker a competitor even when the AI's reason mentions use", () => {
    const judged = { rating: 5, role: "Steel pipe manufacturer", reason: "Manufactures pipe; uses steel coil", buyerType: "competitor" as const };
    expect(consistentType(judged, { company: "Example Tubes Co", identity_quote: "Example Tubes Co" }, product)).toBe("competitor");
  });
});
