/**
 * Deterministic quote check (06 §5). Every AI or rules fact must pass before it is stored:
 * 1. the normalised quote occurs in the normalised document text (exact, or a near-exact window
 *    match that tolerates whitespace/OCR noise only);
 * 2. the normalised value occurs inside the normalised quote, or is numerically equivalent to a
 *    number in the quote ("450 million" ≈ "450,000,000", "24-inch" ≈ "24").
 * Returns the character offsets of the quote in the ORIGINAL text so evidence can point back to it.
 */
import { normaliseForMatch, ratio } from "./text";

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

/** True when some number in `value` equals (within 1%) some number in `quote`. */
export function numericEquivalent(value: string, quote: string): boolean {
  const a = numbersIn(value);
  const b = numbersIn(quote);
  if (!a.length || !b.length) return false;
  return a.some((x) => b.some((y) => (x === 0 ? y === 0 : Math.abs(x - y) / Math.abs(x) <= 0.01)));
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
 */
export function verifyQuote(value: string | null | undefined, quote: string | null | undefined, docText: string): QuoteCheckResult {
  if (!value || !quote || !value.trim() || !quote.trim()) return { ok: false, start: null, end: null, reason: "empty" };
  const nq = normaliseForMatch(quote);
  const { norm, map } = cachedNormalise(docText);
  let pos = norm.indexOf(nq);
  if (pos < 0) pos = fuzzyFind(nq, norm, 97) ?? -1;
  if (pos < 0) return { ok: false, start: null, end: null, reason: "quote_not_found" };
  const nv = normaliseForMatch(value);
  if (!nq.includes(nv) && !numericEquivalent(value, quote)) {
    return { ok: false, start: null, end: null, reason: "value_not_in_quote" };
  }
  const endIndex = Math.min(pos + nq.length - 1, map.length - 1);
  return { ok: true, start: map[pos] ?? null, end: endIndex >= 0 ? map[endIndex] + 1 : null };
}
