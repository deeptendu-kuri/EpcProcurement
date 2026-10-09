import { getCatalogue, getCatalogueItem } from "@/mvp/config/buyers-config";

/** Reviewed consuming activities. Search hints, never proof of demand or seller capabilities. */
export const MATERIAL_ACTIVITIES: Readonly<Record<string, readonly string[]>> = {
  "line-pipe": ["pipeline construction", "gas transmission", "oil pipeline", "pipeline installation", "oil & gas pipelines", "cross-country pipeline", "pipeline EPC", "transmission pipeline", "gas pipeline laying", "CGD network"],
  "cs-process-pipe": ["process piping", "plant piping", "mechanical piping"],
  "ss-duplex-pipe": ["stainless piping", "stainless steel piping", "duplex piping"],
  "alloy-pipe": ["alloy piping", "power plant piping", "boiler piping"],
  octg: ["well drilling", "drilling contractor", "well completion"],
  "di-pipe": ["ductile iron pipeline installation", "water pipeline construction", "water network installation"],
  "hdpe-pipe": ["HDPE installation", "HDPE pipeline", "polyethylene pipeline", "HDPE pipe laying"],
  "grp-pipe": ["GRP installation", "GRE piping", "fiberglass pipeline", "GRP pipe installation"],
  "pvc-pipe": ["PVC pipe installation", "plumbing installation", "drainage installation"],
  "bw-fittings": ["process piping fabrication", "pipeline installation", "pipe spool fabrication"],
  "forged-fittings": ["high pressure piping", "process piping fabrication", "socket weld piping"],
  flanges: ["piping fabrication", "pipeline installation", "process plant piping"],
  "induction-bends": ["pipeline construction", "pipeline bending", "gas transmission pipeline"],
  spools: ["piping installation", "process plant construction", "mechanical piping installation"],
  "gate-globe-check": ["industrial valve installation", "process piping", "water network installation"],
  "ball-valves": ["gas pipeline installation", "process piping", "pipeline valve installation"],
  "butterfly-valves": ["water network installation", "HVAC installation", "industrial valve installation"],
  "control-relief-valves": ["process instrumentation", "process plant construction", "pressure safety systems"],
  "coating-materials": ["pipeline coating", "pipe coating application", "pipeline corrosion protection"],
  "field-joint-coating": ["field joint coating application", "pipeline construction", "pipeline coating"],
  "cathodic-protection": ["cathodic protection installation", "pipeline corrosion protection", "cathodic protection systems"],
  paints: ["industrial painting", "protective coating application", "steel structure painting"],
  "stud-bolts": ["piping fabrication", "steel structure erection", "mechanical equipment installation"],
  gaskets: ["process piping installation", "flanged piping", "plant maintenance"],
  "welding-consumables": ["steel fabrication", "pipeline welding", "structural welding"],
  abrasives: ["abrasive blasting", "surface preparation", "metal fabrication"],
  "structural-steel": ["structural steel fabrication", "steel structure erection", "steel fabrication"],
  plates: ["pressure vessel fabrication", "shipbuilding", "storage tank fabrication", "pressure vessel manufacturing", "vessel construction", "ship repair", "boiler manufacturing", "heavy fabrication", "steel plate fabrication"],
  rebar: ["reinforced concrete construction", "rebar installation", "reinforcement fixing"],
  "gratings-handrails": ["industrial platform construction", "steel structure erection", "pipe support installation"],
  cables: ["power cable installation", "electrical contracting", "power distribution construction", "cable laying", "electrical installation", "HV cable installation", "EHV cable installation", "HVDC cable installation", "11kV to 400kV cable installation", "substation cabling", "underground cabling"],
  "cable-trays": ["cable tray installation", "electrical installation", "MEP installation"],
  instruments: ["process instrumentation installation", "instrumentation installation", "process automation"],
  insulation: ["thermal insulation installation", "industrial insulation", "pipe insulation"],
  pumps: ["pumping station construction", "pump installation", "water treatment plant construction"],
};

/** Exact user-input aliases. Ambiguous short tokens never silently choose a catalogue item. */
const INPUT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "line-pipe": ["pipeline", "pipeline pipe", "line pipes", "api 5l", "gas transmission pipe"],
  "cs-process-pipe": ["carbon steel piping", "carbon steel pipes", "process pipe", "a106", "astm a106", "a53"],
  "ss-duplex-pipe": ["stainless steel pipe", "stainless piping", "stainless steel piping", "ss pipe", "duplex pipe", "duplex piping", "astm a312"],
  "alloy-pipe": ["alloy pipe", "chrome moly pipe", "astm a335"],
  octg: ["octg", "casing and tubing", "well casing", "api 5ct"],
  "di-pipe": ["di pipe", "ductile iron pipes", "k9 pipe"],
  "hdpe-pipe": ["hdpe", "hdpe pipes", "pe100 pipe", "polyethylene pipe"],
  "grp-pipe": ["grp pipe", "gre pipe", "fiberglass pipe", "fibreglass pipe"],
  "pvc-pipe": ["pvc pipe", "upvc", "upvc pipe", "cpvc pipe"],
  "bw-fittings": ["butt weld fittings", "buttweld fittings", "pipe fittings", "b16.9"],
  "forged-fittings": ["socket weld fittings", "threaded fittings", "b16.11"],
  flanges: ["flange", "pipe flanges", "b16.5"],
  "induction-bends": ["induction bends", "hot bends", "insulating joints"],
  spools: ["pipe spools", "prefabricated piping spools"],
  "gate-globe-check": ["gate valve", "gate valves", "globe valve", "check valve", "check valves"],
  "ball-valves": ["ball valve", "pipeline ball valves"],
  "butterfly-valves": ["butterfly valve"],
  "control-relief-valves": ["control valve", "relief valve", "safety relief valves", "psv"],
  "coating-materials": ["pipe coating materials", "3lpe", "3lpp", "fbe powder"],
  "field-joint-coating": ["heat shrink sleeves", "field joint coating"],
  "cathodic-protection": ["anodes for cathodic protection", "iccp"],
  paints: ["industrial paint", "protective paint", "epoxy paint"],
  "stud-bolts": ["stud bolt", "stud bolts and nuts"],
  gaskets: ["gasket", "spiral wound gaskets", "rtj gasket"],
  "welding-consumables": ["welding wire", "welding electrodes", "welding rods", "welding flux"],
  abrasives: ["cutting discs", "grinding discs", "blasting grit"],
  "structural-steel": ["steel structure", "structural sections", "steel beams", "steel channels"],
  plates: ["steel plate", "steel sheets", "hot rolled coil"],
  rebar: ["reinforcing bar", "reinforcement steel", "tmt bars", "tmt bar"],
  "gratings-handrails": ["gratings", "steel gratings", "handrails", "pipe supports"],
  cables: ["power cables", "power cable", "control cables", "electrical wiring", "electrical cables", "armoured cable", "copper wiring"],
  "cable-trays": ["cable tray", "cable ladders", "cable ladder"],
  instruments: ["pressure gauges", "pressure gauge", "flow meters", "flow meter", "temperature gauges"],
  insulation: ["thermal insulation", "mineral wool", "rock wool", "pipe insulation"],
  pumps: ["pump", "water pumps", "process pumps"],
};

const AMBIGUOUS = new Set(["pipe", "pipes", "steel", "wire", "wiring", "electrical", "electricals", "valve", "valves", "panel", "panels", "fittings", "insulation", "cable", "cables", "plate", "plates"]);
export function normalizeMaterialInput(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[–—_-]/g, " ").replace(/[^\p{L}\p{N}./ ]/gu, " ").replace(/\s+/g, " ").trim();
}
export interface MaterialInterpretation {
  status: "resolved" | "clarification" | "unsupported";
  originalKeyword: string;
  productId: string | null;
  label: string | null;
  activities: string[];
  question: string | null;
  candidateIds: string[];
}

/** No LLM/provider call. Unsupported input remains unsupported rather than defaulting to pipe. */
export function resolveMaterial(query: string, selectedProductId?: string): MaterialInterpretation {
  const originalKeyword = query.trim();
  const normalized = normalizeMaterialInput(query);
  const matches = getCatalogue().items.filter(item => [item.id, item.shortName, item.name, ...(INPUT_ALIASES[item.id] ?? [])]
    .some(alias => normalizeMaterialInput(alias) === normalized));
  const selected = selectedProductId ? getCatalogueItem(selectedProductId) : undefined;
  const result = (status: MaterialInterpretation["status"], question: string, candidateIds = matches.map(item => item.id)): MaterialInterpretation =>
    ({status, originalKeyword, productId:null, label:null, activities:[], question, candidateIds});
  if(selectedProductId && !selected)return result("unsupported", "Choose a supported material or add this material to the reviewed catalogue.", []);
  if(selected && matches.some(item => item.id !== selected.id))return result("clarification", "The typed material differs from the selected product. Which material do you want to sell?", [...new Set([selected.id, ...matches.map(item => item.id)])]);
  if(selected && AMBIGUOUS.has(normalized) && !matches.some(item=>item.id===selected.id))return result("clarification", "Clarify the typed material or use the selected product's name before searching.", [selected.id]);
  if(!selected && (AMBIGUOUS.has(normalized) || matches.length > 1))return result("clarification", "Which material or type do you mean? Select the specific product before searching.");
  const product = selected && (!normalized || AMBIGUOUS.has(normalized) || matches.some(item => item.id === selected.id)) ? selected : matches.length === 1 ? matches[0] : null;
  if(!product)return result("unsupported", "This material is not yet mapped. Add or clarify its material type instead of substituting another product.");
  return {status:"resolved", originalKeyword, productId:product.id, label:product.shortName,
    activities:[...(MATERIAL_ACTIVITIES[product.id] ?? [])], question:null, candidateIds:[product.id]};
}
