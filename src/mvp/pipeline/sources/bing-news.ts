/**
 * Bing News RSS search (no key): https://www.bing.com/news/search?q=<query>&format=rss&mkt=<market>.
 * Up to BING_QUERIES_PER_MARKET short award-phrased queries per selected market (buildBingQueries), in
 * the market's own Bing edition (mkt). Item links are Bing click-tracking URLs; the real article URL is
 * in their `url=` parameter. Article pages are fetched later by the read step (text = null here), with
 * the RSS description as fallback text. Headlines are pre-filtered (buying action + physical scope),
 * syndicated copies of one story are capped at MAX_COPIES_PER_STORY publishers, and at most
 * BING_MAX_PER_MARKET items are kept per market. At least 2 s between requests.
 */
import { XMLParser } from "fast-xml-parser";
import { MARKET_NAMES } from "@/mvp/config/markets";
import { COUNTRIES } from "@/mvp/config/countries";
import type { MarketCode } from "@/mvp/types";
import type { RawDoc, Source, SourceContext } from "../contracts";
import {
  ACTION_TERMS,
  GENERIC_QUERY_TERMS,
  findScope,
  hasTerm,
  scopeTermsFor,
} from "../filter";
import { isHttpUrl } from "../net-guard";
import { getText, politeWait, stripHtml } from "../read";
import { hostOf, publisherKeyFor } from "../text";

export const BING_NEWS_URL = "https://www.bing.com/news/search";
export const BING_MAX_PER_MARKET = 12;
const BING_INTERVAL_MS = 2_000;

/** Bing market code per client market (English editions). */
export const BING_MKT: Record<string, string> = {
  IN: "en-in",
  SA: "en-xa",
  AE: "en-ae",
  QA: "en-xa",
  OM: "en-xa",
  KW: "en-xa",
  BH: "en-xa",
  NO: "en-us",
  MY: "en-my",
};

/** Default scope phrase when the run query has no scope words of its own. */
const DEFAULT_SCOPE = "pipeline";

/**
 * Main buyers (national oil, gas and water companies) per market: award news usually names them.
 * Used in "<buyer> <scope> contract" and "pipe contract <buyer>" queries.
 */
export const MARKET_BUYERS: Record<string, string[]> = {
  IN: ["GAIL", "ONGC", "Indian Oil"],
  SA: ["Aramco", "SWPC"],
  AE: ["ADNOC", "DEWA"],
  MY: ["Petronas", "Petronas Carigali"],
  QA: ["QatarEnergy"],
  OM: ["OQ", "PDO"],
  KW: ["KOC", "KNPC"],
  BH: ["Bapco"],
  NO: ["Equinor"],
};

/**
 * Market-specific award queries for pipe/pipeline scopes, checked against Bing News in 2026-09 (each
 * returned recent award or tender stories for the market; the generic "<buyer> pipeline contract"
 * query returns mostly old stories for GAIL, and "pipe order Malaysia" returns nothing).
 */
export const MARKET_NEWS_QUERIES: Record<string, string[]> = {
  IN: ["gas pipeline contract bags"],
  SA: ["water transmission pipeline Saudi"],
  AE: ["DEWA pipeline contract"],
  MY: ["Petronas Carigali contract"],
};

/** Queries per market (Bing RSS returns ~10 items each; more queries = more recall, 2 s apart). */
export const BING_QUERIES_PER_MARKET = 6;

function quote(term: string): string {
  const clean = term.replace(/["()]/g, "").trim();
  return /\s/.test(clean) ? `"${clean}"` : clean;
}

/** The run's scope phrase for news search: first non-generic query term, else "pipeline". */
export function newsScope(terms: string[]): string {
  return terms.find((t) => t.length >= 3 && !GENERIC_QUERY_TERMS.has(t)) ?? DEFAULT_SCOPE;
}

/** Legacy single query (kept for callers/tests): scope + buying action + country. */
export function buildBingQuery(terms: string[], market: string): string {
  const scope = terms
    .filter((t) => t.length >= 3 && !GENERIC_QUERY_TERMS.has(t))
    .slice(0, 3);
  const words = scope.length ? scope : ["pipeline", "line pipe", "piping"];
  const scopePart =
    words.length > 1 ? `(${words.map(quote).join(" OR ")})` : quote(words[0]);
  const country = MARKET_NAMES[market.toUpperCase() as MarketCode] ?? market;
  return `${scopePart} (awarded OR contract OR tender OR order) ${quote(country)}`;
}

/**
 * Award-phrased queries for one market (07 §2 news recall). Bing News RSS works best with short plain
 * queries (quoted phrases and OR groups return few items), so each query is
 * "<scope> <award word> <country or main buyer>", e.g. for "pipeline" in India:
 *   "pipeline contract India", "GAIL pipeline contract", "pipe contract GAIL",
 *   "gas pipeline contract bags", "water pipeline contract India", "pipe order India".
 * Exported for tests.
 */
export function buildBingQueries(terms: string[], market: string): string[] {
  const code = market.toUpperCase();
  const country = MARKET_NAMES[code as MarketCode] ?? COUNTRIES.find((c) => c.code === code)?.name ?? market;
  const scope = newsScope(terms);
  const pipeish = /pipe/.test(scope);
  // "pipe order" catches line-pipe supply orders ("Welspun bags pipe order"); other scopes keep their words.
  const item = scope === "pipeline" || scope === "pipelines" || scope === "line pipe" ? "pipe" : scope;
  const [buyer, second] = MARKET_BUYERS[code] ?? [];
  const queries = [
    `${scope} contract ${country}`,
    buyer ? `${buyer} ${scope} contract` : `${scope} awarded ${country}`,
    buyer ? `${item} contract ${buyer}` : `${scope} wins contract ${country}`,
    ...(pipeish ? (MARKET_NEWS_QUERIES[code] ?? []) : []),
    pipeish ? `water pipeline contract ${country}` : `${scope} subcontract ${country}`,
    `${item} order ${country}`,
    second ? `${second} ${scope} contract` : `${scope} tender ${country}`,
  ];
  return [...new Set(queries)].slice(0, BING_QUERIES_PER_MARKET);
}

const STOP = new Set([
  "the", "and", "for", "from", "with", "wins", "bags", "secures", "order", "orders", "contract", "contracts", "crore", "worth",
  "million", "billion", "company", "shares", "stock", "corp", "ltd", "limited", "inc", "group",
]);

/** Significant headline words (for "same story" detection across syndicated copies). */
function storyTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/(\d),(?=\d)/g, "$1")
      .replace(/[^\p{L}\p{N}.\s]/gu, " ")
      .split(/\s+/)
      .map((w) => w.replace(/^\.+|\.+$/g, ""))
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

/** Two headlines report the same story when most words of the shorter one are in the other. Exported for tests. */
export function sameStory(a: string, b: string): boolean {
  const x = storyTokens(a);
  const y = storyTokens(b);
  if (!x.size || !y.size) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / Math.min(x.size, y.size) >= 0.6;
}

/** Copies of one story kept per run: two independent publishers can corroborate it (G5). */
export const MAX_COPIES_PER_STORY = 2;

/** Real article URL from a Bing click-tracking link (or the link itself when it is direct). */
export function decodeBingLink(link: string): string | null {
  try {
    const url = new URL(link);
    if (/(^|\.)bing\.com$/i.test(url.hostname)) {
      const target = url.searchParams.get("url");
      return target && isHttpUrl(target) ? target : null;
    }
    return isHttpUrl(link) ? link : null;
  } catch {
    return null;
  }
}

interface BingItem {
  title: string;
  url: string;
  description: string;
  published: string | null;
  source: string | null;
}

function textOf(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (Array.isArray(value)) return textOf(value[0]);
  if (typeof value === "object")
    return textOf((value as Record<string, unknown>)["#text"] ?? "");
  return "";
}

/** Parse a Bing News RSS response. Exported for tests. */
export function parseBingRss(xml: string): BingItem[] {
  const parser = new XMLParser({
    ignoreAttributes: true,
    textNodeName: "#text",
  });
  const doc = parser.parse(xml) as { rss?: { channel?: { item?: unknown } } };
  const items = [doc.rss?.channel?.item ?? []].flat() as Record<
    string,
    unknown
  >[];
  const out: BingItem[] = [];
  for (const item of items) {
    const url = decodeBingLink(textOf(item.link).trim());
    const title = stripHtml(textOf(item.title));
    if (!url || !title) continue;
    const published = textOf(item.pubDate);
    const date = published ? new Date(published) : null;
    out.push({
      title,
      url,
      description: stripHtml(textOf(item.description)),
      published:
        date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
      source: textOf(item["News:Source"]) || null,
    });
  }
  return out;
}

export const bingNewsSource: Source = {
  key: "bing",
  name: "News search (Bing)",
  async collect(ctx: SourceContext): Promise<RawDoc[]> {
    const actionTerms = [
      ...ACTION_TERMS.en,
      ...ACTION_TERMS.ar,
      ...ACTION_TERMS.ms,
    ];
    const scopeTerms = scopeTermsFor(ctx.profile, ctx.terms);
    const seen = new Set<string>();
    const stories: { title: string; publishers: Set<string> }[] = [];
    const docs: RawDoc[] = [];
    let failures = 0;
    let requests = 0;
    // Every selected country is searched; countries without their own Bing edition use the global English one.
    const markets = ctx.input.markets.filter((m) => COUNTRIES.some((c) => c.code === m.toUpperCase()));
    for (const market of markets) {
      let taken = 0;
      for (const query of buildBingQueries(ctx.terms, market)) {
        if (taken >= BING_MAX_PER_MARKET) break;
        requests++;
        try {
          await politeWait("www.bing.com", BING_INTERVAL_MS);
          const url = `${BING_NEWS_URL}?${new URLSearchParams({ q: query, format: "rss", mkt: BING_MKT[market.toUpperCase()] ?? "en-us" })}`;
          const res = await getText(
            url,
            "application/rss+xml, application/xml, text/xml",
            15_000,
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          for (const item of parseBingRss(res.text)) {
            if (taken >= BING_MAX_PER_MARKET) break;
            if (seen.has(item.url)) continue;
            const blurb = `${item.title}\n${item.description}`;
            // Cheap pre-filter on the headline and summary before any page fetch:
            // a buying action and a physical scope (figurative "pipelines" do not count).
            if (
              !actionTerms.some((t) => hasTerm(blurb, t)) ||
              !findScope(blurb, scopeTerms)
            )
              continue;
            const publisher = publisherKeyFor(item.url);
            const story = stories.find((st) => sameStory(st.title, item.title));
            if (story && (story.publishers.has(publisher) || story.publishers.size >= MAX_COPIES_PER_STORY)) continue;
            if (story) story.publishers.add(publisher);
            else stories.push({ title: item.title, publishers: new Set([publisher]) });
            seen.add(item.url);
            taken++;
            docs.push({
              sourceKey: `bing:${hostOf(item.url) ?? "news"}`,
              sourceName: `News · ${item.source ?? hostOf(item.url) ?? "Bing"}`,
              tier: "B",
              publisherKey: publisher,
              url: item.url,
              title: item.title,
              publishedAt: item.published,
              text: null,
              fallbackText:
                item.description.length >= 120
                  ? `${item.title}\n\n${item.description}`
                  : null,
              // No market here: the filter reads it from the text (an Indian edition may report a Saudi award).
              market: null,
              language: "en",
              isSample: false,
            });
          }
        } catch (error) {
          failures++;
          await ctx.log(
            `News search ${market} unavailable (${error instanceof Error ? error.message : String(error)})`,
          );
        }
      }
      await ctx.log(`News search ${market}: ${taken} items`);
    }
    if (requests && failures === requests)
      throw new Error("all news searches failed");
    return docs;
  },
};
