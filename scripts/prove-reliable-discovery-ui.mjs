/** Isolated, explicitly fictional UI proof. Disables external credentials before Next dotenv loads. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root=process.cwd();const output=path.resolve(root,'tmp/reliable-discovery-ui-proof');
const dataDir=path.join(output,'db');const runId='11111111-1111-4111-8111-111111111111';
const ids=['22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
mkdirSync(output,{recursive:true});
if(process.argv.includes('--serve')){
  assert.ok(existsSync(path.join(output,'fixture.json')),'Seed the separate fixture database first.');
  // Windows PowerShell removes variables set to ''. Set them inside Node before Next loads dotenv.
  for(const key of ['DATABASE_URL','DATABASE_DIRECT_URL','GROQ_API_KEY','TAVILY_API_KEY','RESEND_API_KEY','HUNTER_API_KEY','EMAILABLE_API_KEY','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','OPENAI_API_KEY','ANTHROPIC_API_KEY','GEMINI_API_KEY','GOOGLE_API_KEY','FULLENRICH_API_KEY','RESEND_RECEIVING_DOMAIN','OUTREACH_WORKER_SECRET','RENDER','VERCEL'])process.env[key]='';
  Object.assign(process.env,{MVP_DATA_DIR:dataDir,MVP_NEXT_DIST_DIR:'.next-reliability',MVP_OFFLINE:'1',MVP_DURABLE_RESEARCH:'off',MVP_RESEARCH_WORKER:'off',MVP_SCHEDULER:'off',MVP_FUNNEL_WORKER:'off',MVP_OUTREACH_WORKER:'off',DEMO_EMAIL_ENABLED:'0',MVP_PROSPECT_DEMO_OUTREACH:'off',APP_URL:'http://localhost:3011',DEMO_PASSWORD:'ui-proof-only',SESSION_SECRET:'local-ui-proof-only-session-secret-32-characters',APPROVED_DEMO_RECIPIENT_EMAIL:'hritikdebnath00@gmail.com',DEMO_RECIPIENT_EMAIL:'hritikdebnath00@gmail.com'});
  assert.equal(process.env.DATABASE_URL,'');
  const require=createRequire(import.meta.url);const nextRequire=createRequire(require.resolve('next/package.json'));const {loadEnvConfig}=nextRequire('@next/env');loadEnvConfig(root,false);
  assert.equal(process.env.DATABASE_URL,'','Next dotenv must not load the cloud database URL.');
  for(const key of ['GROQ_API_KEY','TAVILY_API_KEY','RESEND_API_KEY','HUNTER_API_KEY','EMAILABLE_API_KEY','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET'])assert.equal(process.env[key],'');
  console.log(JSON.stringify({isolatedUi:true,database:'fixture PGlite',providersDisabled:true,workersDisabled:true,port:3011}));
  process.argv=[process.argv[0],path.join(root,'node_modules/next/dist/bin/next'),'start','-p','3011'];
  await import('../node_modules/next/dist/bin/next');
}else if(process.argv.includes('--seed')){
  assert.ok(!existsSync(dataDir),'Use a new isolated fixture directory; do not overwrite an existing database.');
  process.env.DATABASE_URL='';process.env.MVP_DATA_DIR=dataDir;
  const {getDb}=await import('../src/mvp/db/index.ts');const db=getDb();
  try{
    const input={query:'Power and control cables',productId:'cables',contactRole:'buyer',researchMode:'deep',targetCompanies:70,markets:['IN','AE'],leadKinds:['supply_subcontract'],offline:false};
    const counters={sourcesTotal:8,sourcesDone:8,itemsRead:20,relevant:10,scopedProspects:3,newLeads:3,deferredPages:5,deferredUrls:3,researchState:'partial',coverageIncomplete:true,researchStopReason:'UI fixture: bounded research pause; no live search was run'};
    await db.query("insert into runs(id,status,adhoc_query,counters) values($1,'done',$2,$3)",[runId,input,counters]);
    const fixtures=[{name:'Sample Active Electrical EPC',domain:'active.example',country:'IN',activity:'ongoing',date:'2026-10-01',score:85,phone:'+1 202 555 0124'},
      {name:'Sample Capabilities Contractor',domain:'capabilities.example',country:null,activity:'capability_only',date:null,score:95,phone:null},
      {name:'Sample Historical Contractor',domain:'historical.example',country:'AE',activity:'historic',date:'2021-03-15',score:40,phone:null}];
    for(let i=0;i<fixtures.length;i++){
      const f=fixtures[i];const company=(await db.query("insert into companies(canonical_name,normalized_name,country,types,domain,domain_confirmed_at) values($1,$2,$3,'{epc_contractor}',$4,now()) returning id",[f.name,f.name.toLowerCase(),f.country,f.domain])).rows[0].id;
      const lead=(await db.query("insert into leads(kind,buyer_company_id,score,score_breakdown,gate_results,class,reasons,scoring_version,is_sample,client_product_ids,buyer_type,run_id) values('supply_subcontract',$1,$2,'{}','[]','research','[]',1,true,'{cables}','epc_contractor',$3) returning id",[company,f.score,runId])).rows[0].id;
      await db.query("insert into search_opportunities(id,run_id,lead_id,company_id,keyword,product_id,product_name,buying_reason,evidence_ids,discovery_kind,fit_score,material_fit_kind,activity_status,activity_date,priority_components,discovery_version) values($1,$2,$3,$4,'Power and control cables','cables','cables','Fictional UI fixture demonstrating cable installation; not a researched buyer.','{}','company',$5,'explicit',$6,$7,$8,1)",[ids[i],runId,lead,company,f.score,f.activity,f.date,{material_fit:35,current_activity:i===0?25:0}]);
      if(f.phone)await db.query("insert into public_company_contacts(company_id,domain,kind,value,source_url,quote) values($1,$2,'phone',$3,$4,$5)",[company,f.domain,f.phone,`https://${f.domain}/contact`,'Fictional published switchboard fixture; do not contact.']);
    }
    writeFileSync(path.join(output,'fixture.json'),JSON.stringify({dataDir,runId,opportunityIds:ids,synthetic:true,allLeadsSample:true,emailsEnabled:false},null,2));
    console.log(JSON.stringify({seeded:true,synthetic:true,dataDir,runId,opportunityIds:ids}));
  }finally{await db.close();}
}else if(process.argv.includes('--browser')){
  const base=process.env.UI_PROOF_BASE_URL||'http://localhost:3011';
  assert.equal(new URL(base).hostname,'localhost');assert.equal(new URL(base).port,'3011');
  const require=createRequire(import.meta.url);const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
  const errors=[],httpErrors=[],writes=[],externalRequests=[],screens=[];
  try{
    const context=await browser.newContext({viewport:{width:1536,height:1024}});
    await context.addInitScript(()=>localStorage.setItem('mvp.tour.seen','1'));
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){externalRequests.push(route.request().url());return route.abort();}return route.continue();});
    const page=await context.newPage();page.setDefaultTimeout(30_000);
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('response',r=>{if(r.status()>=400)httpErrors.push({status:r.status(),url:r.url()});});
    page.on('request',r=>{if(!['GET','HEAD'].includes(r.method())&&!r.url().endsWith('/api/mvp/login'))writes.push({method:r.method(),url:r.url()});});
    await page.goto(base+'/overview?search='+runId);await page.getByLabel('Password',{exact:true}).fill('ui-proof-only');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/overview?search=*');
    const capture=async name=>{await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});screens.push(name);};
    await page.getByRole('region',{name:'Selected search'}).waitFor();await capture('01-desktop-overview');
    await page.goto(base+'/find?run='+runId);await page.getByText(/Research paused · saved results available/).waitFor();
    assert.equal(await page.getByLabel('Product to sell').inputValue(),'cables');await capture('02-desktop-search-partial');
    await page.goto(base+'/crm?search='+runId);await page.getByRole('heading',{name:'Your potential buyers'}).waitFor();
    assert.equal(await page.getByRole('region',{name:'Recent or ongoing work'}).count(),1);
    await page.getByRole('region',{name:'Relevant companies · current work unconfirmed'}).waitFor();
    await page.getByRole('region',{name:'Historical work'}).waitFor();await capture('03-desktop-crm');
    await page.goto(base+'/opportunities/'+ids[0]+'?returnTo='+encodeURIComponent('/crm?search='+runId));
    await page.getByRole('heading',{name:'Sample Active Electrical EPC',exact:true}).waitFor();
    assert.equal(await page.getByRole('complementary',{name:'Lead context and actions'}).count(),1);await capture('04-desktop-workspace');
    await page.getByRole('tab',{name:'Contacts',exact:true}).click();await capture('05-desktop-contacts');
    await page.getByRole('tab',{name:'Email & meetings',exact:true}).click();await capture('06-desktop-email-disabled');
    await page.setViewportSize({width:390,height:844});await page.getByRole('tab',{name:'Overview',exact:true}).click();await capture('07-mobile-workspace');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile workspace overflow');
    await page.goto(base+'/crm?search='+runId);await page.getByRole('heading',{name:'Your potential buyers'}).waitFor();await capture('08-mobile-crm');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile CRM overflow');
    assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);assert.deepEqual(writes,[]);assert.deepEqual(externalRequests,[]);
    const proof={synthetic:true,allLeadsSample:true,realSearchPerformed:false,emailSent:false,calendarCreated:false,runId,screens,browserErrors:errors,httpErrors,mutationRequests:writes,externalRequests};
    writeFileSync(path.join(output,'proof.json'),JSON.stringify(proof,null,2));
    writeFileSync(path.join(output,'index.html'),`<!doctype html><meta charset="utf-8"><title>Reliable discovery UI proof</title><style>body{font:16px system-ui;background:#f5f7fb;color:#17243b;max-width:1400px;margin:32px auto;padding:20px}img{max-width:100%;border:1px solid #ddd;border-radius:12px}section{margin:24px 0}</style><h1>Actual application UI: isolated synthetic fixtures</h1><p>UI/navigation proof only. All companies are Sample data. No real discovery, provider calls, email or meeting was tested.</p>${screens.map(n=>`<section><h2>${n}</h2><img src="${n}.png" alt="${n}"></section>`).join('')}`);
    console.log(JSON.stringify({...proof,report:path.join(output,'index.html')}));
  }finally{await browser.close();}
}else throw Error('Choose --seed, --serve or --browser. External credentials are disabled for the isolated server.');
