/** Award rows are usable evidence before a website/contact is found. Lists of names are not awards. */
import type {Db} from '@/mvp/db';
import type {RunInput} from '@/mvp/types';
import {verifyRoundup,type RoundupResult} from './roundup';
import {companyIdentityReason} from './entities';
import {resolveBuyerCompany,storeTrigger,confirmedSubcontractLinks} from './triggers';
import {materialEvidenceKind} from '@/mvp/discovery/plan';
import {countriesInQuote} from '@/mvp/discovery/locations';
import {parseDate,parseMoney,normalizeProjectName} from '@/mvp/pipeline/text';
import {searchedProductLabel} from '@/mvp/config/product-label';
import {namesCompany} from '@/mvp/discovery/evidence';
export async function persistRoundupAwards(db:Db,runId:string,input:RunInput,result:RoundupResult) {
  if(!input.productId)return 0;
  const doc=(await db.query<{text:string;url:string;tier:string;publisher_key:string;is_sample:boolean}>('select text,url,tier,publisher_key,is_sample from source_documents where id=$1',[result.found_via.documentId])).rows[0];
  if(!doc||doc.is_sample)return 0;
  let count=0;
  for(const c of verifyRoundup(result,doc.text,result.found_via.documentId).companies){
    if(!['contractor','subcontractor'].includes(c.role??'')||companyIdentityReason(c.name,{registryRow:true}))continue;
    if(!/\b(?:awarded|won|wins|secured|bags|received|letter of award)\b/i.test(c.quote)||materialEvidenceKind(c.quote,input.productId)==='none')continue;
    const work=countriesInQuote(c.quote,[c.name]);const country=work.find(code=>input.markets.includes(code))??work[0]??null;
    if(country&&!input.markets.includes(country))continue;
    await db.tx(async tx=>{
      const company=await resolveBuyerCompany(tx,c.name,null,c.role==='subcontractor'?'subcontractor':'main_epc');
      const quotes=[...new Set([c.quote,c.project?.quote,c.value?.quote,c.date?.quote,c.country?.quote].filter((q):q is string=>Boolean(q)))];
      const evidenceIds:string[]=[];
      for(const quote of quotes){
        const current=(await tx.query<{id:string}>('select id from evidence where document_id=$1 and quote=$2 and quote_verified=true limit 1',[result.found_via.documentId,quote])).rows[0];
        const evidence=current??(await tx.query<{id:string}>("insert into evidence(document_id,url,quote,extracted_by,quote_verified,agreement,tier,publisher_key) values($1,$2,$3,'model:roundup',true,'single',$4,$5) returning id",[result.found_via.documentId,doc.url,quote,doc.tier,doc.publisher_key])).rows[0];
        evidenceIds.push(evidence.id);
        await tx.query("insert into fact_evidence(entity_type,entity_id,field,evidence_id) values('company',$1,$2,$3) on conflict do nothing",[company.id,quote===c.quote?'capability_activity':'*',evidence.id]);
      }
      let projectId:string|null=null;
      if(c.project){
        const key=normalizeProjectName(c.project.name);
        projectId=((await tx.query<{id:string}>('select id from projects where normalized_name=$1 and country is not distinct from $2 limit 1',[key,country])).rows[0]??
          (await tx.query<{id:string}>('insert into projects(name,normalized_name,country) values($1,$2,$3) returning id',[c.project.name,key,country])).rows[0]).id;
      }
      const money=c.value?parseMoney(c.value.text):null;
      const stored=await storeTrigger(tx,runId,company.id,input.productId!,{kind:c.role==='subcontractor'?'subcontract':'award',role:c.role==='subcontractor'?'subcontractor':'contractor',title:c.quote,
        date:c.date?parseDate(c.date.text):null,datePrecision:'unknown',valueUsd:money?.usd??null,valueText:c.value?.text??null,country,
        projectId,projectName:c.project?.name??null,ownerName:null,strength:'confirmed',evidenceIds});
      if(!stored)return;
      const reason=`Potential ${searchedProductLabel(input.productId!,input.query)} application: ${c.quote} Purchasing requirements and contacts remain unconfirmed.`;
      const lead=(await tx.query<{id:string}>(`insert into leads(kind,buyer_company_id,project_id,client_product_ids,score_breakdown,gate_results,class,reasons,scoring_version,run_id,buyer_type)
        values('supply_subcontract',$1,$2,$3::text[],'{}','[]','watch',$4::jsonb,1,$5,$6)
        on conflict on constraint leads_candidate_uniq do update set updated_at=now() returning id`,[company.id,projectId,[input.productId],JSON.stringify([{text:reason,evidenceIds}]),runId,c.role==='subcontractor'?'subcontractor':'epc_contractor'])).rows[0];
      const saved=await tx.query(`insert into search_opportunities(run_id,lead_id,company_id,keyword,product_id,product_name,contact_role,buying_reason,evidence_ids,trigger_id,trigger_kind,trigger_date,operating_country)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid[],$10,$11,$12::date,$13)
        on conflict(run_id,company_id,product_id) do update set evidence_ids=array(select distinct unnest(search_opportunities.evidence_ids||excluded.evidence_ids)) returning id`,
        [runId,lead.id,company.id,input.query,input.productId,searchedProductLabel(input.productId!,input.query),input.contactRole??'buyer',reason,evidenceIds,stored.id,stored.kind,stored.date,stored.country]);
      count+=saved.rows.length;
      // A parent must be named in the same subcontract quote; proximity on a list is insufficient.
      if(stored.kind==='subcontract'&&projectId){
        const parents=(await tx.query<{id:string;canonical_name:string}>('select id,canonical_name from companies where id<>$1',[company.id])).rows;
        for(const parent of parents)if(namesCompany(c.quote,[parent.canonical_name]))await tx.query("insert into project_parties(project_id,company_id,role) values($1,$2,'main_epc') on conflict do nothing",[projectId,parent.id]);
        await confirmedSubcontractLinks(tx,company.id,projectId,evidenceIds);
      }
    });
  }
  return count;
}
