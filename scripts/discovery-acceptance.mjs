/** Supervised local pilot and captures. Chargeable modes are explicit; never enables email or fabricates buyers. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
if(existsSync('.env.funnel.local'))process.loadEnvFile('.env.funnel.local');
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd(),false);
const mode=process.argv[2]||'capture';assert.ok(['preflight','start','capture','review','probe','replay-probe'].includes(mode));
const acceptanceDate=process.env.ACCEPTANCE_DATE||new Date().toISOString().slice(0,10).replaceAll('-','');
assert.match(acceptanceDate,/^\d{8}$/,'Use an explicit YYYYMMDD report date.');
const base='http://localhost:3007';const output=path.resolve('tmp/discovery-acceptance-'+acceptanceDate);mkdirSync(output,{recursive:true});
const file=path.join(output,'state.json');const state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{screens:[],errors:[]};
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function persist(){
  writeFileSync(file,JSON.stringify(state,null,2));
  writeFileSync(path.join(output,'index.html'),`<!doctype html><html><meta charset="utf-8"><title>Discovery-only acceptance</title><style>body{max-width:1400px;margin:30px auto;font:16px/1.5 system-ui;padding:20px;background:#f5f7fb}section{background:white;padding:20px;margin:20px 0;border-radius:12px}img{width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Actual local discovery test</h1><p>Power and control cables · UAE · Real original sources. No seeded buyers. Email and Calendar writes disabled. Targets are not guaranteed yields.</p><pre>${escape(JSON.stringify({runId:state.runId,counters:state.counters,quota:state.quota,errors:state.errors,limits:{search:6,reads:60,aiCalls:12,estimatedAiTokens:30000}},null,2))}</pre>${state.screens.map(s=>`<section><h2>${escape(s.name)}</h2><p>${escape(s.url)}</p><img src="${escape(s.file)}"></section>`).join('')}</html>`);
}
if(mode==='review'){
  assert.ok(state.runId&&!state.review,'Only one supervised review of this pilot; no new search requests.');
  let listening=false;try{await fetch(base+'/api/mvp/health',{signal:AbortSignal.timeout(1500)});listening=true;}catch{}
  assert.equal(listening,false,'Stop the local app before opening PGlite.');
  const {PGlite}=await import('@electric-sql/pglite');const db=await PGlite.create(path.resolve('tmp/automation-demo-db-20261003'));
  try{
    const run=(await db.query('select adhoc_query,status from runs where id=$1',[state.runId])).rows[0];
    assert.equal(run.adhoc_query.productId,'cables');assert.deepEqual(run.adhoc_query.markets,['AE']);
    assert.equal(run.status,'done');
    const control=(await db.query('select enabled from funnel_control where id=1')).rows[0];assert.equal(control.enabled,false);
    // Only the two failed company bundles are reviewed with corrected identity
    // validation/rule extraction. The rejected job-board call is not repeated.
    const reviewed=await db.transaction(async tx=>{
      const rows=(await tx.query("update research_jobs set state='queued',available_at=now(),lease_token=null,lease_until=null where run_id=$1 and stage='analyse' and state='failed' and payload->>'candidateId' is not null returning id",[state.runId])).rows;
      await tx.query("update research_sessions set state='active',stop_reason=null,generation=generation+1 where run_id=$1 and state='partial'",[state.runId]);
      await tx.query("update runs set status='queued',finished_at=null,error=null where id=$1",[state.runId]);
      await tx.query("insert into run_events(run_id,stage,message,counters) values($1,'info',$2,'{}')",[state.runId,'Supervised evidence review: source URLs and successful query responses reused; corrected short-name validation and deterministic company capability extraction. Existing provider failures remain in history; no new search requests.']);
      return rows.length;
    });
    state.review={at:new Date().toISOString(),reviewedBundles:reviewed,newSearchRequests:0,cumulativeLimitsUnchanged:true};persist();
    console.log(JSON.stringify(state.review));
  }finally{await db.close();}
}else if(mode==='replay-probe'){
  assert.ok(state.runId&&state.providerProbe?.status===200&&!state.providerReplay,'Replay the saved response once; no new provider search.');
  let listening=false;try{await fetch(base+'/api/mvp/health',{signal:AbortSignal.timeout(1500)});listening=true;}catch{}
  assert.equal(listening,false,'Stop the local app before opening PGlite.');
  const {PGlite}=await import('@electric-sql/pglite');const db=await PGlite.create(path.resolve('tmp/automation-demo-db-20261003'));
  try{
    const job=(await db.query("select id,payload from research_jobs where run_id=$1 and key='tavily:buyer-v4:cables:AE:company:0' and state='failed'",[state.runId])).rows[0];assert.ok(job);
    const query=job.payload.query;const key=query.key+':'+createHash('sha256').update(query.query).digest('hex');
    const response=JSON.parse(readFileSync(path.join(output,'provider-probe.json'),'utf8'));
    assert.ok(Array.isArray(response.results)&&response.results.length<=10);
    await db.transaction(async tx=>{
      await tx.query('insert into research_query_cache(run_id,query_key,result) values($1,$2,$3) on conflict do nothing',[state.runId,key,JSON.stringify({results:response.results})]);
      await tx.query("update research_jobs set state='queued',error=null,available_at=now() where id=$1",[job.id]);
      await tx.query("update research_sessions set state='active',stop_reason=null where run_id=$1",[state.runId]);
      await tx.query("update runs set status='queued',finished_at=null,error=null where id=$1",[state.runId]);
    });
    state.providerReplay={at:new Date().toISOString(),newSearchRequests:0,failedQueriesNotRetried:5};persist();
    console.log(JSON.stringify({runId:state.runId,reusedOneSavedSearchResponse:true,otherFailedQueriesRemainFailed:true}));
  }finally{await db.close();}
}else if(mode==='probe'){
  assert.ok(state.runId&&!state.providerProbe,'One diagnostic provider probe only; never loop or silently retry.');
  state.providerProbe={at:new Date().toISOString()};persist();
  const response=await fetch('https://api.tavily.com/search',{method:'POST',redirect:'error',headers:{authorization:`Bearer ${process.env.TAVILY_API_KEY}`,'content-type':'application/json'},
    body:JSON.stringify({query:'United Arab Emirates electrical installation contractors services -jobs -"market report" -"market size"',search_depth:'basic',max_results:10,topic:'general',include_answer:false,include_raw_content:false,auto_parameters:false,include_published_date:true,include_usage:true}),signal:AbortSignal.timeout(20000)});
  const body=await response.json();state.providerProbe.status=response.status;
  state.providerProbe.error=String(body.detail?.error??body.detail??body.error??'').replaceAll(process.env.TAVILY_API_KEY,'[REDACTED]').slice(0,400);
  if(response.ok){writeFileSync(path.join(output,'provider-probe.json'),JSON.stringify(body,null,2));state.providerProbe.results=body.results?.length;}
  persist();console.log(JSON.stringify(state.providerProbe));
}else if(mode==='preflight'){
  assert.ok(process.env.TAVILY_API_KEY&&process.env.GROQ_API_KEY,'Existing search/AI keys required.');
  const response=await fetch('https://api.tavily.com/usage',{headers:{authorization:`Bearer ${process.env.TAVILY_API_KEY}`},redirect:'error',signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200,'Tavily usage preflight unavailable; do not launch a charged test.');
  const data=await response.json();const remaining=data.account.plan_limit-data.account.plan_usage;
  const keyRemaining=data.key.limit?data.key.limit-data.key.usage:remaining;
  state.quota={checkedAt:new Date().toISOString(),planRemaining:remaining,keyRemaining};persist();
  assert.ok(remaining>=6&&keyRemaining>=6,'Insufficient free-plan allowance; no pay-as-you-go fallback.');
  console.log(JSON.stringify({preflight:true,...state.quota,searchCreditsToUseAtMost:6}));
}else{
  const installed='C:/Users/admin/AppData/Local/Programs/Python/Python311/Lib/site-packages/playwright/driver/package';
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE||(existsSync(installed)?installed:'playwright'));
  const executable='C:/Users/admin/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
  const browser=await chromium.launch({headless:true,...(existsSync(executable)?{executablePath:executable}:{})});
  try{
    const context=await browser.newContext({viewport:{width:1536,height:1024}});await context.addInitScript(()=>localStorage.setItem('mvp.tour.seen','1'));
    const page=await context.newPage();page.setDefaultNavigationTimeout(60000);page.on('pageerror',e=>state.errors.push(e.message.split('\n')[0]));
    const login=await context.request.post(base+'/api/mvp/login',{data:{password:process.env.DEMO_PASSWORD||'showcase-demo'},headers:{origin:base}});assert.equal(login.status(),200);
    const get=async endpoint=>{const r=await context.request.get(base+endpoint);assert.equal(r.status(),200,endpoint);return r.json();};
    const control=await get('/api/mvp/automation');assert.equal(control.settings.enabled,false);assert.equal(control.settings.worker,false);
    assert.ok(control.threads.every(t=>t.paused||['stopped','meeting_booked'].includes(t.state)));
    const capture=async name=>{await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});state.screens=state.screens.filter(s=>s.name!==name);state.screens.push({name,file:name+'.png',url:page.url()});persist();};
    if(mode==='start'){
      assert.ok(!state.runId&&!state.requestedAt,'This pilot already started; capture it instead of submitting another search.');
      assert.ok(state.quota&&Date.now()-Date.parse(state.quota.checkedAt)<3600000,'Run a fresh quota preflight first.');
      await page.goto(base+'/find');await capture('01-search');state.requestedAt=new Date().toISOString();persist();
      const response=await context.request.post(base+'/api/mvp/runs',{headers:{origin:base},data:{query:'Power and control cables',productId:'cables',markets:['AE'],leadKinds:['supply_subcontract'],researchMode:'batch',targetCompanies:10}});
      assert.equal(response.status(),202,'Search creation failed; inspect before retrying.');state.runId=(await response.json()).runId;assert.ok(state.runId);persist();
      console.log(JSON.stringify({runId:state.runId,oneSearchSubmitted:true,emailDisabled:true}));
    }
    assert.ok(state.runId,'No pilot run to capture.');await page.goto(base+'/find?run='+state.runId);
    const deadline=Date.now()+45000;
    do{
      const {run}=await get('/api/mvp/runs/'+state.runId);state.counters=run.counters;state.status=run.status;state.events=run.events;persist();
      if(['done','failed','cancelled'].includes(run.status))break;await page.waitForTimeout(2500);
    }while(Date.now()<deadline);
    if(['done','failed','cancelled'].includes(state.status))
      await page.locator('section[aria-label="Search progress"]').getByText(/Finished|Research paused|Stopped/).first().waitFor({timeout:15000});
    await capture('02-progress');await page.goto(base+'/crm?search='+state.runId);await capture('03-buyers');
    const diagnostics=await get('/api/mvp/research/'+state.runId);
    writeFileSync(path.join(output,'research-diagnosis.json'),JSON.stringify(diagnostics,null,2));
    const leads=page.locator('a[href^="/opportunities/"]');
    const href=await leads.count()?await leads.first().getAttribute('href'):null;
    if(href){
      await page.goto(base+href);await capture('04-workspace');
      await page.getByRole('tab',{name:'Contacts',exact:true}).click();
      await page.getByTestId('chain-contacts').locator('.skeleton').first().waitFor({state:'hidden',timeout:20000});
      assert.equal(await page.getByText('Contact records could not load.',{exact:false}).count(),0);
      await capture('05-contacts');
      await page.getByRole('tab',{name:'Subcontractors & supply chain',exact:true}).click();
      await page.locator('#supply-chain .skeleton').first().waitFor({state:'hidden',timeout:20000});
      await capture('06-supply-chain');
      await page.getByRole('tab',{name:'Email & meetings',exact:true}).click();await capture('07-email-meetings');
    }
    await page.goto(base+'/overview?search='+state.runId);await capture('08-overview');
    const after=await get('/api/mvp/automation');assert.equal(after.settings.enabled,false);
    assert.deepEqual(after.threads.map(t=>t.id).sort(),control.threads.map(t=>t.id).sort(),'Discovery must not create outreach conversations.');
    assert.ok((state.counters.researchUsage?.search??0)<=6);assert.ok((state.counters.researchUsage?.reads??0)<=60);assert.ok((state.counters.researchUsage?.aiCalls??0)<=12);assert.ok((state.counters.researchUsage?.estimatedAiTokens??0)<=30000);
    assert.deepEqual(state.errors,[]);persist();console.log(JSON.stringify({runId:state.runId,status:state.status,counters:state.counters,report:path.join(output,'index.html')}));
  }finally{persist();await browser.close();}
}
