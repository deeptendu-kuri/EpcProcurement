import type {Db} from '@/mvp/db';
import type {NeedResult} from './need';
import {registerCandidate} from './investigation';
import {originalQuote} from '@/mvp/discovery/evidence';
import {normalizeCompanyName} from '@/mvp/pipeline/text';

/** Keep contractor identity and newer project progress as distinct originals.
 * No migration, invented contractor name or second AI pass is needed. */
export async function registerNeedCandidates(db:Db,runId:string,documentId:string,result:NeedResult|null):Promise<void>{
  for(const c of result?.companies.filter(c=>c.verdict==='lead')??[]){
    await db.tx(async tx=>{
      const candidate=await registerCandidate(tx,runId,c.name,null,documentId,c.identityQuote??c.quote);
      // A weak page-brand seed may already exist with no quote. Preserve the
      // accepted proof rather than leaving its identity null after conflict.
      await tx.query('update research_candidates set identity_document_id=$2,identity_quote=$3 where id=$1',
        [candidate.id,documentId,c.identityQuote??c.quote]);
      const current=result?.currentWork;if(!current)return;
      const source=(await tx.query<{text:string;tier:string;publisher_key:string|null}>(
        'select d.text,d.tier,d.publisher_key from run_documents r join source_documents d on d.id=r.document_id where r.run_id=$1 and d.id=$2',[runId,current.documentId])).rows[0];
      if(!source||!originalQuote(source.text,current.quote))return;
      const old=(await tx.query<{id:string}>('select id from evidence where document_id=$1 and quote=$2 and quote_verified=true limit 1',[current.documentId,current.quote])).rows[0];
      const id=old?.id??(await tx.query<{id:string}>(`insert into evidence(document_id,url,quote,extracted_by,quote_verified,agreement,tier,publisher_key)
        values($1,$2,$3,'rule:current-work',true,'single',$4,$5) returning id`,[current.documentId,current.url,current.quote,source.tier,source.publisher_key])).rows[0].id;
      await tx.query(`update research_candidates set found_via=coalesce(found_via,'{}'::jsonb)||jsonb_build_object('currentWork',$2::jsonb) where id=$1`,
        [candidate.id,JSON.stringify({roleDocumentId:documentId,evidenceId:id,date:current.date})]);
      // A later progress page can upgrade an already-visible lead without
      // inserting a duplicate or changing the original contract's date.
      await tx.query(`update search_opportunities o set activity_status='ongoing',evidence_ids=array(select distinct unnest(o.evidence_ids||array[$3::uuid]))
        from companies co where o.run_id=$1 and o.company_id=co.id and co.normalized_name=$2`,[runId,normalizeCompanyName(c.name),id]);
    });
  }
}
