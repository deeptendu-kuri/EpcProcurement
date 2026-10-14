import { getCatalogueItem } from "@/mvp/config/buyers-config";
import { COUNTRIES } from "@/mvp/config/countries";
import { hasTerm, mentionsPhysicalPipeline,MARKET_TERMS } from "@/mvp/pipeline/filter";
import type { RunInput } from "@/mvp/types";
import type { RawDoc } from "@/mvp/pipeline/contracts";
import { MATERIAL_ACTIVITIES } from "./material";
import { isSearchItemId, itemPhrases, itemWordsOf } from "./item";
import type { CatalogueItem } from "@/mvp/config/buyers-config";
import { tenderWording } from "@/mvp/sourcing/tender-sources";

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
  // Each extra country gets its own share (doc 19; six free news searches, as piping plans four award searches), so five countries are not squeezed into one country's
  // allowance; never beyond deep mode, and environment settings can still only reduce.
  const extra=Math.max(0,Math.min(19,new Set(input?.markets??[]).size-1));
  const deep=MODE_BUDGETS.deep;
  const grow=(base:number,per:number,cap:number)=>Math.min(cap,base+per*extra);
  return {mode,searchQueries:bounded("MVP_MAX_SEARCH_QUERIES",grow(defaults.searchQueries,2,deep.searchQueries)),bingQueries:bounded("MVP_MAX_BING_QUERIES",grow(defaults.bingQueries,6,deep.bingQueries*2)),
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
export interface PlannedBuyerQuery {key:string;market:string;lane:"company"|"project"|"activity"|"directory"|"news";activityIndex:number;query:string;includeDomains?:string[];timeRange?:"year"|"month";topic?:'news'|'general';days?:number;sourcingLane?:'trigger'|'roundup'|'capability';
  /** docs/mvp/22: a tender search (results are tender candidates) that asks the provider for the page text it read. */
  tender?:boolean;rawContent?:boolean}
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
/** Single words that name many things outside industry ("vessel" is a ship, "fan" a supporter). */
const AMBIGUOUS_ITEM_WORDS=new Set(["vessel","vessels","fan","fans","separator","separators","tank","tanks","drum","drums","column","columns","tower","towers",
  "filter","filters","motor","motors","panel","panels","box","boxes","pump","pumps","line","lines","unit","units","system","systems","part","parts","equipment"]);
const INDUSTRIAL_CONTEXT=/\b(?:plants?|projects?|tenders?|rfq|supply|procure\w*|process|industrial|refiner\w*|petrochemical\w*|oil|gas|power|water|wastewater|sewage|ventilation|hvac|cement|mining|chemical\w*|fertili[sz]er\w*|desalination|epc|contract\w*|install\w*|equipment|factor(?:y|ies)|metro|tunnels?|boilers?|compressors?|mechanical)\b/i;
/**
 * A typed search item (docs/mvp/22 §3.2) is named when a source section contains one of its phrases (plural or
 * singular, punctuation-insensitive: "twin-lobe blower" = "twin lobe blower"). A one-word item counts only beside
 * industrial context, and never when the word is ambiguous on its own or part of "whistle-blower".
 */
function searchItemEvidence(text:string,item:CatalogueItem):MaterialEvidenceKind {
  const sections=materialSections(text).map(section=>({raw:section,words:` ${itemWordsOf(section)} `}));
  const phrases=item.keywords.filter(k=>k.includes(" "));
  if(sections.some(s=>phrases.some(p=>s.words.includes(` ${p} `))))return "explicit";
  const singles=item.keywords.filter(k=>!k.includes(" ")&&k.length>=5&&!/\d/.test(k)&&!AMBIGUOUS_ITEM_WORDS.has(k));
  return sections.some(s=>INDUSTRIAL_CONTEXT.test(s.raw)&&singles.some(w=>s.words.includes(` ${w} `)&&!s.words.includes(` whistle ${w} `)))?"explicit":"none";
}
/** Classifies source wording; application is a supported inference, not an exact grade or RFQ. */
export function materialEvidenceKind(text:string,productId:string):MaterialEvidenceKind {
  const product=getCatalogueItem(productId);if(!product)return "none";
  if(isSearchItemId(productId))return searchItemEvidence(text,product);
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
/**
 * Does the text name the item itself: its own words or keywords, or the search brief's name for it and its other
 * names ("cryogenic valves" for a gate-valve search)? Only multi-word brief names count, never a lone "valves".
 */
export function namesItem(text:string,productId:string,brief?:{item:string;synonyms?:string[]}|null,loose=false):boolean {
  if(materialEvidenceKind(text,productId)==="explicit")return true;
  if(!brief)return false;
  const words=` ${itemWordsOf(text)} `;
  const phrases=[brief.item,...(brief.synonyms??[])].flatMap(itemPhrases).filter(p=>p.includes(" "));
  if(phrases.some(p=>words.includes(` ${p} `)))return true;
  // A tender title can split the name ("air cushion fan, type- centrifugal"): every word of the item, in one short span.
  if(!loose||text.length>900)return false;
  const has=(w:string)=>words.includes(` ${w} `)||words.includes(` ${w}s `)||words.includes(` ${w.replace(/s$/,"")} `);
  return phrases.some(p=>p.split(" ").filter(w=>w.length>=3&&!/^\d/.test(w)).every(has));
}
/**
 * docs/mvp/22 §3.6: an open tender, RFQ, bid invitation or supply order that names the item (or one of its other
 * names). Demand in itself: its issuer is checked as a direct buyer. A tender page that does not name the item is not one.
 */
export function tenderForItem(text:string,productId:string,brief?:{item:string;synonyms?:string[]}|null):boolean {
  if(!productId||!tenderWording(text))return false;
  return namesItem(text.slice(0,8000),productId,brief);
}
export function exactProductEvidence(text: string, productId: string): boolean {
  // Compatibility name: true includes a supported application. Consumers must
  // use materialEvidenceKind to label inference rather than claim exact demand.
  return materialEvidenceKind(text,productId)!=="none";
}
export function buyerPageCandidate(text: string, productId: string): boolean {
  return exactProductEvidence(text,productId)
    && WORK.test(text)
    && !materialOutputOnly(text,productId)
    && !/\b(?:market report|market size|cagr|job vacancy)\b/i.test(text);
}
/** Making the material being sold is not consuming it. Equipment fabricators
 * using/buying it as input or actually installing it still qualify. */
export function materialOutputOnly(text:string,productId:string):boolean {
  const sections=materialSections(text);
  // Buying wording, including a tender or RFQ "for supply of" the item (docs/mvp/22): never a seller's own output.
  const consumes=/\b(?:using|uses|consum\w*|purchas\w*|procur\w*|raw materials?|material inputs?|install\w*|erect\w*|pipeline construction|piping construction|tenders?|e-?tender\w*|rfq|bids? (?:are )?invited|invites? (?:bids?|tenders?|e-?tenders?|quotations?|offers?)|enquir\w*)\b/i;
  if(sections.some(section=>consumes.test(section)&&materialEvidenceKind(section,productId)!=='none'))return false;
  // A typed item's own makers, fabricators and suppliers sell it (live run, 14 Oct: a metal fabricator was saved as a
  // pressure-vessel buyer); for catalogue materials, fabricating with them still consumes them.
  const makes=isSearchItemId(productId)
    ?/\b(?:manufactur\w*|produc\w*|fabricat\w*|suppliers?|vendors?|exporters?|makers?|stockists?|distributors?)\b[^.;\n]{0,220}/ig
    :/\b(?:manufactur\w*|produc\w*|pipe mills?|stockists?|distributors?)\b[^.;\n]{0,220}/ig;
  return sections.some(section=>{
    const output=section.match(makes)??[];
    return output.some(clause=>materialEvidenceKind(clause.replace(/\bpipes\b/ig,'pipe'),productId)==='explicit')
      && !consumes.test(section);
  });
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
  // An open tender naming the item is read first; any other tender page (or an AMP copy) last.
  if(tenderForItem(`${title}\n${text}`,input.productId??"",input.brief))score+=18;
  else if(/tender|\/amp\//i.test(raw.url)||/\b(?:terminat\w*|cancelled|stalled)\b/i.test(title))score-=20;
  if(/\b(?:pipe manufacturer|pipe mill|stockist|distributor)\b/i.test(title))score-=25;
  return score;
}
