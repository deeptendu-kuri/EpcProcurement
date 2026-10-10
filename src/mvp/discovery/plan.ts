import { getCatalogueItem } from "@/mvp/config/buyers-config";
import { COUNTRIES } from "@/mvp/config/countries";
import { hasTerm, mentionsPhysicalPipeline,MARKET_TERMS } from "@/mvp/pipeline/filter";
import type { RunInput } from "@/mvp/types";
import type { RawDoc } from "@/mvp/pipeline/contracts";
import { MATERIAL_ACTIVITIES } from "./material";

/** Buying activities, not product sellers. Broad search terms never prove exact product fit. */
export function buyingActivities(productId: string): string[] { return [...(MATERIAL_ACTIVITIES[productId] ?? [])]; }
export type ResearchMode = "preview" | "batch" | "deep";
type BudgetInput = Pick<RunInput, "query" | "markets"> & {researchMode?:ResearchMode; targetCompanies?:number; extraRounds?:number};
export const MODE_BUDGETS = {
  preview:{searchQueries:4,bingQueries:6,maxPages:40,maxAiPages:20,maxAiTokens:60_000,maxPagesPerDomain:4,maxRepairCalls:1,targetCompanies:10},
  batch:{searchQueries:8,bingQueries:12,maxPages:80,maxAiPages:40,maxAiTokens:120_000,maxPagesPerDomain:4,maxRepairCalls:2,targetCompanies:30},
  deep:{searchQueries:24,bingQueries:30,maxPages:200,maxAiPages:80,maxAiTokens:250_000,maxPagesPerDomain:4,maxRepairCalls:2,targetCompanies:100},
} as const;
/** Explicit ceilings, not expected yield. Environment settings may reduce, never expand, a mode. */
export function researchBudget(input?:BudgetInput) {
  const requested=input?.researchMode??process.env.MVP_RESEARCH_MODE;
  const mode:ResearchMode=requested==="batch"||requested==="deep"?requested:"preview";
  const defaults=MODE_BUDGETS[mode];
  const bounded=(name:string,limit:number)=>{
    const value=process.env[name];const n=Number(value);return value!==undefined&&value.trim()!==''&&Number.isInteger(n)&&n>=0?Math.min(n,limit):limit;
  };
  const target=input?.targetCompanies;
  // Each extra country gets its own share (doc 19), so five countries are not squeezed into one country's
  // allowance; never beyond deep mode, and environment settings can still only reduce.
  const extra=Math.max(0,Math.min(19,new Set(input?.markets??[]).size-1));
  const deep=MODE_BUDGETS.deep;
  const grow=(base:number,per:number,cap:number)=>Math.min(cap,base+per*extra);
  return {mode,searchQueries:bounded("MVP_MAX_SEARCH_QUERIES",grow(defaults.searchQueries,2,deep.searchQueries)),bingQueries:bounded("MVP_MAX_BING_QUERIES",grow(defaults.bingQueries,4,deep.bingQueries*2)),
    maxPages:bounded("MVP_MAX_RESEARCH_PAGES",grow(defaults.maxPages,12,deep.maxPages)),
    maxAiPages:bounded("MVP_MAX_AI_DOCS",grow(defaults.maxAiPages,4,deep.maxAiPages)),maxAiTokens:bounded("MVP_MAX_RESEARCH_AI_TOKENS",grow(defaults.maxAiTokens,10_000,deep.maxAiTokens)),
    maxPagesPerDomain:bounded("MVP_MAX_PAGES_PER_DOMAIN",defaults.maxPagesPerDomain),maxRepairCalls:bounded("MVP_MAX_REPAIR_CALLS",defaults.maxRepairCalls),
    targetCompanies:typeof target==="number"&&Number.isInteger(target)&&target>=1&&target<=100?target:defaults.targetCompanies,
    // A quick search takes no extra rounds; absent = the server setting (see research/limits.ts).
    ...(Number.isInteger(input?.extraRounds)&&input!.extraRounds!>=0?{extraRounds:Math.min(5,input!.extraRounds!)}:{})};
}
export function queryBudget(input?:BudgetInput): number {
  return researchBudget(input).searchQueries;
}
export interface PlannedBuyerQuery {key:string;market:string;lane:"company"|"project"|"activity"|"directory"|"news";activityIndex:number;query:string;includeDomains?:string[];timeRange?:"year";topic?:'news'|'general';days?:number;sourcingLane?:'trigger'|'roundup'|'capability'}
export function buyerQueries(input: RunInput) {
  const product = input.productId ? getCatalogueItem(input.productId) : undefined;
  const term = input.query.trim() || product?.shortName || '';
  const activities = buyingActivities(input.productId ?? "");
  if(input.productId && !product)return []; // unknown product must never become an unrelated pipe search
  if(!activities.length)activities.push(term);
  const countries = [...new Set(input.markets)].map(code => ({code, name: COUNTRIES.find(c => c.code === code)?.name})).filter(c => c.name);
  // Visit every country in a lane before returning to a country. Deep modes add
  // activity variants; the same persisted plan resumes without reordering paid work.
  const queries:PlannedBuyerQuery[]=[];
  const mode=researchBudget(input).mode;
  const variants=mode==="preview"?activities.slice(0,2):activities;
  // Small pilots need diverse material-consuming companies, not four variations
  // of the same generic service query. Every market still gets its turn first.
  for(const lane of ["company","project",...(mode==="preview"?[]:["activity","directory"])] as PlannedBuyerQuery["lane"][])for(const [activityIndex,activity] of variants.entries())for(const c of countries) {
    const words=lane==="company"?`${activity} contractors`
      :lane==="project"?`${activity} contractor contract awarded`
      :lane==="directory"?`${activity} registered approved contractors directory`
      :`${term} ${activity} contractor`;
    queries.push({key:`buyer-v6:${input.productId??term}:${c.code}:${lane}:${activityIndex}`,market:c.code,lane,activityIndex,
      query:`${c.name} ${words}`.slice(0,550),...(lane==='project'?{timeRange:'year' as const}:{})});
  }
  return queries;
}
export type MaterialEvidenceKind="explicit"|"application"|"none";
// Shipyards and equipment makers consume material too ("shipbuilding", "pressure vessel manufacturing");
// a matching consuming activity is still required, so a seller's catalogue page does not qualify.
const WORK=/\b(?:epc|contract\w*|construct\w*|install\w*|procure\w*|fabricat\w*|drilling|erect\w*|laying|weld\w*|maintenan\w*|painting|blasting|coating|commission\w*|shipbuild\w*|shipyards?|ship repair\w*|manufactur\w*)\b/i;
const AMBIGUOUS_TERMS=new Set(["steel pipe","seamless pipe","erw pipe","saw pipe","spiral welded","casing","tubing","duplex","elbow","elbows","tees","reducers","fittings","valves","trunnion","field joint","heat-shrink","anode","anodes","rectifier","paint","painting","polyurethane","bolting","fasteners","b7","flux","spool","spools","beams","channels","angles","hea","heb","ipe","plates","sheets","slab","grating","gratings","handrail","u-bolt","cable","cables","transmitter","insulation","cladding","pump","pumps"]);
function materialSections(text:string):string[] {
  // A menu mentioning HDPE must not globally disqualify a separate oil-pipeline
  // work section. Validators still establish the correct entity for each section.
  return text.split(/\n+|(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean).flatMap(section=>section.length>1600?section.match(/.{1,1600}/gs)??[]:[section]);
}
function activityWords(text:string):Set<string> {
  return new Set(text.toLowerCase().replace(/\b(?:fabrication|fabricating|fabricates|fabricated)\b/g,"fabricate")
    .replace(/\b(?:construction|constructing|constructs|constructed)\b/g,"construct")
    .replace(/\b(?:installation|installing|installs|installed)\b/g,"install")
    .replace(/\b(?:erection|erecting|erects|erected)\b/g,"erect")
    .replace(/\b(?:welding|welds|welded)\b/g,"weld")
    .replace(/\b(?:piping|pipes)\b/g,"pipe")
    .replace(/\b(?:laying|lays|laid)\b/g,"lay")
    .match(/[a-z0-9]+/g)?.map(word=>word.length>4&&!word.endsWith("ss")?word.replace(/s$/," ").trim():word)??[]);
}
function supportsActivity(section:string,activity:string):boolean {
  if(hasTerm(section,activity))return true;
  const required=activityWords(activity);
  // Unrelated list items must not combine into a made-up consuming activity
  // ("Installation & Testing, Oil Purification, Electrical Testing" is NOT
  // a claim of electrical installation). Inflected/reordered wording remains
  // supported within a single clause.
  return required.size>=2&&section.split(/[,;:|•]/).some(clause=>{
    const present=activityWords(clause);return [...required].every(word=>present.has(word));
  });
}
/** Classifies source wording; application is a supported inference, not an exact grade or RFQ. */
export function materialEvidenceKind(text:string,productId:string):MaterialEvidenceKind {
  const product=getCatalogueItem(productId);if(!product)return "none";
  const sections=materialSections(text);
  const keywords=product.keywords.filter(term=>!AMBIGUOUS_TERMS.has(term.toLowerCase()));
  if(sections.some(section=>keywords.some(term=>hasTerm(section,term))))return "explicit";
  // Require contextual material meaning for catalogue words that are ambiguous
  // outside engineering (TV channels, financial instruments, printing plates).
  if(productId==="cables"&&sections.some(s=>/\b(?:power|control|armoured|electrical|copper)\s+(?:cables?|wiring)\b/i.test(s)))return "explicit";
  // Substation cabling is a supported electrical-cable application, not an exact
  // cable grade/specification and not generic telecom or software cabling.
  if(productId==="cables"&&sections.some(s=>WORK.test(s)&&/\b(?:substations?|power distribution|electrical)\b/i.test(s)&&/\b(?:cabling works|cable installation|cable laying)\b/i.test(s)))return "application";
  if(productId==="plates"&&sections.some(s=>/\b(?:steel|metal)\s+(?:plates?|sheets?)\b/i.test(s)))return "explicit";
  if(productId==="structural-steel"&&sections.some(s=>/\bsteel\s+(?:beams?|channels?|angles?)\b/i.test(s)))return "explicit";
  if(productId==="pumps"&&sections.some(s=>/\b(?:water|process|centrifugal|industrial)\s+pumps?\b/i.test(s)))return "explicit";
  if(productId==="bw-fittings"&&sections.some(s=>/\b(?:pipe|piping|butt.?weld)\s+fittings?\b/i.test(s)))return "explicit";
  if(productId==="induction-bends"&&sections.some(s=>/\b(?:induction|hot)\s+bends?\b|\b(?:insulating|monolithic)\s+joints?\b/i.test(s)))return "explicit";
  if(productId==="field-joint-coating"&&sections.some(s=>/\bfield\s+joint\s+coating\b|\bheat[- ]shrink\s+sleeves?\b/i.test(s)))return "explicit";
  if(productId==="gate-globe-check"&&sections.some(s=>/\bindustrial valves?\b/i.test(s)))return "application";
  for(const section of sections){
    if(!WORK.test(section))continue;
    // Negative terms constrain an inferred activity, not all domains/pages. A
    // separate explicit searched-material statement already takes precedence.
    if(productId==="line-pipe") {
      if(/\b(?:hdpe|polyethylene|pvc|ductile iron|grp|gre pipe|fiberglass)\b/i.test(section))continue;
      if(mentionsPhysicalPipeline(section))return "application";
    }
    if(productId==="cables"&&/\b(?:fiber|fibre|optical|telecom|data cable)\b/i.test(section)&&!/\b(?:electrical|power distribution|power cable)\b/i.test(section))continue;
    if(productId==="insulation"&&/\b(?:electrical insulation|wire insulation|software|soundproofing)\b/i.test(section)&&!/\b(?:thermal|pipe insulation|industrial insulation|mineral wool)\b/i.test(section))continue;
    if(productId==="structural-steel"&&/\b(?:stainless piping|stainless steel pipe|pipe fabrication)\b/i.test(section)&&!/\b(?:structural|steel structure|steel beams)\b/i.test(section))continue;
    if(buyingActivities(productId).some(activity=>supportsActivity(section,activity)))return "application";
  }
  return "none";
}
export function exactProductEvidence(text: string, productId: string): boolean {
  // Compatibility name: true includes a supported application. Consumers must
  // use materialEvidenceKind to label inference rather than claim exact demand.
  return materialEvidenceKind(text,productId)!=="none";
}
export function buyerPageCandidate(text: string, productId: string): boolean {
  return exactProductEvidence(text,productId)
    && WORK.test(text)
    && !/\b(?:market report|market size|cagr|job vacancy)\b/i.test(text);
}
/** Reading order only, never an eligibility gate. Favour buying-work sources over generic news. */
export function buyerResearchPriority(raw:RawDoc,text:string,input:RunInput):number {
  let score=0;const title=raw.title??"";
  if(raw.sourceKey==="tavily")score+=12;
  if(/\/(?:current-projects|projects|services|capabilities|oil-and-gas|pipeline)(?:[/-]|$)/i.test(new URL(raw.url).pathname))score+=14;
  if(/\b(?:construction|contractor|installation|current projects|epc)\b/i.test(title))score+=8;
  if(exactProductEvidence(text,input.productId??""))score+=4;
  if(input.markets.some(code=>[COUNTRIES.find(c=>c.code===code)?.name??"",...(MARKET_TERMS[code as keyof typeof MARKET_TERMS]??[])]
    .filter(term=>term&&!/^(?:ongc|gail|aramco|adnoc|petronas|equinor|kongsberg)$/i.test(term)).some(term=>hasTerm(text,term))))score+=6;
  if(/\b(?:top \d+|market report|market size|cagr)\b/i.test(title))score-=20;
  if(/tender|\/amp\//i.test(raw.url)||/\b(?:terminat\w*|cancelled|stalled)\b/i.test(title))score-=20;
  if(/\b(?:pipe manufacturer|pipe mill|stockist|distributor)\b/i.test(title))score-=25;
  return score;
}
