/** One real UI search, then observe automatic processing. Never bypass qualification/dedup/send limits. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=path.resolve('tmp/engineering-material-audit-20261005');mkdirSync(output,{recursive:true});
const file=path.join(output,'proof.json');
const state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{product:'Line pipe',markets:['IN','AE'],createdAt:new Date().toISOString()};
const persist=()=>writeFileSync(file,JSON.stringify(state,null,2));
const base='http://localhost:3007';
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
try {
  const context=await browser.newContext({viewport:{width:1536,height:1024}});
  await context.addInitScript(()=>localStorage.setItem('mvp.tour.seen','1'));
  const page=await context.newPage();page.setDefaultTimeout(30_000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const get=async route=>{
    // Only status GETs may retry. A dropped polling connection must never
    // repeat a search submission, and request logs may contain session cookies.
    for(let attempt=0;attempt<3;attempt++) {
      try{const response=await context.request.get(base+route);assert.equal(response.status(),200,route);return await response.json();}
      catch{if(attempt<2)await page.waitForTimeout(2000);}
    }
    throw new Error('Read-only app status check unavailable: '+route);
  };
  await page.goto(base+'/find');
  if(await page.getByLabel('Password',{exact:true}).count()) {
    await page.getByLabel('Password',{exact:true}).fill('showcase-demo');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/find');
  }
  let automation=await get('/api/mvp/automation');
  assert.equal(automation.settings.recipient,'hritikdebnath00@gmail.com');
  assert.equal(automation.settings.enabled,true);assert.equal(automation.settings.ready,true);
  assert.equal(automation.settings.worker,true);assert.equal(automation.settings.prospectDemo,true);
  assert.equal(automation.settings.prospectsPerSearch,1);
  state.settingsBefore=automation.settings;
  state.existingCompanyProductPairs??=automation.threads.map(t=>({companyId:t.company_id,company:t.company,product:t.product_id,state:t.state}));persist();
  if(!state.submittedAt) {
    await page.getByLabel('Product to sell').selectOption('line-pipe');await page.locator('#find-query').fill('line pipe');
    while(await page.locator('fieldset button[aria-pressed="true"]').count())await page.locator('fieldset button[aria-pressed="true"]').first().click();
    for(const country of state.markets)await page.getByLabel('Add a country').selectOption(country);
    await page.screenshot({path:path.join(output,'01-search-configured.png'),fullPage:true});
    state.submittedAt=new Date().toISOString();persist();
    const pending=page.waitForResponse(r=>r.url().endsWith('/api/mvp/runs')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Search now',exact:true}).click();
    const response=await pending;assert.equal(response.status(),202);
    state.ticket=await response.json();state.runId=state.ticket.runId;persist();
    console.log(JSON.stringify({searchSubmitted:true,ticketId:state.ticket.ticketId,runId:state.runId}));
  }
  assert.ok(state.ticket,'A previous submission was interrupted before its ticket was captured. Do not submit again.');
  const deadline=Date.now()+600_000;let last='';let run;
  while(Date.now()<deadline) {
    if(!state.runId){const ticket=await get('/api/mvp/queue/'+state.ticket.ticketId);if(ticket.runId){state.runId=ticket.runId;persist();await page.goto(base+'/find?run='+state.runId);}else if(ticket.state==='failed')throw Error(ticket.error||'Search queue failed');}
    if(state.runId) {
      run=(await get('/api/mvp/runs/'+state.runId)).run;
      state.run=run;persist();
      const newest=run.events?.at(-1);const signature=JSON.stringify([run.status,newest?.id]);
      if(signature!==last){console.log(JSON.stringify({status:run.status,stage:newest?.stage,message:newest?.message,counters:run.counters}));last=signature;}
      if(['done','failed','cancelled'].includes(run.status))break;
    }
    await page.waitForTimeout(5000);
  }
  assert.ok(run,'No search run available yet; resume this script without another submission.');
  await page.goto(base+'/find?run='+state.runId);await page.screenshot({path:path.join(output,'02-search-outcome.png'),fullPage:true});
  await page.goto(base+'/crm?search='+state.runId);
  await page.getByRole('region',{name:'Projects and buying companies'}).waitFor({timeout:5000}).catch(()=>{});
  const ids=[...new Set((await page.locator('a[href^="/opportunities/"]').evaluateAll(links=>links.map(link=>link.getAttribute('href')))).map(href=>href.match(/\/opportunities\/([^?]+)/)?.[1]).filter(Boolean))];
  state.savedOpportunityIds=ids;
  state.resultText=await page.locator('main').innerText();persist();
  await page.screenshot({path:path.join(output,'03-saved-buyers.png'),fullPage:true});
  // The live worker is responsible for qualification/sending. This harness never ticks,
  // retries, confirms roles, validates fake contacts or manually sends an email.
  const waitUntil=Date.now()+(run.status==='done'&&ids.length?240_000:1000);
  do {
    automation=await get('/api/mvp/automation');
    const threads=automation.threads.filter(t=>t.run_id===state.runId);
    state.threads=threads;state.settingsAfter=automation.settings;state.conversations=[];
    for(const t of threads)state.conversations.push({threadId:t.id,opportunityId:t.opportunity_id,...await get('/api/mvp/automation/conversation/'+t.opportunity_id)});
    const messages=state.conversations.flatMap(c=>c.messages??[]);
    state.counts={savedPotentialBuyers:run.counters.scopedProspects??0,enrolledThreads:threads.length,
      qualifiedThreads:threads.filter(t=>!['discovered','needs_contact','review','stopped'].includes(t.state)).length,
      acceptedInitialEmails:messages.filter(m=>m.direction==='out'&&m.kind==='initial'&&m.state==='accepted').length,
      acceptedOtherEmails:messages.filter(m=>m.direction==='out'&&m.kind!=='initial'&&m.state==='accepted').length,
      incomingReplies:messages.filter(m=>m.direction==='in').length,
      bookedMeetings:threads.filter(t=>t.meet_url&&t.event_id).length,
      realBuyerRecipients:threads.filter(t=>t.recipient!=='hritikdebnath00@gmail.com').length};
    persist();
    if(state.counts.acceptedInitialEmails||threads.some(t=>['review','stopped','awaiting_calendar','meeting_booked'].includes(t.state)))break;
    await page.waitForTimeout(5000);
  }while(Date.now()<waitUntil);
  await page.reload();state.resultText=await page.locator('main').innerText();persist();
  await page.screenshot({path:path.join(output,'04-buyers-after-automation.png'),fullPage:true});
  await page.goto(base+'/outreach');await page.getByRole('heading',{name:'Email automation timeline'}).waitFor();await page.screenshot({path:path.join(output,'05-email-automation.png'),fullPage:true});
  state.checkedAt=new Date().toISOString();state.browserErrors=errors;persist();
  assert.equal(state.counts.realBuyerRecipients,0);assert.ok(state.counts.acceptedInitialEmails<=1);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({runId:state.runId,status:run.status,counters:run.counters,counts:state.counts,threads:state.threads.map(t=>({company:t.company,state:t.state,reason:t.reason,recipient:t.recipient})),calendar:state.settingsAfter.calendar,workerError:state.settingsAfter.last_error,proof:file}));
}catch(error){state.auditError={name:error?.name||'Error',code:error?.code||null,runId:state.runId};persist();console.log(JSON.stringify({auditInterrupted:state.auditError,noRepeatSearch:true}));process.exitCode=1;}
finally{await browser.close();}
