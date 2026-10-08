/** One budgeted, real local UI search. Capture mode is read-only; never fabricate buyer replies. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
if(existsSync('.env.funnel.local'))process.loadEnvFile('.env.funnel.local');
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd(),false);
const installed='C:/Users/admin/AppData/Local/Programs/Python/Python311/Lib/site-packages/playwright/driver/package';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||(existsSync(installed)?installed:'playwright'));
const executable='C:/Users/admin/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const base='http://localhost:3007';const mode=process.argv[2]||'capture';assert.ok(['start','capture'].includes(mode));
const output=path.resolve('tmp/local-demo-proof-20261007');mkdirSync(output,{recursive:true});
const statePath=path.join(output,'state.json');
const state=existsSync(statePath)?JSON.parse(readFileSync(statePath,'utf8')):{startedAt:new Date().toISOString(),screens:[],observations:[]};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function persist(){
  writeFileSync(statePath,JSON.stringify(state,null,2));
  writeFileSync(path.join(output,'index.html'),`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Local automatic workflow — actual proof</title><style>body{font:16px/1.6 system-ui;max-width:1500px;margin:30px auto;padding:20px;background:#f6f7fb;color:#16233b}section,header{background:white;border:1px solid #ddd;border-radius:12px;padding:20px;margin:20px 0}img{max-width:100%;border:1px solid #ddd}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><header><h1>Actual local automatic workflow</h1><p>Power and control cables · UAE · one real search. Only hritikdebnath00@gmail.com receives demo delivery. No synthetic replies, invented contacts or claimed meeting without a real event.</p><pre>${esc(JSON.stringify({run:state.run,thread:state.thread,calendar:state.calendar,errors:state.errors},null,2))}</pre></header>${state.screens.map(s=>`<section><h2>${esc(s.name)}</h2><p>${esc(s.time)} · ${esc(s.url)}</p><img src="${esc(s.name)}.png" alt="${esc(s.name)}"></section>`).join('')}<section><h2>Actual conversation</h2><pre>${esc(JSON.stringify(state.messages||[],null,2))}</pre></section>`);
}
const browser=await chromium.launch({headless:true,...(existsSync(executable)?{executablePath:executable}:{})});
try {
  const context=await browser.newContext({viewport:{width:1536,height:1024}});await context.addInitScript(()=>localStorage.setItem('mvp.tour.seen','1'));
  const login=await context.request.post(base+'/api/mvp/login',{headers:{origin:base},data:{password:process.env.DEMO_PASSWORD||'showcase-demo'}});assert.equal(login.status(),200);
  const get=async endpoint=>{const r=await context.request.get(base+endpoint);assert.equal(r.status(),200,endpoint);return r.json();};
  const page=await context.newPage();page.setDefaultTimeout(30_000);page.setDefaultNavigationTimeout(60_000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const capture=async name=>{await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});state.screens=state.screens.filter(s=>s.name!==name);state.screens.push({name,time:new Date().toISOString(),url:page.url()});persist();};
  let automation=await get('/api/mvp/automation');assert.equal(automation.settings.recipient,'hritikdebnath00@gmail.com');assert.equal(automation.settings.worker,true);assert.equal(automation.settings.ready,true);assert.equal(automation.settings.prospectsPerSearch,1);assert.ok(automation.threads.every(t=>t.paused||['stopped','meeting_booked'].includes(t.state)||t.run_id===state.runId),'Unexpected existing active conversation; do not send.');
  if(mode==='start') {
    assert.ok(!state.searchRequestedAt,'One search was already submitted. Use capture; never repeat to obtain screenshots.');
    await page.goto(base+'/settings?tab=automation');await page.getByRole('button',{name:'Connect Google Calendar',exact:true}).or(page.getByRole('button',{name:'Reconnect Google Calendar',exact:true})).waitFor();
    if(!automation.settings.enabled){await page.getByRole('button',{name:'Enable demo funnel',exact:true}).click();await page.getByRole('button',{name:'Pause all automation',exact:true}).waitFor();}
    await capture('01-one-time-setup');await page.goto(base+'/find');await page.getByLabel('Product to sell').selectOption('cables');await page.locator('#find-query').fill('Power and control cables');
    while(await page.locator('fieldset button[aria-pressed="true"]').count())await page.locator('fieldset button[aria-pressed="true"]').first().click();
    await page.getByLabel('Add a country').selectOption('AE');await capture('02-search-selection');
    state.searchRequestedAt=new Date().toISOString();persist();
    const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/mvp/runs')&&r.request().method()==='POST');await page.getByRole('button',{name:'Search now',exact:true}).click();
    const response=await responsePromise;assert.equal(response.status(),202);const data=await response.json();state.runId=data.runId;state.ticketId=data.ticketId;persist();
  }
  for(let i=0;!state.runId&&state.ticketId&&i<20;i++){const ticket=await get('/api/mvp/queue/'+state.ticketId);state.runId=ticket.runId;persist();if(!state.runId)await page.waitForTimeout(1000);}
  assert.ok(state.runId,'No run recorded. Inspect the saved queue ticket before submitting anything again.');
  await page.goto(base+'/find?run='+state.runId);
  const deadline=Date.now()+(mode==='start'?6*60_000:45_000);let last='';
  do {
    const {run}=await get('/api/mvp/runs/'+state.runId);state.run={id:run.id,status:run.status,counters:run.counters};
    const stage=run.events?.filter(e=>!['info','error'].includes(e.stage)).at(-1)?.stage||run.status;
    if(stage!==last){last=stage;await page.waitForTimeout(1200);await capture('03-progress-'+stage.replace(/[^a-z0-9-]/gi,'-'));console.log(JSON.stringify({runId:run.id,status:run.status,stage,companies:run.counters.scopedProspects||0}));}
    persist();if(['done','failed','cancelled'].includes(run.status))break;await page.waitForTimeout(3000);
  }while(Date.now()<deadline);
  await page.goto(base+'/overview?search='+state.runId);await capture('04-selected-search');await page.goto(base+'/crm?search='+state.runId);await capture('05-search-leads');
  for(let i=0;i<(mode==='start'?12:1);i++) {
    automation=await get('/api/mvp/automation');state.calendar=automation.settings.calendar;const t=automation.threads.find(t=>t.run_id===state.runId);state.thread=t?{id:t.id,opportunityId:t.opportunity_id,company:t.company,product:t.product,state:t.state,reason:t.reason,paused:t.paused,meetUrl:t.meet_url,eventId:t.event_id}:null;
    if(t){state.opportunityId=t.opportunity_id;const conversation=await get('/api/mvp/automation/conversation/'+t.opportunity_id);state.messages=conversation.messages;await page.goto(`${base}/opportunities/${t.opportunity_id}?tab=conversation`);await page.getByRole('list',{name:'Sales workflow progress'}).waitFor();await capture('06-automatic-conversation');
      if(state.messages.some(m=>m.kind==='initial'&&m.state==='accepted')){assert.ok(state.messages.find(m=>m.kind==='initial').body.includes('Hi '+t.company+' procurement team'));assert.ok(state.messages.find(m=>m.kind==='initial').body.includes('Power and control cables'));break;}
    }
    persist();if(mode==='start')await page.waitForTimeout(15_000);
  }
  if(state.opportunityId){await page.goto(base+'/opportunities/'+state.opportunityId);await capture('07-company-evidence');await page.getByRole('tab',{name:'Contacts',exact:true}).click();await capture('08-published-contacts');await page.getByRole('tab',{name:'Subcontractors & supply chain',exact:true}).click();await capture('09-supply-chain');
    await page.goto(`${base}/opportunities/${state.opportunityId}?tab=conversation`);await page.setViewportSize({width:390,height:844});await capture('10-mobile-conversation');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Mobile conversation overflows');
  }
  state.errors=errors;persist();assert.deepEqual(errors,[]);console.log(JSON.stringify({report:output,run:state.run,thread:state.thread,calendar:state.calendar,emails:state.messages?.filter(m=>m.direction==='out').map(m=>({kind:m.kind,state:m.state})),errors}));
}finally{await browser.close();}
