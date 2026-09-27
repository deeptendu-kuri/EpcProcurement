import type { LeadFilter } from "@/mvp/types";
import { parseLeadsState, toLeadFilter, type LeadsUrlState } from "@/components/mvp/leads/url-state";

/**
 * Query-string filters shared by GET /api/mvp/leads and /api/mvp/leads/export — the same parameters as
 * the Leads page URL (tab|class, q, category, market, kind, stage, status, added, conf, min, product,
 * source, sort, page, size, run). Invalid values fall back to the defaults. `limit` / `offset` override
 * page / size for API callers.
 */
export function parseLeadQuery(url: string): { filter: LeadFilter; state: LeadsUrlState } {
  const params = new URL(url).searchParams;
  const state = parseLeadsState(params);
  // API callers without a tab get every class (the page defaults to Genuine).
  if (!params.get("tab") && !params.get("class")) state.tab = "all";
  const filter = toLeadFilter(state);
  const limit = Number.parseInt(params.get("limit") ?? "", 10);
  const offset = Number.parseInt(params.get("offset") ?? "", 10);
  if (Number.isFinite(limit) && limit > 0) filter.limit = Math.min(limit, 500);
  if (Number.isFinite(offset) && offset >= 0) filter.offset = offset;
  return { filter, state };
}
