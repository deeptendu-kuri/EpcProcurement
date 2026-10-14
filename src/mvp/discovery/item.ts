/**
 * Universal search (docs/mvp/22 §3.1): any typed product is a search item with a stable id ("q:pressure-vessel").
 * The id carries the words, so every step (and the email automation, later) can rebuild the item without the
 * catalogue. Catalogue products keep their own ids and extra knowledge; this module never imports the catalogue.
 */
import type { CatalogueItem } from '@/mvp/config/buyers-config';

export const SEARCH_ITEM_PREFIX = 'q:';
const MAX_SLUG = 80;

/** Lower case, accents removed, letters, digits and single spaces only. */
export function itemWordsOf(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
/** "API 660 Heat Exchangers" → "q:api-660-heat-exchangers". */
export function searchItemId(text: string): string {
  const words = itemWordsOf(text).slice(0, MAX_SLUG).trim();
  return `${SEARCH_ITEM_PREFIX}${words.replace(/ /g, '-') || 'item'}`;
}
export function isSearchItemId(id: string | null | undefined): id is string {
  return typeof id === 'string' && id.startsWith(SEARCH_ITEM_PREFIX) && /^q:[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(id) && id.length <= SEARCH_ITEM_PREFIX.length + MAX_SLUG;
}
/** The typed words back from the id ("q:centrifugal-fans" → "centrifugal fans"). */
export function searchItemName(id: string): string {
  return id.slice(SEARCH_ITEM_PREFIX.length).replace(/-/g, ' ');
}

const STANDARD = /\basme\s+(?:sec(?:tion)?\.?\s*)?(?:viii|vii|vi|iv|ix|v|i{1,3})\b(?:\s*div(?:ision)?\.?\s*\d)?|\b(?:astm|api|asme|en|iso|iec|bs|din|awwa|nace|tema|mss|ansi|ieee|is)\s?[a-z]?\d[\w.]*/gi;
/** Standards named in the words ("API 660", "ASME Sec VIII Div 1"). */
export function standardsIn(text: string): string[] {
  return [...new Set((text.match(STANDARD) ?? []).map((s) => s.replace(/\s+/g, ' ').trim().toUpperCase()))];
}
/** Singular and plural of the last word: fans ↔ fan, boxes ↔ box, exchangers ↔ exchanger. */
function numberForms(phrase: string): string[] {
  const words = phrase.split(' ');
  const last = words.at(-1) ?? '';
  if (last.length < 3 || /\d/.test(last)) return [phrase];
  const head = words.slice(0, -1);
  const forms = new Set([last]);
  if (/(?:ss|us|is)$/.test(last)) forms.add(`${last}es`);
  else if (/(?:ches|shes|xes|sses)$/.test(last)) forms.add(last.slice(0, -2));
  else if (/ies$/.test(last)) forms.add(`${last.slice(0, -3)}y`);
  else if (/s$/.test(last)) forms.add(last.slice(0, -1));
  else if (/(?:ch|sh|x)$/.test(last)) forms.add(`${last}es`);
  else if (/[^aeiou]y$/.test(last)) forms.add(`${last.slice(0, -1)}ies`);
  else forms.add(`${last}s`);
  return [...forms].map((w) => [...head, w].join(' '));
}
/** Words that say nothing about the item ("supply of", "buyers", "in UAE"). */
const NOISE = new Set(['supply', 'supplies', 'supplier', 'suppliers', 'buyer', 'buyers', 'tender', 'tenders', 'for', 'of', 'and', 'the', 'in', 'with', 'new', 'manufacturer', 'manufacturers']);
/**
 * The phrases a page must contain to name the item: the typed words (singular and plural), and the same words
 * without their standard ("api 660 heat exchanger" → "heat exchanger") when two or more words remain.
 */
export function itemPhrases(text: string): string[] {
  const words = itemWordsOf(text).split(' ').filter((w) => w && !NOISE.has(w));
  const phrase = words.join(' ');
  if (!phrase) return [];
  const bare = itemWordsOf(phrase.replace(STANDARD, ' ')).split(' ').filter((w) => w && !/^\d/.test(w) && !/^(?:sec|section|div|division|viii|vii|ix)$/.test(w)).join(' ');
  return [...new Set([...numberForms(phrase), ...(bare !== phrase && bare.split(' ').length >= 2 ? numberForms(bare) : [])])];
}

/** Other names from a run's search brief ("shell and tube heat exchanger"), registered when a job loads its run. */
const registered = new Map<string, string[]>();
export function registerSearchItemTerms(id: string | null | undefined, terms: readonly string[] | undefined): void {
  if (!isSearchItemId(id) || !terms?.length) return;
  const clean = [...new Set(terms.map((t) => itemWordsOf(t)).filter((t) => t.length >= 4))].slice(0, 12);
  if (clean.length) registered.set(id, clean);
}
export function registeredSearchItemTerms(id: string): string[] {
  return registered.get(id) ?? [];
}

/** A typed item shaped like a catalogue entry, so every read-only step works unchanged. */
export function searchItemFromId(id: string): CatalogueItem {
  const name = searchItemName(id);
  const keywords = [...new Set([...itemPhrases(name), ...registeredSearchItemTerms(id).flatMap(numberForms)])];
  return { id, category: 'Searched item', name, shortName: name, standards: standardsIn(name), hs: [], keywords };
}
