/**
 * Deterministic quote check (06 §5). Every AI or rules fact must pass before it is stored:
 * 1. the normalised quote occurs in the normalised document text (exact, or a near-exact window
 *    match that tolerates whitespace/OCR noise only);
 * 2. the value is backed by the quote, by field kind:
 *    - name / text / enum: the normalised value is a substring of the normalised quote (no numeric fallback);
 *    - number (money, sizes, quantities): EVERY amount in the value, scaled ("450 million" = 4.5e8),
 *      appears in the quote ("450 million" ≈ "450,000,000", "24-inch" ≈ "24"), same currency;
 *    - date: the quote names the same day; a month-only quote ("March 2026") backs only a
 *      month-precision value, never an invented day; a bare year never backs a date.
 * Returns the character offsets of the quote in the ORIGINAL text so evidence can point back to it.
 */
import type { ValueKind } from "./agreement";
import { normaliseForMatch, parseMoney, ratio } from "./text";

export interface QuoteCheckResult {
  ok: boolean;
  /** Offsets in the original document text. */
  start: number | null;
  end: number | null;
  reason?: "quote_not_found" | "value_not_in_quote" | "empty";
}

/** Normalised text plus a map from each normalised index to its original index. */
function normaliseWithMap(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let lastWasSpace = true;
  for (let i = 0; i < text.length; i++) {
    if (!/\s/.test(text[i])) {
      const piece = normaliseForMatch(text[i]);
      for (const ch of piece) {
        norm += ch;
        map.push(i);
      }
      if (piece) lastWasSpace = false;
      continue;
    }
    if (!lastWasSpace) {
      norm += " ";
      map.push(i);
      lastWasSpace = true;
    }
  }
  if (norm.endsWith(" ")) {
    norm = norm.slice(0, -1);
    map.pop();
  }
  return { norm, map };
}

// Many facts are checked against the same document: keep the last few normalisations.
const cache = new Map<string, { norm: string; map: number[] }>();
function cachedNormalise(text: string): { norm: string; map: number[] } {
  const hit = cache.get(text);
  if (hit) return hit;
  const value = normaliseWithMap(text);
  if (cache.size >= 4) cache.delete(cache.keys().next().value as string);
  cache.set(text, value);
  return value;
}

const NUMBER_WORDS: Record<string, number> = {
  thousand: 1e3, lakh: 1e5, lakhs: 1e5, million: 1e6, mn: 1e6, mln: 1e6, crore: 1e7, crores: 1e7, billion: 1e9, bn: 1e9,
};

/** All numbers in a string, including scaled forms ("1.2 billion" → 1.2e9 and 1.2). */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(thousand|lakhs?|million|mn|mln|crores?|billion|bn)?/gi;
  for (const m of text.matchAll(re)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    out.push(n);
    const mult = m[2] ? NUMBER_WORDS[m[2].toLowerCase()] : undefined;
    if (mult) out.push(n * mult);
  }
  return out;
}

/** The amounts a value states: one per number, scaled when a scale word follows ("1.2 billion" → 1.2e9 only). */
function amountsIn(text: string): number[] {
  const out: number[] = [];
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(thousand|lakhs?|million|mn|mln|crores?|billion|bn)?/gi;
  for (const m of text.matchAll(re)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const mult = m[2] ? NUMBER_WORDS[m[2].toLowerCase()] : undefined;
    out.push(mult ? n * mult : n);
  }
  return out;
}

const close = (x: number, y: number) => (x === 0 ? y === 0 : Math.abs(x - y) / Math.abs(x) <= 0.01);

/**
 * True when EVERY amount in `value` (scaled: "1.2 billion" is 1.2e9, not 1.2) equals (within 1%) a
 * number in `quote` (raw or scaled), and a currency named in both sides is the same.
 * "14,500,000,000" ≈ "Rs 1,450 crore"; "USD 1.2 billion" is NOT backed by "1.2 km of pipe".
 */
export function numericEquivalent(value: string, quote: string): boolean {
  const a = amountsIn(value);
  const b = numbersIn(quote);
  if (!a.length || !b.length) return false;
  if (!a.every((x) => b.some((y) => close(x, y)))) return false;
  const moneyValue = parseMoney(value);
  const moneyQuote = parseMoney(quote);
  if (moneyValue && moneyQuote && moneyValue.currency !== moneyQuote.currency) return false;
  return true;
}

// ───────────────────────── dates ─────────────────────────

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

interface DatePart {
  y: number;
  m: number;
  /** null when the text names only a month and year. */
  d: number | null;
}

function datePart(y: number, m: number, d: number | null): DatePart | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || (d !== null && (d < 1 || d > 31))) return null;
  return { y, m, d };
}

const monthIndex = (name: string) => MONTHS.indexOf(name.toLowerCase().slice(0, 3)) + 1;

/** Every date written in `text`: ISO, "15 March 2026", "March 15, 2026", "15/03/2026" (D/M/Y), "March 2026". */
export function datesIn(text: string): DatePart[] {
  const out: DatePart[] = [];
  const push = (p: DatePart | null) => {
    if (p) out.push(p);
  };
  const MON = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
  // Remove each full match once consumed so "March 2026" inside "15 March 2026" is not counted twice.
  let rest = text;
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => DatePart | null) => {
    rest = rest.replace(re, (...args) => {
      push(fn(args.slice(0, -2) as unknown as RegExpMatchArray));
      return " ";
    });
  };
  take(/(\d{4})-(\d{2})-(\d{2})/g, (m) => datePart(+m[1], +m[2], +m[3]));
  take(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON},?\\s+(\\d{4})`, "gi"), (m) => datePart(+m[3], monthIndex(m[2]), +m[1]));
  take(new RegExp(`${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`, "gi"), (m) => datePart(+m[3], monthIndex(m[1]), +m[2]));
  take(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/g, (m) => datePart(+m[3], +m[2], +m[1]));
  take(new RegExp(`\\b${MON}\\s+(\\d{4})\\b`, "gi"), (m) => datePart(+m[2], monthIndex(m[1]), null));
  take(/\b(\d{4})-(\d{2})\b/g, (m) => datePart(+m[1], +m[2], null));
  return out;
}

/**
 * A date value is backed by the quote when the quote names the same day, or (when the quote names
 * only a month) the same month. "15 March 2026" is NOT backed by "closing in March 2026" unless the
 * value itself is month-precision; a bare year never backs a date.
 */
export function dateBackedByQuote(value: string, quote: string): boolean {
  const [v] = datesIn(value);
  if (!v) return false;
  return datesIn(quote).some((q) => {
    if (q.y !== v.y || q.m !== v.m) return false;
    if (q.d === null) return v.d === null;
    return v.d === null || v.d === q.d;
  });
}

/** Find a window in `hay` whose similarity to `needle` is ≥ minRatio (only for quotes ≥ 20 chars). */
function fuzzyFind(needle: string, hay: string, minRatio: number): number | null {
  if (needle.length < 20 || needle.length > 600) return null;
  const anchor = needle.slice(0, 8);
  let best: { pos: number; score: number } | null = null;
  let from = 0;
  // Anchor on the first 8 chars (cheap), then compare a window of the same length ± a few chars.
  for (let guard = 0; guard < 200; guard++) {
    const pos = hay.indexOf(anchor, from);
    if (pos < 0) break;
    for (const delta of [0, -2, 2, -4, 4]) {
      const window = hay.slice(pos, pos + needle.length + delta);
      const score = ratio(needle, window);
      if (score >= minRatio && (!best || score > best.score)) best = { pos, score };
    }
    from = pos + 1;
  }
  return best ? best.pos : null;
}

/**
 * Verify one fact against the document text.
 * @param value the extracted value (e.g. "Example Pipelines Ltd", "24", "USD 450 million")
 * @param quote the verbatim fragment the model says contains the value
 * @param docText the full stored document text
 * @param kind the field kind (decides how the value must be backed by the quote; default strict text)
 */
export function verifyQuote(
  value: string | null | undefined,
  quote: string | null | undefined,
  docText: string,
  kind: ValueKind = "text",
): QuoteCheckResult {
  if (!value || !quote || !value.trim() || !quote.trim()) return { ok: false, start: null, end: null, reason: "empty" };
  const nq = normaliseForMatch(quote);
  const { norm, map } = cachedNormalise(docText);
  let pos = norm.indexOf(nq);
  if (pos < 0) pos = fuzzyFind(nq, norm, 97) ?? -1;
  if (pos < 0) return { ok: false, start: null, end: null, reason: "quote_not_found" };
  if (!valueBackedByQuote(value, quote, kind)) {
    return { ok: false, start: null, end: null, reason: "value_not_in_quote" };
  }
  const endIndex = Math.min(pos + nq.length - 1, map.length - 1);
  return { ok: true, start: map[pos] ?? null, end: endIndex >= 0 ? map[endIndex] + 1 : null };
}

/** Is `value` stated by `quote` for a field of this kind? (see the file header) */
export function valueBackedByQuote(value: string, quote: string, kind: ValueKind): boolean {
  const hasDigits = /\d/.test(value);
  if (kind === "date" && datesIn(value).length) return dateBackedByQuote(value, quote);
  if (kind === "number" && hasDigits) return numericEquivalent(value, quote);
  return normaliseForMatch(quote).includes(normaliseForMatch(value));
}
