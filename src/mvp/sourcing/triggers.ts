/** Evidence-linked hybrid triggers. No collection, enrichment, recipient or worker side effects. */
import type {Queryable} from '@/mvp/db';
import type {Trigger} from '@/mvp/buyers/types';
import {companyGroupKey} from '@/mvp/buyers/group';
import {normalizeCompanyName,parseDate,parseMoney,MONEY_RE,companyKeys} from '@/mvp/pipeline/text';
import {valuesClose} from '@/mvp/pipeline/merge';
import {namesCompany,originalQuote} from '@/mvp/discovery/evidence';
import {countriesInQuote} from '@/mvp/discovery/locations';
import {nonCompanyDomain} from './entities';

export interface TriggerSql {
  id:string;company_id:string;run_id:string|null;product_id:string|null;kind:Trigger['kind'];role:Trigger['role'];
  project_id:string|null;title:string;value_usd:number|string|null;value_text:string|null;event_date:string|null;
  date_precision:Trigger['datePrecision'];country:string|null;evidence_ids:string[];strength:Trigger['strength'];
  project_name?:string|null;owner_name?:string|null;
}
export function triggerView(t:TriggerSql):Trigger {
  return {id:t.id,kind:t.kind,role:t.role,title:t.title,date:t.event_date?.slice(0,10)??null,datePrecision:t.date_precision??'unknown',
    valueUsd:t.value_usd===null?null:Number(t.value_usd),valueText:t.value_text,country:t.country,projectId:t.project_id,
    projectName:t.project_name??null,ownerName:t.owner_name??null,strength:t.strength,evidenceIds:t.evidence_ids};
}
/** Dated work wins over capability. Recency breaks ties, never changes evidence strength. */
export function strongestTrigger(triggers:Trigger[]):Trigger|null {
  const weight=(t:Trigger)=>t.kind==='capability'?0:t.strength==='confirmed'?3:t.strength==='likely'?2:1;
  return [...triggers].sort((a,b)=>weight(b)-weight(a)||Number(Boolean(b.date))-Number(Boolean(a.date))||(b.date??'').localeCompare(a.date??'')||a.id.localeCompare(b.id))[0]??null;
}
export function triggerStageCap(t:Trigger|null,stage:'ready'|'check'|'early'|'not_buyer',now=new Date()):typeof stage {
  if(stage==='not_buyer')return stage;
  const cutoff=new Date(now);cutoff.setUTCMonth(cutoff.getUTCMonth()-18);
  return !t||t.kind==='capability'||!t.date||t.date<cutoff.toISOString().slice(0,10)||t.date>now.toISOString().slice(0,10)?'early':stage;
}
interface Proof {id:string;quote:string;text:string;field?:string;document_id:string;}
export async function triggerProofs(db:Queryable,ids:string[]):Promise<Proof[]> {
  if(!ids.length)return [];
  return (await db.query<Proof>(`select e.id,e.quote,d.text,e.document_id from evidence e join source_documents d on d.id=e.document_id
    where e.id=any($1::uuid[]) and e.quote_verified=true and d.is_sample=false`,[ids])).rows.flatMap(p=>{
      const quote=originalQuote(p.text,p.quote);return quote?[{...p,quote}]:[];
    });
}
/** Shared canonical identity BEFORE inserting company×product×run opportunities. */
export async function resolveBuyerCompany(db:Queryable,name:string,country:string|null,role:string,domain:string|null=null) {
  const normalized=normalizeCompanyName(name);const group=companyGroupKey('',name);
  const keys=companyKeys(name).keys;
  const safeDomain=domain&&!nonCompanyDomain(domain)?domain:null;
  const rows=(await db.query<{id:string;canonical_name:string;country:string|null;domain:string|null}>('select id,canonical_name,country,domain from companies order by created_at,id')).rows;
  const matches=rows.filter(c=>(companyGroupKey(c.id,c.canonical_name)===group||companyKeys(c.canonical_name).keys.some(k=>keys.includes(k)))&&(c.country===country||!country||!c.country||Boolean(safeDomain&&c.domain===safeDomain)));
  const found=matches.find(c=>safeDomain&&c.domain===safeDomain)??matches[0];
  if(found){
    await db.query(`update companies set country=coalesce(country,$2),domain=coalesce(domain,$3),types=array(select distinct unnest(types||$4::text[])),updated_at=now() where id=$1`,[found.id,country,safeDomain,[role]]);
    return {id:found.id};
  }
  return (await db.query<{id:string}>('insert into companies(canonical_name,normalized_name,country,domain,types) values($1,$2,$3,$4,$5::text[]) returning id',[name,normalized,country,safeDomain,[role]])).rows[0];
}
export async function triggersForCompany(db:Queryable,companyId:string,runId?:string,productId?:string):Promise<Trigger[]> {
  const rows=(await db.query<TriggerSql>(`select t.*,t.event_date::text as event_date,p.name as project_name,c.canonical_name as owner_name from company_triggers t
    left join projects p on p.id=t.project_id left join companies c on c.id=p.owner_company_id
    where t.company_id=$1 and ($2::uuid is null or t.run_id=$2) and ($3::text is null or t.product_id=$3)`,[companyId,runId??null,productId??null])).rows;
  const out:Trigger[]=[];
  for(const row of rows){
    const proofs=await triggerProofs(db,row.evidence_ids);if(!proofs.length||!proofs.some(p=>originalQuote(p.text,row.title)))continue;
    const original=triggerView({...row,evidence_ids:proofs.map(p=>p.id)});
    const checked=groundedTrigger(original,proofs);if(!checked)continue;
    out.push({...checked,id:row.id,
      projectName:original.projectName&&proofs.some(p=>originalQuote(p.quote,original.projectName!))?original.projectName:null,
      ownerName:original.ownerName&&proofs.some(p=>namesCompany(p.quote,[original.ownerName!]))?original.ownerName:null});
  }
  return out;
}
export async function syncOpportunityTrigger(db:Queryable,runId:string,companyId:string,productId:string) {
  const best=strongestTrigger(await triggersForCompany(db,companyId,runId,productId));if(!best)return;
  await db.query(`update search_opportunities set trigger_id=$4,trigger_kind=$5,trigger_date=$6::date,operating_country=$7
    where run_id=$1 and company_id=$2 and product_id=$3`,[runId,companyId,productId,best.id,best.kind,best.date,best.country]);
  if(triggerStageCap(best,'ready')==='early')await db.query(`update leads set class='watch' where id in(select lead_id from search_opportunities where run_id=$1 and company_id=$2 and product_id=$3) and class in ('genuine','research')`,[runId,companyId,productId]);
}
/** Optional facts are independently supported, not made true by a verified identity quote. */
function groundedTrigger(t:Omit<Trigger,'id'>,proofs:Proof[]):Omit<Trigger,'id'>|null {
  const title=proofs.flatMap(p=>{const q=originalQuote(p.quote,t.title);return q?[q]:[];})[0];
  if(!title)return null;
  const event=/\b(?:awards?|awarded|wins?|won|secures?|secured|bags?|received|letter of award|winner|contract award|subcontract|tender|order)\b/i;
  if(t.kind!=='capability'&&!event.test(title))return null;
  const date=proofs.map(p=>quotedTriggerDate(t.date,p.quote)).find(d=>d.date)??{date:null,precision:'unknown' as const};
  const valueQuote=t.valueText?proofs.flatMap(p=>{const q=originalQuote(p.quote,t.valueText!);return q?[q]:[];})[0]:null;
  const money=valueQuote?[...valueQuote.matchAll(new RegExp(MONEY_RE.source,'gi'))].map(m=>parseMoney(m[0])).find(m=>m?.usd!==null&&t.valueUsd!==null&&valuesClose(m!.usd!,t.valueUsd,0.015)):null;
  const country=t.country&&proofs.some(p=>countriesInQuote(p.quote).includes(t.country!))?t.country:null;
  return {...t,title,date:date.date,datePrecision:date.precision,country,valueUsd:money?.usd??null,valueText:money?valueQuote??null:null,
    // Capability describes an activity, not a contract/project or an awarded amount.
    ...(t.kind==='capability'?{date:null,datePrecision:'unknown' as const,valueUsd:null,valueText:null,projectId:null,projectName:null,ownerName:null,strength:'possible' as const}:{}),
    evidenceIds:proofs.map(p=>p.id)};
}
/** Append source proofs to one deal (±15% USD, ≤30 days); never combine unrelated values/dates. */
export async function storeTrigger(db:Queryable,runId:string,companyId:string,productId:string,t:Omit<Trigger,'id'>):Promise<Trigger|null> {
  const proofs=await triggerProofs(db,t.evidenceIds);
  const incoming=groundedTrigger(t,proofs);if(!incoming)return null;
  t=incoming;const title=t.title;
  const existing=await triggersForCompany(db,companyId,runId,productId);
  const same=existing.find(e=>e.kind===t.kind&&e.role===t.role&&e.country===t.country&&(
    t.kind==='capability'||e.projectId===t.projectId&&e.title===title||Boolean(e.date&&t.date&&Math.abs(Date.parse(e.date)-Date.parse(t.date))<=30*86400000&&e.valueUsd!==null&&t.valueUsd!==null&&valuesClose(e.valueUsd,t.valueUsd))));
  let id:string;
  if(same){
    id=same.id;
    await db.query('update company_triggers set evidence_ids=array(select distinct unnest(evidence_ids||$2::uuid[])) where id=$1',[id,incoming.evidenceIds]);
  }else{
    id=(await db.query<{id:string}>(`insert into company_triggers(company_id,run_id,product_id,kind,role,project_id,title,value_usd,value_text,event_date,date_precision,country,evidence_ids,strength)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11,$12,$13::uuid[],$14) returning id`,[companyId,runId,productId,t.kind,t.role,t.projectId,title,t.valueUsd,t.valueText,t.date,t.datePrecision,t.country,incoming.evidenceIds,t.strength])).rows[0].id;
  }
  if(t.country)await db.query('update companies set operating_countries=array(select distinct unnest(operating_countries||$2::text[])) where id=$1',[companyId,[t.country]]);
  await syncOpportunityTrigger(db,runId,companyId,productId);
  return (await triggersForCompany(db,companyId,runId,productId)).find(t=>t.id===id)??null;
}
/** Snapshot dates are not blindly accepted: publication alone is not an award date. */
export function quotedTriggerDate(value:string|null,quote:string|null):{date:string|null;precision:Trigger['datePrecision']} {
  if(!value||!quote||/^\s*(?:published|updated|copyright)\b/i.test(quote))return {date:null,precision:'unknown'};
  const year=value.slice(0,4);if(!quote.includes(year))return {date:null,precision:'unknown'};
  const parsed=parseDate(quote);
  if(parsed&&parsed.slice(0,10)===value.slice(0,10))return {date:value.slice(0,10),precision:/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}(?:[- /]|\s+)(?:\d{1,2}|[A-Za-z]{3,9})(?:[- /]|\s+)\d{4}\b|\b[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}\b/.test(quote)?'day':'month'};
  if(!parsed&&/\b(?:awarded|won|secured|order|contract)\b/i.test(quote)&&new RegExp('\\b'+year+'\\b').test(quote)&&value===year+'-01-01')return {date:value,precision:'year'};
  return {date:null,precision:'unknown'};
}
/** Persist award-engine outputs after original-text rechecking, with work geography, not HQ. */
export async function persistAwardTriggers(db:Queryable,runId:string,productId:string,snapshots:Trigger[]):Promise<Trigger[]> {
  const out:Trigger[]=[];
  for(const snapshot of snapshots){
    const party=(await db.query<{company_id:string}>('select company_id from project_parties where id=$1',[snapshot.id])).rows[0];if(!party)continue;
    const proofs=await triggerProofs(db,snapshot.evidenceIds);if(!proofs.length)continue;
    const facts=(await db.query<{field:string;evidence_id:string}>("select field,evidence_id from fact_evidence where entity_type='project_party' and entity_id=$1",[snapshot.id])).rows;
    const dateProof=proofs.find(p=>facts.some(f=>f.field==='award_date'&&f.evidence_id===p.id));
    const date=quotedTriggerDate(snapshot.date,dateProof?.quote??null);
    const geographic=proofs.flatMap(p=>countriesInQuote(p.quote));
    // TED description/project-location proof may be attached to the project, not its winner row.
    const projectProofs=snapshot.projectId?await triggerProofs(db,(await db.query<{evidence_id:string}>("select evidence_id from fact_evidence where entity_type='project' and entity_id=$1",[snapshot.projectId])).rows.map(p=>p.evidence_id)):[];
    const country=[...geographic,...projectProofs.flatMap(p=>countriesInQuote(p.quote))].find(c=>c===snapshot.country)??null;
    const stored=await storeTrigger(db,runId,party.company_id,productId,{...snapshot,date:date.date,datePrecision:date.precision,country,evidenceIds:[...snapshot.evidenceIds,...projectProofs.filter(p=>country&&countriesInQuote(p.quote).includes(country)).map(p=>p.id)]});
    if(stored)out.push(stored);
    if(stored?.kind==='subcontract'&&snapshot.projectId)await confirmedSubcontractLinks(db,party.company_id,snapshot.projectId,stored.evidenceIds);
  }
  return out;
}
/** A shared project alone is not a contractual tier-2 edge; its quote must name both firms. */
export async function confirmedSubcontractLinks(db:Queryable,companyId:string,projectId:string,evidenceIds:string[]) {
  const child=(await db.query<{canonical_name:string}>('select canonical_name from companies where id=$1',[companyId])).rows[0];if(!child)return;
  const parents=(await db.query<{company_id:string;canonical_name:string}>(`select pp.company_id,c.canonical_name from project_parties pp join companies c on c.id=pp.company_id
    where pp.project_id=$1 and pp.role in ('main_epc','consortium_member') and pp.company_id<>$2`,[projectId,companyId])).rows;
  const proofs=await triggerProofs(db,evidenceIds);
  for(const parent of parents){
    const ids=proofs.filter(p=>/\bsubcontract\w*|nominated subcontractor\b/i.test(p.quote)&&namesCompany(p.quote,[child.canonical_name])&&namesCompany(p.quote,[parent.canonical_name])).map(p=>p.id);
    if(!ids.length)continue;
    const current=(await db.query<{id:string}>("select id from chain_links where parent_company_id=$1 and company_id=$2 and project_id=$3 and strength='confirmed' and action='set' limit 1",[parent.company_id,companyId,projectId])).rows[0];
    if(current)await db.query('update chain_links set evidence_ids=array(select distinct unnest(evidence_ids||$2::uuid[])) where id=$1',[current.id,ids]);
    else await db.query("insert into chain_links(parent_company_id,supplier_type,company_id,action,created_by,strength,evidence_ids,project_id) values($1,'subcontractor',$2,'set','hybrid:quote','confirmed',$3::uuid[],$4)",[parent.company_id,companyId,ids,projectId]);
  }
}
export function quotedMoney(quote:string|null){return quote?parseMoney(quote):null;}
