/**
 * The exact material the user typed (docs/mvp/19 Phase 1): "Welded Stainless Steel Pipes 316L ASTM A312
 * 2 inch" → method welded, grade 316L, standard ASTM A312, size 2 inch. The catalogue item stays the base
 * product; the spec sharpens the searches, the rating and the wording, and ranks (never filters) buyers.
 * Pure and deterministic, so it can be derived from the stored search words at any time.
 */
export type MakeMethod = 'welded' | 'seamless' | 'erw' | 'efw' | 'lsaw' | 'ssaw' | 'saw';
export interface MaterialSpec {
  method: MakeMethod | null;
  grades: string[];
  standards: string[];
  sizes: string[];
  finishes: string[];
}

const METHOD: [RegExp, MakeMethod][] = [
  [/\bseamless\b|\bsmls\b/i, 'seamless'],
  [/\blsaw\b/i, 'lsaw'], [/\b(?:ssaw|hsaw|spiral(?:ly)?[- ]welded)\b/i, 'ssaw'], [/\bsaw\b/i, 'saw'],
  [/\berw\b|\belectric[- ]resistance[- ]welded\b/i, 'erw'], [/\befw\b|\belectric[- ]fusion[- ]welded\b/i, 'efw'],
  [/\bwelded\b/i, 'welded'],
];
const GRADE = /\b(?:30[49]L?|31[06](?:L|Ti|H)?|317L|321H?|347H?|310S?|904L|409|410|430|2205|2507|(?:super )?duplex|X(?:42|46|52|56|60|65|70|80)|L(?:245|290|360|415|450|485|555)|P(?:5|9|11|22|91|92)|WPB|Gr(?:ade)?\.? ?[ABC]\b|S355\w*|S275\w*|SA[- ]?516(?:[- ]?(?:Gr\.? ?)?(?:60|70))?|A36|E250|IS ?2062)\b/gi;
const STANDARD = /\b(?:ASTM ?A ?\d{2,4}|A(?:53|106|179|192|213|249|269|270|312|333|335|358|500|516|671|672|691|778|790|928)\b|API ?5(?:L|CT)|PSL ?[12]|EN ?10(?:025|028|216|217|219|255|296|297)|DIN ?\d{4,5}|IS ?\d{3,5}|BS ?\d{3,5}|JIS ?G ?\d{4}|ISO ?\d{3,5}|ASME ?B ?36\.(?:10|19)M?|AWWA ?C\d{3})\b/gi;
const SIZE = /\b\d+(?:[./]\d+)?\s?(?:"|inch(?:es)?|in\b|mm\b|NB\b|DN ?\d+|NPS\b)|\bDN ?\d{2,4}\b|\bNPS ?\d+(?:[./]\d+)?\b|\bsch(?:edule)?\.? ?(?:\d{1,3}S?|XXS|XS|STD)\b/gi;
const FINISH = /\b(?:polished|mirror[- ]finish|pickled|annealed|bright annealed|galvani[sz]ed|hot[- ]dip|GI|black|painted|FBE|3LPE|3LPP|epoxy[- ]coated|lined|bevel(?:l)?ed)\b/gi;

const uniq = (values: string[]) => [...new Map(values.map((v) => [v.toLowerCase().replace(/\s+/g, ' '), v.replace(/\s+/g, ' ').trim()])).values()];

export function parseMaterialSpec(text: string): MaterialSpec {
  const t = text ?? '';
  return {
    method: METHOD.find(([re]) => re.test(t))?.[1] ?? null,
    grades: uniq(t.match(GRADE) ?? []).slice(0, 4),
    standards: uniq((t.match(STANDARD) ?? []).map((s) => (/^A\d/i.test(s) ? `ASTM ${s.toUpperCase()}` : s.toUpperCase().replace(/^ASTM ?A ?/, 'ASTM A')))).slice(0, 4),
    sizes: uniq(t.match(SIZE) ?? []).slice(0, 4),
    finishes: uniq(t.match(FINISH) ?? []).slice(0, 3),
  };
}

export const hasSpec = (s: MaterialSpec) => Boolean(s.method || s.grades.length || s.standards.length || s.sizes.length || s.finishes.length);

const METHOD_WORD: Record<MakeMethod, string> = { welded: 'Welded', seamless: 'Seamless', erw: 'ERW', efw: 'EFW', lsaw: 'LSAW', ssaw: 'SSAW (spiral)', saw: 'SAW' };
/** "Welded · 316L · ASTM A312 · 2 inch" for chips and labels. */
export function specChips(s: MaterialSpec): string[] {
  return [s.method ? METHOD_WORD[s.method] : null, ...s.grades, ...s.standards, ...s.sizes, ...s.finishes].filter((v): v is string => Boolean(v));
}

/**
 * Who uses this variant: the kinds of work that buy it. Searched alongside the catalogue's buyers so a
 * "welded stainless" search reaches water, food and pharma plant builders, not only seamless users.
 */
const USES: Record<string, Partial<Record<MakeMethod | 'any', string[]>>> = {
  'ss-duplex-pipe': {
    welded: ['water treatment and desalination plants', 'food, dairy and beverage plants', 'pharmaceutical plants', 'HVAC and building services piping'],
    efw: ['water treatment and desalination plants', 'chemical process plants'],
    erw: ['water and building services piping', 'food and beverage plants'],
    seamless: ['high-pressure process piping in refineries and petrochemical plants', 'heat exchangers and boilers', 'oil and gas instrumentation lines'],
    any: ['chemical and petrochemical process plants', 'water treatment and desalination plants', 'food and pharmaceutical plants'],
  },
  'cs-process-pipe': {
    seamless: ['refinery and petrochemical process piping', 'boiler and power plant piping'],
    erw: ['building services and firefighting piping', 'water distribution'],
    welded: ['firefighting, plumbing and building services', 'structural and piling work'],
    any: ['process plant piping', 'building services and firefighting piping'],
  },
  'line-pipe': {
    lsaw: ['large-diameter oil and gas trunk pipelines', 'offshore pipelines'],
    ssaw: ['water transmission pipelines', 'piling'],
    erw: ['gas distribution networks', 'small-diameter flowlines'],
    seamless: ['high-pressure flowlines and subsea pipelines'],
    any: ['oil and gas pipelines', 'gas distribution networks'],
  },
};
export function specUses(productId: string, s: MaterialSpec): string[] {
  const uses = USES[productId];
  if (!uses) return [];
  return (s.method && uses[s.method]) || uses.any || [];
}

/** Variant words for search queries: "welded stainless steel pipe ASTM A312". */
export function specSearchWords(baseName: string, s: MaterialSpec): string {
  const method = s.method ? METHOD_WORD[s.method].replace(' (spiral)', '').toLowerCase() : '';
  return [method, baseName, s.standards[0] ?? s.grades[0] ?? ''].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** One line for the AI rater: what exactly is being sold and who uses that variant. */
export function specBrief(baseName: string, productId: string, s: MaterialSpec): string {
  const chips = specChips(s);
  const uses = specUses(productId, s);
  return `${chips.length ? `${chips.join(', ')} ` : ''}${baseName}${uses.length ? `; typically used in ${uses.join('; ')}` : ''}`;
}
