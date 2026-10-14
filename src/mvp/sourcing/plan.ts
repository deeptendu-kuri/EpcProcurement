import { getCatalogueItem } from '@/mvp/config/buyers-config';
import { COUNTRIES } from '@/mvp/config/countries';
import { MATERIAL_ACTIVITIES } from '@/mvp/discovery/material';
import { whoBuys } from '@/mvp/discovery/material-catalogue';
import { hasSpec, parseMaterialSpec, specUses } from '@/mvp/discovery/spec';
import type { ResearchMode, PlannedBuyerQuery } from '@/mvp/discovery/plan';
import { RESEARCH_SOURCES } from '@/mvp/research/registry';
import { TED_COUNTRIES } from '@/mvp/pipeline/sources/ted';
import { usesFor, workQueryWords, type SearchBrief } from '@/mvp/discovery/brief';
import { countryLanguage } from '@/mvp/config/country-meta';
import { LOCAL_TENDER_WORDS, tenderDomains, tenderListPages } from './tender-sources';

export type SourcingLane = 'trigger' | 'roundup' | 'capability';
export interface SourceTask {
  id:string;lane:SourcingLane;source:'bing-query'|'tavily'|'ted'|'registry'|'local-news'|'gdelt-country'|'tender-page';market:string;priority:number;
  query?:string;url?:string;topic?:'news'|'general';days?:number;registryId?:string;includeDomains?:string[];
  /** docs/mvp/22: an open-tender search (most recent year, page text from the provider). */
  tender?:boolean;timeRange?:'year'|'month';
  /** local-news: what to translate; gdelt-country: English words to match in any language. */
  material?:string;work?:string;words?:string[];
  /** local-news from a search brief: the query in the country's own words, used as is (no translation). */
  localQuery?:string;localWords?:string[];
}
export interface SourcePlanInput {productId:string;keyword?:string;markets:string[];mode:ResearchMode;lanes?:SourcingLane[];includeResellers?:boolean;
  /** docs/mvp/20: searches built from the work that uses the item, per country; absent = the catalogue plan. */
  brief?:SearchBrief}
// Companies found by the work they do share the list tier with contractor lists (doc 19): regular buyers
// get a fair share of the search allowance instead of what is left after news and lists.
const BASE_PRIORITY:Record<SourcingLane,number>={trigger:2000,roundup:1000,capability:1000};
/** Piping materials: bought for oil & gas, water and power projects, which the news reports as EPC awards. */
export const PIPING_PRODUCTS=new Set(['line-pipe','cs-process-pipe','ss-duplex-pipe','alloy-pipe','bw-fittings','forged-fittings','flanges','induction-bends','spools',
  'gate-globe-check','ball-valves','butterfly-valves','control-relief-valves','stud-bolts','gaskets']);
/**
 * Award news names the project, not the pipe or the elbow ("Aramco awards EPC contract for gas plant"):
 * for piping materials the news searches ask for awarded projects that consume them (web audit, 10 Oct).
 */
export const PROJECT_AWARD_QUERIES=['EPC contract awarded','pipeline project contract awarded','refinery petrochemical gas plant EPC contract','desalination power plant EPC contract awarded'];
/** Tender searches outrank every other paid search: an open tender naming the item is the strongest demand (docs/mvp/22 §3.5). */
export const TENDER_PRIORITY=1290;
/** The item as tender searches name it: the brief's short name, else his own words (never a catalogue family name). */
function tenderItem(input:SourcePlanInput,fallback:string):string {
  return (input.brief?.source==='ai'?input.brief.item:'')||input.keyword?.trim()||fallback;
}
/**
 * Ordered tasks, not promises of buyers (docs/mvp/19). For every country: award news (English, the
 * country's own language and GDELT's local outlets), contractor lists, stockists when he sells to them,
 * and direct searches for the companies whose work uses the exact material typed. Tasks of one lane
 * alternate between countries, so every country is searched before any country gets a second search.
 */
export function sourcePlan(input:SourcePlanInput):SourceTask[] {
  // A typed item (q:…) is an item built from its own words (docs/mvp/22); only a malformed id is refused.
  const product=getCatalogueItem(input.productId);
  if(!product)throw new Error('Unknown sourcing product.');
  const activities=MATERIAL_ACTIVITIES[input.productId]??[product.shortName];
  const spec=parseMaterialSpec(input.keyword??'');
  // His own words are the best search terms ("Welded Stainless Steel Pipes 316L"); the variant they name
  // adds searches for the work that uses it.
  const material=input.keyword?.trim()||product.shortName;
  // Typical uses of the variant only when the words name one ("welded …"); plain searches keep their queries.
  const uses=hasSpec(spec)?specUses(input.productId,spec):[];
  const segments=whoBuys(input.productId);
  const markets=[...new Set(input.markets)].map(code=>({code,name:COUNTRIES.find(c=>c.code===code)?.name})).filter((c):c is {code:string;name:string}=>Boolean(c.name));
  const tasks:(SourceTask&{round:number;order:number})[]=[];
  markets.forEach(({code,name},order)=>{
    const rounds:Record<string,number>={};
    const add=(lane:SourcingLane,source:SourceTask['source'],n:number,extra:Partial<SourceTask>,tag='')=>{
      if(input.lanes&&!input.lanes.includes(lane))return;
      const round=rounds[lane]=(rounds[lane]??-1)+1;
      const priority=tag==='tender'&&source==='tender-page'?TENDER_PRIORITY+20-n-order
        :tag==='tender'&&source==='tavily'?TENDER_PRIORITY-n*100-order
        :input.brief&&source==='tavily'?({trigger:1260,capability:1220,roundup:1190}[lane])-n*100-order:BASE_PRIORITY[lane];
      // Work-based requests share the first paid-query tier across the lanes.
      // Otherwise Quick's entire allowance was spent on trigger news before a
      // single contractor-list or company search could run.
      tasks.push({id:`hybrid-v2:${input.productId}:${code}:${lane}${tag?`:${tag}`:''}:${source}:${n}`,lane,source,market:code,priority,round,order,...extra});
    };
    // ── tenders: open tenders, RFQs and supply orders that name the item (docs/mvp/22 §3.5); the issuer buys it.
    // Part of the brief-based search (production); the legacy catalogue plan below is unchanged. ──
    const item=tenderItem(input,product.shortName);
    const domains=input.brief?tenderDomains(code):[];
    if(input.brief&&domains.length)add('trigger','tavily',0,{query:`${item} tender ${name}`,topic:'general',includeDomains:domains,tender:true,timeRange:'year'},'tender');
    // A tender list page read directly (no search credit), where the country has one that names the buyer.
    if(input.brief)tenderListPages(item,code).forEach((page,n)=>add('trigger','tender-page',n,{url:page.url,query:page.name,tender:true},'tender'));
    if(input.brief){
      add('trigger','tavily',domains.length?1:0,{query:`${input.brief.tenderWords?.[0]??`supply of ${item}`} tender ${name}`,topic:'general',tender:true,timeRange:'year'},'tender');
      add('trigger','bing-query',0,{query:`"${item}" tender ${name}`},'tender');
      add('trigger','bing-query',1,{query:`"${item}" order ${name}`},'tender');
    }
    const localItem=input.brief?.localItem?.[code]?.[0],tenderWord=LOCAL_TENDER_WORDS[countryLanguage(code)];
    if(localItem&&tenderWord)add('trigger','local-news',0,{query:`"${item}" tender ${name}`,material:item,work:'tender',localQuery:`${tenderWord} ${localItem}`,localWords:[localItem,tenderWord]},'tender');
    const activity=activities[0];
    if(input.brief){
      // docs/mvp/20: this country's own uses (they differ between countries), searched by their headline words.
      const brief=input.brief,work=usesFor(brief,code,4);
      // No work described (the AI brief failed for a typed item): tenders and direct mentions still run.
      if(!work.length)return;
      const words=(n:number)=>workQueryWords(work[n]).slice(0,2).join(' ');
      // ── trigger: awards for the work that uses the item, in English, the country's language, GDELT and tenders ──
      work.forEach((_,n)=>add('trigger','bing-query',n,{query:`${words(n)} contract awarded ${name}`}));
      // Owner construction/progress pages and corporate project releases matter
      // as much as news. General search includes those originals and older EPC
      // contracts that are still being executed, rather than only recent awards.
      add('trigger','tavily',0,{query:`${work[0].name} EPC contractor ongoing construction projects ${name}`,topic:'general'});
      if(work[1])add('trigger','tavily',1,{query:`${words(1)} contract awarded ${name}`,topic:'news',days:540});
      const local=work.find(u=>u.localWords[code]?.length);
      add('trigger','local-news',0,{query:`${words(0)} contract ${name}`,material:workQueryWords(work[0])[0],work:work[0].name,
        ...(local?{localQuery:`${local.localWords[code].slice(0,3).join(' ')} ${brief.places[code]?.[0]??name}`,localWords:local.localWords[code]}:{})});
      add('trigger','gdelt-country',0,{words:work.flatMap(workQueryWords).slice(0,4)});
      if(TED_COUNTRIES[code])add('trigger','ted',0,{});
      // Rule 7: steadily bought items come from plants being maintained: the owners' maintenance contracts.
      if(brief.buying!=='project'){
        add('trigger','bing-query',work.length,{query:`shutdown turnaround maintenance contract ${name}`});
        if(order===0)brief.owners.slice(0,2).forEach((owner,n)=>add('trigger','tavily',2+n,{query:`${owner} maintenance services contract awarded`,topic:'news',days:540}));
      }
      // ── roundup and capability: companies whose regular work is this work ──
      for(const [n,registry] of RESEARCH_SOURCES.filter(r=>r.country===code&&r.materials.includes(input.productId)&&r.permission==='public-listing').entries()){
        add('roundup','registry',n,{url:registry.url,registryId:registry.id,priority:1950,includeDomains:[new URL(registry.url).hostname.replace(/^www\./,'')]});
      }
      add('roundup','tavily',0,{query:`${work[0].name} contractors ${name} list top companies`,topic:'general'});
      if(input.includeResellers===true)add('roundup','tavily',1,{query:`${material} stockists suppliers ${name}`,topic:'general'});
      work.slice(0,2).forEach((use,n)=>add('capability','tavily',n,{query:`${use.name} contractor ${name} projects`,topic:'general'}));
      return;
    }
    // ── trigger: awards and orders ──
    const piping=PIPING_PRODUCTS.has(input.productId);
    if(piping)PROJECT_AWARD_QUERIES.forEach((words,n)=>add('trigger','bing-query',n,{query:`${words} ${name}`}));
    else add('trigger','bing-query',0,{query:`${activity} contract awarded ${name}`});
    add('trigger','tavily',0,{query:piping?`EPC contract awarded pipeline refinery gas plant desalination ${name}`:`${material} ${activity} contract awarded orders ${name}`,topic:'news',days:365});
    add('trigger','local-news',0,{query:`${material} contract ${name}`,material,work:uses[0]??activity});
    add('trigger','gdelt-country',0,{words:[material,activity,...activities.slice(1,2)]});
    if(!piping)add('trigger','bing-query',1,{query:`wins ${activity} contract ${name}`});
    if(TED_COUNTRIES[code])add('trigger','ted',0,{});
    // ── roundup: lists of contractors (and stockists when he sells to them) ──
    for(const [n,registry] of RESEARCH_SOURCES.filter(r=>r.country===code&&r.materials.includes(input.productId)&&r.permission==='public-listing').entries()){
      add('roundup','registry',n,{url:registry.url,registryId:registry.id,priority:1950,includeDomains:[new URL(registry.url).hostname.replace(/^www\./,'')]});
    }
    add('roundup','tavily',0,{query:`${uses[0]?`${uses[0]} contractors`:`${activity} contractors`} ${name} list top companies`,topic:'general'});
    if(input.includeResellers!==false)add('roundup','tavily',1,{query:`${material} stockists suppliers ${name}`,topic:'general'});
    // ── capability: companies whose work uses this exact material ──
    add('capability','tavily',0,{query:`${uses[0]?`${uses[0]} contractor`:`${activities[0]} contractor`} ${name} services projects`,topic:'general'});
    add('capability','tavily',1,{query:segments[1]?`${segments[1]} ${name} company`:`${activities[1%activities.length]} contractor ${name} services projects`,topic:'general'});
    if(uses[1])add('capability','tavily',2,{query:`${uses[1]} contractor ${name}`,topic:'general'});
  });
  // Priority by lane first; within a lane, each country's first search before anyone's second.
  // Free news tasks must not demote a country's first paid request simply
  // because that country's brief contains more applications/local queries.
  return tasks.map(t=>({...t,priority:t.priority-(input.brief&&t.source==='tavily'?0:t.round*10)}))
    .sort((a,b)=>b.priority-a.priority||a.round-b.round||a.order-b.order)
    .map(t=>{const task:SourceTask&{round?:number;order?:number}={...t};delete task.round;delete task.order;return task as SourceTask;});
}
export function tavilyTask(task:SourceTask):PlannedBuyerQuery {
  if(task.source!=='tavily'||!task.query)throw new Error('Task is not a Tavily query.');
  return {key:task.id,market:task.market,lane:task.lane==='trigger'?'news':task.lane==='roundup'?'directory':'company',
    activityIndex:0,query:task.query,topic:task.topic,days:task.days,sourcingLane:task.lane,includeDomains:task.includeDomains,
    ...(task.tender?{tender:true,rawContent:true}:{}),...(task.timeRange?{timeRange:task.timeRange}:{})};
}
