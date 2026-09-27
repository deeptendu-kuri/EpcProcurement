/**
 * Offline fixtures (12 §2): synthetic, clearly fictional documents (every company name contains
 * "Example"). Used when MVP_OFFLINE=1 or when every live source fails. Documents are flagged
 * `isSample` so source_documents.is_sample is true and the UI can show a "Sample data" badge.
 *
 * Dates are relative so the demo never goes stale: `published_offset_days` is days from today and
 * `{{date:+34}}` in the text becomes e.g. "31 October 2026".
 */
import type { SourceTier } from "@/mvp/types";
import type { RawDoc, Source, SourceContext } from "../contracts";
import documents from "../fixtures/documents.json";

export interface FixtureDocument {
  id: string;
  url: string;
  publisher_key: string;
  source_name: string;
  tier: string;
  published_offset_days?: number;
  published_at?: string;
  market: string;
  title: string;
  text: string;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function addDays(now: Date, days: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days, 9, 0, 0));
}

/** "{{date:+34}}" → "31 October 2026" relative to `now`. */
export function fillDatePlaceholders(text: string, now: Date = new Date()): string {
  return text.replace(/\{\{date:([+-]\d+)\}\}/g, (_, offset: string) => {
    const d = addDays(now, Number(offset));
    return `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  });
}

/** All fixture documents as RawDocs (dates filled in for `now`). */
export function fixtureDocs(now: Date = new Date()): (RawDoc & { fixtureId: string })[] {
  return (documents as FixtureDocument[]).map((doc) => ({
    fixtureId: doc.id,
    sourceKey: "fixture",
    sourceName: doc.source_name,
    tier: (["A", "B", "C"].includes(doc.tier) ? doc.tier : "B") as SourceTier,
    publisherKey: doc.publisher_key,
    url: doc.url,
    title: doc.title,
    publishedAt: doc.published_at ?? addDays(now, doc.published_offset_days ?? 0).toISOString(),
    text: fillDatePlaceholders(doc.text, now),
    market: doc.market,
    language: "en",
    isSample: true,
  }));
}

export const fixturesSource: Source = {
  key: "fixture",
  name: "Sample data (offline fixtures)",
  async collect(ctx: SourceContext): Promise<RawDoc[]> {
    const markets = new Set(ctx.input.markets.map((m) => m.toUpperCase()));
    return fixtureDocs().filter((doc) => !markets.size || markets.has(String(doc.market).toUpperCase()));
  },
};
