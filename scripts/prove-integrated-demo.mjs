/** Read-only production UI proof. Never enables automation or consumes provider credits. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
if(existsSync('.env.funnel.local'))process.loadEnvFile('.env.funnel.local');
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd(),false);
const installed='C:/Users/admin/AppData/Local/Programs/Python/Python311/Lib/site-packages/playwright/driver/package';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||(existsSync(installed)?installed:'playwright'));
const executable='C:/Users/admin/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const base='http://localhost:3007';const run='bdaae4a4-2998-4732-9a7f-e3cd315f36e2';
const output=path.resolve('tmp/integrated-demo-proof');mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(existsSync(executable)?{executablePath:executable}:{})});
const screens=[];const errors=[];const writes=[];const requests=[];
try {
  const context=await browser.newContext({viewport:{width:1536,height:1024}});await context.addInitScript(()=>localStorage.setItem('mvp.tour.seen','1'));
  const login=await context.request.post(base+'/api/mvp/login',{headers:{origin:base},data:{password:process.env.DEMO_PASSWORD||'showcase-demo'}});assert.equal(login.status(),200);
  const get=async endpoint=>{const response=await context.request.get(base+endpoint);assert.equal(response.status(),200,endpoint);return response.json();};
  const before=await get('/api/mvp/automation');assert.equal(before.settings.enabled,false);assert.equal(before.settings.worker,true);assert.equal(before.settings.recipient,'hritikdebnath00@gmail.com');
  assert.ok(before.threads.every(t=>t.paused||['stopped','meeting_booked'].includes(t.state)));
  const researchBefore=(await get('/api/mvp/runs/'+run)).run.counters;
  const page=await context.newPage();page.setDefaultTimeout(30_000);page.setDefaultNavigationTimeout(60_000);page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{requests.push(r.url());if(!['GET','HEAD'].includes(r.method()))writes.push({method:r.method(),url:r.url()});});
  async function capture(name){await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});screens.push(name);}
  await page.goto(base+'/crm?search='+run);await page.getByRole('heading',{name:'Your potential buyers',exact:true}).waitFor();await capture('01-researched-companies');
  const card=page.getByRole('article').filter({has:page.getByRole('heading',{name:'Sama Al Shahba',exact:true}).first()});
  const href=await card.getByRole('link',{name:'Open full lead workspace →',exact:true}).getAttribute('href');assert.ok(href);
  const opportunityId=new URL(href,base).pathname.split('/').at(-1);
  await page.goto(base+href);await page.getByRole('complementary',{name:'Lead context and actions'}).waitFor();await capture('02-company-evidence');
  await page.goto(`${base}/opportunities/${opportunityId}?tab=conversation`);await page.getByRole('link',{name:'Email & Calendar setup',exact:true}).waitFor();
  assert.equal(await page.getByRole('tab',{name:'Email & meetings',exact:true}).getAttribute('aria-selected'),'true');
  assert.equal(await page.getByRole('button',{name:'Start this prospect’s demo workflow',exact:true}).isVisible(),false);
  await page.getByRole('region',{name:'What we can sell them'}).getByRole('heading',{name:'Power and control cables',exact:true}).waitFor();
  await page.getByRole('list',{name:'Sales workflow progress'}).waitFor();await page.getByText(/Research is paused/).waitFor();await capture('03-same-lead-demo-workflow');
  const conversation=await get('/api/mvp/automation/conversation/'+opportunityId);assert.equal(conversation.threads.length,0);assert.equal(conversation.eligibility.researchPaused,true);
  await page.setViewportSize({width:390,height:844});await capture('04-mobile-workflow');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Mobile workflow overflow');
  await page.setViewportSize({width:1536,height:1024});await page.goto(base+'/settings?tab=automation');await page.getByRole('button',{name:'Enable demo funnel',exact:true}).waitFor();await capture('05-automation-setup');
  const after=await get('/api/mvp/automation');assert.equal(after.settings.enabled,false);assert.deepEqual(after.threads.map(t=>t.id).sort(),before.threads.map(t=>t.id).sort());
  assert.deepEqual((await get('/api/mvp/runs/'+run)).run.counters,researchBefore);assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.ok(requests.every(url=>new URL(url).origin===base),'Browser contacted an external provider');
  const proof={passed:true,opportunityId,company:'Sama Al Shahba',screens,browserErrors:errors,mutationRequests:writes,newEmails:0,newProviderRequests:0,worker:true,automationEnabled:false,calendarConnected:Boolean(after.settings.calendar)};
  writeFileSync(path.join(output,'proof.json'),JSON.stringify(proof,null,2));
  writeFileSync(path.join(output,'index.html'),`<!doctype html><meta charset="utf-8"><title>Integrated demo UI proof</title><style>body{font:16px system-ui;background:#f5f7fb;max-width:1400px;margin:30px auto;padding:20px}section{margin:30px 0}img{max-width:100%;border:1px solid #ddd}</style><h1>Actual production local UI — integrated demo controls</h1><p>Real saved Sama Al Shahba research. No emails sent, no research started, no Calendar writes. Google consent is still a user action.</p>${screens.map(name=>`<section><h2>${name}</h2><img src="${name}.png" alt="${name}"></section>`).join('')}`);
  console.log(JSON.stringify(proof));
}finally{await browser.close();}
