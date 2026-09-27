/**
 * GDELT DOC 2.0 article search (05 §2.5): no key, 3-month window, English sources.
 * GET https://api.gdeltproject.org/api/v2/doc/doc?query=…&mode=artlist&format=json&maxrecords=50&timespan=3months
 * Response: { articles: [{ url, title, seendate: "20260920T101500Z", domain, language, sourcecountry }] }.
 * GDELT asks for at most one request every 5 seconds; when throttled it answers with a plain-text
 * message instead of JSON, which we treat as "rate limited" and retry once.
 * Article pages are fetched later by the read step (text = null here).
 */
import { MARKET_NAMES } from "@/mvp/config/markets";
import type { MarketCode } from "@/mvp/types";
import type { RawDoc, Source, SourceContext } from "../contracts";
import { getText, politeWait } from "../read";

export const GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
/** Articles taken per run (each is then fetched politely). */
export const GDELT_MAX_ARTICLES = 12;

const TRIGGERS = ["tender", "awarded", "contract"];

function quoteTerm(term: string): string {
  const clean = term.replace(/["()]/g, "").trim();
  return /\s|-/.test(clean) ? `"${clean}"` : clean;
}

function group(items: string[]): string {
  return items.length > 1 ? `(${items.join(" OR ")})` : (items[0] ?? "");
}

/** GDELT query: (keywords) (tender OR awarded OR contract) (market names) sourcelang:english. Exported for tests. */
export function buildGdeltQuery(terms: string[], markets: string[]): string {
  const keywords = terms.filter((t) => t.length >= 3).slice(0, 4).map(quoteTerm);
  const names = markets
    .map((m) => MARKET_NAMES[m.toUpperCase() as MarketCode] ?? m)
    .map(quoteTerm);
  return [group(keywords.length ? keywords : ["pipeline", '"line pipe"']), group(TRIGGERS), group(names), "sourcelang:english"]
    .filter(Boolean)
    .join(" ");
}

/** "20260920T101500Z" → ISO. */
export function parseSeenDate(seen: string | undefined): string | null {
  const m = seen?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` : null;
}

interface GdeltArticle {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  language?: string;
}

async function requestOnce(url: string): Promise<{ articles?: GdeltArticle[] } | "rate_limited"> {
  await politeWait("api.gdeltproject.org");
  const res = await getText(url, "application/json", 30_000);
  const body = res.text;
  if (res.status === 429 || /limit requests to one every 5 seconds/i.test(body)) return "rate_limited";
  if (!res.ok) throw new Error(`GDELT HTTP ${res.status}`);
  if (!body.trim()) return { articles: [] };
  try {
    return JSON.parse(body) as { articles?: GdeltArticle[] };
  } catch {
    throw new Error(`GDELT returned non-JSON: ${body.slice(0, 120)}`);
  }
}

export const gdeltSource: Source = {
  key: "gdelt",
  name: "GDELT news",
  async collect(ctx: SourceContext): Promise<RawDoc[]> {
    const query = buildGdeltQuery(ctx.terms, ctx.input.markets);
    await ctx.log(`GDELT query: ${query}`);
    const url = `${GDELT_URL}?${new URLSearchParams({ query, mode: "artlist", format: "json", maxrecords: "50", timespan: "3months", sort: "datedesc" })}`;
    let result = await requestOnce(url);
    if (result === "rate_limited") {
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      result = await requestOnce(url);
      if (result === "rate_limited") throw new Error("GDELT rate limit (one request every 5 seconds)");
    }
    const seenDomains = new Map<string, number>();
    const docs: RawDoc[] = [];
    for (const article of result.articles ?? []) {
      if (!article.url || !article.title) continue;
      if (article.language && !/english/i.test(article.language)) continue;
      const domain = article.domain ?? "";
      const count = seenDomains.get(domain) ?? 0;
      if (count >= 2) continue; // spread across publishers (independence, politeness)
      seenDomains.set(domain, count + 1);
      docs.push({
        sourceKey: "gdelt",
        sourceName: `GDELT · ${domain || "news"}`,
        tier: "B",
        url: article.url,
        title: article.title,
        publishedAt: parseSeenDate(article.seendate),
        text: null,
        fallbackText: null,
        language: "en",
        isSample: false,
      });
      if (docs.length >= GDELT_MAX_ARTICLES) break;
    }
    return docs;
  },
};
