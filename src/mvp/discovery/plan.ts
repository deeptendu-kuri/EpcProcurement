import { getCatalogueItem } from "@/mvp/config/buyers-config";
import { COUNTRIES } from "@/mvp/config/countries";
import { hasTerm, mentionsPhysicalPipeline } from "@/mvp/pipeline/filter";
import type { RunInput } from "@/mvp/types";

/** Buying activities, not product sellers. Broad search terms never prove exact product fit. */
const ACTIVITIES: Record<string, string[]> = {
  "line-pipe": ["pipeline construction", "gas transmission", "oil pipeline", "pipeline installation"],
  "cs-process-pipe": ["process piping", "plant piping", "mechanical piping"],
  "ss-duplex-pipe": ["stainless piping", "duplex piping"],
  "alloy-pipe": ["power plant piping", "boiler piping"],
  "octg": ["well drilling", "drilling contractor"],
  "di-pipe": ["water pipeline construction"],
  "hdpe-pipe": ["HDPE installation", "polyethylene pipeline"],
  "grp-pipe": ["GRP installation", "GRE piping"],
};
export function buyingActivities(productId: string): string[] { return ACTIVITIES[productId] ?? []; }
export function queryBudget(): number {
  const value = Number(process.env.MVP_MAX_SEARCH_QUERIES ?? 3);
  return Number.isInteger(value) && value >= 1 && value <= 12 ? value : 3;
}
export function buyerQueries(input: RunInput) {
  const product = input.productId ? getCatalogueItem(input.productId) : undefined;
  const term = product?.shortName || input.query;
  const activity = buyingActivities(input.productId ?? "")[0] || term;
  const countries = [...new Set(input.markets)].map(code => ({code, name: COUNTRIES.find(c => c.code === code)?.name})).filter(c => c.name);
  const exclusions = "-jobs -market-report -tender -stockist";
  // Country-specific requests; do not pretend a multi-country OR query covered each market.
  return [
    ...countries.map(c => ({market:c.code, lane:"company" as const, query:`${c.name} ${activity} contractor EPC services projects ${term} ${exclusions}`.slice(0,550)})),
    ...countries.map(c => ({market:c.code, lane:"project" as const, query:`${c.name} ${activity} EPC contractor contract awarded construction ${term} ${exclusions}`.slice(0,550)})),
  ];
}
export function exactProductEvidence(text: string, productId: string): boolean {
  const product = getCatalogueItem(productId);
  if (!product) return false;
  // Line-pipe projects can imply procurement; incompatible pipe materials cannot qualify.
  if (productId === "line-pipe" && /\b(?:hdpe|polyethylene|pvc|ductile iron|grp|gre pipe)\b/i.test(text)) return false;
  const genericPipeTerms=new Set(["steel pipe","seamless pipe","erw pipe","saw pipe","spiral welded"]);
  if (product.keywords.filter(k=>!genericPipeTerms.has(k.toLowerCase())).some(k => hasTerm(text,k))) return true;
  return productId === "line-pipe" && mentionsPhysicalPipeline(text)
    && /\b(?:construct\w*|install\w*|laying|epc|contractor|subcontractor)\b/i.test(text);
}
export function buyerPageCandidate(text: string, productId: string): boolean {
  return (exactProductEvidence(text,productId) || productId==='line-pipe' && mentionsPhysicalPipeline(text))
    && /\b(?:epc|contractor|subcontractor|construct\w*|install\w*|procure\w*|fabricat\w*|drilling)\b/i.test(text)
    && !/\b(?:market report|market size|cagr|job vacancy)\b/i.test(text);
}
