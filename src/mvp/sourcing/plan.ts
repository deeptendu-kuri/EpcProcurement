import { getCatalogueItem } from '@/mvp/config/buyers-config';
import { COUNTRIES } from '@/mvp/config/countries';
import { MATERIAL_ACTIVITIES } from '@/mvp/discovery/material';
import { whoBuys } from '@/mvp/discovery/material-catalogue';
import type { ResearchMode, PlannedBuyerQuery } from '@/mvp/discovery/plan';
import { RESEARCH_SOURCES } from '@/mvp/research/registry';
import { TED_COUNTRIES } from '@/mvp/pipeline/sources/ted';

export type SourcingLane = 'trigger' | 'roundup' | 'capability';
export interface SourceTask {
  id:string;lane:SourcingLane;source:'bing-query'|'tavily'|'ted'|'registry';market:string;priority:number;
  query?:string;url?:string;topic?:'news'|'general';days?:number;registryId?:string;includeDomains?:string[];
}
export interface SourcePlanInput {productId:string;keyword?:string;markets:string[];mode:ResearchMode;lanes?:SourcingLane[]}
/** Ordered tasks, not promises of buyers. Capability tasks are admitted only after earlier lanes settle. */
export function sourcePlan(input:SourcePlanInput):SourceTask[] {
  const product=getCatalogueItem(input.productId);
  if(!product)throw new Error('Unknown sourcing product.');
  const activities=MATERIAL_ACTIVITIES[input.productId]??[product.shortName];
  const material=input.keyword?.trim()||product.shortName;
  const markets=[...new Set(input.markets)].map(code=>({code,name:COUNTRIES.find(c=>c.code===code)?.name})).filter(c=>c.name);
  const tasks:SourceTask[]=[];
  const add=(lane:SourcingLane,source:SourceTask['source'],market:string,n:number,extra:Partial<SourceTask>)=>{
    if(input.lanes&&!input.lanes.includes(lane))return;
    tasks.push({id:`hybrid-v1:${input.productId}:${market}:${lane}:${source}:${n}`,lane,source,market,
      priority:lane==='trigger'?2000:lane==='roundup'?1000:-100,...extra});
  };
  for(const {code,name} of markets){
    const activity=activities[0];
    add('trigger','bing-query',code,0,{query:`${activity} contract awarded ${name}`});
    add('trigger','bing-query',code,1,{query:`wins ${activity} contract ${name}`});
    add('trigger','tavily',code,0,{query:`${material} ${activity} contract awarded orders ${name}`,topic:'news',days:365});
    if(TED_COUNTRIES[code])add('trigger','ted',code,0,{});
    for(const [n,registry] of RESEARCH_SOURCES.filter(r=>r.country===code&&r.materials.includes(input.productId)&&r.permission==='public-listing').entries()){
      add('roundup','registry',code,n,{url:registry.url,registryId:registry.id,priority:1950,includeDomains:[new URL(registry.url).hostname.replace(/^www\./,'')]});
    }
    add('roundup','tavily',code,0,{query:`${activity} contractors ${name} list top companies`,topic:'general'});
    // Direct company searches: one by consuming work, one by the reviewed buyer segment further down
    // the chain ("Shipyards Malaysia", "Piping and mechanical subcontractors India").
    const segments=whoBuys(input.productId);
    add('capability','tavily',code,0,{query:`${activities[0]} contractor ${name} services projects`,topic:'general'});
    add('capability','tavily',code,1,{query:segments[1]?`${segments[1]} ${name} company`:`${activities[1%activities.length]} contractor ${name} services projects`,topic:'general'});
  }
  return tasks.sort((a,b)=>b.priority-a.priority);
}
export function tavilyTask(task:SourceTask):PlannedBuyerQuery {
  if(task.source!=='tavily'||!task.query)throw new Error('Task is not a Tavily query.');
  return {key:task.id,market:task.market,lane:task.lane==='trigger'?'news':task.lane==='roundup'?'directory':'company',
    activityIndex:0,query:task.query,topic:task.topic,days:task.days,sourcingLane:task.lane,includeDomains:task.includeDomains};
}
