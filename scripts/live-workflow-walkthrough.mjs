/** Explicit live walkthrough. `start` submits ONE UI search; `continue` resumes
 * saved pages with bounded AI calls; `retry` retries one unsent qualification.
 * All other modes are read-only.
 * Evidence is saved under ignored tmp/, including a resumable run ID. Never rerun
 * a paid search to recover a browser error. No fake buyers, replies or meetings.
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base='http://localhost:3007';
const output=path.resolve('tmp/live-workflow-20261004');
mkdirSync(output,{recursive:true});
const statePath=path.join(output,'walkthrough.json');
const state=existsSync(statePath)?JSON.parse(readFileSync(statePath,'utf8')):{startedAt:new Date().toISOString(),screens:[],observations:[],runId:null,ticketId:null,threadId:null,opportunityId:null};
const mode=process.argv[2]||'inspect';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function persist(){
  const readingCapture=state.screens.find(item=>item.name==='05-search-read');
  if(readingCapture)readingCapture.description='The backend had entered reading; this browser capture still shows collection because the UI polls every two seconds. Reading completion and item counts are preserved in the actual event log. This image is not presented as a fabricated completed-reading screen.';
  writeFileSync(statePath,JSON.stringify(state,null,2));
  writeFileSync(path.join(output,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Live buyer-to-meeting walkthrough</title><style>body{font:16px/1.6 system-ui;background:#f4f6fb;color:#18243b;margin:auto;max-width:1250px;padding:32px}article,header{background:white;border:1px solid #dde3ee;border-radius:14px;padding:24px;margin-bottom:24px}img{width:100%;border:1px solid #dde3ee;border-radius:8px}small{color:#627087}pre{white-space:pre-wrap;font:13px/1.6 monospace}a{color:#4f46db}.notice{background:#fff5d7;padding:16px;border-radius:8px}</style><header><h1>Live buyer → email → reply → meeting</h1><p>Actual local application, real internet discovery and Hritik-only demo delivery. No sample leads or simulated buyer replies. Provider acceptance is not proof of inbox delivery. Buyer email validation remains separate from demo routing.</p><p>Started: ${escape(state.startedAt)} · Search: ${escape(state.runId||'not started')} · Product: line pipe · Country: India</p><p class="notice">Google Calendar: ${escape(state.calendar||'consent needed')}. A meeting is not recorded as completed unless an actual Calendar event and Meet link exist. Some search stages can finish between screenshots; the recorded event log preserves those transitions without fabricating UI captures.</p><h2>Evidence / observations</h2><ul>${state.observations.map(item=>`<li>${escape(item.time)} — ${escape(item.text)}</li>`).join('')}</ul>${state.run?`<h2>Search outcome</h2><pre>${escape(JSON.stringify(state.run,null,2))}</pre>`:''}</header>${state.screens.map(item=>`<article id="${escape(item.name)}"><h2>${escape(item.title)}</h2><p>${escape(item.description)}</p><small>${escape(item.time)} · ${escape(item.url)}</small><p><a href="${escape(item.name)}.png">Open full-resolution screenshot</a></p><img loading="lazy" src="${escape(item.name)}.png" alt="${escape(item.title)}"></article>`).join('')}<footer>Generated from actual browser evidence. Keep private: includes approved demo email content. Secrets and session cookies are not included. ${state.runId?'<p><a href="search-events.json">Recorded search progress events</a></p>':''}</footer></html>`);
  const reportPath=path.join(output,'index.html');
  const verifiedSearch=Boolean(state.run?.counters?.scopedProspects);
  const acceptedInitial=state.messages?.some(m=>m.direction==='out'&&m.kind==='initial'&&m.state==='accepted');
  const status=`<h2>Live test status — ${verifiedSearch?'research produced potential buyers':'not yet end-to-end complete'}</h2><ul><li>Actual UI search: ${state.run?escape(state.run.status):'not completed'}; ${state.run?.counters?.itemsRead??0} pages read; ${state.run?.counters?.scopedProspects??0} saved potential buyers (not validated buyer contacts).</li><li>New-search automatic email: ${state.thread?escape(state.thread.state):'not reached — no qualified prospect enrolled'}; provider-accepted initial email: ${acceptedInitial?'yes':'no'}.</li><li>Existing inbox-only conversation: ${state.inboxProof?escape(state.inboxProof.state)+'; historical proof, separate from this search':'not captured'}.</li><li>Calendar consent: ${escape(state.calendar||'not connected')}. New meeting booking: ${state.thread?.meet_url?'actual meeting URL recorded':'not demonstrated'}.</li></ul><p>${acceptedInitial?'Next: the inbox owner can reply to the new prospect-demo email to test this actual researched-buyer conversation.':'Automatic email remains unproven until qualification passes and an initial message is accepted.'} Google Calendar consent is still required for a real meeting. Original progress events and genuine test failures are retained below.</p>`;
  writeFileSync(reportPath,readFileSync(reportPath,'utf8').replace('<h2>Evidence / observations</h2>',status+'<h2>Evidence / observations</h2>'));
}
function observe(text){const item={time:new Date().toISOString(),text};state.observations.push(item);persist();console.log(JSON.stringify(item));}
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
try {
  const context=await browser.newContext({viewport:{width:1536,height:1024}});
  await context.addInitScript(()=>localStorage.setItem('mvp.tour.seen','1'));
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.setDefaultTimeout(20000);
  async function screenshot(name,title,description,locator){
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});
    if(locator&&await locator.count())await locator.first().screenshot({path:path.join(output,name+'-detail.png')}).catch(()=>{});
    state.screens=state.screens.filter(item=>item.name!==name);
    state.screens.push({name,title,description,time:new Date().toISOString(),url:page.url()});persist();console.log(JSON.stringify({screenshot:name,url:page.url()}));
  }
  async function get(endpoint){const response=await context.request.get(base+endpoint);assert.equal(response.status(),200,endpoint+' HTTP '+response.status());return response.json();}
  await page.goto(base+'/find');
  if(await page.getByLabel('Password',{exact:true}).count()){
    if(mode==='start')await screenshot('01-login','1. Sign in','Password-protected local demo. Password and session cookie are excluded from evidence.');
    await page.getByLabel('Password',{exact:true}).fill(process.env.DEMO_PASSWORD||'showcase-demo');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/find');
  }
  let automation=await get('/api/mvp/automation');const settings=automation.settings;
  assert.equal(settings.recipient,'hritikdebnath00@gmail.com');assert.equal(settings.enabled,true);assert.equal(settings.ready,true);assert.equal(settings.worker,true);assert.equal(settings.prospectDemo,true);assert.equal(settings.prospectsPerSearch,1);
  state.calendar=settings.calendar;persist();
  if(mode==='inspect'){
    console.log(JSON.stringify({appReady:true,recipient:settings.recipient,calendar:settings.calendar,existingThreads:automation.threads.map(t=>({id:t.id,mode:t.mode,company:t.company,product:t.product,state:t.state,reason:t.reason})),recentRuns:(await get('/api/mvp/runs')).runs.map(r=>({id:r.id,status:r.status,input:r.adhoc_query,counters:r.counters}))}));
  }else if(mode==='email-proof'){
    const thread=automation.threads.find(t=>t.mode==='email_test'&&t.recipient===settings.recipient);
    assert.ok(thread,'No existing live inbox-test conversation. No new test was sent.');
    const conversation=await get('/api/mvp/automation/test/'+thread.id);
    state.inboxProof={separateFromSearch:true,id:thread.id,state:thread.state,reason:thread.reason,summary:thread.summary,meet_url:thread.meet_url,
      messages:conversation.messages.map(m=>({direction:m.direction,kind:m.kind,subject:m.subject,body:m.body,state:m.state,created_at:m.created_at}))};persist();
    await page.goto(base+'/outreach');await page.getByRole('heading',{name:'Email automation timeline'}).waitFor();await page.waitForTimeout(500);
    const incoming=conversation.messages.filter(m=>m.direction==='in').length;const outgoing=conversation.messages.filter(m=>m.direction==='out'&&m.state==='accepted').length;
    await screenshot(`11-existing-inbox-in-${incoming}-out-${outgoing}-${thread.state}`,'11. Separate existing live inbox test: '+thread.state,'This is the pre-existing inbox-only test, NOT an email generated by the new zero-buyer search. Its actual incoming replies and outgoing sales messages are shown honestly.');
    console.log(JSON.stringify({separateInboxProof:true,threadId:thread.id,state:thread.state,incoming,outgoing,calendar:settings.calendar,reason:thread.reason,report:path.join(output,'index.html')}));
  }else {
    if(mode==='start'){
      assert.ok(!state.runId&&!state.ticketId,'This walkthrough already has a search. Use capture, never repeat start.');
      await page.goto(base+'/overview');await screenshot('02-overview-before','2. Sales workspace before research','Existing searches are preserved. This walkthrough creates one new, explicitly scoped search.');
      await page.goto(base+'/outreach');await screenshot('03-automation-setup','3. Automation enabled and restricted','Automatic potential-buyer demo delivery is enabled; only Hritik’s approved inbox can receive mail. Calendar consent status is shown.');
      await page.goto(base+'/find');await page.getByLabel('Product to sell').selectOption('line-pipe');await page.locator('#find-query').fill('line pipe');
      while(await page.locator('fieldset button[aria-pressed="true"]').count())await page.locator('fieldset button[aria-pressed="true"]').first().click();
      await page.getByLabel('Add a country').selectOption('IN');
      await screenshot('04-search-configured','4. Product and country selection','Line pipe, India only. Procurement is the default role priority. One UI search; no fixture fallback.');
      const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/mvp/runs')&&r.request().method()==='POST');
      await page.getByRole('button',{name:'Search now',exact:true}).click();
      const response=await responsePromise;assert.equal(response.status(),202);const ticket=await response.json();state.runId=ticket.runId;state.ticketId=ticket.ticketId;persist();
      observe('One live search submitted through the actual Search now button. No second paid submission will be made by this walkthrough.');
    }
    for(let n=0;!state.runId&&state.ticketId&&n<30;n++){const ticket=await get('/api/mvp/queue/'+state.ticketId);if(ticket.runId){state.runId=ticket.runId;persist();break;}if(ticket.state==='failed')throw Error(ticket.error||'Queue failed');await page.waitForTimeout(2000);}
    assert.ok(state.runId,'Search has no run ID yet; use capture to resume.');
    await page.goto(base+'/find?run='+state.runId);
    if(['retry','retry_original_evidence'].includes(mode)){
      const marker=mode==='retry'?'qualificationRetriedAt':'originalEvidenceRetriedAt';
      assert.ok(!state[marker],'Qualification retry already requested. Use capture.');
      const current=automation.threads.find(t=>t.run_id===state.runId);
      assert.ok(current && current.state==='review' && current.opportunity_id,'Expected the unsent researched-buyer review thread.');
      const conversation=await get('/api/mvp/automation/conversation/'+current.opportunity_id);
      assert.equal(conversation.messages.length,0,'Never retry an attempted or existing delivery in this walkthrough.');
      await page.goto(base+'/outreach');
      const row=page.locator('li').filter({has:page.locator(`a[href="/opportunities/${current.opportunity_id}"]`)}).first();
      await screenshot('14-before-qualification-retry','14. Retry the unsent evidence check','Only this researched-company thread is retried. No search rerun, no manual email, no previous delivery exists.');
      const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/mvp/automation')&&r.request().method()==='POST');
      await row.getByRole('button',{name:'Retry checked step',exact:true}).click();
      const response=await responsePromise;assert.equal(response.status(),200);
      state[marker]=new Date().toISOString();persist();observe('One unsent product-fit check retried through the actual UI after correcting citation validation.');
      await page.goto(base+'/find?run='+state.runId);
    }
    if(['continue','expand','repair_format'].includes(mode)){
      const marker=mode==='repair_format'?'formatRepairRequestedAt':mode==='expand'?'expandedResearchRequestedAt':'recoveryRequestedAt';
      assert.ok(!state[marker],'This research continuation already ran. Use capture to resume; never repeat a credit-consuming action.');
      await page.getByRole('button',{name:'Continue checking saved pages',exact:true}).waitFor();
      await screenshot('12-before-recovery','12. Continue analysing original saved pages','The corrected engine rechecks cached evidence and a bounded fresh AI batch. No repeat Tavily search. No minimum buyer-score gate.');
      const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/mvp/runs/'+state.runId)&&r.request().method()==='POST');
      await page.getByRole('button',{name:'Continue checking saved pages',exact:true}).click();
      const response=await responsePromise;assert.equal(response.status(),202);
      state[marker]=new Date().toISOString();persist();observe('Bounded continuation requested through the real UI: original source pages reused, no paid web search repeated.');
    }
    let run;
    const deadline=Date.now()+(['start','continue','expand','repair_format'].includes(mode)?420000:45000);
    do {
      run=(await get('/api/mvp/runs/'+state.runId)).run;
      writeFileSync(path.join(output,'search-events.json'),JSON.stringify({runId:state.runId,events:run.events},null,2));
      const stage=run.events?.at(-1)?.stage||run.status;
      const name=(state.recoveryRequestedAt?'13-recovery-':'05-search-')+stage.replace(/[^a-z0-9-]/gi,'-');
      if(!state.screens.some(item=>item.name===name)){
        await page.waitForTimeout(2250);
        await screenshot(name,'5. Search progress: '+stage,'Observed live state. Stages: collect internet sources → read source pages → check product/buyer evidence → save ranked opportunities. The event log records all actual transitions.',page.getByRole('region',{name:'Search progress',exact:true}));
      }
      if(['done','failed','cancelled'].includes(run.status))break;
      await page.waitForTimeout(1250);
    }while(Date.now()<deadline);
    state.run={id:run.id,status:run.status,counters:run.counters,error:run.error||null};persist();
    if(!['done','failed','cancelled'].includes(run.status)){observe('Search still running; resume capture with the saved run ID.');}
    else {
      await page.goto(base+'/overview?search='+state.runId);await screenshot('06-overview-selected-search','6. Select this search in the workspace','Only this search’s product-scoped results are shown; counts do not mix unrelated searches.');
      await page.goto(base+'/crm?search='+state.runId);await screenshot('07-saved-buyers','7. Saved potential buyers and supporting sources','Potential buyers are not confirmed purchases. Company-only opportunities are labelled honestly; project names appear only with verified project evidence.');
      const leads=page.locator('a[href^="/opportunities/"]');
      if(await leads.count()){
        state.opportunityId ||= (await leads.first().getAttribute('href')).match(/\/opportunities\/([^?]+)/)?.[1];persist();
        await page.goto(base+'/opportunities/'+state.opportunityId);await page.getByRole('complementary',{name:'Lead context and actions'}).waitFor();
        await screenshot('08-lead-workspace','8. Lead workspace: evidence, contacts and conversation','Actual researched company, exact product and evidence. Contact validation is separate from approved-inbox demo delivery.');
        await page.getByRole('tab',{name:'Email & meetings',exact:true}).click();
      }
      automation=await get('/api/mvp/automation');
      const enrollmentDeadline=Date.now()+(['start','continue','retry','retry_original_evidence'].includes(mode)?210000:15000);
      let thread;
      do{
        automation=await get('/api/mvp/automation');thread=automation.threads.find(t=>t.run_id===state.runId);
        if(thread){state.threadId=thread.id;state.opportunityId=thread.opportunity_id;state.thread={id:thread.id,company:thread.company,product:thread.product,state:thread.state,reason:thread.reason,summary:thread.summary,meet_url:thread.meet_url};persist();
          const conversation=await get('/api/mvp/automation/conversation/'+thread.opportunity_id);
          state.messages=conversation.messages.map(m=>({id:m.id,direction:m.direction,kind:m.kind,subject:m.subject,body:m.body,state:m.state,created_at:m.created_at,error:m.error}));persist();
          if(state.messages.some(m=>m.direction==='out'&&m.state==='accepted')||['review','stopped','meeting_booked','awaiting_calendar'].includes(thread.state))break;
        }
        await page.waitForTimeout(4000);
      }while(Date.now()<enrollmentDeadline);
      if(thread){
        await page.goto(base+'/opportunities/'+thread.opportunity_id);await page.getByRole('tab',{name:'Email & meetings',exact:true}).click();const timeline=page.getByRole('region',{name:'Automatic email conversation'});await timeline.waitFor();await page.waitForTimeout(750);
        const incoming=state.messages.filter(m=>m.direction==='in').length;const accepted=state.messages.filter(m=>m.direction==='out'&&m.state==='accepted').length;
        const name=`09-conversation-in-${incoming}-out-${accepted}-${thread.state}`;
        await screenshot(name,'9. Automatic email conversation: '+thread.state,`${incoming} actual inbound replies; ${accepted} provider-accepted outgoing messages. State: ${thread.reason}. Provider acceptance does not imply verified buyer contact or confirmed inbox delivery.`,timeline);
        if(thread.meet_url)observe('Actual booked meeting link: '+thread.meet_url);
      }else observe('No automatic thread has enrolled for this search yet. No email is fabricated or manually sent to disguise the missing step.');
      await page.goto(base+'/outreach');await screenshot('10-automation-progress','10. Email automation progress','Research qualification, outgoing delivery, replies and meeting status are shown by the actual app.');
      console.log(JSON.stringify({run:state.run,thread:state.thread||null,messages:state.messages?.map(m=>({direction:m.direction,kind:m.kind,state:m.state,subject:m.subject,body:m.body})),report:path.join(output,'index.html'),browserErrors:errors}));
    }
    assert.deepEqual(errors,[]);
  }
}catch(error){observe('Walkthrough paused: '+error.message);throw error;}
finally {persist();await browser.close();}
