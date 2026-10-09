/**
 * The material vocabulary behind free-text search: catalogue names and keywords, reviewed aliases,
 * the words buyers and suppliers actually type ("GI pipe", "MS plate", "LSAW"), standards, and a
 * reviewed "who buys this" list per product. Built on the server and passed to the search form.
 */
import { getCatalogue } from '@/mvp/config/buyers-config';
import { INPUT_ALIASES, MATERIAL_ACTIVITIES } from './material';
import { interpretMaterial, materialMismatch, normalizeWords, type MaterialEntry } from './interpret';

// Market words, reviewed per product (search hints only).
const MARKET_TERMS: Readonly<Record<string, readonly string[]>> = {
  'line-pipe': ['api 5l pipe', 'lsaw pipe', 'ssaw pipe', 'hsaw pipe', 'spiral pipe', 'spiral welded pipe', 'erw steel pipe', 'oil pipeline pipe', 'gas pipeline pipe', 'line pipes'],
  'cs-process-pipe': ['gi pipe', 'galvanized pipe', 'galvanised pipe', 'galvanized steel pipe', 'ms pipe', 'mild steel pipe', 'black steel pipe', 'seamless steel pipe', 'seamless pipes',
    'a53 pipe', 'a106 pipe', 'carbon steel seamless pipe', 'sch 40 pipe', 'carbon steel pipes'],
  'ss-duplex-pipe': ['stainless steel pipes', 'ss pipes', 'duplex steel pipe', '316 pipe', '304 pipe'],
  'alloy-pipe': ['p91 pipe', 'p11 pipe', 'p22 pipe', 'alloy pipes', 'boiler tubes'],
  octg: ['casing pipe', 'tubing pipe', 'oil well casing', 'drill pipes', 'casing and tubing pipe'],
  'di-pipe': ['ductile iron pipes', 'di pipes'],
  'hdpe-pipe': ['hdpe pipes', 'pe pipes', 'polyethylene pipes'],
  'grp-pipe': ['grp pipes', 'frp pipes', 'gre pipes'],
  'pvc-pipe': ['pvc pipes', 'upvc pipes', 'cpvc pipes'],
  'structural-steel': ['steel sections', 'i beam', 'h beam', 'hollow sections', 'shs', 'rhs', 'steel angles', 'steel channels'],
  plates: ['steel plates', 'steel sheet', 'ms plate', 'ms plates', 'chequered plate', 'boiler plate', 'pressure vessel plate', 'a516 plate', 'hr plate', 'steel coils'],
  rebar: ['steel bars', 'reinforcement bars', 'deformed bars', 'tmt bars'],
};

// Reviewed buyer segments: who procures this product for engineering work, top of the chain first.
const WHO_BUYS: Readonly<Record<string, readonly string[]>> = {
  'line-pipe': ['Pipeline EPC contractors', 'Pipeline-laying subcontractors', 'Oil, gas and water pipeline owners'],
  'cs-process-pipe': ['Refinery and petrochemical EPC contractors', 'Piping and mechanical subcontractors', 'Pipe spool fabrication shops', 'MEP contractors (galvanized pipe)'],
  'ss-duplex-pipe': ['Process plant EPC contractors', 'Desalination and water-treatment contractors', 'Food, pharma and chemical plant builders'],
  'alloy-pipe': ['Power plant EPC contractors', 'Boiler makers', 'Refinery piping contractors'],
  octg: ['Drilling contractors', 'Oil and gas operators', 'Well services companies'],
  'di-pipe': ['Water network contractors', 'Water and wastewater utilities', 'Infrastructure contractors'],
  'hdpe-pipe': ['Water and gas distribution contractors', 'Irrigation contractors', 'Utilities'],
  'grp-pipe': ['Water transmission and cooling-water contractors', 'Desalination plant builders', 'Utilities'],
  'pvc-pipe': ['MEP and plumbing contractors', 'Drainage contractors', 'Building contractors'],
  'bw-fittings': ['Piping and mechanical subcontractors', 'Pipe spool fabrication shops', 'Plant EPC contractors'],
  'forged-fittings': ['Piping and mechanical subcontractors', 'Pipe spool fabrication shops', 'Plant maintenance contractors'],
  flanges: ['Piping and mechanical subcontractors', 'Pipe spool fabrication shops', 'Plant and pipeline EPC contractors'],
  'induction-bends': ['Pipeline EPC contractors', 'Pipeline-laying subcontractors'],
  spools: ['Plant EPC contractors', 'Mechanical installation subcontractors'],
  'gate-globe-check': ['Plant and pipeline EPC contractors', 'Piping and mechanical subcontractors', 'Water network contractors'],
  'ball-valves': ['Pipeline EPC contractors', 'Gas distribution contractors', 'Plant EPC contractors'],
  'butterfly-valves': ['Water and wastewater contractors', 'HVAC and MEP contractors', 'Utilities'],
  'control-relief-valves': ['Plant EPC contractors', 'Instrumentation subcontractors', 'Plant maintenance contractors'],
  'coating-materials': ['Pipe coating plants', 'Pipeline EPC contractors', 'Coating subcontractors'],
  'field-joint-coating': ['Pipeline EPC contractors', 'Pipeline-laying subcontractors', 'Coating subcontractors'],
  'cathodic-protection': ['Pipeline EPC contractors', 'Corrosion-protection subcontractors', 'Tank and terminal builders'],
  paints: ['Painting and coating subcontractors', 'Steel structure fabricators', 'Marine and offshore yards'],
  'stud-bolts': ['Piping and mechanical subcontractors', 'Plant maintenance contractors', 'Fabrication shops'],
  gaskets: ['Piping and mechanical subcontractors', 'Plant maintenance contractors', 'Fabrication shops'],
  'welding-consumables': ['Fabrication shops', 'Pipeline and structural welding contractors', 'Shipyards'],
  abrasives: ['Fabrication shops', 'Blasting and painting subcontractors', 'Shipyards'],
  'structural-steel': ['Steel structure fabricators and erectors', 'Building and industrial contractors', 'Pre-engineered building suppliers'],
  plates: ['Pressure vessel and tank fabricators', 'Shipyards', 'Steel structure fabricators', 'Boiler makers'],
  rebar: ['Building and civil contractors', 'Infrastructure contractors', 'Precast concrete plants'],
  'gratings-handrails': ['Plant EPC contractors', 'Steel structure fabricators', 'Industrial platform builders'],
  cables: ['Electrical contractors', 'Substation and power EPC contractors', 'MEP contractors'],
  'cable-trays': ['Electrical and MEP contractors', 'Plant EPC contractors'],
  instruments: ['Instrumentation subcontractors', 'Plant EPC contractors', 'Plant maintenance contractors'],
  insulation: ['Insulation subcontractors', 'Plant EPC contractors', 'HVAC and MEP contractors'],
  pumps: ['Water and wastewater contractors', 'Plant EPC contractors', 'MEP contractors'],
};

// Words that mean a different material from a catalogue item with the same noun.
const EXCLUDE: Readonly<Record<string, readonly string[]>> = {
  cables: ['optical', 'fiber', 'fibre', 'telecom', 'data cable', 'network cable', 'lan cable'],
  plates: ['number plate', 'printing plate', 'license plate', 'licence plate'],
  instruments: ['musical', 'surgical', 'dental'],
  paints: ['wall paint', 'decorative paint', 'emulsion'],
};

/** Who buys a product, for search hints and the search form. */
export const whoBuys = (productId: string): string[] =>
  [...(WHO_BUYS[productId] ?? (MATERIAL_ACTIVITIES[productId] ?? []).slice(0, 3).map((a) => `Companies doing ${a}`))];

let cached: MaterialEntry[] | null = null;
export function materialCatalogue(): MaterialEntry[] {
  if (cached) return cached;
  cached = getCatalogue().items.map((item) => {
    const standards = (item.standards ?? []).map(normalizeWords);
    const terms = [...new Set([item.shortName, ...item.keywords, ...(INPUT_ALIASES[item.id] ?? []), ...(MARKET_TERMS[item.id] ?? [])].map(normalizeWords).filter(Boolean))];
    return { id: item.id, name: item.name, shortName: item.shortName, category: item.category, terms, standards, whoBuys: whoBuys(item.id), exclude: [...(EXCLUDE[item.id] ?? [])] };
  });
  return cached;
}

export interface MaterialInterpretation {
  status: 'resolved' | 'clarification' | 'unsupported';
  originalKeyword: string;
  productId: string | null;
  label: string | null;
  activities: string[];
  question: string | null;
  candidateIds: string[];
}
/** @deprecated name kept for callers; same as normalizeWords. */
export const normalizeMaterialInput = normalizeWords;

/**
 * Server check for a search: the typed words plus the chosen product type.
 * The user's chosen type is trusted unless the words clearly name a different material
 * ("power cables" with line pipe). Without a chosen type, clear words resolve on their own and
 * generic words ask for a type. No AI call.
 */
export function resolveMaterial(query: string, selectedProductId?: string): MaterialInterpretation {
  const originalKeyword = query.trim();
  const catalogue = materialCatalogue();
  const resolved = (id: string): MaterialInterpretation => {
    const entry = catalogue.find((e) => e.id === id)!;
    return { status: 'resolved', originalKeyword, productId: id, label: entry.shortName, activities: [...(MATERIAL_ACTIVITIES[id] ?? [])], question: null, candidateIds: [id] };
  };
  const ask = (status: 'clarification' | 'unsupported', question: string, candidateIds: string[]): MaterialInterpretation =>
    ({ status, originalKeyword, productId: null, label: null, activities: [], question, candidateIds });
  if (selectedProductId) {
    if (!catalogue.some((e) => e.id === selectedProductId)) return ask('unsupported', 'Choose a product type from the list.', []);
    const chosen = catalogue.find((e) => e.id === selectedProductId)!;
    const { mismatch, suggestion } = materialMismatch(catalogue, query, selectedProductId);
    // A specific word outside the catalogue ("cement") is not silently searched as the chosen type.
    const words = normalizeWords(query).split(' ').filter((w) => w.length >= 3);
    const vocabulary = new Set(catalogue.flatMap((e) => [...e.terms, normalizeWords(e.name)]).flatMap((t) => t.split(' ')));
    const unknown = words.length > 0 && words.every((w) => !vocabulary.has(w) && !vocabulary.has(w.replace(/s$/, '')));
    if (unknown && interpretMaterial(catalogue, query).confidence === 'none')
      return ask('unsupported', `"${originalKeyword}" is not in your product list yet. Choose the closest product type.`, []);
    if (mismatch && suggestion) {
      return ask('clarification', `You typed "${originalKeyword}", which looks like ${suggestion.label}, but the chosen type is ${chosen.shortName}. Which one do you sell?`, [selectedProductId, suggestion.id]);
    }
    return resolved(selectedProductId);
  }
  const reading = interpretMaterial(catalogue, query);
  if (reading.best && (reading.confidence === 'exact' || reading.confidence === 'strong')) return resolved(reading.best.id);
  return reading.choices.length
    ? ask('clarification', reading.family ? `${reading.family} has several types. Choose the one you sell.` : 'Choose the product type closest to what you sell.', reading.choices.map((c) => c.id))
    : ask('unsupported', 'This material is not in your product list yet. Choose the closest product type.', []);
}
