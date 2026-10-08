/** One live official-domain lookup. Re-runs capture existing results, never repeat paid research. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=path.resolve('tmp/published-contacts-proof');mkdirSync(output,{recursive:true});
const manifest=path.join(output,'proof.json');
const state=existsSync(manifest)?JSON.parse(readFileSync(manifest,'utf8')):{};
const websiteOnly=process.argv[2]==='website';const marker=websiteOnly?'websiteSubmittedAt':'submittedAt';
const save=()=>writeFileSync(manifest,JSON.stringify(state,null,2));
const base='http://localhost:3007';const id='c9cb4722-d73a-4718-8cba-a6222d46835f';
// Identity checked against the company's actual published Contact/About pages.
const domain='kalpataruprojects.com';
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
try {
  const context=await browser.newContext({viewport:{width:1536,height:1024}});
  await context.addInitScript(()=>localStorage.setItem('mvp.tour.seen','1'));
  const page=await context.newPage();page.setDefaultTimeout(30_000);
  await page.goto(base+'/find');await page.getByLabel('Password',{exact:true}).fill('showcase-demo');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/find');
  const get=async endpoint=>{const r=await context.request.get(base+endpoint);assert.equal(r.status(),200);return r.json();};
  const before=await get('/api/mvp/automation/conversation/'+id);
  await page.goto(base+'/opportunities/'+id);await page.getByRole('tab',{name:'Contacts',exact:true}).click();
  await page.getByRole('heading',{name:'Find & validate company contacts',exact:true}).waitFor();
  if(!state[marker]) {
    await page.getByLabel('Official company website domain').fill(domain);
    await page.getByRole('checkbox',{name:/I checked that this website/}).check();
    state[marker]=new Date().toISOString();state.domain=domain;state.officialSource='https://kalpataruprojects.com/contact';save();
    const pending=page.waitForResponse(r=>r.url().endsWith('/enrichment')&&r.request().method()==='POST',{timeout:150_000});
    await page.getByRole('button',{name:websiteOnly?'Read website phone & inbox · no search credits':'Find published company contacts',exact:true}).click();
    const response=await pending;state.httpStatus=response.status();state.result=await response.json();state[websiteOnly?'websiteResult':'searchResult']=state.result;save();
    assert.equal(response.status(),200,JSON.stringify(state.result));
  }
  await page.reload();await page.getByRole('tab',{name:'Contacts',exact:true}).click();
  await page.getByRole('table',{name:'Company contact roles & details'}).waitFor();
  await page.getByTestId('chain-contact-row').first().waitFor();
  const view=await get('/api/mvp/opportunities/'+id+'/enrichment');state.current=view;
  await page.screenshot({path:path.join(output,'01-contacts.png'),fullPage:true});
  await page.getByRole('tab',{name:'Overview',exact:true}).click();
  assert.equal(await page.getByRole('region',{name:'What we can sell them',exact:true}).count(),1);
  await page.screenshot({path:path.join(output,'02-overview.png'),fullPage:true});
  const after=await get('/api/mvp/automation/conversation/'+id);
  state.noAdditionalDemoMail=JSON.stringify(before.messages.filter(m=>m.direction==='out').map(m=>m.id))===JSON.stringify(after.messages.filter(m=>m.direction==='out').map(m=>m.id));
  state.checkedAt=new Date().toISOString();save();
  console.log(JSON.stringify({httpStatus:state.httpStatus,result:state.result,current:state.current,noAdditionalDemoMail:state.noAdditionalDemoMail,proof:manifest}));
}finally{await browser.close();}
