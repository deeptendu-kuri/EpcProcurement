/** Session-protected table read model. Never collects pages or starts workers/email. */
import {getDb,type Queryable} from '@/mvp/db';
import {loadBuyerRecords} from '@/mvp/buyers/load';
import {buildTeam} from '@/mvp/buyers/team';
import {stageFromClass} from '@/mvp/buyers/view';
import type {BuyerRole,LeadRow,ContractorRow,SubcontractorRow,ContactSlot} from '@/mvp/buyers/types';
import {triggerProofs,triggersForCompany,strongestTrigger,triggerStageCap} from '@/mvp/sourcing/triggers';
import {companyIdentityReason} from '@/mvp/sourcing/entities';
import {capabilityLabel,countriesInQuote} from '@/mvp/discovery/locations';
import {namesCompany,originalQuote} from '@/mvp/discovery/evidence';
import {searchedProductLabel} from '@/mvp/config/product-label';
import type {TableQuery,TableResult,TableContact,WorkspaceRef,TableRow} from './contracts';

interface Opp {
  id:string;run_id:string;lead_id:string;company_id:string;product_id:string;product_name:string;keyword:string;
  evidence_ids:string[];qualification:string;name:string;country:string|null;domain:string|null;types:string[];
  class:string;score:number;confidence_band:'high'|'medium'|'low';status:string;is_sample:boolean;
  activity_status:string|null;material_fit_kind:string|null;
}
export interface CompanyTableView {row:LeadRow;role:BuyerRole;contractorRole:ContractorRow['role'];team:ContactSlot[];contacts:TableContact[];ref:WorkspaceRef;refProduct:string;qualification:string;activity:string;}
export interface ChainTableView {row:SubcontractorRow;contacts:TableContact[];opportunityId:string|null;tier?:2|3;}
export interface TableDataset {companies:CompanyTableView[];chain:ChainTableView[];truncated:boolean;}
const roleOf=(types:string[],fallback:BuyerRole='epc_contractor'):BuyerRole=>types.includes('subcontractor')?'subcontractor':types.some(t=>/manufacturer|supplier/.test(t))?'manufacturer':types.includes('owner')?'owner':fallback;
/** A name isn't a proved fact merely because its record or verification flag exists. */
export async function companyTableView(db:Queryable,o:Opp,team:ContactSlot[]=[],now=new Date()):Promise<CompanyTableView|null> {
  const triggers=await triggersForCompany(db,o.company_id,o.run_id,o.product_id);
  const proof=await triggerProofs(db,[...new Set([...o.evidence_ids,...triggers.flatMap(t=>t.evidenceIds)])]);
  if(!proof.some(p=>namesCompany(p.quote,[o.name]))||companyIdentityReason(o.name,{confirmedDomain:o.domain,registryRow:triggers.some(t=>t.kind!=='capability')}))return null;
  const trigger=strongestTrigger(triggers);const role=roleOf(o.types);
  const validIds=new Set(proof.map(p=>p.id));
  // Contacts without web proof may still be edited in the existing workspace, but are not presented as sourced people here.
  const checkedTeam=team.map(s=>({...s,person:s.person&&proof.some(p=>s.person!.evidenceIds.includes(p.id)&&originalQuote(p.quote,s.person!.name)&&(!s.person!.title||originalQuote(p.quote,s.person!.title)))?s.person:null})).map(s=>({...s,status:s.person?s.status:'not_found' as const}));
  const found=checkedTeam.filter(s=>s.person).length;
  const hqProof=(await db.query<{quote:string;text:string}>(`select e.quote,d.text from fact_evidence f join evidence e on e.id=f.evidence_id join source_documents d on d.id=e.document_id
    where f.entity_type='company' and f.entity_id=$1 and f.field in ('country','hq_country') and e.quote_verified=true and d.is_sample=false`,[o.company_id])).rows;
  const hq=o.country&&hqProof.some(p=>originalQuote(p.text,p.quote)&&countriesInQuote(p.quote,[o.name]).includes(o.country!))?o.country:null;
  const activity=proof.map(p=>capabilityLabel(o.product_id,p.quote)).find(Boolean)??'';
  const row:LeadRow={opportunityId:o.id,companyId:o.company_id,name:o.name,whatTheyDo:activity,trigger,
    operatingCountry:trigger?.country??null,hqCountry:hq,sellSummary:searchedProductLabel(o.product_id,o.keyword,o.product_name),
    fitScore:Number(o.score??0),howSure:o.confidence_band??'low',stage:o.qualification==='rejected'?'not_buyer':triggerStageCap(trigger,stageFromClass(o.class),now),
    contactsFound:found,contactsTotal:checkedTeam.length,sourceCount:new Set(proof.map(p=>p.document_id)).size,status:o.status,isSample:o.is_sample};
  const personIds=checkedTeam.flatMap(s=>s.person?[s.person.id]:[]);
  const points=personIds.length?(await db.query<{person_id:string;kind:string;value:string;verified:boolean;source:string}>(`select cp.person_id,cp.kind,cp.value,cp.source,
    (cp.verified_at>now()-interval '90 days' and cp.source like 'provider:%' and cp.validation_status='valid'
      and p.confirmed_at>now()-interval '90 days' and exists(select 1 from person_roles pr where pr.person_id=p.id
        and (pr.company_id=p.current_company_id or pr.company_id is null) and pr.end_date is null)) as verified
    from contact_points cp join people p on p.id=cp.person_id where cp.person_id=any($1::uuid[]) and cp.kind in ('email','phone')`,[personIds])).rows:[];
  const contacts:TableContact[]=checkedTeam.map(s=>{
    const ps=points.filter(p=>p.person_id===s.person?.id&&!o.is_sample);const email=ps.find(p=>p.kind==='email'&&p.verified);const phone=ps.find(p=>p.kind==='phone'&&p.verified);
    return {...s,companyId:o.company_id,companyName:o.name,opportunityId:o.id,tier:1,email:email?.value??null,phone:phone?.value??null,validated:Boolean(email)&&!o.is_sample,
      source:s.person?.evidenceIds.some(id=>validIds.has(id))?'Verified page quote':''};
  });
  return {row,role,contractorRole:trigger?.role==='subcontractor'?'subcontractor':proof.some(p=>/\bEPC\b|engineering,? procurement (?:and|&) construction/i.test(p.quote))?'epc':'main_contractor',team:checkedTeam,contacts,ref:{companyId:o.company_id,opportunityId:o.id,leadId:o.lead_id,keyword:o.keyword,role},refProduct:o.product_id,qualification:o.qualification,activity:o.activity_status??'unknown'};
}
export async function tableDataset(run:string,db:Queryable=getDb(),now=new Date()):Promise<TableDataset> {
  if(run==='none')return {companies:[],chain:[],truncated:false};
  const opps=(await db.query<Opp>(`select o.*,c.canonical_name as name,c.country,c.domain,c.types,l.class,l.score,l.confidence_band,l.status,l.is_sample
    from search_opportunities o join leads l on l.id=o.lead_id join companies c on c.id=o.company_id
    where ($1::uuid is null or o.run_id=$1) order by o.created_at desc,o.id limit 2001`,[run==='all'?null:run])).rows;
  const selected=opps.slice(0,2000);const records=await loadBuyerRecords({leadIds:selected.map(o=>o.lead_id),db,now});
  const byLead=new Map(records.map(r=>[r.view.leadId,r.view]));const companies:CompanyTableView[]=[];
  for(const o of selected){
    const view=byLead.get(o.lead_id);const team=view?.team??buildTeam(roleOf(o.types),o.name,[]);
    // Person evidence is independently checked, not limited to the opportunity's material evidence.
    const peopleIds=team.flatMap(s=>s.person?.evidenceIds??[]);
    const extra=await triggerProofs(db,peopleIds);
    const company=await companyTableView(db,{...o,evidence_ids:[...o.evidence_ids,...extra.map(e=>e.id)]},team,now);
    if(company)companies.push(company);
  }
  const chain:ChainTableView[]=[];
  // Two bounded hops: tier 2 and tier 3. No needs-map guesses or cyclic expansion.
  let frontier=companies.map(c=>({id:c.row.companyId,name:c.row.name,root:c,path:[c.row.companyId]}));
  const edges=new Set<string>();
  for(const tier of [2,3] as const){
  const next:typeof frontier=[];
  const links=frontier.length?(await db.query<{company_id:string;parent_company_id:string;supplier_type:string;strength:'confirmed'|'likely'|'possible';evidence_ids:string[];action:string}>(`select distinct on (parent_company_id,supplier_type,company_id) * from chain_links
    where parent_company_id=any($1::uuid[]) order by parent_company_id,supplier_type,company_id,created_at desc,id desc`,[frontier.map(p=>p.id)])).rows:[];
  for(const link of links){
    if(link.action!=='set')continue;
    const parent=frontier.find(c=>c.id===link.parent_company_id)!;
    const key=`${parent.id}:${link.company_id}`;
    if(parent.path.includes(link.company_id)||edges.has(key))continue;
    const child=(await db.query<{canonical_name:string;domain:string|null;types:string[]}>('select canonical_name,domain,types from companies where id=$1',[link.company_id])).rows[0];
    if(!child||companyIdentityReason(child.canonical_name,{confirmedDomain:child.domain,registryRow:link.evidence_ids.length>0}))continue;
    const proof=await triggerProofs(db,link.evidence_ids);
    const named=proof.filter(p=>namesCompany(p.quote,[child.canonical_name])&&namesCompany(p.quote,[parent.name]));
    if(!named.length)continue; // A user-set edge without source proof remains editable in the old workspace, not asserted here.
    const same=companies.find(c=>c.row.companyId===link.company_id);
    const team=same?.team??buildTeam(roleOf(child.types,'subcontractor'),child.canonical_name,[]);
    const row:SubcontractorRow={companyId:link.company_id,name:child.canonical_name,
      supplies:named.map(p=>capabilityLabel(parent.root.refProduct,p.quote)).find(Boolean)??'',
      linkedToCompanyId:parent.id,linkedToName:parent.name,
      link:link.strength==='confirmed'&&!named.some(p=>/\b(?:subcontract\w*|supplied|supplies|nominated)\b/i.test(p.quote))?'possible':link.strength,
      country:same?.row.operatingCountry??named.flatMap(p=>countriesInQuote(p.quote,[child.canonical_name,parent.name]))[0]??null,sellSummary:parent.root.row.sellSummary,contactsFound:same?.row.contactsFound??0,contactsTotal:team.length,
      sourceCount:new Set(named.map(p=>p.document_id)).size};
    edges.add(key);next.push({id:link.company_id,name:child.canonical_name,root:parent.root,path:[...parent.path,link.company_id]});
    chain.push({row,tier,opportunityId:same?.row.opportunityId??null,contacts:same?.contacts.map(c=>({...c,tier}))??team.map(s=>({...s,companyId:link.company_id,companyName:child.canonical_name,opportunityId:null,tier,email:null,phone:null,validated:false,source:''}))});
  }
  frontier=next;
  }
  return {companies,chain,truncated:opps.length>2000};
}
export function filterTables(data:TableDataset,q:TableQuery,now=new Date()):TableResult {
  const base=data.companies.filter(c=>q.qualification?c.qualification===q.qualification:q.showRejected==='1'||c.qualification!=='rejected');
  const match=base.filter(c=>{
    const r=c.row;const date=r.trigger?.date;const days=date?(now.getTime()-Date.parse(date))/86400000:null;
    return (!q.country||r.operatingCountry===q.country)&&(!q.role||c.role===q.role)&&(!q.trigger||r.trigger?.kind===q.trigger)
      &&(!q.age||(q.age==='undated'?!date:days!==null&&days>=0&&days<=Number(q.age)))
      &&(!q.fit||r.stage===q.fit)&&(!q.product||q.product===c.refProduct)
      &&(!q.keyword||c.ref.keyword.toLowerCase().includes(q.keyword.toLowerCase()))&&(!q.q||`${r.name} ${r.whatTheyDo} ${r.trigger?.title??''}`.toLowerCase().includes(q.q.toLowerCase()))
      &&(!q.company||r.companyId===q.company)
      &&(!q.contactRole||c.contacts.some(s=>s.person&&s.role===q.contactRole))
      &&(!q.contacts||(q.contacts==='missing'?r.contactsFound===0:q.contacts==='validated'?c.contacts.some(s=>s.validated):r.contactsFound>0))
      &&(!q.activity||(q.activity==='active'?['recent','ongoing'].includes(c.activity):c.activity===q.activity));
  });
  const contractors:ContractorRow[]=match.flatMap(c=>c.row.trigger&&c.row.trigger.kind!=='capability'&&c.row.trigger.role!=='owner'&&c.row.trigger.role!=='supplier'?[{...c.row,role:c.contractorRole,projectName:c.row.trigger.projectName,ownerName:c.row.trigger.ownerName}]:[]);
  const selected=new Set(match.map(c=>c.row.companyId));const reachable=new Set(selected);
  for(let hop=0;hop<2;hop++)for(const c of data.chain)if(reachable.has(c.row.linkedToCompanyId))reachable.add(c.row.companyId);
  const chain=data.chain.filter(c=>reachable.has(c.row.linkedToCompanyId));
  const contacts=[...new Map([...match.flatMap(c=>c.contacts),...chain.filter(c=>!selected.has(c.row.companyId)).flatMap(c=>c.contacts)].map(c=>[`${c.companyId}:${c.slotId}`,c])).values()];
  const lists={leads:match.map(c=>c.row),contractors,subcontractors:chain.map(c=>c.row),contacts};
  const rows:TableRow[]=[...lists[q.tab]];
  const number=(r:TableRow,field:'date'|'value'|'fit')=>'trigger' in r?(field==='date'?(r.trigger?.date?Date.parse(r.trigger.date):-Infinity):field==='value'?r.trigger?.valueUsd??-Infinity:r.fitScore):-Infinity;
  rows.sort((a,b)=>{if(q.sort==='name')return ('name' in a?a.name:a.companyName).localeCompare('name' in b?b.name:b.companyName);
    const [field,dir]=q.sort.split('_') as ['date'|'value'|'fit','asc'|'desc'];const av=number(a,field),bv=number(b,field);return av===bv?0:(av<bv?-1:1)*(dir==='asc'?1:-1);});
  return {rows:rows.slice((q.page-1)*q.size,q.page*q.size),total:rows.length,facets:{
    countries:[...new Set(base.flatMap(c=>c.row.operatingCountry?[c.row.operatingCountry]:[]))].sort(),
    products:[...new Map(base.map(c=>[c.refProduct,{id:c.refProduct,name:c.row.sellSummary}])).values()],roles:[...new Set(base.map(c=>c.role))],
    counts:{leads:lists.leads.length,contractors:contractors.length,subcontractors:chain.length,contacts:contacts.length},
    capabilityOnly:match.filter(c=>c.row.trigger?.kind==='capability').length,workspaces:base.map(c=>c.ref),truncated:data.truncated}};
}
export async function crmTables(q:TableQuery,db:Queryable=getDb(),now=new Date()):Promise<TableResult>{return filterTables(await tableDataset(q.run,db,now),q,now);}
