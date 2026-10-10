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
import type {EvidenceDrawerView,SourceCard,LeadRow,Trigger} from '@/mvp/buyers/types';

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
    let domain:string;try{const u=new URL(r.url);if(!['https:','http:'].includes(u.protocol))continue;domain=u.hostname;}catch{continue;}
    const classified=classifyPage({url:r.url,title:r.title,text:r.text});
    if(classified==='junk')continue;
    const kind:SourceCard['kind']=r.source_key.startsWith('directory:')?'directory':classified==='article'?'news':classified;
    const card=cards.get(r.document_id)??{documentId:r.document_id,url:r.url,domain,title:r.title??domain,publishedAt:r.published_at,kind,quotes:[]};
    for(const proves of proofGroups(r.fields,quote))card.quotes.push({evidenceId:r.id,sentence:sentenceFor(r.text,quote,null,null)??quote,highlight:quote,proves});
    cards.set(r.document_id,card);
  }
  // A page title or a bare company name ("Product & Services – Example Ltd") proves no work: hide it
  // when real statements remain, so the panel never ends up empty.
  const all=[...cards.values()];
  const nameOnly=(q:SourceCard['quotes'][number])=>titleOnly(q.sentence)||titleOnly(q.highlight)||(!/[a-z]/.test(q.highlight)&&q.highlight.split(/\s+/).length<=8);
  if(!all.some(c=>c.quotes.some(q=>!nameOnly(q))))return all;
  return all.map(c=>({...c,quotes:c.quotes.filter(q=>!nameOnly(q))})).filter(c=>c.quotes.length);
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
  const data=await tableDataset(opp.run_id,db);const company=data.companies.find(c=>c.row.opportunityId===id);
  const view=company?await drawerView(db,data,opp.company_id,company,opp.run_id):null;
  return view?withLeadContext(db,view,opp.company_id,opp.run_id):likelyLeadView(db,opp.company_id,opp.run_id);
}
export async function companyEvidence(id:string,run='all',db:Queryable=getDb()):Promise<EvidenceDrawerView|null>{
  const data=await tableDataset(run,db);
  const listed=run==='all'||data.companies.some(c=>c.row.companyId===id)||data.chain.some(c=>c.row.companyId===id||c.row.linkedToCompanyId===id);
  const view=listed?await drawerView(db,data,id,data.companies.find(c=>c.row.companyId===id)??null,run):null;
  // A lead saved from the shortlist has no checked quote yet: show why it is rated likely and where it was found.
  return view?withLeadContext(db,view,id,run):likelyLeadView(db,id,run);
}

interface LeadOpp {id:string;run_id:string;fit_score:number;verification:'website'|'listing'|'rating';buying_reason:string;product_id:string;product_name:string;name:string;country:string|null;types:string[]}
async function leadOpp(db:Queryable,companyId:string,run:string):Promise<LeadOpp|null>{
  return (await db.query<LeadOpp>(`select o.id,o.run_id,o.fit_score,o.verification,o.buying_reason,o.product_id,o.product_name,c.canonical_name as name,c.country,c.types
    from search_opportunities o join companies c on c.id=o.company_id where o.company_id=$1 and ($2::uuid is null or o.run_id=$2) and o.qualification<>'rejected'
    order by o.created_at desc limit 1`,[companyId,run==='all'?null:run])).rows[0]??null;
}
const PROOF_NOTE={
  verified:'Verified: its own website shows matching work.',
  listing:'Its listed work: a list or directory entry describes its work with this material. Its own website is not checked yet.',
  likely:'Likely buyer, not verified: rated from what the source says. Verify it before relying on it; it is never emailed automatically.',
} as const;
/** The search's rating of this company and whether it can be checked now. */
async function ratingFor(db:Queryable,opp:LeadOpp|null){
  if(!opp)return null;
  const {listFoundCompanies}=await import('@/mvp/research/found');
  const found=(await listFoundCompanies(db,opp.run_id)).find(c=>c.opportunityId===opp.id);
  if(!found)return null;
  // A saved likely lead (status "saved") can be verified too; only one already being checked cannot.
  const checkable=(opp.verification==='rating'||opp.verification==='listing')&&found.status!=='checking'&&found.buyerType!=='reseller';
  return {found,rating:{score:found.rating,role:found.ratingRole,reason:found.ratingReason,buyerType:found.buyerType,candidateId:found.id,runId:opp.run_id,checkable,status:found.statusText}};
}
const newestFirst=(a:Trigger,b:Trigger)=>(b.date??'').localeCompare(a.date??'');
/** Adds how the lead is proven, the search's rating and its recent work to a verified view. */
async function withLeadContext(db:Queryable,view:EvidenceDrawerView,companyId:string,run:string):Promise<EvidenceDrawerView>{
  const opp=await leadOpp(db,companyId,run);
  const level=opp?.verification==='listing'?'listing':opp?.verification==='rating'?'likely':'verified';
  const rated=await ratingFor(db,opp).catch(()=>null);
  const recent=(await triggersForCompany(db,companyId,run!=='all'?run:undefined)).sort(newestFirst);
  return {...view,proof:{level,note:PROOF_NOTE[level]},rating:rated?.rating??null,recent};
}
/**
 * A lead saved from the shortlist (docs/mvp/19 §6): no checked quote yet, so the panel shows why the search
 * rated it a likely buyer, the source page that named it (the exact line, when it is on the page), its
 * recent work if any, and a Verify action.
 */
async function likelyLeadView(db:Queryable,companyId:string,run:string):Promise<EvidenceDrawerView|null>{
  const opp=await leadOpp(db,companyId,run);if(!opp)return null;
  const rated=await ratingFor(db,opp).catch(()=>null);
  const candidate=rated?(await db.query<{quote:string|null;doc:string|null;text:string|null;url:string|null;title:string|null;published_at:string|null}>(`select c.identity_quote as quote,c.identity_document_id as doc,d.text,d.url,d.title,d.published_at::text as published_at
    from research_candidates c left join source_documents d on d.id=c.identity_document_id where c.id=$1`,[rated.rating.candidateId])).rows[0]:null;
  const sources:SourceCard[]=[];
  if(candidate?.doc&&candidate.url&&candidate.text){
    let domain='';try{domain=new URL(candidate.url).hostname;}catch{/* not a web page */}
    const quote=candidate.quote?originalQuote(candidate.text,candidate.quote):null;
    const kind=classifyPage({url:candidate.url,title:candidate.title,text:candidate.text});
    if(domain)sources.push({documentId:candidate.doc,url:candidate.url,domain,title:candidate.title??domain,publishedAt:candidate.published_at,
      kind:kind==='junk'||kind==='article'?'roundup':kind==='company_site'?'company_site':kind==='directory'?'directory':'roundup',
      quotes:quote?[{evidenceId:`candidate:${rated!.rating.candidateId}`,sentence:sentenceFor(candidate.text,quote,null,null)??quote,highlight:quote,proves:'role'}]:[]});
  }
  const triggers=(await triggersForCompany(db,companyId,opp.run_id)).sort(newestFirst);
  const level=opp.verification==='listing'?'listing':opp.verification==='website'?'verified':'likely';
  const team=buildTeam(opp.types.includes('subcontractor')?'subcontractor':'epc_contractor',opp.name,[]);
  const notes=(await db.query<{at:string;text:string}>("select created_at::text as at,'Workspace note/status: '||body as text from opportunity_events where opportunity_id=$1 order by created_at desc limit 30",[opp.id])).rows;
  const header:LeadRow={opportunityId:opp.id,companyId,name:opp.name,whatTheyDo:rated?.rating.role??'',trigger:strongestTrigger(triggers),operatingCountry:opp.country,hqCountry:null,
    sellSummary:opp.product_name,fitScore:Math.max(Number(opp.fit_score)||0,rated?.rating.score??0),howSure:'low',stage:'check',contactsFound:0,contactsTotal:team.length,sourceCount:sources.length,status:'likely',isSample:false};
  return {header,why:rated?.rating.reason??opp.buying_reason,application:null,sources,related:{above:[],below:[]},contacts:team,activity:notes,
    proof:{level,note:PROOF_NOTE[level]},rating:rated?.rating??null,recent:triggers};
}
