/**
 * Leads filter state held in the URL (docs/mvp/13 §2 "filter state kept in the URL", §4).
 * Pure and isomorphic: used by the Leads page (server), the filter bar (client) and the CSV export.
 * Only non-default values are written, in a fixed order, so shared links stay short and stable.
 */
import {
  BUYER_TYPES,
  DISCIPLINES,
  LEAD_STATUSES,
  PROJECT_STAGES,
  type AddedWindow,
  type BuyerType,
  type ConfidenceBand,
  type LeadClass,
  type LeadFilter,
  type LeadKind,
  type LeadSort,
  type LeadSource,
  type LeadStatus,
} from "@/mvp/types";

export type LeadsTab = LeadClass | "all";
/** "" = open leads (the default). */
export type StatusChoice = "" | "all" | LeadStatus;

export interface LeadsUrlState {
  tab: LeadsTab;
  q: string;
  category: string;
  market: string;
  kind: LeadKind | "";
  stage: string;
  status: StatusChoice;
  added: AddedWindow | "";
  confidence: ConfidenceBand | "";
  minScore: number | null;
  product: string;
  source: LeadSource | "";
  /** EPC contractor, subcontractor, supplier or owner. */
  buyer: BuyerType | "";
  sort: LeadSort;
  page: number;
  size: PageSize;
  run: string;
}

export const PAGE_SIZES = [10, 25, 50] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 25;
export const TABS: LeadsTab[] = ["genuine", "research", "watch", "rejected", "all"];
export const SORTS: LeadSort[] = ["latest", "score", "closing"];
export const ADDED_WINDOWS: AddedWindow[] = ["24h", "7d", "30d"];

export const DEFAULT_STATE: LeadsUrlState = {
  tab: "genuine",
  q: "",
  category: "",
  market: "",
  kind: "",
  stage: "",
  status: "",
  added: "",
  confidence: "",
  minScore: null,
  product: "",
  source: "",
  buyer: "",
  sort: "latest",
  page: 1,
  size: DEFAULT_PAGE_SIZE,
  run: "",
};

/** URL parameter name for each state key, in the order they are written. */
const PARAM: Record<keyof LeadsUrlState, string> = {
  tab: "tab",
  q: "q",
  category: "category",
  market: "market",
  kind: "kind",
  stage: "stage",
  status: "status",
  added: "added",
  confidence: "conf",
  minScore: "min",
  product: "product",
  source: "source",
  buyer: "buyer",
  sort: "sort",
  size: "size",
  page: "page",
  run: "run",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function reader(source: ParamSource): (key: string) => string {
  if (source instanceof URLSearchParams) return (key) => source.get(key)?.trim() ?? "";
  return (key) => {
    const value = source[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  };
}

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T | ""): T | "" {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Read the Leads state from URL parameters. Unknown or invalid values fall back to the defaults. */
export function parseLeadsState(source: ParamSource): LeadsUrlState {
  const get = reader(source);
  // `class` is accepted as an alias of `tab` (older links, CSV export).
  const tab = oneOf(get("tab") || get("class"), TABS, DEFAULT_STATE.tab) as LeadsTab;
  const min = Number.parseInt(get("min"), 10);
  const page = Number.parseInt(get("page"), 10);
  const size = Number.parseInt(get("size"), 10);
  const market = get("market").toUpperCase();
  return {
    tab,
    q: get("q").slice(0, 200),
    category: oneOf(get("category"), DISCIPLINES, ""),
    market: /^[A-Z]{2}$/.test(market) ? market : "",
    kind: oneOf(get("kind"), ["bid", "supply_subcontract"] as const, ""),
    stage: oneOf(get("stage"), PROJECT_STAGES, ""),
    status: oneOf(get("status"), ["all", ...LEAD_STATUSES] as const, ""),
    added: oneOf(get("added"), ADDED_WINDOWS, ""),
    confidence: oneOf(get("conf"), ["high", "medium", "low"] as const, ""),
    minScore: Number.isFinite(min) && min > 0 ? Math.min(min, 100) : null,
    product: get("product").slice(0, 100),
    source: oneOf(get("source"), ["live", "sample"] as const, ""),
    buyer: oneOf(get("buyer"), BUYER_TYPES, ""),
    sort: (oneOf(get("sort"), SORTS, DEFAULT_STATE.sort) || DEFAULT_STATE.sort) as LeadSort,
    page: Number.isFinite(page) && page > 1 ? Math.min(page, 10_000) : 1,
    size: (PAGE_SIZES as readonly number[]).includes(size) ? (size as PageSize) : DEFAULT_PAGE_SIZE,
    run: UUID_RE.test(get("run")) ? get("run").toLowerCase() : "",
  };
}

/** Write the state as URL parameters, leaving out defaults. */
export function serializeLeadsState(state: Partial<LeadsUrlState>): URLSearchParams {
  const params = new URLSearchParams();
  const full = { ...DEFAULT_STATE, ...state };
  for (const key of Object.keys(PARAM) as (keyof LeadsUrlState)[]) {
    const value = full[key];
    if (value === null || value === "" || value === DEFAULT_STATE[key]) continue;
    params.set(PARAM[key], String(value));
  }
  return params;
}

/** Keys that are filters (a change returns to page 1; they show as chips). */
export const FILTER_KEYS = [
  "q", "category", "market", "kind", "stage", "status", "added", "confidence", "minScore", "product", "source", "buyer", "run",
] as const satisfies readonly (keyof LeadsUrlState)[];
export type FilterKey = (typeof FILTER_KEYS)[number];

/**
 * Apply changes to a state. Any change other than `page` returns to page 1 (docs/mvp/13 §4:
 * "Changing a filter returns to page 1").
 */
export function applyChanges(state: LeadsUrlState, changes: Partial<LeadsUrlState>): LeadsUrlState {
  const next = { ...state, ...changes };
  if (!("page" in changes)) next.page = 1;
  return next;
}

/** Filters that are set (for the chips row). */
export function activeFilters(state: LeadsUrlState): FilterKey[] {
  return FILTER_KEYS.filter((key) => state[key] !== "" && state[key] !== null);
}

/** href for the Leads page with this state. */
export function leadsHref(state: Partial<LeadsUrlState>, pathname = "/leads"): string {
  const query = serializeLeadsState(state).toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** The repository filter for a state (page → limit/offset). */
export function toLeadFilter(state: LeadsUrlState): LeadFilter {
  return {
    class: state.tab === "all" ? undefined : state.tab,
    q: state.q || undefined,
    discipline: state.category || undefined,
    market: state.market || undefined,
    kind: state.kind || undefined,
    stage: state.stage || undefined,
    status: state.status === "" ? "open" : state.status,
    added: state.added || undefined,
    confidence: state.confidence || undefined,
    minScore: state.minScore ?? undefined,
    productId: state.product || undefined,
    source: state.source || undefined,
    buyerType: state.buyer || undefined,
    runId: state.run || undefined,
    sort: state.sort,
    limit: state.size,
    offset: (state.page - 1) * state.size,
  };
}

/** "Showing 1–25 of 132" numbers for a page. */
export function pageRange(page: number, size: number, total: number): { from: number; to: number; pages: number } {
  const pages = Math.max(1, Math.ceil(total / size));
  if (!total) return { from: 0, to: 0, pages };
  const from = Math.min((page - 1) * size + 1, total);
  const to = Math.min(page * size, total);
  return { from, to, pages };
}

/** Page numbers to show: first, last, current ±1, with "…" gaps. */
export function pageNumbers(page: number, pages: number): (number | "…")[] {
  const wanted = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  sorted.forEach((n, index) => {
    if (index > 0 && n - sorted[index - 1] > 1) out.push("…");
    out.push(n);
  });
  return out;
}
