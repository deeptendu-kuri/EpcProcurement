/**
 * Text helpers shared by the pipeline: normalisation (05 §4, 06 §5), hashing, company-name
 * normalisation (04 companies.normalized_name) and a small token-set ratio (RapidFuzz-style, 0–100).
 */
import { createHash } from "node:crypto";

/** NFC + collapse whitespace + trim. Used for stored document text (05 §4 step 3). */
export function cleanText(text: string): string {
  return text.normalize("NFC").replace(/[  -​  　]/g, " ").replace(/[ \t\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** sha256 hex of a string. */
export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** sha1 hex of a string. */
export function sha1(text: string): string {
  return createHash("sha1").update(text, "utf8").digest("hex");
}

const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;

/**
 * Comparison form for quote checks (06 §5): NFC, unify quotes/dashes, Arabic alef variants,
 * tatweel and diacritics removed, casefold, collapse whitespace.
 */
export function normaliseForMatch(text: string): string {
  return text
    .normalize("NFC")
    .replace(ARABIC_DIACRITICS, "")
    .replace(/ـ/g, "") // tatweel
    .replace(/[آأإٱ]/g, "ا") // alef variants → bare alef
    .replace(/ى/g, "ي") // alef maksura → ya
    .replace(/ة/g, "ه") // ta marbuta → ha
    .replace(/[‘’‚‛′´`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const LEGAL_SUFFIXES = [
  "ltd", "limited", "llc", "l.l.c", "co", "company", "inc", "incorporated", "corp", "corporation", "pjsc", "psc", "saog", "saoc",
  "bhd", "berhad", "sdn", "asa", "as", "pvt", "private", "plc", "gmbh", "ag", "sa", "spa", "bv", "nv", "wll", "fze", "fzco", "fzc", "jsc",
];
const SUFFIX_SET = new Set(LEGAL_SUFFIXES);

/** companies.normalized_name: lowercase, punctuation removed, trailing/inner legal suffixes stripped. */
export function normalizeCompanyName(name: string): string {
  const tokens = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const kept = tokens.filter((token) => !SUFFIX_SET.has(token));
  const result = (kept.length ? kept : tokens).join(" ").replace(/^the /, "");
  return result.trim();
}

const PROJECT_STOPWORDS = new Set(["the", "project", "projects", "scheme", "phase", "of", "for", "and", "a", "an"]);

/** projects.normalized_name: lowercase, punctuation/dashes removed, filler words ("the", "project") dropped. */
export function normalizeProjectName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token && !PROJECT_STOPWORDS.has(token))
    .join(" ");
}

/** Normalised person name for people.normalized_name. */
export function normalizePersonName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(mr|mrs|ms|dr|eng|engr|sheikh)\.?\s+/g, "")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Levenshtein-based similarity ratio 0–100 (like RapidFuzz `ratio`). */
export function ratio(a: string, b: string): number {
  if (a === b) return 100;
  if (!a.length || !b.length) return 0;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  const distance = prev[b.length];
  return Math.round((1 - distance / Math.max(a.length, b.length)) * 100);
}

/**
 * Token-set ratio (RapidFuzz `token_set_ratio`): compares the sorted intersection of tokens with each
 * side's remainder, so "example pipelines" vs "example pipelines india" scores high.
 */
export function tokenSetRatio(a: string, b: string): number {
  const ta = new Set(a.split(/\s+/).filter(Boolean));
  const tb = new Set(b.split(/\s+/).filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  const inter = [...ta].filter((t) => tb.has(t)).sort();
  const diffA = [...ta].filter((t) => !tb.has(t)).sort();
  const diffB = [...tb].filter((t) => !ta.has(t)).sort();
  const base = inter.join(" ");
  const combA = [base, ...diffA].filter(Boolean).join(" ");
  const combB = [base, ...diffB].filter(Boolean).join(" ");
  if (!base) return ratio(combA, combB);
  return Math.max(ratio(base, combA), ratio(base, combB), ratio(combA, combB));
}

/** Parse "12 August 2026", "August 12, 2026", "2026-08-12", "12/08/2026" (day first) → "YYYY-MM-DD". */
export function parseDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  const valid = (y: number, m: number, d: number) =>
    y > 1990 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null;
  let m = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = text.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})/i);
  if (m) return valid(+m[3], months.indexOf(m[2].toLowerCase().slice(0, 3)) + 1, +m[1]);
  m = text.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i);
  if (m) return valid(+m[3], months.indexOf(m[1].toLowerCase().slice(0, 3)) + 1, +m[2]);
  m = text.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (m) return valid(+m[3], +m[2], +m[1]);
  m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})\b/i);
  if (m) return valid(+m[2], months.indexOf(m[1].toLowerCase().slice(0, 3)) + 1, 1);
  return null;
}

const MULTIPLIERS: Record<string, number> = {
  thousand: 1e3, k: 1e3, lakh: 1e5, lakhs: 1e5, million: 1e6, mn: 1e6, m: 1e6, mln: 1e6, crore: 1e7, crores: 1e7, cr: 1e7,
  billion: 1e9, bn: 1e9, b: 1e9,
};

/** Rough USD rates per 1 unit of currency (slice only; replace with a rates feed later). */
export const USD_PER_UNIT: Record<string, number> = {
  USD: 1, EUR: 1.08, GBP: 1.27, INR: 1 / 83, SAR: 1 / 3.75, AED: 1 / 3.6725, QAR: 1 / 3.64, OMR: 2.6, KWD: 3.25, BHD: 2.65,
  NOK: 1 / 10.5, MYR: 1 / 4.7, SEK: 1 / 10.6, DKK: 1 / 6.9,
};

const CURRENCY_ALIASES: Record<string, string> = {
  "$": "USD", "US$": "USD", USD: "USD", "€": "EUR", EUR: "EUR", "£": "GBP", GBP: "GBP", INR: "INR", RS: "INR", "RS.": "INR", "₹": "INR",
  SAR: "SAR", SR: "SAR", AED: "AED", DH: "AED", QAR: "QAR", OMR: "OMR", KWD: "KWD", BHD: "BHD", NOK: "NOK", KR: "NOK", MYR: "MYR",
  RM: "MYR", SEK: "SEK", DKK: "DKK",
};

/** Money pattern used by the rules extractor and by `parseMoney`. */
export const MONEY_RE =
  /(?:(US\$|USD|\$|€|EUR|£|GBP|INR|Rs\.?|₹|SAR|SR|AED|QAR|OMR|KWD|BHD|NOK|MYR|RM|SEK|DKK)\s?(\d[\d,]*(?:\.\d+)?)(?:\s?(billion|million|crores?|lakhs?|thousand|bn|mn|mln|cr)\b)?|(\d[\d,]*(?:\.\d+)?)\s?(billion|million|crores?|lakhs?|bn|mn)?\s?(USD|EUR|INR|SAR|AED|QAR|OMR|KWD|BHD|NOK|MYR|SEK|DKK)\b)/i;

/** Parse "USD 450 million", "Rs 1,250 crore", "35000000 NOK" → amount, currency and USD value. */
export function parseMoney(text: string | null | undefined): { amount: number; currency: string; usd: number | null } | null {
  if (!text) return null;
  const m = text.match(MONEY_RE);
  if (!m) return null;
  const cur = (m[1] ?? m[6] ?? "").toUpperCase();
  const num = Number((m[2] ?? m[4] ?? "").replace(/,/g, ""));
  const mult = MULTIPLIERS[(m[3] ?? m[5] ?? "").toLowerCase()] ?? 1;
  const currency = CURRENCY_ALIASES[cur] ?? cur;
  if (!Number.isFinite(num) || !currency) return null;
  const amount = num * mult;
  const rate = USD_PER_UNIT[currency];
  return { amount, currency, usd: rate ? Math.round(amount * rate) : null };
}

/** Parse a number with optional thousands separators. */
export function parseNumber(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Host without "www." for a URL, or null. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** publisher_key: registrable-ish domain group ("energy.economictimes.indiatimes.com" → "indiatimes.com"). */
export function publisherKeyFor(url: string): string {
  const host = hostOf(url);
  if (!host) return "unknown";
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const secondLevel = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);
  const tail = parts.slice(-2);
  if (secondLevel.has(tail[0]) && parts.length >= 3) return parts.slice(-3).join(".");
  return tail.join(".");
}

/** Canonical URL for dedupe: lowercase host, no fragment, no tracking params, no trailing slash. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref$|from$)/i.test(key)) u.searchParams.delete(key);
    }
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return url.trim();
  }
}
