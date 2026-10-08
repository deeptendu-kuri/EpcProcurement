/**
 * SuperSearch filter state held in the URL (docs/mvp/14 §10). Pure and isomorphic: the /search page
 * (server) parses it, the filter panel (client) writes it, and `toBuyerSearch` turns it into the
 * BuyerSearch body sent to POST /api/mvp/buyers. Only non-default values are written, in a
 * fixed order, so links stay short and stable.
 */
import type { BuyerRole, BuyerSearch, BuyerSignal, BuyerStage, ChainLinkStatus, ChainTier, SlotRole, TriggerKind } from "@/mvp/buyers/types";
export const TRIGGER_KINDS:TriggerKind[]=['award','order','tender','subcontract','capability'];

export const PAGE_SIZE = 25;

export const ROLES: BuyerRole[] = ["epc_contractor", "subcontractor", "manufacturer", "owner", "distributor", "fabricator"];
export const SIGNALS: BuyerSignal[] = ["order_won", "contract_won", "tender_open", "expansion"];
export const STAGES: BuyerStage[] = ["ready", "check", "early", "not_buyer"];
export const SLOT_ROLES: SlotRole[] = ["decision_maker", "buyer", "technical_approver", "influencer", "approver", "vendor_registration"];
export const HOW_SURE = ["high", "medium", "low"] as const;
export const REACH = ["allowed", "opt_out_only", "consent_needed"] as const;
export const SORTS = ["latest", "fit", "window"] as const;
export const WITHIN_DAYS = [30, 90, 180, 365] as const;
/** Supply-chain tier filter (docs/mvp/15 §D). */
export const TIERS: ChainTier[] = [1, 2, 3];
/** "How we know" filter for derived buyers (15 §D). */
export const LINKS = ["confirmed", "likely", "possible"] as const satisfies readonly Exclude<ChainLinkStatus, "not_identified">[];
export type KnownLink = (typeof LINKS)[number];

export type HowSure = (typeof HOW_SURE)[number];
export type Reach = (typeof REACH)[number];
export type SearchSort = (typeof SORTS)[number];
export type ResultView = "buyers" | "contacts";

/** Prefix of a whole catalogue category in the `sell` list (e.g. "cat:Valves"); other values are item ids. */
export const CATEGORY_PREFIX = "cat:";

export interface SearchUrlState {
  triggerKinds:TriggerKind[];
  triggerAge:string;
  locAny: string[];
  locNot: string[];
  basis: "hq" | "site";
  roleAny: BuyerRole[];
  roleNot: BuyerRole[];
  /** Catalogue item ids and/or "cat:<Category>". */
  sell: string[];
  hideCompetitors: boolean;
  signals: BuyerSignal[];
  withinDays: number | null;
  departments: string[];
  slotRoles: SlotRole[];
  onlyWithFound: boolean;
  industry: string[];
  valueMin: number | null;
  valueMax: number | null;
  lookalike: string;
  companies: string[];
  reach: Reach[];
  stage: BuyerStage[];
  minFit: number | null;
  howSure: HowSure[];
  /** Supply-chain tiers (empty = all). */
  tiers: ChainTier[];
  /** How we know a tier 2/3 company is in the chain (empty = any). */
  links: KnownLink[];
  q: string;
  sort: SearchSort;
  page: number;
  view: ResultView;
  /** Lead id of the buyer open in the sidebar. */
  open: string;
}

export const DEFAULT_SEARCH: SearchUrlState = {
  triggerKinds:[],triggerAge:'',
  locAny: [],
  locNot: [],
  basis: "hq",
  roleAny: [],
  roleNot: [],
  sell: [],
  hideCompetitors: true,
  signals: [],
  withinDays: null,
  departments: [],
  slotRoles: [],
  onlyWithFound: false,
  industry: [],
  valueMin: null,
  valueMax: null,
  lookalike: "",
  companies: [],
  reach: [],
  stage: [],
  minFit: null,
  howSure: [],
  tiers: [],
  links: [],
  q: "",
  sort: "latest",
  page: 1,
  view: "buyers",
  open: "",
};

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function getter(params: Params) {
  return (key: string): string | null => {
    if (params instanceof URLSearchParams) return params.get(key);
    const value = params[key];
    return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
  };
}

function list(value: string | null): string[] {
  if (!value) return [];
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function listOf<T extends string>(value: string | null, allowed: readonly T[]): T[] {
  return list(value).filter((item): item is T => (allowed as readonly string[]).includes(item));
}

function num(value: string | null, min: number, max: number): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function parseSearchState(params: Params): SearchUrlState {
  const get = getter(params);
  const sort = get("sort");
  return {
    triggerKinds:listOf(get('trigger'),TRIGGER_KINDS),triggerAge:['30','90','365','540','undated'].includes(get('age')??'')?get('age')!:'',
    locAny: list(get("loc")),
    locNot: list(get("locx")),
    basis: get("basis") === "site" ? "site" : "hq",
    roleAny: listOf(get("role"), ROLES),
    roleNot: listOf(get("rolex"), ROLES),
    sell: list(get("sell")),
    hideCompetitors: get("comp") !== "show",
    signals: listOf(get("sig"), SIGNALS),
    withinDays: num(get("days"), 1, 3650),
    departments: list(get("dept")),
    slotRoles: listOf(get("slot"), SLOT_ROLES),
    onlyWithFound: get("found") === "1",
    industry: list(get("ind")),
    valueMin: num(get("vmin"), 0, 1e12),
    valueMax: num(get("vmax"), 0, 1e12),
    lookalike: (get("like") ?? "").trim().slice(0, 200),
    companies: list(get("co")).slice(0, 200),
    reach: listOf(get("reach"), REACH),
    stage: listOf(get("stage"), STAGES),
    minFit: num(get("fit"), 0, 100),
    howSure: listOf(get("sure"), HOW_SURE),
    tiers: listOf(get("tier"), ["1", "2", "3"] as const).map((value) => Number(value) as ChainTier),
    links: listOf(get("how"), LINKS),
    q: (get("q") ?? "").trim().slice(0, 200),
    sort: (SORTS as readonly string[]).includes(sort ?? "") ? (sort as SearchSort) : "latest",
    page: num(get("page"), 1, 10_000) ?? 1,
    view: get("view") === "contacts" ? "contacts" : "buyers",
    open: (get("open") ?? "").trim().slice(0, 64),
  };
}

/** Only non-default values, in a fixed order. */
export function serializeSearchState(state: SearchUrlState): URLSearchParams {
  const out = new URLSearchParams();
  const put = (key: string, value: string | number | null | undefined | false) => {
    if (value === null || value === undefined || value === false || value === "") return;
    out.set(key, String(value));
  };
  const putList = (key: string, values: readonly string[]) => put(key, values.join(","));
  put("q", state.q);
  putList('trigger',state.triggerKinds);put('age',state.triggerAge);
  putList("loc", state.locAny);
  putList("locx", state.locNot);
  put("basis", state.basis === "site" ? "site" : "");
  putList("role", state.roleAny);
  putList("rolex", state.roleNot);
  putList("sell", state.sell);
  put("comp", state.hideCompetitors ? "" : "show");
  putList("sig", state.signals);
  put("days", state.withinDays);
  putList("dept", state.departments);
  putList("slot", state.slotRoles);
  put("found", state.onlyWithFound ? "1" : "");
  putList("ind", state.industry);
  put("vmin", state.valueMin);
  put("vmax", state.valueMax);
  put("like", state.lookalike);
  putList("co", state.companies);
  putList("reach", state.reach);
  putList("stage", state.stage);
  put("fit", state.minFit);
  putList("sure", state.howSure);
  putList("tier", state.tiers.map(String));
  putList("how", state.links);
  put("sort", state.sort === "latest" ? "" : state.sort);
  put("page", state.page > 1 ? state.page : null);
  put("view", state.view === "contacts" ? "contacts" : "");
  put("open", state.open);
  return out;
}

export function searchHref(state: SearchUrlState, pathname = "/search"): string {
  const query = serializeSearchState(state).toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** Keys that change the result set (a change resets the page and closes nothing else). */
const RESULT_KEYS = new Set<keyof SearchUrlState>(
  (Object.keys(DEFAULT_SEARCH) as (keyof SearchUrlState)[]).filter((key) => !["page", "open", "view"].includes(key)),
);

/** Apply a change; any filter change goes back to page 1. */
export function applySearchChange(state: SearchUrlState, change: Partial<SearchUrlState>): SearchUrlState {
  const next = { ...state, ...change };
  if (!("page" in change) && Object.keys(change).some((key) => RESULT_KEYS.has(key as keyof SearchUrlState))) next.page = 1;
  if ("view" in change && change.view !== state.view) next.page = 1;
  return next;
}

/** Number of active filters (for the "Filters (n)" button on small screens and "Clear all"). */
export function activeFilterCount(state: SearchUrlState): number {
  let count = 0;
  for (const key of RESULT_KEYS) {
    if (key === "sort") continue;
    const value = state[key];
    const fallback = DEFAULT_SEARCH[key];
    if (Array.isArray(value)) count += value.length ? 1 : 0;
    else if (value !== fallback) count += 1;
  }
  return count;
}

export function clearedSearch(state: SearchUrlState): SearchUrlState {
  return { ...DEFAULT_SEARCH, view: state.view, sort: state.sort };
}

/** A catalogue item as far as the filter needs it. */
export interface CatalogueOption {
  id: string;
  name: string;
  category: string;
}

/** Expand "cat:<Category>" into its item ids (unknown categories are dropped). */
export function expandSell(sell: string[], catalogue: CatalogueOption[]): string[] {
  const ids = new Set<string>();
  for (const value of sell) {
    if (value.startsWith(CATEGORY_PREFIX)) {
      const category = value.slice(CATEGORY_PREFIX.length);
      for (const item of catalogue) if (item.category === category) ids.add(item.id);
    } else {
      ids.add(value);
    }
  }
  return [...ids];
}

function anyNot<T>(any: T[], not: T[]): { any?: T[]; not?: T[] } | undefined {
  if (!any.length && !not.length) return undefined;
  return { ...(any.length ? { any } : {}), ...(not.length ? { not } : {}) };
}

/** The request body for POST /api/mvp/buyers (and /contacts). */
export function toBuyerSearch(state: SearchUrlState, catalogue: CatalogueOption[] = [], pageSize = PAGE_SIZE): BuyerSearch {
  const search: BuyerSearch = { sort: state.sort, page: state.page, pageSize };
  if(state.triggerKinds.length||state.triggerAge)search.triggers={...(state.triggerKinds.length?{kinds:state.triggerKinds}:{}),...(state.triggerAge==='undated'?{undated:true}:state.triggerAge?{withinDays:Number(state.triggerAge)}:{})};
  const location = anyNot(state.locAny, state.locNot);
  if (location || state.basis === "site") search.location = { ...location, basis: state.basis };
  const roles = anyNot(state.roleAny, state.roleNot);
  if (roles) search.roles = roles;
  const sell = expandSell(state.sell, catalogue);
  search.sell = { ...(sell.length ? { any: sell } : {}), hideCompetitors: state.hideCompetitors };
  if (state.signals.length || state.withinDays) {
    search.signals = { ...(state.signals.length ? { any: state.signals } : {}), ...(state.withinDays ? { withinDays: state.withinDays } : {}) };
  }
  if (state.departments.length || state.slotRoles.length || state.onlyWithFound) {
    search.contacts = {
      ...(state.departments.length ? { departments: state.departments } : {}),
      ...(state.slotRoles.length ? { slotRoles: state.slotRoles } : {}),
      ...(state.onlyWithFound ? { onlyWithFound: true } : {}),
    };
  }
  if (state.industry.length) search.industry = state.industry;
  if (state.valueMin !== null || state.valueMax !== null) {
    search.valueUsd = { ...(state.valueMin !== null ? { min: state.valueMin } : {}), ...(state.valueMax !== null ? { max: state.valueMax } : {}) };
  }
  if (state.lookalike) search.lookalikeOf = state.lookalike;
  if (state.companies.length) search.companyList = state.companies;
  if (state.reach.length) search.reach = state.reach;
  if (state.stage.length) search.stage = state.stage;
  if (state.minFit !== null) search.minFit = state.minFit;
  if (state.howSure.length) search.howSure = state.howSure;
  if (state.tiers.length) search.tiers = state.tiers;
  if (state.links.length) search.linkStatus = state.links;
  if (state.q) search.q = state.q;
  return search;
}
