/**
 * Trade-press RSS/Atom feeds (05 §2: ETEnergyWorld, ETInfra, Zawya …). Feeds come from RSS_FEEDS
 * (comma-separated) or the defaults below. A feed that fails is logged and skipped.
 * Items are pre-filtered on title + description (buying action or scope term) before any page fetch,
 * so we only read pages that can matter. Long descriptions are used as the text directly.
 */
import { XMLParser } from "fast-xml-parser";
import { mvpEnv } from "@/mvp/config/env";
import type { RawDoc, Source, SourceContext } from "../contracts";
import { ACTION_TERMS, findScope, hasTerm, scopeTermsFor } from "../filter";
import { hostOf, publisherKeyFor } from "../text";
import { isHttpUrl } from "../net-guard";
import { getText, politeWait, stripHtml } from "../read";

export const DEFAULT_RSS_FEEDS = [
  "https://energy.economictimes.indiatimes.com/rss/topstories",
  "https://infra.economictimes.indiatimes.com/rss/topstories",
  "https://www.thehindubusinessline.com/economy/feeder/default.rss",
  "https://saudigazette.com.sa/rssFeed/74",
  "https://www.thenationalnews.com/arc/outboundfeeds/rss/?outputType=xml",
  "https://www.offshore-technology.com/feed/",
  "https://www.pipeline-journal.net/rss.xml",
  "https://www.offshore-energy.biz/feed/",
];

export const RSS_MAX_ITEMS = 12;

export function feedUrls(): string[] {
  const configured = mvpEnv.rssFeeds();
  return (configured.length ? configured : DEFAULT_RSS_FEEDS).filter((url) => isHttpUrl(url));
}

interface FeedItem {
  title: string;
  link: string;
  description: string;
  published: string | null;
}

function textOf(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return textOf(value[0]);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return textOf(obj["#text"] ?? obj["__cdata"] ?? "");
  }
  return "";
}

/** Parse RSS 2.0 or Atom into items. Exported for tests. */
export function parseFeed(xml: string): FeedItem[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });
  const doc = parser.parse(xml) as Record<string, unknown>;
  const rss = (doc.rss as Record<string, unknown> | undefined)?.channel as Record<string, unknown> | undefined;
  const atom = doc.feed as Record<string, unknown> | undefined;
  const rawItems = [rss?.item ?? atom?.entry ?? []].flat() as Record<string, unknown>[];
  return rawItems
    .map((item) => {
      let link = textOf(item.link);
      if (!link && item.link && typeof item.link === "object") {
        const links = [item.link].flat() as Record<string, unknown>[];
        link = String((links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0])?.["@_href"] ?? "");
      }
      const published = textOf(item.pubDate ?? item.published ?? item.updated ?? item["dc:date"]);
      const date = published ? new Date(published) : null;
      return {
        title: stripHtml(textOf(item.title)),
        link: link.trim(),
        description: stripHtml(textOf(item["content:encoded"] ?? item.description ?? item.summary ?? item.content)),
        published: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
      };
    })
    .filter((item) => isHttpUrl(item.link) && item.title); // third-party link: http(s) only
}

export const rssSource: Source = {
  key: "rss",
  name: "Trade press (RSS)",
  async collect(ctx: SourceContext): Promise<RawDoc[]> {
    const docs: RawDoc[] = [];
    let failures = 0;
    const feeds = feedUrls();
    const actionTerms = [...ACTION_TERMS.en, ...ACTION_TERMS.ar, ...ACTION_TERMS.ms];
    const scopeTerms = scopeTermsFor(ctx.profile, ctx.terms);
    for (const feed of feeds) {
      try {
        const host = hostOf(feed) ?? feed;
        await politeWait(host);
        const res = await getText(feed, "application/rss+xml, application/atom+xml, application/xml, text/xml");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const items = parseFeed(res.text);
        for (const item of items) {
          const blurb = `${item.title}\n${item.description}`;
          if (!actionTerms.some((t) => hasTerm(blurb, t)) || !findScope(blurb, scopeTerms)) continue;
          const long = item.description.length >= 600;
          docs.push({
            sourceKey: `rss:${hostOf(item.link) ?? host}`,
            sourceName: `RSS · ${host}`,
            tier: "B",
            publisherKey: publisherKeyFor(item.link),
            url: item.link,
            title: item.title,
            publishedAt: item.published,
            text: long ? `${item.title}\n\n${item.description}` : null,
            fallbackText: item.description.length >= 200 ? `${item.title}\n\n${item.description}` : null,
            language: "en",
            isSample: false,
          });
          if (docs.length >= RSS_MAX_ITEMS) break;
        }
      } catch (error) {
        failures++;
        await ctx.log(`RSS feed unavailable: ${feed} (${error instanceof Error ? error.message : String(error)})`);
      }
      if (docs.length >= RSS_MAX_ITEMS) break;
    }
    if (failures === feeds.length) throw new Error("all RSS feeds failed");
    return docs;
  },
};
