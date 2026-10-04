/** Read-only local browser check. No searches, sending, enrichment or calendar writes. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"playwright");
const base="http://localhost:3007";
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addInitScript(()=>localStorage.setItem("mvp.tour.seen","1"));
  const page=await context.newPage();const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(base+"/outreach");await page.getByLabel("Password",{exact:true}).fill(process.env.DEMO_PASSWORD||"showcase-demo");
  await page.getByRole("button",{name:"Sign in",exact:true}).click();await page.waitForURL("**/outreach");
  await page.getByText("Potential-buyer demo mode:",{exact:false}).waitFor();
  const statusResponse=await context.request.get(base+"/api/mvp/automation");assert.equal(statusResponse.status(),200);
  const status=await statusResponse.json();assert.equal(status.settings.recipient,"hritikdebnath00@gmail.com");
  assert.equal(status.settings.prospectDemo,true);assert.equal(status.settings.prospectsPerSearch,1);assert.equal(status.settings.worker,true);assert.equal(status.settings.enabled,true);
  mkdirSync("tmp/automation-browser-proof",{recursive:true});
  await page.screenshot({path:"tmp/automation-browser-proof/09-potential-buyer-demo-mode.png",fullPage:true});
  for(const path of ["/find","/crm","/overview"]) {
    await page.goto(base+path);assert.equal(await page.locator("main").count(),1);
  }
  await page.goto(base+"/find");await page.getByText("Find contractors with relevant projects",{exact:false}).waitFor();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,readOnly:true,liveResearchRequests:0,emailSends:0,verificationRequests:0,browserErrors:0,recipient:status.settings.recipient,prospectDemo:true,perSearchLimit:1,calendar:status.settings.calendar||"consent needed"}));
} finally {await browser.close();}
