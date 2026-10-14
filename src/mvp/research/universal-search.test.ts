// @vitest-environment node
/**
 * docs/mvp/22: universal search. Any typed product is searched as typed (no catalogue type), its open tenders are
 * searched first in every country, and an organisation's own tender or order for the item makes it a direct buyer.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type Db } from "@/mvp/db";
import type { RunInput } from "@/mvp/types";
import type { RawDoc } from "@/mvp/pipeline/contracts";
import type { LLMProvider } from "@/mvp/llm";
import { saveBuyer } from "@/mvp/discovery";
import { briefKey, catalogueBrief, fabricatedItem, parseBrief, type SearchBrief } from "@/mvp/discovery/brief";
import { consistentRating, consistentType } from "./shortlist";
import { materialEvidenceKind, materialOutputOnly, tenderForItem } from "@/mvp/discovery/plan";
import { registerSearchItemTerms } from "@/mvp/discovery/item";
import { sourcePlan } from "@/mvp/sourcing/plan";
import { tenderListPages, tenderWording } from "@/mvp/sourcing/tender-sources";
import { listOurProducts } from "@/mvp/products/our-products";
import { runInputSchema } from "@/app/api/mvp/_shared/schemas";
import { judgeNeed, maskedIssuer, tenderDueDate } from "./need";
import { inChosenCountry } from "./likely";
import { tenderListingBlocks, workAnalysisText } from "./relevance";
import { createResearchRun, sessionFor } from "./store";
import { analysisBudget, processResearchTick, rateLimited, type ResearchDeps } from "./engine";
import { LLMHttpError } from "@/mvp/llm/types";
import { researchBudget } from "@/mvp/discovery/plan";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const fansBrief = (over: Partial<SearchBrief> = {}): SearchBrief => ({
  version: 3, item: "Centrifugal fans", mustHave: [], buying: "both", source: "ai", productId: "q:centrifugal-fans",
  uses: [
    { name: "thermal power plant", newsWords: ["thermal power", "boiler"], why: "Boilers need ID and FD fans.", countries: [], localWords: {} },
    { name: "cement plant", newsWords: ["cement plant", "kiln"], why: "Kilns and mills move air with fans.", countries: [], localWords: {} },
  ],
  buyerRoles: ["EPC contractors"], notBuyers: ["ceiling fan dealers"], owners: ["NTPC"], places: { IN: ["भारत", "Dadri"] },
  kind: "rotating_equipment", synonyms: ["ID fan", "induced draft fan"], tenderWords: ["supply of centrifugal fans"], directBuyers: ["power utilities"], makers: ["fan manufacturers"], localItem: {},
  ...over,
});

describe("a typed item is named only by its own words (docs/mvp/22 §3.2)", () => {
  it("finds the item's phrases and the brief's other names, punctuation-insensitive", () => {
    expect(materialEvidenceKind("NTPC tenders supply of Centrifugal-Fans for Dadri.", "q:centrifugal-fans")).toBe("explicit");
    expect(materialEvidenceKind("The plant needs a new centrifugal fan for its kiln.", "q:centrifugal-fans")).toBe("explicit");
    registerSearchItemTerms("q:centrifugal-fans", ["induced draft fan"]);
    expect(materialEvidenceKind("Replacement of induced draft fans at unit 2 of the power station.", "q:centrifugal-fans")).toBe("explicit");
    expect(materialEvidenceKind("Fans cheered as the team won the cup.", "q:centrifugal-fans")).toBe("none");
  });
  it("guards one-word items: industrial context needed, never a whistle-blower", () => {
    expect(materialEvidenceKind("Twin lobe blowers for the sewage treatment plant aeration tanks.", "q:blowers")).toBe("explicit");
    expect(materialEvidenceKind("A whistle-blower reported the company to the regulator.", "q:blowers")).toBe("none");
    expect(materialEvidenceKind("The research vessel docked in Mumbai port.", "q:vessel")).toBe("none");
  });
});

describe("open tenders that name the item (docs/mvp/22 §3.6)", () => {
  it("is a tender only with tender wording AND the item", () => {
    expect(tenderForItem("Tender for supply of centrifugal fans at NTPC Dadri. Bid due date 30 Oct 2026.", "q:centrifugal-fans")).toBe(true);
    expect(tenderForItem("منافسة توريد pressure vessels لمحطة الجبيل", "q:pressure-vessels")).toBe(true);
    expect(tenderForItem("Tender for civil works of the Dadri ash dyke. Bid due date 30 Oct 2026.", "q:centrifugal-fans")).toBe(false);
    expect(tenderForItem("Our centrifugal fans are built for power plants.", "q:centrifugal-fans")).toBe(false);
  });
  it("recognises a catalogue product's tender by the brief's own name for the item, never by a lone family word", () => {
    const text = "ADNOC Gas invites tender for supply of cryogenic valves for the Ruwais LNG train. Bid closing date 2 Nov 2026.";
    const brief = { item: "Cryogenic valves", synonyms: ["cryogenic ball valves"] };
    expect(tenderForItem(text, "gate-globe-check")).toBe(false);
    expect(tenderForItem(text, "gate-globe-check", brief)).toBe(true);
    expect(tenderForItem("Tender for supply of valves for the water network. Bid closing date 2 Nov 2026.", "gate-globe-check", brief)).toBe(false);
  });
});

describe("the tender lane of the search plan (docs/mvp/22 §3.5)", () => {
  it("searches each country's tender portals first, then the work, for a typed item", () => {
    const plan = sourcePlan({ productId: "q:centrifugal-fans", keyword: "Centrifugal fans", markets: ["IN", "AE"], mode: "preview", brief: fansBrief() });
    const tender = plan.filter((t) => t.tender && t.source === "tavily");
    expect(tender.filter((t) => t.market === "IN").map((t) => t.query)).toEqual(["Centrifugal fans tender India", "supply of centrifugal fans tender India"]);
    // India's tender list page is read directly, first, with no search credit; the UAE has none.
    const pages = plan.filter((t) => t.source === "tender-page");
    expect(pages.map((t) => [t.market, t.url])).toEqual([["IN", "https://tender18.com/all-india-tenders/keyword-tenders/centrifugal-fan-tenders"]]);
    expect(pages[0].id).toContain(":tender:");
    expect(pages[0].priority).toBeGreaterThan(Math.max(...tender.map((t) => t.priority)));
    expect(tender.find((t) => t.market === "IN")?.includeDomains).toEqual(expect.arrayContaining(["tender18.com", "publicservicesmap.in"]));
    expect(tender.find((t) => t.market === "AE")?.includeDomains).toEqual(expect.arrayContaining(["bidsfactory.com", "dewa.gov.ae"]));
    expect(tender.every((t) => t.timeRange === "year")).toBe(true);
    const paid = plan.filter((t) => t.source === "tavily");
    expect(paid.slice(0, 2).every((t) => t.tender)).toBe(true);
    expect(plan.filter((t) => t.source === "bing-query" && t.id.includes(":tender:")).map((t) => t.query)).toContain('"Centrifugal fans" order India');
    expect(plan.some((t) => t.lane === "capability" && /thermal power plant/.test(t.query ?? ""))).toBe(true);
  });
  it("adds the item's own-language name to Gulf tender searches", () => {
    const plan = sourcePlan({ productId: "q:pressure-vessels", keyword: "pressure vessels", markets: ["SA"], mode: "preview",
      brief: fansBrief({ item: "Pressure vessels", productId: "q:pressure-vessels", localItem: { SA: ["أوعية ضغط"] } }) });
    expect(plan.find((t) => t.source === "local-news" && t.id.includes(":tender:"))).toMatchObject({ localQuery: "مناقصة أوعية ضغط" });
  });
  it("still searches tenders and direct mentions when the AI could not describe the work", () => {
    const fallback = catalogueBrief("pressure vessels", ["IN"], "q:pressure-vessels");
    expect(fallback.uses).toHaveLength(0);
    const plan = sourcePlan({ productId: "q:pressure-vessels", keyword: "pressure vessels", markets: ["IN"], mode: "preview", brief: fallback });
    expect(plan.filter((t) => t.tender).map((t) => t.url ?? t.query)).toEqual(["https://tender18.com/all-india-tenders/keyword-tenders/pressure-vessel-tenders",
      "pressure vessels tender India", "supply of pressure vessels tender India"]);
  });
  it("names India's tender list page by the item's singular words", () => {
    const url = (item: string) => tenderListPages(item, "IN")[0]?.url.replace("https://tender18.com/all-india-tenders/keyword-tenders/", "");
    expect([url("API 660 heat exchangers"), url("Axial Fans"), url("gas boxes"), url("Separators"), url("pressure vessel")])
      .toEqual(["api-660-heat-exchanger-tenders", "axial-fan-tenders", "gas-box-tenders", "separator-tenders", "pressure-vessel-tenders"]);
    expect(tenderListPages("pressure vessels", "SA")).toEqual([]);
  });
  it("never throws for a typed item, even in the legacy plan", () => {
    expect(() => sourcePlan({ productId: "q:pressure-vessels", keyword: "pressure vessels", markets: ["IN"], mode: "preview" })).not.toThrow();
    expect(() => sourcePlan({ productId: "not-a-product", keyword: "x", markets: ["IN"], mode: "preview" })).toThrow("Unknown sourcing product.");
  });
});

describe("fixes from the first live run (14 Oct)", () => {
  it("a typed item's own fabricators and suppliers are sellers, but a tender 'for supply of' it is a buyer", () => {
    expect(materialOutputOnly("Alnafie Metal Industries fabricates pressure vessels and storage tanks for refineries.", "q:pressure-vessels")).toBe(true);
    expect(materialOutputOnly("Example Fans Ltd is a leading supplier of centrifugal fans in India.", "q:centrifugal-fans")).toBe(true);
    expect(materialOutputOnly("NTPC Limited invites e-tender for supply of centrifugal fans, 2 sets, for its Dadri station.", "q:centrifugal-fans")).toBe(false);
    // Catalogue materials: fabricating WITH the material still consumes it.
    expect(materialOutputOnly("Example Fabricator fabricates pressure vessels from stainless steel pipe.", "ss-duplex-pipe")).toBe(false);
  });
  it("keeps only kinds of makers and buyers, and other names that are the same item", () => {
    const brief = parseBrief(JSON.stringify({ item: "pressure vessel", kind: "static_equipment",
      synonyms: ["ASME pressure vessel", "API 650 tank", "ASME Section VIII vessel"],
      makers: ["Larsen & Toubro", "Technip Energies", "pressure vessel fabricators", "steel plate stockists"],
      directBuyers: ["ADNOC", "refinery operators", "Saudi Aramco", "water utilities"], buying: "project",
      uses: [{ name: "refinery revamp", newsWords: ["refinery expansion"], why: "Vessels." }, { name: "gas processing plant", newsWords: ["gas plant"], why: "Separators." }] }),
      "pressure vessels", ["AE"], "q:pressure-vessels")!;
    expect(brief.synonyms).toEqual(["ASME pressure vessel", "ASME Section VIII vessel"]);
    expect(brief.makers).toEqual(["pressure vessel fabricators", "steel plate stockists"]);
    expect(brief.directBuyers).toEqual(["refinery operators", "water utilities"]);
  });
});

describe("fabricators of a typed fabricated item are competitors (live run, 14 Oct)", () => {
  const alnafie = { company: "AlNafie Metal Industries", identity_quote: "AlNafie Metal Industries provides full steel fabrication and erection services for major EPC projects in Saudi Arabia." };
  const rated = { rating: 65, role: "Steel fabricator", reason: "Fabricates steel for petrochemical plants.", buyerType: "end_user" as const };
  const vessels = { productId: "q:pressure-vessels", kind: "static_equipment" as const };

  it("rates a steel fabricator as a competitor for pressure vessels, and still as a buyer of plate or of fans", () => {
    expect(fabricatedItem(vessels)).toBe(true);
    expect(consistentType(rated, alnafie, "Pressure vessels", { brief: vessels })).toBe("competitor");
    expect(consistentRating(rated, alnafie, "Pressure vessels", { brief: vessels })).toBe(5);
    expect(fabricatedItem({ productId: "plates", kind: "static_equipment" })).toBe(false);
    expect(consistentType(rated, alnafie, "Steel plates", { brief: { productId: "plates", kind: "material" } })).toBe("end_user");
    expect(consistentType(rated, alnafie, "Centrifugal fans", { brief: { productId: "q:centrifugal-fans", kind: "rotating_equipment" } })).toBe("end_user");
    expect(consistentType({ ...rated, role: "EPC contractor", buyerType: "contractor" }, alnafie, "Pressure vessels", { brief: vessels })).toBe("contractor");
  });
});

describe("tender pages have their own AI allowance (live run, 14 Oct)", () => {
  it("adds three AI pages and 12k tokens per country for tender checks only", () => {
    const budget = { ...researchBudget({ query: "x", markets: ["IN", "AE"], researchMode: "preview" }), maxAiPages: 0, maxAiTokens: 0 };
    expect(analysisBudget(budget, 2, true)).toMatchObject({ maxAiPages: 6, maxAiTokens: 24_000 });
    expect(analysisBudget(budget, 2, false)).toBe(budget);
  });
  it("treats an AI rate limit as a wait to retry, never as a buyer-check answer", () => {
    expect(rateLimited(new LLMHttpError("groq", 429, "Rate limit reached for model openai/gpt-oss-120b on tokens per minute (TPM)"))).toBe(true);
    expect(rateLimited(new Error("groq 429: Rate limit reached"))).toBe(true);
    expect(rateLimited(new Error("Unexpected token } in JSON"))).toBe(false);
  });
});

describe("brief v3 (docs/mvp/22 §3.4)", () => {
  it("classes fans, blowers, pumps and compressors as rotating equipment whatever the AI said (live run, 14 Oct)", () => {
    const answer = (item: string, kind: string) => JSON.stringify({ item, kind, mustHave: [], buying: "both", synonyms: [], makers: [], directBuyers: [], tenderWords: [],
      uses: [{ name: "thermal power plant", newsWords: ["thermal power"], why: "x", countries: [] }, { name: "cement plant", newsWords: ["cement plant"], why: "y", countries: [] }],
      buyerRoles: [], notBuyers: [], owners: [], places: {} });
    expect(parseBrief(answer("centrifugal fan", "static_equipment"), "centrifugal fans", ["IN"], "q:centrifugal-fans")?.kind).toBe("rotating_equipment");
    expect(parseBrief(answer("pressure vessel", "static_equipment"), "pressure vessels", ["IN"], "q:pressure-vessels")?.kind).toBe("static_equipment");
    // The fallback brief (no AI) still knows a vessel is fabricated and a fan rotates.
    expect([catalogueBrief("pressure vessels", ["IN"], "q:pressure-vessels").kind, catalogueBrief("axial fans", ["IN"], "q:axial-fans").kind, catalogueBrief("seamless pipe", ["IN"], "q:seamless-pipe").kind])
      .toEqual(["static_equipment", "rotating_equipment", "other"]);
  });
  it("reads the item kind, its other names, tender wording, direct buyers, makers and local names", () => {
    const brief = parseBrief(JSON.stringify({ item: "API 660 shell and tube heat exchanger", kind: "static_equipment",
      synonyms: ["shell and tube heat exchanger", "exchanger", "TEMA AES exchanger", "API 660"], tenderWords: ["supply of heat exchangers"], directBuyers: ["refinery operators"], makers: ["exchanger fabricators"],
      localItem: { SA: ["مبادل حراري"] }, buying: "project",
      uses: [{ name: "refinery revamp", newsWords: ["refinery expansion"], why: "Exchangers are replaced in revamps." }, { name: "petrochemical plant", newsWords: ["cracker"], why: "Process heat recovery." }] }),
      "API 660 heat exchanger", ["SA", "IN"], "q:api-660-heat-exchanger");
    expect(brief).toMatchObject({ kind: "static_equipment", tenderWords: ["supply of heat exchangers"], directBuyers: ["refinery operators"], makers: ["exchanger fabricators"], localItem: { SA: ["مبادل حراري"] } });
    expect(brief!.synonyms).toEqual(["shell and tube heat exchanger", "TEMA AES exchanger", "API 660"]);
  });
});

describe("direct buyers: an organisation's own tender or order (docs/mvp/22 §3.7)", () => {
  const recent = daysAgo(10);
  const text = `Tender for Supply of Centrifugal Fans\nNTPC Limited invites e-tender for supply of centrifugal fans, 2 sets, for its Dadri station in Uttar Pradesh, India. Bid due date in three weeks.\nExample Fans Pvt Ltd won an order to supply centrifugal fans to a cement plant in India.`;
  const doc = { text, publishedAt: recent };
  const answer = (companies: Record<string, unknown>[], date = recent.slice(0, 7)) => JSON.stringify({ project: null, country: "India", date, use: null, needsItem: "yes", needWhy: "A supply tender.", companies });
  const ntpc = { name: "NTPC Limited", role: "direct_buyer", package: "Supply of centrifugal fans", quote: "NTPC Limited invites e-tender for supply of centrifugal fans, 2 sets, for its Dadri station in Uttar Pradesh, India.", buysItem: "yes" };

  it("makes the tender issuer a lead and the supplier a competitor", () => {
    const result = judgeNeed(answer([ntpc, { name: "Example Fans Pvt Ltd", role: "seller_of_item", package: "fan supply", quote: "Example Fans Pvt Ltd won an order to supply centrifugal fans to a cement plant in India.", buysItem: "no" }]),
      doc, fansBrief(), ["IN"])!;
    expect(result.companies.map((c) => [c.name, c.verdict])).toEqual([["NTPC Limited", "lead"], ["Example Fans Pvt Ltd", "rejected"]]);
    expect(result.companies[0].reason).toBe("issues an open tender or RFQ for the item");
    expect(result.companies[1].reason).toContain("competitor");
  });
  it("rejects a stale tender, an undated one, one for services or parts, and one that does not name the item", () => {
    const old = judgeNeed(answer([ntpc], "2024-01"), { text, publishedAt: "2024-01-10" }, fansBrief(), ["IN"])!;
    expect(old.companies[0].reason).toContain("older than 12 months");
    const undated = judgeNeed(answer([ntpc], ""), { text, publishedAt: null }, fansBrief(), ["IN"])!;
    expect(undated.companies[0].reason).toContain("no date");
    const service = judgeNeed(answer([{ ...ntpc, buysItem: "no" }]), doc, fansBrief(), ["IN"])!;
    expect(service.companies[0].reason).toContain("services or spare parts");
    const other = `NTPC Limited invites e-tender for civil works at its Dadri station in Uttar Pradesh, India.`;
    const unnamed = judgeNeed(answer([{ ...ntpc, quote: other }]), { text: other, publishedAt: recent }, fansBrief(), ["IN"])!;
    expect(unnamed.companies[0].reason).toContain("does not name the item");
  });
});

describe("tender list pages: one block per listing (live probe, 14 Oct)", () => {
  it("never takes a portal or sector label for the buyer (live run 6, 14 Oct)", () => {
    expect(["Generation GEM", "Defense GEM", "Uttar Pradesh Tenders", "Railways", "Corporations And Associations And Others"].map(maskedIssuer)).toEqual([true, true, true, true, true]);
    expect(["Indian Army", "Bharat Heavy Electricals Limited (BHEL)", "Engineers India Limited", "Uranium Corporation of India Limited", "Gujarat Metro Rail Corporation"].map(maskedIssuer)).toEqual([false, false, false, false, false]);
  });
  it("recognises tenders in the common tender languages, never a word that merely contains 'tender'", () => {
    expect(["Avis d'appel d'offres : fourniture de séparateurs", "Licitación pública para suministro de ventiladores", "Licitação para fornecimento de válvulas",
      "Ausschreibung: Lieferung von Druckbehältern", "Gara d'appalto per scambiatori", "İhale ilanı: basınçlı kap", "Тендер на поставку", "招标公告 换热器"].map(tenderWording))
      .toEqual([true, true, true, true, true, true, true, true]);
    expect(tenderWording("The tenderness of the meat")).toBe(false);
  });
  it("reads the due date printed on a listing, in the formats Indian and Gulf portals use", () => {
    expect(tenderDueDate("Agency / Dept : indian army Due Date : Oct 14, 2026 (Expire Today)")).toBe("2026-10-14");
    expect(tenderDueDate("Bid End Date: 23-10-2026 15:00")).toBe("2026-10-23");
    expect(tenderDueDate("Closing Date 05 Nov 2026")).toBe("2026-11-05");
    expect(tenderDueDate("Last Date: 2026-12-01")).toBe("2026-12-01");
    expect(tenderDueDate("Tender for centrifugal fans, 2 sets")).toBeNull();
  });
  // The shape of a tender aggregator's keyword page: menus first, then each tender over several lines.
  const listing = (ref: string, title: string, agency: string, due: string) =>
    `View Documents\nT18 Ref No : ${ref}\nLocation : somewhere , india\nSource : GEM Tenders\nLIVE TENDER\n${title}\nAgency / Dept :\n${agency}\nDue Date :\n${due}\nTender Value : Refer Document`;
  const menus = Array.from({ length: 120 }, (_, i) => `Menu item ${i}`).join("\n");
  const page = [menus,
    listing("17761151", "tender for air cushion fan for horizontal belt filter, type- centrifugal, pressure- 500 mm wg", "uranium corporation of india limited UCIL", "Nov 03, 2026"),
    listing("17758953", "corrigendum tender for didw impeller for centrifugal fan", "nuclear power corporation of india limited NPCIL", "Oct 23, 2026"),
    listing("17766956", "tender for supply and repairing of various duct and overhauling of various air centrifugal fan", "gujarat state electricity corporation limited GSECL", "Oct 19, 2026"),
    listing("17722968", "tender for centrifugal fan blower (q3)", "indian army", "Oct 30, 2026"),
    "Centrifugal fans move air in many industries.",
  ].join("\n");
  const brief = fansBrief();

  it("puts each listing naming the item (title, agency, due date) ahead of the page's menus", () => {
    const blocks = tenderListingBlocks(page, brief);
    expect(blocks).toHaveLength(4);
    expect(blocks[0]).toContain("air cushion fan for horizontal belt filter, type- centrifugal");
    expect(blocks[0]).toContain("Agency / Dept : uranium corporation of india limited UCIL Due Date : Nov 03, 2026");
    expect(workAnalysisText(page, brief).indexOf("Menu item 119")).toBe(-1);
    expect(tenderListingBlocks("Centrifugal fans move air.\nWe make centrifugal fans.", brief)).toEqual([]);
  });
  it("makes whole-unit tender issuers leads and rejects tenders for parts or repairs", () => {
    const blocks = tenderListingBlocks(page, brief);
    const company = (name: string, quote: string) => ({ name, role: "direct_buyer", package: "tender", quote, buysItem: "yes" });
    const answer = JSON.stringify({ project: null, country: "India", date: daysAgo(2).slice(0, 7), use: null, needsItem: "yes", needWhy: "Tenders.", companies: [
      company("Uranium Corporation of India Limited", blocks[0]), company("Nuclear Power Corporation of India Limited", blocks[1]),
      company("Gujarat State Electricity Corporation Limited", blocks[2]), company("Indian Army", blocks[3])] });
    const result = judgeNeed(answer, { text: page, publishedAt: "2026-10-12" }, brief, ["IN"], new Date("2026-10-14T00:00:00Z"))!;
    expect(result.companies.map((c) => [c.name, c.verdict])).toEqual([
      ["Uranium Corporation of India Limited", "lead"], ["Nuclear Power Corporation of India Limited", "rejected"],
      ["Gujarat State Electricity Corporation Limited", "rejected"], ["Indian Army", "lead"]]);
    expect(result.companies[1].reason).toContain("services or spare parts");
    expect(result.companies[0].reason).toBe("issues an open tender or RFQ for the item (due 2026-11-03)");
    const closed = judgeNeed(answer, { text: page, publishedAt: "2026-10-12" }, brief, ["IN"], new Date("2026-11-20T00:00:00Z"))!;
    expect(closed.companies[0]).toMatchObject({ verdict: "lead", reason: "issued a tender for the item (closed 2026-11-03)", since: "2026-11" });
    const impellers = judgeNeed(answer, { text: page, publishedAt: "2026-10-12" }, fansBrief({ item: "Fan impellers", synonyms: [], productId: "q:fan-impellers" }), ["IN"], new Date("2026-10-14T00:00:00Z"))!;
    expect(impellers.companies[1].verdict).toBe("lead");
  });
});

describe("a likely buyer is placed in a chosen country (live run 7, 14 Oct)", () => {
  it("needs its own line, its source title or its country website; a US contractor is not a Brazil buyer", () => {
    const company = (quote: string, title: string | null, website: string | null) => ({ quote, source: { title }, website });
    expect(inChosenCountry(company("Hanging H Companies works on oil and gas pipelines, uses ball valves", "Top pipeline contractors", "hanginghcompanies.com"), ["BR"])).toBe(false);
    expect(inChosenCountry(company("Example Montagens builds gas pipelines in Brazil.", null, null), ["BR"])).toBe(true);
    expect(inChosenCountry(company("Example Montagens builds gas pipelines.", "Pipeline contractors in Brazil", null), ["BR"])).toBe(true);
    expect(inChosenCountry(company("Example Montagens builds gas pipelines.", null, "https://www.example.com.br"), ["BR"])).toBe(true);
    expect(inChosenCountry(company("Example Ltd builds pipelines.", null, "example.co.uk"), ["GB"])).toBe(true);
  });
});

describe("the API accepts any product (docs/mvp/22 §3.3)", () => {
  const base = { query: "pressure vessels", markets: ["IN"], leadKinds: ["supply_subcontract"] };
  it("needs no product; takes a catalogue id or a typed item id; refuses anything else", () => {
    expect(runInputSchema.safeParse(base).success).toBe(true);
    expect(runInputSchema.safeParse({ ...base, productId: "q:pressure-vessels" }).success).toBe(true);
    expect(runInputSchema.safeParse({ ...base, productId: "line-pipe" }).success).toBe(true);
    expect(runInputSchema.safeParse({ ...base, productId: "q:<script>" }).success).toBe(false);
    expect(runInputSchema.safeParse({ ...base, productId: "made-up" }).success).toBe(false);
  });
});

describe("a typed-item search end to end (durable engine, no live requests)", () => {
  let db: Db;
  beforeAll(async () => { db = await createTestDb(); }, 120_000);
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    vi.stubEnv("TAVILY_API_KEY", ""); vi.stubEnv("GROQ_API_KEY", ""); vi.stubEnv("CLOUDFLARE_API_TOKEN", ""); vi.stubEnv("MVP_RESEARCH_NEWS", "off"); vi.stubEnv("MVP_WORK_SEARCH", "on");
    await db.exec("truncate runs, source_documents, companies, search_briefs cascade");
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("finds the open tender and saves its issuer as a direct buyer with the tender as proof", async () => {
    const published = daysAgo(8);
    const tender: RawDoc = { sourceKey: "bing:tenders.example", sourceName: "News · tenders.example", tier: "B", url: "https://tenders.example/ntpc-dadri-centrifugal-fans",
      title: "Tender for Supply of Centrifugal Fans - NTPC Dadri",
      text: "Tender for Supply of Centrifugal Fans - NTPC Dadri\nNTPC Limited invites e-tender for supply of centrifugal fans, 2 sets, for its Dadri station in Uttar Pradesh, India. Bid due date in three weeks.",
      publishedAt: published, isSample: false };
    const input: RunInput = { query: "Centrifugal fans", productId: "q:centrifugal-fans", markets: ["IN"], leadKinds: ["supply_subcontract"], researchMode: "batch" };
    await db.query("insert into search_briefs(key,material,markets,brief,source) values($1,$2,$3,$4::jsonb,'ai')", [briefKey(input.query, ["IN"]), input.query, ["IN"], JSON.stringify(fansBrief())]);
    const id = await createResearchRun(input, db);
    const needProvider: LLMProvider = { name: "groq", model: "test", async complete() { return { tokensIn: 1, tokensOut: 1, text: JSON.stringify({
      project: null, country: "India", date: published.slice(0, 7), use: null, needsItem: "yes", needWhy: "NTPC tenders for the item.",
      companies: [{ name: "NTPC Limited", role: "direct_buyer", package: "Supply of centrifugal fans (2 sets)", quote: "NTPC Limited invites e-tender for supply of centrifugal fans, 2 sets, for its Dadri station in Uttar Pradesh, India.", buysItem: "yes" }] }) }; } };
    const deps: ResearchDeps = { collect: vi.fn(async () => [tender]), read: vi.fn(), discover: vi.fn(), save: saveBuyer, needProvider };
    for (let tick = 0; tick < 150 && (await sessionFor(db, id))?.state === "active"; tick++) await processResearchTick(db, deps, id);

    const keys = (await db.query<{ key: string }>("select key from research_jobs where run_id=$1 and stage='collect'", [id])).rows.map((r) => r.key);
    expect(keys).toContain("hybrid-v2:q:centrifugal-fans:IN:trigger:tender:bing-query:0");
    const checks = (await db.query<{ company_name: string; role: string; verdict: string }>("select company_name, role, verdict from need_checks where run_id=$1", [id])).rows;
    expect(checks).toContainEqual({ company_name: "NTPC Limited", role: "direct_buyer", verdict: "lead" });
    const opp = (await db.query<{ product_id: string; product_name: string; buying_reason: string; material_fit_kind: string; activity_status: string; trigger_kind: string | null }>(
      "select product_id, product_name, buying_reason, material_fit_kind, activity_status, trigger_kind from search_opportunities where run_id=$1", [id])).rows;
    expect(opp).toHaveLength(1);
    expect(opp[0]).toMatchObject({ product_id: "q:centrifugal-fans", product_name: "Centrifugal fans", material_fit_kind: "explicit", activity_status: "recent", trigger_kind: "tender" });
    expect(opp[0].buying_reason).toContain("NTPC Limited invites e-tender for supply of centrifugal fans");
    expect(opp[0].buying_reason).toContain("Why it needs Centrifugal fans: Issues an open tender or RFQ for the item on the source.");
    const said = (await db.query<{ message: string }>("select message from run_events where run_id=$1", [id])).rows.map((r) => r.message).join("\n");
    expect(said).toContain("Open demand: NTPC Limited is buying Centrifugal fans");
  }, 60_000);

  it("searches a product he does not sell, in a country outside his list, and saves its local-language tender's buyer", async () => {
    // His products (Settings) are shortcuts and email context only: ball valves are not among them, and Brazil is not a default country.
    expect((await listOurProducts(db)).map((p) => p.name)).not.toContain("Ball valves");
    const published = daysAgo(6);
    const text = "Licitação nº 7004/2026 - Fornecimento de válvulas de esfera\nA Petróleo Brasileiro S.A. (Petrobras) abre licitação para fornecimento de válvulas de esfera para a Refinaria Duque de Caxias (REDUC), Rio de Janeiro, Brasil. Abertura das propostas em três semanas.";
    const tender: RawDoc = { sourceKey: "tavily", sourceName: "Licitações Petrobras", tier: "B", url: "https://licitacoes.example/petrobras-valvulas-de-esfera",
      title: "Licitação: fornecimento de válvulas de esfera - Petrobras", text, publishedAt: published, isSample: false };
    const input: RunInput = { query: "Ball valves", productId: "q:ball-valves", markets: ["BR"], leadKinds: ["supply_subcontract"], researchMode: "batch" };
    const brief = fansBrief({ item: "Ball valves", productId: "q:ball-valves", kind: "other", synonyms: ["ball valve"], tenderWords: ["supply of ball valves"], places: { BR: ["Brasil"] },
      localItem: { BR: ["válvulas de esfera"] }, uses: [
        { name: "oil refinery", newsWords: ["refinery"], why: "Refineries isolate process lines with ball valves.", countries: [], localWords: {} },
        { name: "gas pipeline", newsWords: ["gas pipeline"], why: "Pipelines use ball valves.", countries: [], localWords: {} }] });
    await db.query("insert into search_briefs(key,material,markets,brief,source) values($1,$2,$3,$4::jsonb,'ai')", [briefKey(input.query, ["BR"]), input.query, ["BR"], JSON.stringify(brief)]);
    const id = await createResearchRun(input, db);
    const needProvider: LLMProvider = { name: "groq", model: "test", async complete() { return { tokensIn: 1, tokensOut: 1, text: JSON.stringify({
      project: null, country: "Brazil", date: published.slice(0, 7), use: null, needsItem: "yes", needWhy: "Petrobras tenders for ball valves.",
      companies: [{ name: "Petróleo Brasileiro S.A. (Petrobras)", role: "direct_buyer", package: "Fornecimento de válvulas de esfera",
        quote: "A Petróleo Brasileiro S.A. (Petrobras) abre licitação para fornecimento de válvulas de esfera para a Refinaria Duque de Caxias (REDUC), Rio de Janeiro, Brasil.", buysItem: "yes" }] }) }; } };
    const deps: ResearchDeps = { collect: vi.fn(async () => [tender]), read: vi.fn(), discover: vi.fn(), save: saveBuyer, needProvider };
    for (let tick = 0; tick < 150 && (await sessionFor(db, id))?.state === "active"; tick++) await processResearchTick(db, deps, id);

    const checks = (await db.query<{ company_name: string; role: string; verdict: string; reason: string }>("select company_name, role, verdict, reason from need_checks where run_id=$1", [id])).rows;
    expect(checks).toContainEqual(expect.objectContaining({ company_name: "Petróleo Brasileiro S.A. (Petrobras)", role: "direct_buyer", verdict: "lead" }));
    const opp = (await db.query<{ product_name: string; trigger_kind: string | null; buying_reason: string }>("select product_name, trigger_kind, buying_reason from search_opportunities where run_id=$1", [id])).rows;
    expect(opp).toEqual([expect.objectContaining({ product_name: "Ball valves", trigger_kind: "tender" })]);
    expect(opp[0].buying_reason).toContain("abre licitação para fornecimento de válvulas de esfera");
  }, 60_000);

  it("reads and checks a tender page ahead of everything else, saving its issuer (live run, 14 Oct)", async () => {
    vi.stubEnv("MVP_MAX_AI_DOCS", "0");
    const published = daysAgo(5);
    const tender: RawDoc = { sourceKey: "bing:tenders.example", sourceName: "News · tenders.example", tier: "B", url: "https://tenders.example/gsecl-centrifugal-fans",
      title: "Tender for Centrifugal Fans - GSECL", text: "Tender for Centrifugal Fans - GSECL\nGujarat State Electricity Corporation Limited invites tender for supply of centrifugal fans for Ukai thermal power station, Gujarat, India.",
      publishedAt: published, isSample: false };
    const input: RunInput = { query: "Centrifugal fans", productId: "q:centrifugal-fans", markets: ["IN"], leadKinds: ["supply_subcontract"], researchMode: "preview" };
    await db.query("insert into search_briefs(key,material,markets,brief,source) values($1,$2,$3,$4::jsonb,'ai')", [briefKey(input.query, ["IN"]), input.query, ["IN"], JSON.stringify(fansBrief())]);
    const id = await createResearchRun(input, db);
    const needProvider: LLMProvider = { name: "groq", model: "test", async complete() { return { tokensIn: 1, tokensOut: 1, text: JSON.stringify({
      project: null, country: "India", date: published.slice(0, 7), use: null, needsItem: "yes", needWhy: "A supply tender.",
      companies: [{ name: "Gujarat State Electricity Corporation Limited", role: "direct_buyer", package: "Supply of centrifugal fans", quote: "Gujarat State Electricity Corporation Limited invites tender for supply of centrifugal fans for Ukai thermal power station, Gujarat, India.", buysItem: "yes" }] }) }; } };
    const deps: ResearchDeps = { collect: vi.fn(async () => [tender]), read: vi.fn(), discover: vi.fn(), save: saveBuyer, needProvider };
    for (let tick = 0; tick < 150 && (await sessionFor(db, id))?.state === "active"; tick++) await processResearchTick(db, deps, id);
    const opp = (await db.query<{ trigger_kind: string | null }>("select trigger_kind from search_opportunities where run_id=$1", [id])).rows;
    expect(opp).toEqual([{ trigger_kind: "tender" }]);
  }, 60_000);
});
