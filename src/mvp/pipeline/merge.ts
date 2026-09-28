/**
 * Data fixes (docs/mvp/14 §11), pure helpers used by extract/resolve:
 *
 * - the same order reported in different currencies is one project: same buyer + owner + product,
 *   award dates within 30 days and USD values within 15%;
 * - company name variants ("Welspun Corp", "Welspun Corp Associate", "Welspun Corp Unit") are one
 *   company (aliases such as "Saudi Arabian Oil Co" = "Saudi Aramco" are in text.ts KNOWN_ALIAS_GROUPS);
 * - place names mistaken for companies are dropped (gazetteer + "no company suffix and only ever
 *   written after in/at/near");
 * - implausible values (> USD 20B for a single order) are dropped.
 */
import { USD_PER_UNIT, companyVariantKey, normalizeCompanyName } from "./text";

/** Largest believable value of a single order or contract (14 §11). */
export const MAX_ORDER_USD = 20e9;
/** Two reports of one order: award dates at most this many days apart … */
export const SAME_ORDER_DAYS = 30;
/** … and USD values at most this far apart (relative to the larger). */
export const SAME_ORDER_VALUE_TOLERANCE = 0.15;

/** USD value of an amount, or null when the currency has no rate. */
export function toUsd(amount: number | null | undefined, currency: string | null | undefined): number | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount) || !currency) return null;
  const rate = USD_PER_UNIT[currency.toUpperCase()];
  return rate ? Math.round(amount * rate) : null;
}

/** True when a USD value is not believable for one order (> USD 20B). */
export function isImplausibleValue(usd: number | null | undefined): boolean {
  return typeof usd === "number" && Number.isFinite(usd) && usd > MAX_ORDER_USD;
}

/** Drop a parsed money value that is implausible for a single order. */
export function plausibleMoney<T extends { usd: number | null } | null>(money: T): T | null {
  return money && isImplausibleValue(money.usd) ? null : money;
}

export interface OrderReport {
  buyerId: string | null;
  ownerId: string | null;
  /** Product / discipline keys of the order ("pipeline", "line pipe"…). Empty = unknown. */
  products: string[];
  awardDate: string | null;
  amount: number | null;
  currency: string | null;
  /** Precomputed USD value (wins over amount + currency). */
  usd?: number | null;
}

/**
 * True when two reports describe the same order (14 §11): same buyer and owner, a shared product
 * (or unknown on one side), award dates within 30 days (when both known) and USD values within 15%
 * (when both known). Currencies may differ — values are compared in USD.
 */
export function sameOrder(a: OrderReport, b: OrderReport): boolean {
  if (!a.buyerId || !b.buyerId || a.buyerId !== b.buyerId) return false;
  if (!a.ownerId || !b.ownerId || a.ownerId !== b.ownerId) return false;
  if (a.products.length && b.products.length && !a.products.some((p) => b.products.includes(p))) return false;
  if (a.awardDate && b.awardDate) {
    const days = Math.abs(Date.parse(a.awardDate) - Date.parse(b.awardDate)) / 86_400_000;
    if (!Number.isFinite(days) || days > SAME_ORDER_DAYS) return false;
  }
  const usdA = a.usd ?? toUsd(a.amount, a.currency);
  const usdB = b.usd ?? toUsd(b.amount, b.currency);
  if (usdA && usdB && !valuesClose(usdA, usdB)) return false;
  return true;
}

/** Values within the same-order tolerance (15% of the larger). */
export function valuesClose(a: number, b: number, tolerance = SAME_ORDER_VALUE_TOLERANCE): boolean {
  const max = Math.max(Math.abs(a), Math.abs(b));
  if (max === 0) return true;
  return Math.abs(a - b) / max <= tolerance;
}

export { companyVariantKey };

/** True when two company names are variants of one company. */
export function sameCompanyVariant(a: string, b: string): boolean {
  const ka = companyVariantKey(a) ?? normalizeCompanyName(a);
  const kb = companyVariantKey(b) ?? normalizeCompanyName(b);
  return ka.length >= 2 && ka === kb;
}

/** Gazetteer of places often mistaken for companies (in addition to text.ts PLACE_NAMES). */
export const PLACE_GAZETTEER = new Set([
  // GCC
  "jebel ali", "ruwais", "al ruwais", "fujairah", "ras al khaimah", "ajman", "umm al quwain", "al ain", "jubail", "yanbu", "ras tanura",
  "khobar", "al khobar", "dhahran", "mecca", "makkah", "medina", "madinah", "neom", "tabuk", "abqaiq", "khurais", "doha", "ras laffan",
  "mesaieed", "muscat", "sohar", "duqm", "salalah", "sur", "kuwait city", "ahmadi", "manama", "sitra", "jafurah", "hawiyah", "haradh",
  "eastern province", "western region",
  // India
  "kandla", "mundra", "jamnagar", "dahej", "hazira", "vadodara", "ahmedabad", "surat", "pune", "chennai", "kolkata", "hyderabad",
  "bengaluru", "bangalore", "kochi", "visakhapatnam", "paradip", "odisha", "tamil nadu", "karnataka", "kerala", "andhra pradesh",
  "uttar pradesh", "madhya pradesh", "punjab", "haryana", "west bengal", "assam", "bihar", "telangana",
  "gurugram", "gurgaon", "new delhi", "delhi", "noida", "greater noida", "faridabad", "mumbai", "navi mumbai", "thane", "rajasthan", "gujarat", "maharashtra",
  // Malaysia / Norway / other
  "port klang", "pengerang", "kerteh", "bintulu", "labuan", "penang", "melaka", "stavanger", "bergen", "trondheim", "hammerfest",
  "kollsnes", "mongstad", "europe", "asia", "middle east", "gulf", "africa",
]);

/** Suffixes / words that mark a company name (so it is not a bare place). */
const COMPANY_MARKER =
  /\b(?:ltd|limited|llc|l\.l\.c|co|company|inc|corp|corporation|pjsc|psc|saog|bhd|berhad|sdn|asa|pvt|plc|gmbh|ag|sa|spa|bv|nv|wll|fze|fzco|jsc|group|holdings?|industries|industrial|engineering|construction|contracting|pipes?|steel|energy|petroleum|oil|gas|power|services|solutions|infra\w*|enterprises?|trading|international|municipality|kommune|authority|ministry|council|corporation)\b/i;

/** Last words that make a name a street, junction or locality rather than a company. */
const PLACE_TYPE_END = /\s(?:chowk|nagar|marg|road|rd|street|st|avenue|circle|junction|crossing|flyover|bypass|expressway|highway|colony|vihar|enclave|bagh|ganj|pur|puram|abad|district|village|taluka|tehsil|mandal)$/i;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * True when an extracted company name is really a place (14 §11): it is in the gazetteer, or it has
 * no company suffix / industry word and every mention in the text comes right after "in", "at" or
 * "near" ("a new plant in Ruwais").
 */
export function isPlaceName(name: string, text = ""): boolean {
  const clean = name.trim().replace(/^the\s+/i, "").replace(/[.,;:]+$/, "");
  if (!clean) return true;
  if (PLACE_GAZETTEER.has(clean.toLowerCase())) return true;
  if (COMPANY_MARKER.test(clean)) return false;
  // Street / junction / locality names ("Shankar Chowk", "Rajiv Nagar", "MG Road", "Sector 29").
  if (PLACE_TYPE_END.test(clean) || /^sector\s+\d+[a-z]?$/i.test(clean)) return true;
  if (!text) return false;
  const all = [...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(clean)}(?![\\p{L}\\p{N}])`, "giu"))];
  if (!all.length) return false;
  return all.every((m) => /\b(?:in|at|near)\s+(?:the\s+)?$/i.test(text.slice(Math.max(0, (m.index ?? 0) - 12), m.index ?? 0)));
}
