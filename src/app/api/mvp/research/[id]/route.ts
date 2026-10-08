import {NextResponse} from 'next/server';
import {getDb} from '@/mvp/db';
import {NO_STORE,jsonError,serverError,uuidSchema} from '../../_shared/http';
/** Authenticated, bounded read-only diagnostics. No environment, private inbox or provider payloads. */
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;if(!uuidSchema.safeParse(id).success)return jsonError(404,'Search not found.');
  try{
    const db=getDb();const run=(await db.query('select id from runs where id=$1',[id])).rows[0];if(!run)return jsonError(404,'Search not found.');
    const [candidates,jobs,documents,usage]=await Promise.all([
      db.query('select id,company,domain_hint,state,reason,cardinality(document_ids) as pages from research_candidates where run_id=$1 order by created_at limit 200',[id]),
      db.query(`select stage,key,state,error,result,payload->>'source' as source,payload->'query'->>'query' as query,
        payload->'raw'->>'url' as url,payload->'raw'->'research'->>'lane' as lane from research_jobs where run_id=$1 order by created_at limit 300`,[id]),
      db.query(`select d.id,d.url,d.title,d.text from source_documents d join run_documents r on r.document_id=d.id where r.run_id=$1 limit 100`,[id]),
      db.query('select provider,model,purpose,ok,tokens_in,tokens_out from llm_usage where run_id=$1 order by ts limit 100',[id]),
    ]);
    // Raw collector result.docs contains arbitrary source data; only expose safe counters.
    const safeJobs=jobs.rows.map(row=>{const r=row as {result?:Record<string,unknown>};return {...row,result:r.result?Object.fromEntries(Object.entries(r.result).filter(([k])=>['urls','deferred','documentId','candidate','format','truncated','pdfPages','paginationLimited','unreadable','failureReason','domainLimited','saved','invalid','cached','requestedUrl','finalUrl'].includes(k))):null};});
    return NextResponse.json({candidates:candidates.rows,jobs:safeJobs,documents:documents.rows,usage:usage.rows},{headers:NO_STORE});
  }catch(error){return serverError('research diagnostics',error);}
}
