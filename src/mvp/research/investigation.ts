import { createHash } from "node:crypto";
import type { Db, Queryable } from "@/mvp/db";
import type { RawDoc } from "@/mvp/pipeline/contracts";
import type { RunInput } from "@/mvp/types";
import { namesCompany } from "@/mvp/discovery/evidence";
import { buyerPageCandidate } from "@/mvp/discovery/plan";
import { addJob } from "./store";
import { readLane, readLaneLimits } from "./registry";

export interface ResearchCandidate {id:string;key:string;company:string;domain_hint:string|null;identity_document_id:string|null;identity_quote:string|null;document_ids:string[];state:string}
export interface DirectorySeed {company:string;quote:string|null;domain:string|null;row:number}
const PERSONAL=/^(?:gmail|googlemail|outlook|hotmail|yahoo|icloud|protonmail|aol)\./i;
const NON_COMPANY=/(?:^|\.)(?:linkedin\.com|facebook\.com|instagram\.com|youtube\.com|rocketreach\.co|tracxn\.com|cbinsights\.com|ensun\.io|foundit\.in|economictimes\.(?:com|indiatimes\.com)|urbanacres\.in|constructionweekonline\.com|gulfnews\.com|reuters\.com)$/i;
export const domainOf=(url:string)=>new URL(url).hostname.toLowerCase().replace(/^www\./,"");
const normalized=(name:string)=>name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
/** Entire rows, never neighbouring phone/email cells. Listing seeds still require work evidence. */
export function directorySeeds(text:string,productId:string):DirectorySeed[] {
  if(!/company\s*name/i.test(text)||!/(?:builder|contractor)\s*(?:category|type|name)/i.test(text))return [];
  const result:DirectorySeed[]=[];
  for(const [row,line] of text.split('\n').entries()) {
    const cells=line.split(/\s*\|\s*/).map(s=>s.trim());
    if(cells.length<3||!cells.some(c=>/^contractor$/i.test(c))||cells.some(c=>/^consultant$/i.test(c)))continue;
    const company=cells[0];if(company.length<5||company.length>180||!/[a-z]/i.test(company))continue;
    if(['cables','cable-trays'].includes(productId)&&!cells.some(c=>/electrical|utility|infrastructure/i.test(c)))continue;
    const email=line.match(/[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/i);
    const domain=email&&!PERSONAL.test(email[1])?email[1].toLowerCase():null;
    result.push({company,quote:line,domain,row:row+1});
  }
  return [...new Map(result.map(s=>[normalized(s.company),s])).values()];
}
/** Conservative page-brand seed. A title/hint is not a purchasing or legal-verification claim. */
export function pageCompany(text:string,title:string|null,url:string):string|null {
  if(NON_COMPANY.test(domainOf(url)))return null;
  const legal=/\b(?:contracting|contractors?|engineering|infrastructure|fabrication|construction|utility|utilities|mechanical|electrical|steel)\b/i;
  const domain=domainOf(url).split('.')[0].replace(/[^a-z0-9]/g,'');
  const genericFirst=/^(?:cable|cables|pipe|pipes|pipeline|gas|oil|electrical|mechanical|civil|structural|industrial|engineering|construction|building|comprehensive|third|power|steel|utility|utilities|services?|solutions?|design|installation|maintenance|inspection|testing|top|latest|best|about|contact|welcome)$/i;
  const segments=(title??'').split(/\s+[|–—-]\s+|\s*\|\s*/);
  for(const segment of [...segments].reverse()) {
    const name=segment.replace(/^(?:home|welcome to)\s*[:–—-]?\s*/i,'').trim();
    const tokens=name.match(/[\p{L}\p{N}]+/gu)??[];
    const first=tokens[0]?.toLowerCase()??'';
    const domainBrand=!genericFirst.test(first)&&(first.length>=5&&domain.startsWith(first)||tokens.join('').toLowerCase()===domain);
    const declaredBrand=segments.length>1&&segment===segments.at(-1)&&tokens.length>=2&&!genericFirst.test(first);
    const namedBusiness=/\b(?:llc|ltd|limited|inc|plc|corporation)\b/i.test(name)||legal.test(name)&&first.length>=3&&!genericFirst.test(first);
    if(name.length>=5&&name.length<=105&&(domainBrand||namedBusiness||declaredBrand)&&namesCompany(text,[name])&&!/^(?:our |services|projects|electrical installation|pipeline construction|cable laying in|top \d|best \d|approved |list of|directory)|\b(?:news|awarded|wins?|secured|jobs|market|report|tender|contract award)\b/i.test(name))return name;
  }
  return null;
}
export async function registerCandidate(tx:Queryable,runId:string,company:string,domain:string|null,documentId:string,quote:string|null) {
  const key=createHash('sha256').update(normalized(company)).digest('hex');
  const candidate=(await tx.query<ResearchCandidate>(`insert into research_candidates(run_id,key,company,domain_hint,identity_document_id,identity_quote)
    values($1,$2,$3,$4,$5,$6) on conflict(run_id,key) do update set domain_hint=coalesce(research_candidates.domain_hint,excluded.domain_hint),updated_at=now() returning *`,[runId,key,company,domain,documentId,quote])).rows[0];
  return candidate;
}
/** One shared queue admission contract for initial sources, directory pagination and follow-ups. */
export async function queueRead(tx:Queryable,runId:string,raw:RawDoc,budget:{maxPages:number},priority=35) {
  const keys=(await tx.query<{key:string;payload:{raw?:RawDoc}}>("select key,payload from research_jobs where run_id=$1 and stage='read'",[runId])).rows;
  if(keys.some(k=>k.key===raw.url))return true;
  const lane=readLane(raw);const limits=readLaneLimits(budget.maxPages);
  if(keys.length>=budget.maxPages||keys.filter(k=>k.payload.raw&&readLane(k.payload.raw)===lane).length>=limits[lane])return false;
  await addJob(tx,runId,'read',raw.url,{raw},priority);return true;
}
export async function seedInvestigations(db:Db,runId:string,input:RunInput,documentId:string,raw:RawDoc,text:string,title:string|null,budget:{maxPages:number}) {
  const seeds=raw.research?.lane==='directory'?directorySeeds(text,input.productId!):[];
  const directory=Boolean(raw.research?.registryId)||seeds.length>0||/\b(?:top \d+|best \d+|list of|directory)\b/i.test(title??'');
  const ownName=!directory?pageCompany(text,title,raw.url):null;
  if(ownName)seeds.push({company:ownName,domain:domainOf(raw.url),quote:null,row:0});
  let queued=0;
  for(const seed of seeds)await db.tx(async tx=>{
    const c=await registerCandidate(tx,runId,seed.company,seed.domain,documentId,seed.quote);
    if(!seed.domain){await tx.query("update research_candidates set state='review',reason='Official website not established; no guessed contact.' where id=$1",[c.id]);return;}
    if(ownName){await tx.query('update research_candidates set document_ids=array(select distinct unnest(document_ids || $2::uuid[])) where id=$1',[c.id,[documentId]]);queued++;return;}
    const follow:RawDoc={sourceKey:'company-investigation',sourceName:seed.company,tier:'B',url:`https://${seed.domain}/`,title:null,publishedAt:null,text:null,isSample:false,research:{lane:'investigation',candidateId:c.id}};
    if(await queueRead(tx,runId,follow,budget,46))queued++;
    else await tx.query("update research_candidates set state='review',reason='Company investigation deferred by the shared reading budget.' where id=$1",[c.id]);
  });
  return {seeds:seeds.length,queued,ownName};
}
export async function candidateForPage(db:Db,runId:string,raw:RawDoc):Promise<ResearchCandidate|null> {
  if(raw.research?.candidateId)return (await db.query<ResearchCandidate>('select * from research_candidates where id=$1 and run_id=$2',[raw.research.candidateId,runId])).rows[0]??null;
  return (await db.query<ResearchCandidate>('select * from research_candidates where run_id=$1 and domain_hint=$2 and document_ids<>\'{}\' order by created_at limit 1',[runId,domainOf(raw.url)])).rows[0]??null;
}
export function companyPageLinks(links:{url:string;text:string}[],domain:string) {
  return [...new Map(links.filter(l=>{
    try{const u=new URL(l.url);return /^https?:$/.test(u.protocol)&&domainOf(l.url)===domain
      &&!u.search&&!/\.(?:png|jpg|svg|zip|mp4)$/i.test(u.pathname)
      &&/services?|capabilit|projects?|contact|about|pipeline|electrical|mechanical|steel|utility/i.test(u.pathname+' '+l.text);
    }catch{return false;}
  }).map(l=>[l.url,l])).values()].sort((a,b)=>{
    const score=(l:{url:string;text:string})=>/services?|capabilit|pipeline|electrical|utility/i.test(l.url+' '+l.text)?3:/contact/i.test(l.url+' '+l.text)?2:1;
    return score(b)-score(a);
  });
}
/** Identity on the company's own domain must corroborate a directory hint before bundling. */
export function candidatePageIdentity(candidate:ResearchCandidate,text:string) {
  const short=candidate.company.replace(/(?:[,\s]+(?:L\.?L\.?C\.?|LIMITED|LTD\.?|PVT\.?|PRIVATE|CO\.?))+\s*$/i,'').trim();
  return namesCompany(text,[candidate.company])||(short.length>=8&&short.split(/\s+/).length>=2&&namesCompany(text,[short]));
}
export async function extendInvestigation(db:Db,runId:string,c:ResearchCandidate,raw:RawDoc,documentId:string,text:string,links:{url:string;text:string}[],input:RunInput,budget:{maxPages:number}) {
  if(!c.domain_hint||domainOf(raw.url)!==c.domain_hint)return false;
  const domain=c.domain_hint;
  const prior=(await db.query<{text:string}>('select text from source_documents where id=any($1::uuid[])',[c.document_ids])).rows;
  if(!candidatePageIdentity(c,text)&&!prior.some(p=>candidatePageIdentity(c,p.text)))return false;
  await db.tx(async tx=>{
    await tx.query('update research_candidates set document_ids=array(select distinct unnest(document_ids || $2::uuid[])),updated_at=now() where id=$1',[c.id,[documentId]]);
    const jobs=(await tx.query<{payload:{raw:RawDoc}}>("select payload from research_jobs where run_id=$1 and stage='read' and payload->'raw'->'research'->>'candidateId'=$2",[runId,c.id])).rows;
    let slots=Math.max(0,3-jobs.length-(raw.research?.candidateId?0:1));
    for(const link of companyPageLinks(links,domain)){
      if(!slots||link.url===raw.url)continue;
      const next:RawDoc={...raw,url:link.url,title:null,text:null,research:{lane:'investigation',candidateId:c.id}};
      if(await queueRead(tx,runId,next,budget,45))slots--;
    }
    if(buyerPageCandidate(text,input.productId!)||prior.some(p=>buyerPageCandidate(p.text,input.productId!)))
      await addJob(tx,runId,'analyse',`bundle:${c.id}`,{candidateId:c.id},30);
  });
  return true;
}
