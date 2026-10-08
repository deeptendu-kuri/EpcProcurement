/** Supervised real UI walkthrough. Exactly one new search; capture is read-only.
 * Never substitutes fixtures or fabricated inbox replies. All email is Hritik-only.
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
if(existsSync('.env.funnel.local'))process.loadEnvFile('.env.funnel.local');
const installed='C:/Users/admin/AppData/Local/Programs/Python/Python311/Lib/site-packages/playwright/driver/package';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||(existsSync(installed)?installed:'playwright'));
const executable=process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Users/admin/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const base='http://localhost:3007';const mode=process.argv[2]||'capture';
assert.ok(['start','capture','resume'].includes(mode));
const output=path.resolve('tmp/live-acceptance-20261005');mkdirSync(output,{recursive:true});
const statePath=path.join(output,'state.json');
const state=existsSync(statePath)?JSON.parse(readFileSync(statePath,'utf8')):{startedAt:new Date().toISOString(),product:'Power and control cables',country:'United Arab Emirates',screens:[],observations:[]};
const safeError=e=>String(e?.message||e).split('\n')[0].slice(0,600);
state.observations=state.observations.map(x=>({...x,text:x.text.split('\n')[0]}));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function persist(){
  writeFileSync(statePath,JSON.stringify(state,null,2));
  writeFileSync(path.join(output,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Real local acceptance: search to meeting</title><style>body{font:16px/1.6 system-ui;max-width:1440px;margin:24px auto;padding:24px;background:#f5f7fb;color:#18243b}header,section{background:white;border:1px solid #dce3ec;border-radius:14px;padding:22px;margin:24px 0}img{max-width:100%;border:1px solid #dde3ee;border-radius:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.notice{background:#fff5d7;padding:14px;border-radius:8px}</style><header><h1>Real local test: search → buyers → email → reply → meeting</h1><p>${esc(state.product)} · ${esc(state.country)} · ${esc(state.startedAt)}</p><p class="notice">No synthetic buyers or simulated replies. Only hritikdebnath00@gmail.com receives demo emails and invitations. Provider acceptance is not inbox confirmation. Unknown buyer contact fields remain blank. Screens show actual observed UI; stages missed between polls are not fabricated.</p><h2>Current outcome</h2><pre>${esc(JSON.stringify({run:state.run||null,thread:state.thread||null,calendar:state.calendar||'Not connected',greetingVerified:state.greetingVerified||false,browserErrors:state.browserErrors||[]},null,2))}</pre><h2>Observations</h2><ul>${state.observations.map(x=>`<li>${esc(x.time)} — ${esc(x.text)}</li>`).join('')}</ul></header>${state.screens.map(s=>`<section><h2>${esc(s.title)}</h2><p>${esc(s.description)}</p><small>${esc(s.time)} · ${esc(s.url)}</small><p><a href="${esc(s.name)}.png">Full screenshot</a></p><img loading="lazy" src="${esc(s.name)}.png" alt="${esc(s.title)}"></section>`).join('')}<section><h2>Actual conversation</h2><pre>${esc(JSON.stringify(state.messages||[],null,2))}</pre></section></html>`);
}
function observe(text){state.observations.push({time:new Date().toISOString(),text});persist();console.log(text);}
const browser=await chromium.launch({headless:true,...(existsSync(executable)?{executablePath:executable}:{})});
try{
  const context=await browser.newContext({viewport:{width:1536,height:1024}});
  await context.addInitScript(()=>localStorage.setItem('mvp.tour.seen','1'));
  const page=await context.newPage();page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(60000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const capture=async(name,title,description)=>{
    await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(200);
    await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});
    state.screens=state.screens.filter(s=>s.name!==name);state.screens.push({name,title,description,url:page.url(),time:new Date().toISOString()});persist();console.log(JSON.stringify({screenshot:name}));
  };
  const get=async endpoint=>{const r=await context.request.get(base+endpoint);assert.equal(r.status(),200,`${endpoint} HTTP ${r.status()}`);return r.json();};
  await page.goto(base+'/find');
  if(await page.getByLabel('Password',{exact:true}).count()){
    if(mode==='start')await capture('01-login','1. Local application login','The password is not entered in this screenshot.');
    await page.getByLabel('Password',{exact:true}).fill(process.env.DEMO_PASSWORD||'showcase-demo');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/find');
  }
  let automation=await get('/api/mvp/automation');
  assert.equal(automation.settings.recipient,'hritikdebnath00@gmail.com');assert.equal(automation.settings.ready,true);assert.equal(automation.settings.worker,true);
  assert.equal(automation.settings.prospectDemo,true);assert.equal(automation.settings.prospectsPerSearch,1);
  state.calendar=automation.settings.calendar;persist();
  if(mode==='start'){
    assert.ok(!state.searchRequestedAt&&!state.runId,'Search already requested; use capture or resume, never submit a duplicate search.');
    await page.goto(base+'/outreach');
    if(!automation.settings.enabled){await page.getByRole('button',{name:'Enable demo funnel',exact:true}).click();await page.getByRole('button',{name:'Pause all automation',exact:true}).waitFor();}
    await capture('02-automation-ready','2. Automatic outreach setup','Real providers configured, approved-inbox demo enabled. Calendar connection status is displayed; missing consent is not treated as a booking.');
    await page.goto(base+'/overview');await capture('03-overview-before','3. Search workspace','Existing results and paused conversations are preserved; this walkthrough creates one new search.');
    await page.goto(base+'/find');await page.getByLabel('Product to sell').selectOption('cables');await page.locator('#find-query').fill(state.product);
    while(await page.locator('fieldset button[aria-pressed="true"]').count())await page.locator('fieldset button[aria-pressed="true"]').first().click();
    await page.getByLabel('Add a country').selectOption('AE');
    await capture('04-search-selection','4. Search configuration','Power and control cables, UAE only, smallest preview budget. Contact role is optional, not a filter that removes companies.');
    state.searchRequestedAt=new Date().toISOString();persist();
    const promise=page.waitForResponse(r=>r.url().endsWith('/api/mvp/runs')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Search now',exact:true}).click();const response=await promise;
    const body=await response.json();assert.equal(response.status(),202,JSON.stringify(body));state.runId=body.runId;state.ticketId=body.ticketId;persist();
    observe('One actual UI search submitted. No repeat Tavily search will be submitted to recover a screenshot or browser failure.');
  }
  for(let i=0;!state.runId&&state.ticketId&&i<20;i++){
    const ticket=await get('/api/mvp/queue/'+state.ticketId);if(ticket.runId){state.runId=ticket.runId;persist();break;}await page.waitForTimeout(1500);
  }
  assert.ok(state.runId,'No run ID. Inspect the saved queue ticket before any repeat submission.');
  await page.goto(base+'/find?run='+state.runId);
  if(mode==='resume'){
    state.resumes=(state.resumes||0)+1;assert.ok(state.resumes<=2,'Two bounded resume rounds already used; inspect instead of spending more.');persist();
    const r=await context.request.post(base+'/api/mvp/runs/'+state.runId,{data:{action:'continue_analysis'},headers:{origin:base}});
    assert.equal(r.status(),202,JSON.stringify(await r.json()));observe('Explicit bounded resume of this same saved run; no new web search.');await page.reload();
  }
  const deadline=Date.now()+(mode==='capture'?75000:420000);let lastStage='';let run;
  do{
    run=(await get('/api/mvp/runs/'+state.runId)).run;
    writeFileSync(path.join(output,'search-events.json'),JSON.stringify({runId:state.runId,events:run.events},null,2));
    state.run={id:run.id,status:run.status,counters:run.counters,error:run.error||null};persist();
    const stage=run.events?.filter(e=>!['info','error'].includes(e.stage)).at(-1)?.stage||run.status;
    if(stage!==lastStage){lastStage=stage;await page.waitForTimeout(2100);await capture(`05-round${state.resumes||0}-progress-`+stage.replace(/[^a-z0-9-]/gi,'-'),'5. Observed research progress: '+stage,'Actual progress screen. Source events preserve all transitions; the screenshot may reflect the polling delay.');console.log(JSON.stringify({status:run.status,counters:run.counters}));}
    if(['done','failed','cancelled'].includes(run.status))break;
    await page.waitForTimeout(2500);
  }while(Date.now()<deadline);
  await page.goto(base+'/overview?search='+state.runId);await capture('06-overview-search','6. This selected search','Search-scoped counts and navigation, without mixing historical materials.');
  await page.goto(base+'/crm?search='+state.runId);await capture('07-buyers','7. Grounded potential buyers','Evidence-supported buying companies; not confirmed purchases. Contact fields are allowed to stay blank.');
  const links=page.locator('a[href^="/opportunities/"]');
  if(await links.count()){
    state.opportunityId=(await links.first().getAttribute('href')).match(/\/opportunities\/([^?]+)/)?.[1];persist();
    await page.goto(base+'/opportunities/'+state.opportunityId);await page.getByRole('complementary',{name:'Lead context and actions'}).waitFor();
    await capture('08-workspace','8. Lead detail and supporting evidence','Rich company/project context, exact product offered, evidence and lead actions.');
    await page.getByRole('tab',{name:'Contacts',exact:true}).click();await capture('09-contacts','9. Available contacts','Published or verified contact details only. Missing employee names/emails are not invented.');
  }
  const emailDeadline=Date.now()+(mode==='capture'?15000:150000);let thread;
  do{
    automation=await get('/api/mvp/automation');state.calendar=automation.settings.calendar;
    thread=automation.threads.find(t=>t.run_id===state.runId);
    if(thread){
      state.thread={id:thread.id,opportunityId:thread.opportunity_id,company:thread.company,product:thread.product,state:thread.state,reason:thread.reason,summary:thread.summary,meetingUrl:thread.meet_url};
      const conversation=await get('/api/mvp/automation/conversation/'+thread.opportunity_id);state.messages=conversation.messages;
      const intro=state.messages.find(m=>m.direction==='out'&&m.kind==='initial');
      if(intro){assert.ok(!/^Hi Hritik/i.test(intro.body),'Greeting still confuses buyer with salesperson');assert.ok(intro.body.includes("I'm Hritik Debnath"));assert.ok(intro.body.includes(thread.company+' procurement team'));state.greetingVerified=true;}
      persist();
      if(state.messages.some(m=>m.direction==='out'&&m.state==='accepted')||['review','stopped','awaiting_calendar','meeting_booked'].includes(thread.state))break;
    }
    if(run.counters?.researchState==='partial'||run.status==='failed')break;
    await page.waitForTimeout(3500);
  }while(Date.now()<emailDeadline);
  if(thread){await page.goto(base+'/opportunities/'+thread.opportunity_id);await page.getByRole('tab',{name:'Email & meetings',exact:true}).click();await page.getByRole('region',{name:'Automatic email conversation'}).waitFor();await page.waitForTimeout(800);await capture('10-conversation-'+thread.state,'10. Actual email conversation: '+thread.state,'Actual outgoing/incoming messages and booking state. Reply to the new email in Gmail; the walkthrough never manufactures a buyer response.');}
  await page.goto(base+'/outreach');await capture('11-automation-status','11. Automatic outreach progress','Research fit checks, delivery, reply analysis and Calendar status as recorded by the actual app.');
  state.browserErrors=errors;persist();assert.deepEqual(errors,[]);
  console.log(JSON.stringify({run:state.run,thread:state.thread||null,greetingVerified:state.greetingVerified||false,calendar:state.calendar||'not connected',report:path.join(output,'index.html')}));
}catch(e){observe('Test paused: '+safeError(e));process.exitCode=1;}
finally{persist();await browser.close();}
