/**
 * What each buyer will buy from the client, and when (docs/mvp/14 §5), and the competitor check per
 * item (14 §6). Pure functions over the config files in src/mvp/config.
 */
import {
  getCatalogue,
  getCatalogueItem,
  getNeedsMap,
  type CatalogueItem,
  type KnownCompany,
  type NeedsRule,
} from "@/mvp/config/buyers-config";
import type { BuyerRole, FitLevel, SellItem } from "./types";
import type { ProjectType, Situation } from "./roles";

// ───────────────────────── catalogue matching ─────────────────────────

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const keywordRes = new Map<string, RegExp>();
function keywordRe(keyword: string): RegExp {
  let re = keywordRes.get(keyword);
  if (!re) {
    re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(keyword.toLowerCase()).replace(/\\ /g, "[\\s-]?").replace(/ /g, "[\\s-]?")}s?(?![\\p{L}\\p{N}])`, "iu");
    keywordRes.set(keyword, re);
  }
  return re;
}

/** Catalogue items whose keywords (or standards) appear in the text. */
export function catalogueItemsIn(text: string, items: readonly CatalogueItem[] = getCatalogue().items): string[] {
  if (!text.trim()) return [];
  const out: string[] = [];
  for (const item of items) {
    const words = [...item.keywords, ...item.standards];
    if (words.some((word) => keywordRe(word).test(text))) out.push(item.id);
  }
  return out;
}

// ───────────────────────── needs rules ─────────────────────────

/**
 * The needs rule for a buyer (14 §5). An owner running an open tender buys the tender scope, so it
 * uses the EPC rule of its project type; an upstream owner uses the drilling rule.
 */
export function pickNeedsRule(role: BuyerRole, situation: Situation, opts: { openTender?: boolean } = {}): NeedsRule | null {
  const rules = getNeedsMap().rules;
  if (role === "owner") {
    if (situation === "drilling") return rules.find((r) => r.id === "owner-drilling") ?? null;
    if (opts.openTender && situation) {
      const epc = rules.find((r) => r.role === "epc_contractor" && r.situation === situation);
      if (epc) return { ...epc, trigger: "Tender open" };
    }
    return rules.find((r) => r.role === "owner" && r.situation === null) ?? null;
  }
  if (role === "subcontractor" && situation === "water") {
    const water = rules.find((r) => r.id === "epc-water");
    if (water) return { ...water, trigger: "Subcontract won" };
  }
  return (
    rules.find((r) => r.role === role && r.situation === situation) ??
    rules.find((r) => r.role === role && r.situation === null) ??
    rules.find((r) => r.role === role) ??
    null
  );
}

const DAY_MS = 86_400_000;
const MONTH_DAYS = 30.44;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ISO day `months` (may be fractional) after a date. */
export function addMonths(iso: string, months: number): string {
  const base = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return new Date(base + months * MONTH_DAYS * DAY_MS).toISOString().slice(0, 10);
}

/** "Oct – Nov 2026", "Nov 2026 – Jan 2027", "Oct 2026" for a date range. */
export function monthRange(from: string | null, to: string | null): string | null {
  if (!from) return null;
  const a = new Date(`${from.slice(0, 10)}T00:00:00Z`);
  const b = to ? new Date(`${to.slice(0, 10)}T00:00:00Z`) : a;
  const ma = `${MONTHS[a.getUTCMonth()]}`;
  const mb = `${MONTHS[b.getUTCMonth()]}`;
  if (a.getUTCFullYear() === b.getUTCFullYear()) {
    return a.getUTCMonth() === b.getUTCMonth() ? `${ma} ${a.getUTCFullYear()}` : `${ma} – ${mb} ${b.getUTCFullYear()}`;
  }
  return `${ma} ${a.getUTCFullYear()} – ${mb} ${b.getUTCFullYear()}`;
}

/** Window text for an item: a month range from the trigger date, else "0–3 months after <trigger>". */
export function windowText(rule: Pick<NeedsRule, "trigger" | "continuous">, from: number, to: number, triggerDate: string | null): string {
  if (rule.continuous) return triggerDate ? `Continuous; peak ${monthRange(addMonths(triggerDate, from), addMonths(triggerDate, to))}` : "Continuous; peak after a big order";
  if (triggerDate) return monthRange(addMonths(triggerDate, from), addMonths(triggerDate, to)) ?? "";
  return `${fmt(from)}–${fmt(to)} months after ${rule.trigger.toLowerCase()}`;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// ───────────────────────── competitor check (14 §6) ─────────────────────────

export interface CompetitorInput {
  role: BuyerRole;
  situation: Situation;
  /** The buyer's name. */
  name: string;
  /** Verified text about the buyer (evidence sentences, party scope). */
  text: string;
  known: KnownCompany | null;
  /** Catalogue items in the order the buyer won (a manufacturer makes what it supplies). */
  orderItemIds?: readonly string[];
}

const MAKER_PHRASE = /\b(?:manufactur(?:er|ers|es|ing)\s+(?:of\s+)?|maker\s+of\s+|makes\s+|produc(?:er|ers|es|ing)\s+(?:of\s+)?|mill\s+(?:for|making)\s+)([^.;]{3,120})/gi;

/**
 * Items the buyer makes or stocks, with the reason (14 §6): known-companies list, "manufacturer of …"
 * / "produces …" phrases, and for a manufacturer the items of the order it won (a pipe mill that
 * won a pipe order makes that pipe); a pipe mill with nothing more specific makes line pipe; a valve
 * maker makes the valves named, else all valves.
 */
export function competitorItems(input: CompetitorInput): Map<string, string> {
  const out = new Map<string, string>();
  const items = getCatalogue().items;
  const add = (id: string, why: string) => {
    if (!out.has(id) && getCatalogueItem(id)) out.set(id, why);
  };
  for (const id of input.known?.makes ?? []) add(id, input.role === "distributor" ? "They stock it" : "They make it");

  // "manufacturer of … / produces …" only describes the buyer when the buyer is on the supply side: an
  // owner's or EPC's evidence ("Arabian Pipes signed a contract with Saudi Aramco for the manufacturing
  // of steel pipes") describes the company that won the order, not the buyer.
  if (input.role === "manufacturer" || input.role === "fabricator" || input.role === "distributor") {
    for (const match of input.text.matchAll(MAKER_PHRASE)) {
      for (const id of catalogueItemsIn(match[1], items)) add(id, "They make it");
    }
  }

  if (input.role === "manufacturer") {
    const pipeIds = new Set(items.filter((i) => i.category === "Pipes").map((i) => i.id));
    const valveIds = new Set(items.filter((i) => i.category === "Valves").map((i) => i.id));
    const ordered = input.orderItemIds ?? [];
    if (input.situation === "pipe_mill") {
      for (const id of ordered) if (pipeIds.has(id)) add(id, "They make it");
      if (![...out.keys()].some((id) => pipeIds.has(id))) add("line-pipe", "Pipe mill — they make pipe");
    } else if (input.situation === "valve_maker") {
      for (const id of ordered) if (valveIds.has(id)) add(id, "They make it");
      if (![...out.keys()].some((id) => valveIds.has(id))) for (const id of valveIds) add(id, "Valve maker — they make valves");
    } else {
      for (const id of ordered) add(id, "They make it");
    }
  }
  return out;
}

// ───────────────────────── sell items ─────────────────────────

export interface SellInput {
  role: BuyerRole;
  situation: Situation;
  rule: NeedsRule | null;
  triggerDate: string | null;
  /** Project type (for "$package-pipes"). */
  projectType: ProjectType | null;
  /** Catalogue items named in verified facts about this buyer / package (requirements, scope, quotes). */
  mentioned: ReadonlyMap<string, string[]>;
  /** Catalogue items the buyer stocks (for "$product-range"); empty = unknown. */
  productRange?: readonly string[];
  /** Items the buyer makes / stocks, with the reason (competitorItems). */
  competitors: ReadonlyMap<string, string>;
}

export interface SellPlanItem extends SellItem {
  /** Index of the needs-rule group (window step) the item belongs to; -1 = named only. */
  group: number;
}

const FIT_ORDER: Record<FitLevel, number> = { good: 0, possible: 1, competitor: 2 };

/**
 * What the buyer will buy (14 §5) with fit, reason, window and evidence. Items the buyer makes or
 * stocks become `competitor` (14 §6). Items named in the sources are upgraded to `good` (or added).
 * Sorted: good, possible, competitor; within a fit, by window.
 */
export function sellItemsFor(input: SellInput): SellPlanItem[] {
  const out = new Map<string, SellPlanItem>();
  const pipes = getNeedsMap().packagePipes;
  const rule = input.rule;

  const expand = (id: string): string[] => {
    if (id === "$package-pipes") return pipes[input.projectType ?? "default"] ?? pipes.default ?? [];
    if (id === "$product-range") {
      const range = input.productRange ?? [];
      return range.length ? [...range] : ["line-pipe", "cs-process-pipe", "bw-fittings", "flanges", "gate-globe-check"];
    }
    return [id];
  };

  rule?.groups.forEach((group, index) => {
    for (const entry of group.items) {
      for (const id of expand(entry.id)) {
        const item = getCatalogueItem(id);
        if (!item || out.has(id)) continue;
        const productRangeUnknown = entry.id === "$product-range" && !(input.productRange ?? []).length;
        out.set(id, {
          itemId: id,
          name: item.name,
          category: item.category,
          fit: productRangeUnknown ? "possible" : entry.fit,
          why: productRangeUnknown ? "Stockists resell pipe, fittings, flanges and valves" : entry.why,
          window: windowText(rule, group.from, group.to, input.triggerDate),
          evidenceIds: [],
          group: index,
        });
      }
    }
  });

  for (const [id, evidenceIds] of input.mentioned) {
    const item = getCatalogueItem(id);
    if (!item) continue;
    const current = out.get(id);
    if (current) {
      current.fit = "good";
      current.evidenceIds = [...new Set([...current.evidenceIds, ...evidenceIds])];
      if (!/named in the source/i.test(current.why)) current.why = `${current.why} — named in the source`;
    } else if (!input.competitors.has(id)) {
      out.set(id, {
        itemId: id,
        name: item.name,
        category: item.category,
        fit: "good",
        why: "Named in the source",
        window: rule ? windowText(rule, rule.groups[0].from, rule.groups[0].to, input.triggerDate) : undefined,
        evidenceIds: [...evidenceIds],
        group: rule ? 0 : -1,
      });
    }
  }

  for (const [id, why] of input.competitors) {
    const item = getCatalogueItem(id);
    if (!item) continue;
    const current = out.get(id);
    const base = current ?? { itemId: id, name: item.name, category: item.category, window: undefined, evidenceIds: [], group: -1 };
    out.set(id, { ...base, fit: "competitor", why: `${why} — hidden from outreach` });
  }

  return [...out.values()].sort((a, b) => FIT_ORDER[a.fit] - FIT_ORDER[b.fit] || (a.group < 0 ? 99 : a.group) - (b.group < 0 ? 99 : b.group));
}

/** Short names for chips and the headline ("coating materials", "welding consumables"). */
export function shortItemName(itemId: string): string {
  return getCatalogueItem(itemId)?.shortName ?? itemId;
}

/** "a, b and c" */
export function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Row summary of what we can sell ("Coating materials, welding consumables, fittings"). */
export function sellSummary(items: readonly SellItem[], max = 4): string {
  const names = items.filter((i) => i.fit !== "competitor").slice(0, max).map((i) => shortItemName(i.itemId));
  if (!names.length) return "";
  const text = names.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Row competitor note ("Makes line pipe — competitor for pipe"), or null. */
export function competitorNote(items: readonly SellItem[], role: BuyerRole): string | null {
  const comp = items.filter((i) => i.fit === "competitor");
  if (!comp.length) return null;
  const verb = role === "distributor" ? "Stocks" : "Makes";
  const names = joinAnd(comp.slice(0, 2).map((i) => shortItemName(i.itemId)));
  const more = comp.length > 2 ? ` +${comp.length - 2}` : "";
  const categories = [...new Set(comp.map((i) => i.category.toLowerCase().replace(/ & .*/, "")))];
  const forWhat = categories.length === 1 ? (categories[0] === "pipes" ? "pipe" : categories[0]) : "these items";
  return `${verb} ${names}${more} — competitor for ${forWhat}`;
}
