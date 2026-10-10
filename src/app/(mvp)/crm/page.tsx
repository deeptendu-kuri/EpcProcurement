import { SearchWorkspace } from "@/components/mvp/search/search-workspace";
import { catalogueOptions, marketOptions } from "@/components/mvp/search/page-data";
import { parseSearchState } from "@/components/mvp/search/search-state";
import { FoundCompanies } from "@/components/mvp/tables/found-companies";
import { demoEmailEnabled } from "@/mvp/email/config";
import { recentSearches } from "@/mvp/opportunities";
import { marketName } from "@/mvp/config/markets";
import { searchKind } from "@/components/mvp/run-steps";

export const dynamic = "force-dynamic";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Leads (docs/mvp/17 §4.4): the SuperSearch table for one of the user's searches (default: the latest)
 * or all of them, in tabs: all leads, verified, likely, and the companies the search found but has not
 * checked yet. Filters slide open from the SuperSearch button.
 */
export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = { ...(await searchParams) };
  // Older links used ?search=<id>.
  if (!params.run && typeof params.search === "string") params.run = params.search;
  const state = parseSearchState(params);
  const searches = (await recentSearches()).filter((s) => s.adhoc_query?.productId);
  if (!state.run && searches[0]) state.run = searches[0].id;
  const runs = searches.map((s) => ({ id: s.id, status: s.status, kind: searchKind(s.status, s.counters ?? {}),
    label: `${s.adhoc_query?.query || "Search"} · ${(s.adhoc_query?.markets ?? []).map(marketName).slice(0, 3).join(", ")}${(s.adhoc_query?.markets?.length ?? 0) > 3 ? "…" : ""} · ${day(s.created_at)}` }));
  const run = state.run && state.run !== "all" ? state.run : null;
  return <SearchWorkspace tab="search" basePath="/crm" state={state} runs={runs} catalogue={catalogueOptions()} markets={marketOptions()} demoEmail={demoEmailEnabled()}
    foundCompanies={run ? <FoundCompanies runId={run} /> : null} />;
}
