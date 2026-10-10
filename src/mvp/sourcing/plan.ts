import { getCatalogueItem } from '@/mvp/config/buyers-config';
import { COUNTRIES } from '@/mvp/config/countries';
import { MATERIAL_ACTIVITIES } from '@/mvp/discovery/material';
import { whoBuys } from '@/mvp/discovery/material-catalogue';
import { hasSpec, parseMaterialSpec, specUses } from '@/mvp/discovery/spec';
import type { ResearchMode, PlannedBuyerQuery } from '@/mvp/discovery/plan';
import { RESEARCH_SOURCES } from '@/mvp/research/registry';
import { TED_COUNTRIES } from '@/mvp/pipeline/sources/ted';

export type SourcingLane = 'trigger' | 'roundup' | 'capability';
export interface SourceTask {
  id:string;lane:SourcingLane;source:'bing-query'|'tavily'|'ted'|'registry'|'local-news'|'gdelt-country';market:string;priority:number;
  query?:string;url?:string;topic?:'news'|'general';days?:number;registryId?:string;includeDomains?:string[];
  /** local-news: what to translate; gdelt-country: English words to match in any language. */
  material?:string;work?:string;words?:string[];
}
export interface SourcePlanInput {productId:string;keyword?:string;markets:string[];mode:ResearchMode;lanes?:SourcingLane[];includeResellers?:boolean}
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
/**
 * Ordered tasks, not promises of buyers (docs/mvp/19). For every country: award news (English, the
 * country's own language and GDELT's local outlets), contractor lists, stockists when he sells to them,
 * and direct searches for the companies whose work uses the exact material typed. Tasks of one lane
 * alternate between countries, so every country is searched before any country gets a second search.
 */
export function sourcePlan(input:SourcePlanInput):SourceTask[] {
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
    const add=(lane:SourcingLane,source:SourceTask['source'],n:number,extra:Partial<SourceTask>)=>{
      if(input.lanes&&!input.lanes.includes(lane))return;
      const round=rounds[lane]=(rounds[lane]??-1)+1;
      tasks.push({id:`hybrid-v2:${input.productId}:${code}:${lane}:${source}:${n}`,lane,source,market:code,priority:BASE_PRIORITY[lane],round,order,...extra});
    };
    const activity=activities[0];
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
  return tasks.map(t=>({...t,priority:t.priority-t.round*10}))
    .sort((a,b)=>b.priority-a.priority||a.round-b.round||a.order-b.order)
    .map(t=>{const task:SourceTask&{round?:number;order?:number}={...t};delete task.round;delete task.order;return task as SourceTask;});
}
export function tavilyTask(task:SourceTask):PlannedBuyerQuery {
  if(task.source!=='tavily'||!task.query)throw new Error('Task is not a Tavily query.');
  return {key:task.id,market:task.market,lane:task.lane==='trigger'?'news':task.lane==='roundup'?'directory':'company',
    activityIndex:0,query:task.query,topic:task.topic,days:task.days,sourcingLane:task.lane,includeDomains:task.includeDomains};
}
