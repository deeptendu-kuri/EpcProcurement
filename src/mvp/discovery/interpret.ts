/**
 * Free-text material search, like a search engine: "steel pipe", "seamless pipe ASTM A106",
 * "casing and tubing", "GI pipe", "steel plates". Pure and synchronous, so the search form can
 * interpret as the user types and the server can validate the same way. No AI call.
 *
 * Generic words ("steel pipe", "pipe", "valves") return a family with one-click product types
 * instead of a rejection; specific words (standards, grades, process names) pick the type.
 */

export interface MaterialEntry {
  id: string; name: string; shortName: string; category: string;
  /** Lower-case search terms: catalogue keywords, aliases, market words and standards. */
  terms: string[]; standards: string[];
  /** Who typically buys this product, in plain words. */
  whoBuys: string[];
  /** Words that mean a different material ("optical fiber cable" is not a power cable). */
  exclude?: string[];
}
export interface MaterialChoice { id: string; label: string; detail: string; score: number }
export interface MaterialReading {
  text: string;
  /** Best product for the words, pre-selected in the form; null when nothing fits. */
  best: MaterialChoice | null;
  /** Product types to offer as one-click choices (the family, or close alternatives). */
  choices: MaterialChoice[];
  /** Plain-language family name when the words are generic ("Steel pipe"). */
  family: string | null;
  confidence: 'exact' | 'strong' | 'broad' | 'none';
  whoBuys: string[];
}

export const normalizeWords = (value: string) =>
  value.normalize('NFKC').toLowerCase().replace(/[–—_-]/g, ' ').replace(/[^\p{L}\p{N}./ ]/gu, ' ').replace(/\s+/g, ' ').trim();
const has = (text: string, phrase: string) => phrase.length > 0 && new RegExp(`(?:^|\\s)${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s)`).test(text);
// Words that say "what kind of thing" without naming a type.
const GENERIC = new Set(['steel', 'pipe', 'pipes', 'piping', 'tube', 'tubes', 'valve', 'valves', 'fitting', 'fittings', 'cable', 'cables', 'material', 'materials',
  'supply', 'supplier', 'suppliers', 'buyers', 'for', 'and', 'of', 'the', 'products', 'product', 'metal', 'industrial', 'construction', 'mild', 'ms', 'carbon', 'cs']);
const FAMILIES: { name: string; when: RegExp; ids: string[] }[] = [
  { name: 'Steel pipe', when: /\b(?:steel|ms|mild steel|carbon steel|cs|metal)\s+(?:pipe|pipes|piping|tube|tubes)\b/, ids: ['line-pipe', 'cs-process-pipe', 'ss-duplex-pipe', 'alloy-pipe', 'octg'] },
  { name: 'Pipe', when: /^(?:pipe|pipes|piping|tubes?)$/, ids: ['line-pipe', 'cs-process-pipe', 'ss-duplex-pipe', 'alloy-pipe', 'octg', 'di-pipe', 'hdpe-pipe', 'grp-pipe', 'pvc-pipe'] },
  { name: 'Valves', when: /^(?:industrial |pipeline |process )?valves?$/, ids: ['gate-globe-check', 'ball-valves', 'butterfly-valves', 'control-relief-valves'] },
  { name: 'Fittings and flanges', when: /^(?:pipe )?(?:fittings?|flanges? and fittings?)$/, ids: ['bw-fittings', 'forged-fittings', 'flanges', 'induction-bends', 'spools'] },
  { name: 'Steel products', when: /^(?:steel|ms|mild steel|steel products)$/, ids: ['structural-steel', 'plates', 'rebar', 'line-pipe', 'cs-process-pipe'] },
  { name: 'Coatings', when: /^(?:coatings?|pipe coatings?|corrosion protection)$/, ids: ['coating-materials', 'field-joint-coating', 'cathodic-protection', 'paints'] },
];

function scoreEntry(entry: MaterialEntry, text: string): number {
  if (entry.exclude?.some((w) => has(text, w))) return 0;
  let score = 0;
  const exact = [entry.id.replace(/-/g, ' '), normalizeWords(entry.shortName), normalizeWords(entry.name), ...entry.terms].some((t) => t === text);
  if (exact) score = 100;
  for (const standard of entry.standards) if (has(text, standard) || has(text, standard.replace(/^(?:astm|api|asme|iso|en|bs|aws|nace|awwa|iec)\s+/, ''))) score = Math.max(score, 90);
  for (const term of entry.terms) if (term.length >= 3 && has(text, term)) score = Math.max(score, 60 + Math.min(30, term.length));
  // The words appear whole inside a longer product term ("wire" in "welding wire", never "cement" in "reinforcement").
  if (text.length >= 4 && entry.terms.some((t) => t.length > text.length && has(t, text))) score = Math.max(score, 45);
  // Word overlap for loose phrasing ("pipes for gas pipeline").
  const words = text.split(' ').filter((w) => w.length >= 3 && !GENERIC.has(w));
  if (words.length) {
    const vocab = new Set([...entry.terms, normalizeWords(entry.name)].flatMap((t) => t.split(' ')));
    const hit = words.filter((w) => vocab.has(w) || vocab.has(w.replace(/s$/, ''))).length;
    score = Math.max(score, Math.round((hit / words.length) * 35));
  }
  return score;
}

export function interpretMaterial(catalogue: MaterialEntry[], input: string): MaterialReading {
  const text = normalizeWords(input);
  const empty: MaterialReading = { text: input, best: null, choices: [], family: null, confidence: 'none', whoBuys: [] };
  if (text.length < 2) return empty;
  const choice = (entry: MaterialEntry, score: number): MaterialChoice => ({ id: entry.id, label: entry.shortName.charAt(0).toUpperCase() + entry.shortName.slice(1), detail: entry.name, score });
  const scored = catalogue.map((entry) => ({ entry, score: scoreEntry(entry, text) })).sort((a, b) => b.score - a.score);
  const top = scored[0];
  // Generic words only ("steel pipe", "pipe", "valves"): offer the family's types and pre-select
  // the best-matching member ("carbon steel pipe" → process pipe).
  const specific = text.split(' ').filter((w) => w.length >= 3 && !GENERIC.has(w));
  const family = specific.length ? null : FAMILIES.find((f) => f.when.test(text)) ?? null;
  if (family) {
    const members = family.ids.map((id) => scored.find((s) => s.entry.id === id)!).filter(Boolean);
    const lead = [...members].sort((a, b) => b.score - a.score)[0];
    return { text: input, best: choice(lead.entry, lead.score), choices: members.map((m) => choice(m.entry, m.score)), family: family.name, confidence: 'broad', whoBuys: lead.entry.whoBuys };
  }
  if (!top || top.score < 30) {
    // Nothing fits well: offer the closest few, pre-select none.
    const closest = scored.filter((s) => s.score > 0).slice(0, 4);
    return { ...empty, choices: closest.map((s) => choice(s.entry, s.score)) };
  }
  const confidence = top.score >= 100 ? 'exact' : top.score >= 60 ? 'strong' : 'broad';
  // Close alternatives in the same category stay one click away.
  const alternatives = scored.filter((s) => s.entry.id !== top.entry.id && s.entry.category === top.entry.category && s.score >= Math.max(30, top.score - 30)).slice(0, 4);
  const sameCategory = alternatives.length ? alternatives : scored.filter((s) => s.entry.id !== top.entry.id && s.entry.category === top.entry.category).slice(0, 4);
  return { text: input, best: choice(top.entry, top.score), choices: [choice(top.entry, top.score), ...sameCategory.map((s) => choice(s.entry, s.score))],
    family: null, confidence, whoBuys: top.entry.whoBuys };
}

/** Server check: does the chosen product fit the typed words? Only a confident, different material is a mismatch. */
export function materialMismatch(catalogue: MaterialEntry[], input: string, productId: string): { mismatch: boolean; suggestion: MaterialChoice | null } {
  const reading = interpretMaterial(catalogue, input);
  if (!reading.best || reading.confidence === 'none' || reading.confidence === 'broad') return { mismatch: false, suggestion: null };
  if (reading.best.id === productId || reading.choices.some((c) => c.id === productId)) return { mismatch: false, suggestion: null };
  const chosen = catalogue.find((e) => e.id === productId);
  // The typed words may still mention the chosen product ("line pipe and fittings").
  if (chosen && chosen.terms.some((t) => t.length >= 3 && has(normalizeWords(input), t))) return { mismatch: false, suggestion: null };
  return { mismatch: reading.best.score >= 60, suggestion: reading.best };
}
