import { describe, expect, it } from "vitest";
import { getClientProfile } from "@/mvp/config/profile";
import { filterDocument, findScope, mentionsPhysicalPipeline, queryTerms, scopeTermsFor, scopeText } from "./filter";
import { BING_MKT, BING_QUERIES_PER_MARKET, buildBingQueries, buildBingQuery, decodeBingLink, parseBingRss, sameStory } from "./sources/bing-news";
import { DEFAULT_RSS_FEEDS, feedUrls } from "./sources/rss";
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

describe("news recall and precision (07 §2)", () => {
  it("builds short award-phrased queries per market, in the market's Bing edition", () => {
    expect(buildBingQueries(queryTerms("pipeline"), "IN")).toEqual([
      "pipeline contract India",
      "GAIL pipeline contract",
      "pipe contract GAIL",
      "gas pipeline contract bags",
      "water pipeline contract India",
      "pipe order India",
    ]);
    expect(buildBingQueries(queryTerms("pipeline EPC contract"), "SA")).toContain("pipe contract Aramco");
    expect(buildBingQueries(queryTerms("pipeline"), "SA")).toContain("water transmission pipeline Saudi");
    expect(buildBingQueries([], "AE")).toEqual(expect.arrayContaining(["ADNOC pipeline contract", "DEWA pipeline contract"]));
    expect(buildBingQueries(queryTerms("line pipe"), "MY")).toEqual([
      "line pipe contract Malaysia",
      "Petronas line pipe contract",
      "pipe contract Petronas",
      "Petronas Carigali contract",
      "water pipeline contract Malaysia",
      "pipe order Malaysia",
    ]);
    // Non-pipe scopes get no pipeline-specific market queries.
    expect(buildBingQueries(queryTerms("pressure vessel"), "IN").join(" ")).not.toMatch(/pipe/);
    expect(buildBingQueries(queryTerms("piping works"), "IN")[0]).toBe("piping contract India");
    for (const market of ["IN", "SA", "AE", "MY"]) {
      const queries = buildBingQueries([], market);
      expect(queries.length).toBeLessThanOrEqual(BING_QUERIES_PER_MARKET);
      expect(queries.join(" ")).not.toMatch(/["()]|\bOR\b/); // plain queries: Bing RSS returns few items for operators
    }
    expect(BING_MKT).toMatchObject({ IN: "en-in", SA: "en-xa", AE: "en-ae", MY: "en-my" });
  });

  it("detects syndicated copies of one story, not different stories of one company", () => {
    expect(sameStory("Welspun secures $412.5 million pipe order in the United States", "Welspun Corp secures $412.5 million HFIW pipe order, global order book hits record $4.7 billion")).toBe(true);
    expect(sameStory("Welspun Corp bags largest-ever Rs 4,000 cr pipe order", "Welspun Corp's associate firm wins ₹2,000 crore steel pipe contract from Aramco")).toBe(false);
  });

  it("keeps oil, gas and water pipelines; drops figurative ones", () => {
    expect(mentionsPhysicalPipeline("Desco Infratech secures gas pipeline contract from Adani Total Gas")).toBe(true);
    expect(mentionsPhysicalPipeline("GMDA awards contract for 200mld water pipeline")).toBe(true);
    expect(mentionsPhysicalPipeline("Gamuda orderbook seen hitting RM60bil as contract pipeline builds")).toBe(false);
    expect(mentionsPhysicalPipeline("Bitdeer says its AI pipeline has crossed $7B after Malaysia expansion")).toBe(false);
    expect(mentionsPhysicalPipeline("Drone stock: strong order pipeline, says broker")).toBe(false);
    const terms = scopeTermsFor(profile, queryTerms("pipeline"));
    expect(findScope("India’s Rs 9.3 lakh cr defence pipeline: big approval jump", terms)).toBeNull();
    expect(findScope("Welspun wins steel pipe contract from Aramco", terms)).not.toBeNull();
    const r = verdict("Bitdeer secures Malaysia AI facility as sales pipeline tops $7 billion", "Bitdeer secured a contract in Malaysia; its sales pipeline tops $7 billion.", ["MY"]);
    expect(r.verdict).toBe("drop");
  });

  it("reads the configured feeds plus the default feeds", () => {
    const saved = process.env.RSS_FEEDS;
    process.env.RSS_FEEDS = "https://feeds.example.com/a.xml";
    try {
      expect(feedUrls()[0]).toBe("https://feeds.example.com/a.xml");
      expect(feedUrls()).toEqual(expect.arrayContaining(DEFAULT_RSS_FEEDS));
    } finally {
      if (saved === undefined) delete process.env.RSS_FEEDS;
      else process.env.RSS_FEEDS = saved;
    }
  });
});
