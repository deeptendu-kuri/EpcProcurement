/**
 * Bing News RSS search (no key): https://www.bing.com/news/search?q=<query>&format=rss&mkt=<market>.
 * One query per selected market: scope words (run query, else client products) + buying-action words
 * + the country name. Item links are Bing click-tracking URLs; the real article URL is in their
 * `url=` parameter. Article pages are fetched later by the read step (text = null here), with the
 * RSS description as fallback text. At least 2 s between requests; at most BING_MAX_PER_MARKET items
 * per market, deduplicated by URL.
 */
import { XMLParser } from "fast-xml-parser";
import { MARKET_NAMES } from "@/mvp/config/markets";
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
export const BING_MAX_PER_MARKET = 10;
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

/** Default scope phrases when the run query has no scope words of its own. */
const DEFAULT_SCOPE = ["pipeline", "line pipe", "piping"];

function quote(term: string): string {
  const clean = term.replace(/["()]/g, "").trim();
  return /\s/.test(clean) ? `"${clean}"` : clean;
}

/** Bing query for one market. Exported for tests. */
export function buildBingQuery(terms: string[], market: string): string {
  const scope = terms
    .filter((t) => t.length >= 3 && !GENERIC_QUERY_TERMS.has(t))
    .slice(0, 3);
  const words = scope.length ? scope : DEFAULT_SCOPE;
  const scopePart =
    words.length > 1 ? `(${words.map(quote).join(" OR ")})` : quote(words[0]);
  const country = MARKET_NAMES[market.toUpperCase() as MarketCode] ?? market;
  return `${scopePart} (awarded OR contract OR tender OR order) ${quote(country)}`;
}

/** Queries for one market: the run's scope words, then an award-focused query on the client's core scope. */
export function buildBingQueries(terms: string[], market: string): string[] {
  const country = quote(
    MARKET_NAMES[market.toUpperCase() as MarketCode] ?? market,
  );
  const awardQuery = `(pipeline OR "line pipe" OR piping) (EPC OR wins OR bags OR secures OR "contract awarded") ${country}`;
  return [...new Set([buildBingQuery(terms, market), awardQuery])];
}

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
    const docs: RawDoc[] = [];
    let failures = 0;
    const markets = ctx.input.markets.filter((m) => BING_MKT[m.toUpperCase()]);
    for (const market of markets) {
      let taken = 0;
      for (const query of buildBingQueries(ctx.terms, market)) {
        try {
          await politeWait("www.bing.com", BING_INTERVAL_MS);
          const url = `${BING_NEWS_URL}?${new URLSearchParams({ q: query, format: "rss", mkt: BING_MKT[market.toUpperCase()] })}`;
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
            // Cheap pre-filter on the headline and summary before any page fetch.
            if (
              !actionTerms.some((t) => hasTerm(blurb, t)) ||
              !findScope(blurb, scopeTerms)
            )
              continue;
            seen.add(item.url);
            taken++;
            docs.push({
              sourceKey: `bing:${hostOf(item.url) ?? "news"}`,
              sourceName: `News · ${item.source ?? hostOf(item.url) ?? "Bing"}`,
              tier: "B",
              publisherKey: publisherKeyFor(item.url),
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
    if (markets.length && failures === markets.length * 2)
      throw new Error("all news searches failed");
    return docs;
  },
};
