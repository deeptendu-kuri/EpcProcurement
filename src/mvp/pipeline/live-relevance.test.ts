import { describe, expect, it } from "vitest";
import { getClientProfile } from "@/mvp/config/profile";
import { filterDocument, queryTerms, scopeText } from "./filter";
import { buildBingQuery, decodeBingLink, parseBingRss } from "./sources/bing-news";
import { buildTedQuery, disciplineFor } from "./sources/ted";

const NOW = new Date("2026-09-27T00:00:00Z");
const profile = getClientProfile();

function verdict(title: string, text: string, markets = ["IN", "SA", "AE", "NO", "MY"], sourceMarket: string | null = null, query = "pipeline EPC contract") {
  return filterDocument({ title, text, publishedAt: NOW.toISOString(), markets, queryTerms: queryTerms(query), profile, sourceMarket, now: NOW });
}

describe("live relevance (generic words are not scope)", () => {
  it("drops generic words from the run query", () => {
    expect(queryTerms("pipeline EPC contract")).toEqual(["pipeline"]);
    expect(queryTerms("piping works")).toEqual(["piping"]);
    expect(queryTerms("EPC contract")).toEqual([]);
    expect(queryTerms("line pipe")).toEqual(["line pipe"]);
  });

  it("drops a fire truck with a water tank (TED notice)", () => {
    const r = verdict(
      "Crew vehicle, narrow with water tank and fire pump",
      "Title: Crew vehicle, narrow with water tank and fire pump. Notice type: Contract notice (call for tenders). Buyer: Oslo Fire departement (NO).",
      ["NO"],
      "NO",
    );
    expect(r.verdict).toBe("drop");
    expect(r.reason).toMatch(/no scope term/);
    expect(disciplineFor(["34144210"], "Crew vehicle, narrow with water tank and fire pump")).toBe("other");
  });

  it("drops an office PC tender", () => {
    const r = verdict("Student PCs", "Contract notice: framework agreement for student PCs for upper secondary schools in Innlandet, Norway.", ["NO"], "NO");
    expect(r.verdict).toBe("drop");
  });

  it("ignores figurative pipelines (IPO, hotel, contract pipelines)", () => {
    expect(scopeText("India's IPO pipeline could raise 2 lakh crore")).not.toMatch(/pipeline/i);
    const r = verdict("Gamuda orderbook seen hitting RM60bil as contract pipeline builds", "Gamuda has won contracts in Malaysia and its contract pipeline builds.", ["MY"]);
    expect(r.verdict).toBe("drop");
  });

  it("keeps a pipeline EPC award", () => {
    const r = verdict(
      "GAIL awards EPC contract for 120 km gas pipeline",
      "GAIL (India) Ltd has awarded the EPC contract for the 120 km Jamnagar gas pipeline section in Gujarat to an Indian contractor. The scope includes 24-inch API 5L X65 line pipe.",
      ["IN"],
    );
    expect(r.verdict).toBe("relevant");
    expect(r.markets).toEqual(["IN"]);
  });

  it("maps disciplines only from industrial phrases", () => {
    expect(disciplineFor(["45231300"], "Construction work for water and sewage pipelines")).toBe("pipeline");
    expect(disciplineFor(["45330000"], "Framework agreement for plumbing work")).toBe("construction_services");
    expect(disciplineFor([], "Supply of pressure vessels and heat exchangers")).toBe("static_equipment");
  });
});

describe("source queries", () => {
  it("TED query uses scope terms and CPV codes, never generic words", () => {
    const q = buildTedQuery(queryTerms("pipeline EPC contract"), ["NOR"], ["bid", "supply_subcontract"], NOW);
    expect(q).toContain("classification-cpv IN (44163100");
    expect(q).toContain('FT~"pipeline"');
    expect(q).not.toMatch(/FT~"contract"|FT~"epc"/i);
    expect(q).toContain("publication-date>=20260331");
    expect(buildTedQuery([], ["NOR"], [], NOW, 365)).toContain("publication-date>=20250927");
  });

  it("Bing query per market and real article URLs", () => {
    expect(buildBingQuery(queryTerms("pipeline EPC contract"), "IN")).toBe('pipeline (awarded OR contract OR tender OR order) India');
    expect(buildBingQuery([], "SA")).toContain('"Saudi Arabia"');
    expect(
      decodeBingLink("http://www.bing.com/news/apiclick.aspx?ref=FexRss&aid=&tid=x&url=https%3a%2f%2fwww.business-standard.com%2fmarkets%2fsteamhouse-bags-epc-contract.html&c=1&mkt=en-in"),
    ).toBe("https://www.business-standard.com/markets/steamhouse-bags-epc-contract.html");
    expect(decodeBingLink("https://www.bing.com/news/search?q=x")).toBeNull();
    const items = parseBingRss(
      `<rss><channel><item><title>A wins pipeline contract</title><link>http://www.bing.com/news/apiclick.aspx?url=https%3a%2f%2fexample.com%2fa</link><description>Text</description><pubDate>Wed, 23 Sep 2026 17:00:00 GMT</pubDate></item></channel></rss>`,
    );
    expect(items).toEqual([{ title: "A wins pipeline contract", url: "https://example.com/a", description: "Text", published: "2026-09-23T17:00:00.000Z", source: null }]);
  });
});
