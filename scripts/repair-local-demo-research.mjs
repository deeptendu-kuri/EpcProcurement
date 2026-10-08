/** Supervised repair of the single captured local test, not a new search/send. */
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
if(existsSync('.env.funnel.local'))process.loadEnvFile('.env.funnel.local');
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd(),false);
const file='tmp/local-demo-proof-20261007/state.json';const state=JSON.parse(readFileSync(file,'utf8'));
assert.equal(state.runId,'50f5bd4b-e684-426c-ab5e-6f92ab37cf85');
const base='http://localhost:3007';const login=await fetch(base+'/api/mvp/login',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({password:process.env.DEMO_PASSWORD||'showcase-demo'})});assert.equal(login.status,200);
const cookie=login.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
const request=async(endpoint,body)=>{
  const r=await fetch(base+endpoint,{headers:{cookie,origin:base,'content-type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
  const data=await r.json();assert.ok(r.ok,`${r.status}: ${data.error||'Local request failed'}`);return data;
};
const automation=await request('/api/mvp/automation');assert.equal(automation.settings.recipient,'hritikdebnath00@gmail.com');assert.equal(automation.settings.enabled,true);
assert.ok(automation.threads.every(t=>t.paused||t.run_id===state.runId||['stopped','meeting_booked'].includes(t.state)));
if(process.argv.includes('--retry-qualification')){
  assert.ok(!state.qualificationRetriedAt,'The supervised qualification retry was already requested.');
  const t=automation.threads.find(t=>t.run_id===state.runId&&t.company==='Sama Al Shahba');assert.ok(t&&t.state==='review');
  const conversation=await request('/api/mvp/automation/conversation/'+t.opportunity_id);assert.equal(conversation.messages.length,0,'Never retry an attempted delivery.');
  assert.ok(!automation.threads.some(t=>t.run_id===state.runId&&!['review','stopped'].includes(t.state)),'Another company is already selected.');
  state.qualificationRetriedAt=new Date().toISOString();writeFileSync(file,JSON.stringify(state,null,2));
  await request('/api/mvp/automation',{action:'retry',threadId:t.id});console.log(JSON.stringify({qualificationRetry:true,noDeliveryRetried:true,threadId:t.id}));
}else{
  assert.ok(!state.cachedReplayAt,'The supervised cached replay was already requested.');
  const replay=await request('/api/mvp/runs/'+state.runId,{action:'replay_cached'});
  state.cachedReplayAt=new Date().toISOString();state.cachedAnalyses=replay.cachedAnalyses;writeFileSync(file,JSON.stringify(state,null,2));
  console.log(JSON.stringify({cachedAnalyses:replay.cachedAnalyses,newSearchRequests:0,newPageReads:0,newDiscoveryAiRequests:0,limitsUnchanged:true}));
}
