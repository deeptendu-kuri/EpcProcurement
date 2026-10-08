/** Local read-only diagnosis. Stop the local app before opening its PGlite directory. */
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const state=JSON.parse(readFileSync(path.join(root,'tmp/live-workflow-20261004/walkthrough.json'),'utf8'));
const db=await PGlite.create(path.join(root,'tmp/automation-demo-db-20261003'));
try {
  const usage=await db.query('select provider,model,purpose,ok,error,tokens_in,tokens_out from llm_usage where run_id=$1 order by ts',[state.runId]);
  const docs=await db.query(`select d.id,d.url,d.title,d.text,c.result from source_documents d join run_documents rd on rd.document_id=d.id
    left join buyer_discovery_cache c on c.document_id=d.id and c.product_id='line-pipe' where rd.run_id=$1`,[state.runId]);
  writeFileSync(path.join(root,'tmp/live-workflow-20261004/research-diagnosis.json'),JSON.stringify({usage:usage.rows,documents:docs.rows},null,2));
  console.log(JSON.stringify({usage:usage.rows,documents:docs.rows.map(d=>({id:d.id,url:d.url,title:d.title,cached:d.result,chars:d.text?.length,textPreview:d.text?.slice(0,350)}))}));
}finally{await db.close();}
