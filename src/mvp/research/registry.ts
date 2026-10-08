import type { RunInput } from "@/mvp/types";
import type { RawDoc } from "@/mvp/pipeline/contracts";

export interface ResearchSource {
  id: string; url: string; country: string; materials: readonly string[];
  type: "directory"; parser: "contractor-table";
  permission: "public-listing" | "review-required";
  claims: readonly string[]; maxPages: number;
}
/** Public listing only. Restricted PDFs are not automatically enabled by public visibility. */
export const RESEARCH_SOURCES: readonly ResearchSource[] = [{
  id: "dewa-contractor-list", country: "AE", materials: ["cables", "cable-trays", "hdpe-pipe", "di-pipe", "pvc-pipe", "rebar", "structural-steel"],
  url: "https://www.dewa.gov.ae/en/builder/useful-tools/consultant-and-contractor-listing",
  type: "directory", parser: "contractor-table", permission: "public-listing",
  claims: ["listed-company", "contractor-specialisation", "published-contact"], maxPages: 3,
}];
export function sourceSeeds(input: RunInput): RawDoc[] {
  return RESEARCH_SOURCES.filter(s => s.permission === "public-listing" && input.markets.includes(s.country) && s.materials.includes(input.productId ?? ""))
    .map(s => ({ sourceKey: `directory:${s.id}`, sourceName: "Official contractor listing", tier: "A", url: s.url,
      title: null, publishedAt: null, text: null, isSample: false, research: { lane: "directory", registryId: s.id } }));
}
/** Reserve company follow-up capacity before general pages; news never owns the whole queue. */
export function readLaneLimits(maxPages: number) {
  if(maxPages<8)return {investigation:maxPages,directory:maxPages,news:maxPages,discovery:maxPages};
  const investigation = Math.max(1, Math.floor(maxPages * .5));
  const directory = Math.max(1, Math.floor(maxPages * .1));
  const news = Math.floor(maxPages * .1);
  return { investigation, directory, news, discovery: Math.max(0, maxPages - investigation - directory - news) };
}
export function readLane(raw: RawDoc): "investigation" | "directory" | "news" | "discovery" {
  const lane = raw.research?.lane;
  return lane === "investigation" || lane === "directory" || lane === "news" ? lane : raw.sourceKey.startsWith("rss:") || raw.sourceKey === "gdelt" || raw.sourceKey === "bing-news" ? "news" : "discovery";
}
