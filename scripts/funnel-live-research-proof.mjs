/** One explicitly invoked real web search. No fixtures, contact guessing, or buyer delivery. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
const loadModule=createRequire(import.meta.url);
const {chromium}=loadModule(process.env.PLAYWRIGHT_MODULE||'playwright');
const base='http://localhost:3007';
const input={query:'line pipe',productId:'line-pipe',markets:['IN','SA'],leadKinds:['supply_subcontract'],contactRole:'buyer'};
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    await context.addInitScript(()=>localStorage.setItem('mvp.tour.seen','1'));
    const page=await context.newPage();await page.goto(base+'/find');
    await page.getByLabel('Password',{exact:true}).fill(process.env.DEMO_PASSWORD||'showcase-demo');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/find');
    async function get(url){for(let attempt=0;attempt<3;attempt++){try{const r=await context.request.get(base+url);assert.equal(r.status(),200);return await r.json();}catch{if(attempt===2)throw new Error('Read-only app polling failed. Inspect the existing search; do not repeat the paid research request.');await page.waitForTimeout(1500);}}}
    const settings=(await get('/api/mvp/automation')).settings;assert.equal(settings.enabled,true);assert.equal(settings.recipient,'hritikdebnath00@gmail.com');
    let id=process.argv[2];
    if(id)assert.match(id,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
    else {
      const response=await context.request.post(base+'/api/mvp/runs',{data:input,headers:{origin:base}});assert.equal(response.status(),202);
      const ticket=await response.json();id=ticket.runId;
      for(let n=0;!id&&n<60;n++){await page.waitForTimeout(3000);id=(await get('/api/mvp/queue/'+ticket.ticketId)).runId;}
    }
    assert.ok(id,'Research is still queued; do not start another duplicate.');console.log(JSON.stringify({started:true,runId:id,product:input.productId,markets:input.markets}));
    let run;
    for(let n=0;n<180;n++){run=(await get('/api/mvp/runs')).runs.find(r=>r.id===id);if(['done','failed','cancelled'].includes(run?.status))break;await page.waitForTimeout(3000);}
    assert.ok(['done','failed','cancelled'].includes(run?.status),'Research still running; inspect this run instead of starting another.');
    await page.goto(base+'/crm?search='+id);await page.screenshot({path:path.resolve('tmp/automation-browser-proof/08-real-search-scoped-results.png'),fullPage:true});
    console.log(JSON.stringify({runId:id,status:run.status,counters:run.counters,error:run.error||null,fixtureFallback:false}));
    assert.equal(run.status,'done',run.error||'Live research did not complete.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
