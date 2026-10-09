/** Read-only evidence projections. Stored verification flags are never sufficient on their own. */
import {getDb,type Queryable} from '@/mvp/db';
import {tableDataset,type CompanyTableView,type TableDataset} from '@/mvp/crm/tables';
import {triggerProofs,triggersForCompany,strongestTrigger} from '@/mvp/sourcing/triggers';
import {classifyPage} from '@/mvp/sourcing/classify';
import {namesCompany,originalQuote} from '@/mvp/discovery/evidence';
import {companyIdentityReason} from '@/mvp/sourcing/entities';
import {sentenceFor} from '@/mvp/buyers/load';
import {buildTeam} from '@/mvp/buyers/team';
import {applicationSentence} from '@/mvp/discovery/application';
import type {EvidenceDrawerView,SourceCard,LeadRow} from '@/mvp/buyers/types';

interface SourceSql {id:string;document_id:string;quote:string;text:string;url:string;title:string|null;published_at:string|null;source_key:string;fields:string[];}
type Proves=SourceCard['quotes'][number]['proves'];
export function proofGroups(fields:string[],quote:string):Proves[]{
  const groups=new Set<Proves>();
  for(const field of fields){
    if(/date/.test(field))groups.add('date');
    if(/value|amount|money/.test(field))groups.add('value');
    if(/project|site/.test(field))groups.add('project');
    if(/country|location/.test(field))groups.add('country');
    if(/role|type/.test(field))groups.add('role');
    if(/person|full_name|title/.test(field))groups.add('people');
    if(/material|activity|capability|requirement/.test(field))groups.add('material');
  }
  if(/\b(?:won|wins?|awarded|secured|contract|orders?|subcontract)\b/i.test(quote))groups.add('award');
  if(!groups.size)groups.add('material');
  return [...groups];
}
/** Short title-like text with a title separator and no statement: "Products – Example Engineering Ltd". */
export function titleOnly(quote:string):boolean {
  const words=quote.trim().split(/\s+/).length;
  return words<=10&&/\s[–—|-]\s/.test(quote)&&!/\b(?:is|are|was|were|has|have|had|will|won|wins|secured|supplies|provides|manufactures|builds|fabricates|delivered|awarded)\b/i.test(quote);
}
export async function sourceCards(db:Queryable,ids:string[]):Promise<SourceCard[]>{
  if(!ids.length)return [];
  const rows=(await db.query<SourceSql>(`select e.id,e.document_id,e.quote,d.text,d.url,d.title,d.published_at::text as published_at,d.source_key,
    coalesce(array_agg(distinct f.entity_type||'.'||f.field) filter(where f.field is not null),'{}') as fields
    from evidence e join source_documents d on d.id=e.document_id left join fact_evidence f on f.evidence_id=e.id
    where e.id=any($1::uuid[]) and e.quote_verified=true and d.is_sample=false
    group by e.id,d.id order by d.published_at desc nulls last,d.id,e.id`,[ids])).rows;
  const cards=new Map<string,SourceCard>();
  for(const r of rows){
    const quote=originalQuote(r.text,r.quote);if(!quote)continue;
    // A page title ("Product & Services – Example Ltd") only names the company; it proves no work.
    if(titleOnly(quote))continue;
    let domain:string;try{const u=new URL(r.url);if(!['https:','http:'].includes(u.protocol))continue;domain=u.hostname;}catch{continue;}
    const classified=classifyPage({url:r.url,title:r.title,text:r.text});
    if(classified==='junk')continue;
    const kind:SourceCard['kind']=r.source_key.startsWith('directory:')?'directory':classified==='article'?'news':classified;
    const card=cards.get(r.document_id)??{documentId:r.document_id,url:r.url,domain,title:r.title??domain,publishedAt:r.published_at,kind,quotes:[]};
    for(const proves of proofGroups(r.fields,quote))card.quotes.push({evidenceId:r.id,sentence:sentenceFor(r.text,quote,null,null)??quote,highlight:quote,proves});
    cards.set(r.document_id,card);
  }
  return [...cards.values()];
}
async function companyProofIds(db:Queryable,companyId:string){
  return (await db.query<{evidence_id:string}>("select evidence_id from fact_evidence where entity_type='company' and entity_id=$1",[companyId])).rows.map(r=>r.evidence_id);
}
async function drawerView(db:Queryable,data:TableDataset,companyId:string,company:CompanyTableView|null,run?:string):Promise<EvidenceDrawerView|null>{
  const links=(await db.query<{evidence_ids:string[]}>(`select distinct on(parent_company_id,supplier_type,company_id) evidence_ids,action from chain_links
    where company_id=$1 or parent_company_id=$1 order by parent_company_id,supplier_type,company_id,created_at desc,id desc`,[companyId])).rows as {evidence_ids:string[];action:string}[];
  const triggers=await triggersForCompany(db,companyId,run&&run!=='all'?run:undefined,company?.refProduct);
  const oppIds=company?(await db.query<{evidence_ids:string[]}>('select evidence_ids from search_opportunities where id=$1',[company.row.opportunityId])).rows[0]?.evidence_ids??[]:[];
  const ids=[...new Set([...await companyProofIds(db,companyId),...oppIds,...triggers.flatMap(t=>t.evidenceIds),...company?.team.flatMap(s=>s.person?.evidenceIds??[])??[],...links.filter(l=>l.action==='set').flatMap(l=>l.evidence_ids)])];
  let header:LeadRow|undefined=company?.row;
  if(!header){
    const raw=(await db.query<{canonical_name:string;domain:string|null;types:string[]}>('select canonical_name,domain,types from companies where id=$1',[companyId])).rows[0];
    if(!raw||companyIdentityReason(raw.canonical_name,{confirmedDomain:raw.domain,registryRow:links.length>0}))return null;
    const proof=await triggerProofs(db,ids);if(!proof.some(p=>namesCompany(p.quote,[raw.canonical_name])))return null;
    const linked=data.chain.find(c=>c.row.companyId===companyId)?.row;
    const team=buildTeam(raw.types.includes('subcontractor')?'subcontractor':'epc_contractor',raw.canonical_name,[]);
    header={opportunityId:'',companyId,name:raw.canonical_name,whatTheyDo:linked?.supplies??'',trigger:strongestTrigger(triggers),operatingCountry:linked?.country??strongestTrigger(triggers)?.country??null,hqCountry:null,
      sellSummary:linked?.sellSummary??'',fitScore:0,howSure:'low',stage:'early',contactsFound:0,contactsTotal:team.length,sourceCount:new Set(proof.map(p=>p.document_id)).size,status:'unscored',isSample:false};
  }
  const sources=await sourceCards(db,ids);if(!sources.length)return null;
  const why=header.trigger?.title??sources.flatMap(c=>c.quotes).find(q=>namesCompany(q.highlight,[header!.name]))?.highlight??'';
  const application=company?applicationSentence(company.refProduct,[why,...sources.flatMap(c=>c.quotes.map(q=>q.sentence))]):null;
  const notes=company?(await db.query<{at:string;text:string}>("select created_at::text as at,'Workspace note/status: '||body as text from opportunity_events where opportunity_id=$1 order by created_at desc limit 30",[header.opportunityId])).rows:[];
  const emails=company?(await db.query<{at:string;text:string}>(`select m.created_at::text as at,
    case when m.direction='out' then 'Demo email to configured approved inbox' else 'Approved-inbox reply' end||' · '||m.kind||' · '||m.state as text
    from funnel_messages m join funnel_threads t on t.id=m.thread_id where t.opportunity_id=$1 order by m.created_at desc limit 30`,[header.opportunityId])).rows:[];
  return {header:{...header,sourceCount:sources.length},why,application,sources,
    related:{above:data.chain.filter(c=>c.row.companyId===companyId).map(c=>c.row),below:data.chain.filter(c=>c.row.linkedToCompanyId===companyId).map(c=>c.row)},
    contacts:company?.team??buildTeam('subcontractor',header.name,[]),activity:[...notes,...emails].sort((a,b)=>b.at.localeCompare(a.at))};
}
export async function opportunityEvidence(id:string,db:Queryable=getDb()):Promise<EvidenceDrawerView|null>{
  const opp=(await db.query<{run_id:string;company_id:string}>('select run_id,company_id from search_opportunities where id=$1',[id])).rows[0];if(!opp)return null;
  const data=await tableDataset(opp.run_id,db);const company=data.companies.find(c=>c.row.opportunityId===id);if(!company)return null;
  return drawerView(db,data,opp.company_id,company,opp.run_id);
}
export async function companyEvidence(id:string,run='all',db:Queryable=getDb()):Promise<EvidenceDrawerView|null>{
  const data=await tableDataset(run,db);
  if(run!=='all'&&!data.companies.some(c=>c.row.companyId===id)&&!data.chain.some(c=>c.row.companyId===id||c.row.linkedToCompanyId===id))return null;
  return drawerView(db,data,id,data.companies.find(c=>c.row.companyId===id)??null,run);
}
