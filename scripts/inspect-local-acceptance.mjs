/** Read-only local PGlite diagnosis. Refuses to open while the app is listening. */
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
let listening=false;
try{await fetch('http://127.0.0.1:3007/api/mvp/health',{signal:AbortSignal.timeout(1500)});listening=true;}catch{}
if(listening)throw Error('Stop the app before opening its local PGlite database.');
const out=path.resolve('tmp/live-acceptance-20261005');const state=JSON.parse(readFileSync(path.join(out,'state.json'),'utf8'));
const db=await PGlite.create(path.resolve('tmp/automation-demo-db-20261003'));
try{
  const documents=(await db.query(`select d.id,d.url,d.title,d.text,c.result,c.version from source_documents d join run_documents rd on rd.document_id=d.id
    left join buyer_discovery_cache c on c.document_id=d.id and c.product_id='cables' where rd.run_id=$1`,[state.runId])).rows;
  const jobs=(await db.query('select stage,key,state,error,result,payload from research_jobs where run_id=$1 order by created_at',[state.runId])).rows;
  const usage=(await db.query('select provider,model,purpose,ok,error,tokens_in,tokens_out from llm_usage where run_id=$1 order by ts',[state.runId])).rows;
  const queries=(await db.query('select query_key,result from research_query_cache where run_id=$1',[state.runId])).rows;
  writeFileSync(path.join(out,'research-diagnosis.json'),JSON.stringify({runId:state.runId,documents,jobs,usage,queries},null,2));
  console.log(JSON.stringify({runId:state.runId,documents:documents.map(d=>({url:d.url,title:d.title,chars:d.text.length,cached:d.result,textPreview:d.text.slice(0,700)})),queries,
    unreadable:jobs.filter(j=>j.result?.unreadable).map(j=>({url:j.payload.raw?.url,title:j.payload.raw?.title})),usage}));
}finally{await db.close();}
