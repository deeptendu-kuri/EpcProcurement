/** One supervised correction of OUR 6 October capture. Never cloud/other searches. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const file=path.resolve('tmp/discovery-acceptance-20261006/state.json');
const state=JSON.parse(readFileSync(file,'utf8'));const refresh=process.argv.includes('--refresh-capability');
assert.ok(state.runId&&(refresh?state.sourceCorrection&&!state.sourceCorrection.capabilityRefresh:!state.sourceCorrection));
let listening=false;try{await fetch('http://127.0.0.1:3007/api/mvp/health',{signal:AbortSignal.timeout(1500)});listening=true;}catch{}
assert.equal(listening,false,'Stop the app before opening local PGlite.');
const {PGlite}=await import('@electric-sql/pglite');const db=await PGlite.create(path.resolve('tmp/automation-demo-db-20261003'));
try{
  const run=(await db.query('select adhoc_query from runs where id=$1',[state.runId])).rows[0];
  assert.equal(run.adhoc_query.productId,'cables');assert.deepEqual(run.adhoc_query.markets,['AE']);
  assert.equal((await db.query('select enabled from funnel_control where id=1')).rows[0].enabled,false);
  if(refresh){
    // Recheck one existing buyer against its already-read, explicit service claim.
    // No new search/read jobs and no increases to the cumulative budget.
    const candidate=(await db.query("select id,document_ids from research_candidates where run_id=$1 and company='Sama Al Shahba' and domain_hint='sasts.ae'",[state.runId])).rows[0];assert.ok(candidate);
    const pages=(await db.query("select text from source_documents where id=any($1::uuid[]) and url='https://sasts.ae/electrical-works-cable-laying-in-uae/'",[candidate.document_ids])).rows;
    assert.ok(pages.some(p=>p.text.includes('Our electrical services include installation, repair, and maintenance of electrical systems and wiring')));
    await db.transaction(async tx=>{
      const jobs=(await tx.query("update research_jobs set state='queued',priority=150,available_at=now(),lease_token=null,lease_until=null where run_id=$1 and stage='analyse' and state='done' and payload->>'candidateId'=$2 returning id",[state.runId,candidate.id])).rows;
      assert.equal(jobs.length,1,'Exactly one saved company bundle is rechecked.');
      await tx.query("update research_sessions set state='active',stop_reason=null where run_id=$1",[state.runId]);
      await tx.query("update runs set status='queued',finished_at=null where id=$1",[state.runId]);
      await tx.query("insert into run_events(run_id,stage,message,counters) values($1,'info',$2,'{}')",[state.runId,'Rechecking one saved company bundle using its explicit own-service statement instead of a branded article title. No new searches, no increased budget, no email.']);
    });
    state.sourceCorrection.capabilityRefresh={at:new Date().toISOString(),newSearchRequests:0,newReadJobs:0,cumulativeLimitsUnchanged:true};
    writeFileSync(file,JSON.stringify(state,null,2));console.log(JSON.stringify(state.sourceCorrection.capabilityRefresh));
  }else{
  const corrected=await db.transaction(async tx=>{
    const reasons=new Map([
      ['LEDYi Lighting','Rejected: a publisher roundup describing OTHER contractors was not evidence that the publisher consumes this material.'],
      ['Elsewedy Electric','Rejected: unrelated installation/testing list items were combined into a material application. Re-research its own relevant work before admitting it.'],
      ['Cable Laying in UAE: Essential Services for a Reliable Power Infrastructure','Rejected: a service/article heading is not a company name. The source-defined company brand will be researched separately.'],
    ]);
    let count=0;
    for(const [name,reason] of reasons){
      const rows=(await tx.query("update search_opportunities o set qualification='rejected',reviewed_at=now(),next_action=$3 from companies c where c.id=o.company_id and o.run_id=$1 and c.canonical_name=$2 returning o.id",[state.runId,name,reason])).rows;
      for(const row of rows)await tx.query('insert into opportunity_events(opportunity_id,body) values($1,$2)',[row.id,reason]);count+=rows.length;
    }
    // Exact original title/body branding, not a generated company name.
    const candidate=(await tx.query('select id,document_ids from research_candidates where run_id=$1 and company=$2',[state.runId,'Cable Laying in UAE: Essential Services for a Reliable Power Infrastructure'])).rows[0];
    if(candidate){
      const source=(await tx.query("select text from source_documents where id=any($1::uuid[]) and url like 'https://sasts.ae/%'",[candidate.document_ids])).rows;
      assert.ok(source.some(d=>d.text.includes('Sama Al Shahba')),'Literal source branding must exist.');
      const key=createHash('sha256').update('sama al shahba').digest('hex');
      await tx.query("update research_candidates set company='Sama Al Shahba',key=$2,state='investigating',reason='Original source-defined brand corrected; old heading opportunity rejected and retained.' where id=$1",[candidate.id,key]);
      await tx.query("update research_jobs set state='queued',priority=150,available_at=now(),lease_token=null,lease_until=null where run_id=$1 and stage='analyse' and payload->>'candidateId'=$2",[state.runId,candidate.id]);
    }
    // Resume only the corrected source bundle. Unspent or failed provider work
    // stays paused/failed and the cumulative budget is NOT increased.
    await tx.query("update research_sessions set state='active',stop_reason=null where run_id=$1",[state.runId]);
    await tx.query("update runs set status='queued',finished_at=null where id=$1",[state.runId]);
    await tx.query("insert into run_events(run_id,stage,message,counters) values($1,'info',$2,'{}')",[state.runId,'Source audit rejected three incorrect pilot records without deleting their history. Corrected original company branding is rechecked; budgets unchanged and email remains off.']);
    return count;
  });
  state.sourceCorrection={at:new Date().toISOString(),rejectedRecords:corrected,newSearchRequests:0,deletedRecords:0};
  writeFileSync(file,JSON.stringify(state,null,2));console.log(JSON.stringify(state.sourceCorrection));
  }
}finally{await db.close();}
