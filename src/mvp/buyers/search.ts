/**
 * SuperSearch over built buyer records (docs/mvp/14 §9, §10): filters, facets (each counted with every
 * other filter applied), sort, paging, and the contacts view. Pure — load.ts builds the records.
 *
 * Defaults: `sell.hideCompetitors` is on (competitor items never match a "What we can sell" filter,
 * and buyers that compete on every item are hidden); without a `stage` filter, "Not a buyer" and
 * leads the user marked "Not relevant" are hidden.
 */
import { getCatalogue } from "@/mvp/config/buyers-config";
import { countryName, locationMatches } from "./format";
import { BUYER_ROLE_LABELS, BUYER_STAGE_LABELS } from "./types";
import type {
  BuyerFacets,
  BuyerRow,
  BuyerSearch,
  BuyerSearchResult,
  BuyerSignal,
  ContactRow,
  ContactSearchResult,
  ContactSlot,
  FacetCount,
} from "./types";
import type { BuyerRecord } from "./view";

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

type Dimension = "location" | "roles" | "sell" | "signals" | "contacts" | "industry" | "value" | "lookalike" | "companyList" | "reach" | "stage" | "minFit" | "howSure" | "q";

const SIGNAL_LABELS: Record<BuyerSignal, string> = { order_won: "Won an order", contract_won: "Won a contract", tender_open: "Open tender", expansion: "Expansion" };
const REACH_LABELS: Record<string, string> = { allowed: "Allowed", opt_out_only: "With opt-out", consent_needed: "Consent needed", blocked: "Blocked" };
const INDUSTRY_LABELS: Record<string, string> = { oil_gas: "Oil & gas", water: "Water", power: "Power", petrochemical: "Petrochemical", infrastructure: "Infrastructure", mining: "Mining", other: "Other" };

/** Slots that pass the contacts filter (departments / slot roles); all slots when none given. */
export function slotsMatching(record: BuyerRecord, contacts: BuyerSearch["contacts"]): ContactSlot[] {
  const departments = (contacts?.departments ?? []).map((d) => d.toLowerCase());
  const roles = contacts?.slotRoles ?? [];
  return record.view.team.filter(
    (slot) =>
      (!departments.length || departments.includes((record.slotDepartments[slot.slotId] ?? "").toLowerCase())) &&
      (!roles.length || roles.includes(slot.role)),
  );
}

function hideCompetitors(search: BuyerSearch): boolean {
  return search.sell?.hideCompetitors ?? true;
}

function daysAgo(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isFinite(t) ? (now.getTime() - t) / 86_400_000 : null;
}

function sellIds(record: BuyerRecord, hide: boolean): string[] {
  return record.view.sellItems.filter((i) => !hide || i.fit !== "competitor").map((i) => i.itemId);
}

/** Similarity of a buyer to the look-alike reference: same role, shared items, same country. */
export function lookalikeScore(record: BuyerRecord, reference: BuyerRecord): number {
  if (record.view.leadId === reference.view.leadId) return 0;
  let score = record.view.role === reference.view.role ? 3 : 0;
  const theirs = new Set(sellIds(reference, true));
  score += sellIds(record, true).filter((id) => theirs.has(id)).length;
  if (record.hqCountry && record.hqCountry === reference.hqCountry) score += 1;
  if (record.sector && record.sector === reference.sector) score += 1;
  return score;
}

/** True when the record passes every filter except those in `omit`. */
export function matches(record: BuyerRecord, search: BuyerSearch, now: Date, all: readonly BuyerRecord[] = [], omit: ReadonlySet<Dimension> = new Set()): boolean {
  const view = record.view;
  const on = (dim: Dimension) => !omit.has(dim);

  if (on("stage")) {
    if (search.stage?.length) {
      if (!search.stage.includes(view.stage)) return false;
    } else if (view.stage === "not_buyer" || record.leadStatus === "rejected") return false;
  }
  if (hideCompetitors(search) && record.competitorForAll && !search.stage?.includes("not_buyer")) return false;

  if (on("location") && search.location) {
    const place = search.location.basis === "site" ? { country: record.siteCountry, site: record.site } : { country: record.hqCountry, site: null };
    const any = search.location.any ?? [];
    const not = search.location.not ?? [];
    if (any.length && !any.some((v) => locationMatches(v, place.country, place.site))) return false;
    if (not.length && not.some((v) => locationMatches(v, place.country, place.site))) return false;
  }
  if (on("roles") && search.roles) {
    if (search.roles.any?.length && !search.roles.any.includes(view.role)) return false;
    if (search.roles.not?.length && search.roles.not.includes(view.role)) return false;
  }
  if (on("sell") && search.sell?.any?.length) {
    const ids = new Set(sellIds(record, hideCompetitors(search)));
    // A filter value may be an item id or a category name ("Valves", "Fittings & flanges").
    const categories = new Set(record.view.sellItems.filter((i) => !hideCompetitors(search) || i.fit !== "competitor").map((i) => i.category.toLowerCase()));
    if (!search.sell.any.some((v) => ids.has(v) || categories.has(v.toLowerCase()))) return false;
  }
  if (on("signals") && search.signals) {
    if (search.signals.any?.length && !search.signals.any.some((s) => record.signals.includes(s))) return false;
    if (search.signals.withinDays && search.signals.withinDays > 0) {
      const age = daysAgo(view.triggerDate ?? record.createdAt, now);
      if (age === null || age > search.signals.withinDays) return false;
    }
  }
  if (on("contacts") && search.contacts) {
    const slots = slotsMatching(record, search.contacts);
    if ((search.contacts.departments?.length || search.contacts.slotRoles?.length) && !slots.length) return false;
    if (search.contacts.onlyWithFound && !slots.some((s) => s.person)) return false;
  }
  if (on("industry") && search.industry?.length && !industryMatches(search.industry, record.sector)) return false;
  if (on("value") && search.valueUsd) {
    const v = record.valueUsd;
    if (search.valueUsd.min !== undefined && (v === null || v < search.valueUsd.min)) return false;
    if (search.valueUsd.max !== undefined && (v === null || v > search.valueUsd.max)) return false;
  }
  if (on("lookalike") && search.lookalikeOf) {
    const ref = findLookalikeRef(all, search.lookalikeOf);
    if (!ref || lookalikeScore(record, ref) < 4) return false;
  }
  if (on("companyList") && search.companyList?.length) {
    const wanted = search.companyList.map((c) => c.toLowerCase().trim());
    if (!wanted.some((c) => c === view.companyId.toLowerCase() || c === view.leadId.toLowerCase() || view.name.toLowerCase().includes(c) || view.shortName.toLowerCase() === c)) return false;
  }
  if (on("reach") && search.reach?.length && !(search.reach as string[]).includes(view.reach.email)) return false;
  if (on("minFit") && typeof search.minFit === "number" && search.minFit > 0 && view.fitScore < search.minFit) return false;
  if (on("howSure") && search.howSure?.length && !search.howSure.includes(view.howSure)) return false;
  if (on("q") && search.q?.trim()) {
    const q = search.q.trim().toLowerCase();
    const hay = [view.name, view.shortName, view.subRoleLabel ?? "", view.roleLabel, view.buyingReason, record.row.buyingReason, countryName(view.country) ?? "", ...view.sellItems.map((i) => `${i.name} ${i.category}`), ...view.team.map((s) => s.person?.name ?? "")]
      .join(" \n ")
      .toLowerCase();
    if (!q.split(/\s+/).every((word) => hay.includes(word))) return false;
  }
  return true;
}

function count<T extends string>(values: Iterable<T>, labels: (v: T) => string): FacetCount[] {
  const map = new Map<T, number>();
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
  return [...map.entries()].map(([value, n]) => ({ value, label: labels(value), count: n })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Facets: each dimension counted over the records that pass every other filter. */
export function buildFacets(records: readonly BuyerRecord[], search: BuyerSearch, now: Date): BuyerFacets {
  const pass = (dim: Dimension) => records.filter((r) => matches(r, search, now, records, new Set([dim])));
  const catalogue = getCatalogue().items;
  const itemName = (id: string) => catalogue.find((i) => i.id === id)?.shortName ?? id;
  const hide = hideCompetitors(search);
  return {
    roles: count(pass("roles").map((r) => r.view.role), (v) => BUYER_ROLE_LABELS[v]),
    countries: count(
      pass("location").map((r) => (search.location?.basis === "site" ? r.siteCountry : r.hqCountry)).filter((c): c is string => Boolean(c)),
      (v) => countryName(v) ?? v,
    ),
    items: count(pass("sell").flatMap((r) => sellIds(r, hide)), itemName),
    signals: count(pass("signals").flatMap((r) => r.signals), (v) => SIGNAL_LABELS[v]),
    stages: count(pass("stage").map((r) => r.view.stage), (v) => BUYER_STAGE_LABELS[v]),
    howSure: count(pass("howSure").map((r) => r.view.howSure), (v) => v.charAt(0).toUpperCase() + v.slice(1)),
    reach: count(pass("reach").map((r) => r.view.reach.email), (v) => REACH_LABELS[v] ?? v),
    industries: count(pass("industry").map((r) => r.sector).filter((s): s is string => Boolean(s)), (v) => INDUSTRY_LABELS[v] ?? v),
  };
}

function sortRecords(records: BuyerRecord[], sort: BuyerSearch["sort"], lookalike: BuyerRecord | null): BuyerRecord[] {
  const nextWindow = (r: BuyerRecord) => {
    const step = r.view.window.slice(1).find((s) => s.state === "now") ?? r.view.window.slice(1).find((s) => s.state === "next");
    if (!step) return "9999";
    return step.state === "now" ? "0000" : (step.from ?? "9998");
  };
  const byLatest = (a: BuyerRecord, b: BuyerRecord) => (b.view.triggerDate ?? b.createdAt.slice(0, 10)).localeCompare(a.view.triggerDate ?? a.createdAt.slice(0, 10)) || b.view.fitScore - a.view.fitScore;
  const copy = [...records];
  if (lookalike) return copy.sort((a, b) => lookalikeScore(b, lookalike) - lookalikeScore(a, lookalike) || b.view.fitScore - a.view.fitScore);
  if (sort === "fit") return copy.sort((a, b) => b.view.fitScore - a.view.fitScore || byLatest(a, b));
  if (sort === "window") return copy.sort((a, b) => nextWindow(a).localeCompare(nextWindow(b)) || b.view.fitScore - a.view.fitScore);
  return copy.sort(byLatest);
}

function pageOf(search: Pick<BuyerSearch, "page" | "pageSize">): { page: number; pageSize: number } {
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(search.pageSize) || DEFAULT_PAGE_SIZE)));
  const page = Math.max(1, Math.floor(Number(search.page) || 1));
  return { page, pageSize };
}

/** Industry filter values are sector codes ("oil_gas"); their labels ("Oil & gas") are accepted too. */
function industryMatches(wanted: readonly string[], sector: string | null | undefined): boolean {
  if (!sector) return false;
  const label = (INDUSTRY_LABELS[sector] ?? sector).toLowerCase();
  return wanted.some((w) => w === sector || w.toLowerCase() === label);
}

/**
 * The reference buyer for "Lookalike company": a lead id or company id, else a company name typed in the
 * filter panel (exact name / short name first, then the first name that contains it).
 */
export function findLookalikeRef(records: readonly BuyerRecord[], ref: string): BuyerRecord | null {
  const key = ref.trim().toLowerCase();
  if (!key) return null;
  return (
    records.find((r) => r.view.leadId === ref || r.view.companyId === ref) ??
    records.find((r) => r.view.name.toLowerCase() === key || r.view.shortName.toLowerCase() === key) ??
    records.find((r) => r.view.name.toLowerCase().includes(key)) ??
    null
  );
}

/** Rows as shown in the table: competitor items stay in the note, never in the sell summary. */
function rowFor(record: BuyerRecord, search: BuyerSearch): BuyerRow {
  const slots = slotsMatching(record, search.contacts);
  if (!search.contacts?.departments?.length && !search.contacts?.slotRoles?.length) return record.row;
  return { ...record.row, found: slots.filter((s) => s.person).length, total: slots.length };
}

/** SuperSearch buyers: one page of rows, total, facets and contact counts across all results. */
export function searchRecords(records: readonly BuyerRecord[], search: BuyerSearch, now: Date): BuyerSearchResult {
  const filtered = records.filter((r) => matches(r, search, now, records));
  const lookalike = search.lookalikeOf ? findLookalikeRef(records, search.lookalikeOf) : null;
  const sorted = sortRecords(filtered, search.sort, lookalike);
  const { page, pageSize } = pageOf(search);
  let contactsFound = 0;
  let contactsTotal = 0;
  for (const record of filtered) {
    const slots = slotsMatching(record, search.contacts);
    contactsTotal += slots.length;
    contactsFound += slots.filter((s) => s.person).length;
  }
  return {
    rows: sorted.slice((page - 1) * pageSize, page * pageSize).map((r) => rowFor(r, search)),
    total: filtered.length,
    facets: buildFacets(records, search, now),
    contactsFound,
    contactsTotal,
    page,
    pageSize,
  };
}

/** SuperSearch contacts: one row per buying-team slot (person or empty slot) of the matching buyers. */
export function searchContactRecords(records: readonly BuyerRecord[], search: BuyerSearch, now: Date): ContactSearchResult {
  const filtered = sortRecords(records.filter((r) => matches(r, search, now, records)), search.sort, null);
  const rows: ContactRow[] = [];
  for (const record of filtered) {
    for (const slot of slotsMatching(record, search.contacts)) {
      if (search.contacts?.onlyWithFound && !slot.person) continue;
      rows.push({
        leadId: record.view.leadId,
        companyId: record.view.companyId,
        company: record.view.name,
        role: record.view.role,
        roleLabel: record.view.roleLabel,
        country: record.view.country,
        slotId: slot.slotId,
        slotRole: slot.role,
        slotTitle: slot.title,
        person: slot.person,
        status: slot.status,
        findLinks: slot.findLinks,
      });
    }
  }
  // Found people first, then empty slots.
  rows.sort((a, b) => Number(Boolean(b.person)) - Number(Boolean(a.person)));
  const { page, pageSize } = pageOf(search);
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, found: rows.filter((r) => r.person).length, page, pageSize };
}
