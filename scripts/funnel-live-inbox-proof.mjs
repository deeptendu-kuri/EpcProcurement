/** Explicit live demo: one idempotent inbox test. No research or verification requests. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
const loadModule = createRequire(import.meta.url);
const { chromium } = loadModule(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = 'http://localhost:3007';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => localStorage.setItem('mvp.tour.seen', '1'));
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/outreach');
    await page.getByLabel('Password', { exact: true }).fill(process.env.DEMO_PASSWORD || 'showcase-demo');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/outreach');
    async function get(endpoint) { const r = await context.request.get(base + endpoint); assert.equal(r.status(), 200); return r.json(); }
    async function post(data) { const r = await context.request.post(base + '/api/mvp/automation', { data, headers: { origin: base } }); if (r.status() !== 200) throw new Error((await r.json()).error || `Automation HTTP ${r.status()}`); return r.json(); }
    let data = await get('/api/mvp/automation');
    assert.equal(data.settings.recipient, 'hritikdebnath00@gmail.com');
    assert.equal(data.settings.worker, true); assert.equal(data.settings.ready, true);
    if (!data.settings.enabled) data = await post({ action: 'enable', confirmedRecipient: data.settings.recipient });
    data = await post({ action: 'start_email_test', confirmedRecipient: data.settings.recipient, productId: 'line-pipe' });
    const thread = data.threads.find(t => t.mode === 'email_test' && t.recipient === data.settings.recipient);
    assert.ok(thread); assert.equal(thread.opportunity_id, null);
    const checkSellerIntro = process.argv.includes('--seller-intro');
    if (checkSellerIntro) await post({ action: 'send_seller_test_intro', confirmedRecipient: data.settings.recipient, threadId: thread.id });
    let conversation;
    for (let n = 0; n < 24; n++) {
      conversation = await get('/api/mvp/automation/test/' + thread.id);
      if (conversation.messages.some(m => m.kind === (checkSellerIntro ? 'seller_intro' : 'initial') && m.state === 'accepted')) break;
      const current = conversation.threads[0];
      if (current.state === 'review') throw new Error('Test needs review: ' + current.reason);
      await page.waitForTimeout(5000);
    }
    assert.ok(conversation.messages.some(m => m.kind === 'initial' && m.state === 'accepted'), 'No provider-accepted initial email yet; inspect the timeline before retrying.');
    if (checkSellerIntro) { const message = conversation.messages.find(m => m.kind === 'seller_intro' && m.state === 'accepted'); assert.ok(message); assert.ok(message.body.includes("I'm Hritik Debnath")); assert.ok(message.body.includes('procurement options for line pipe')); assert.ok(message.body.includes('quality expectations and budget')); assert.ok(!message.body.includes('Congratulations')); }
    const leads = await get('/api/mvp/leads');
    assert.ok(leads.items.every(l => !l.isSample), 'Live demo must not substitute sample buyer records.');
    await page.reload();
    await page.getByRole('heading', { name: 'Email automation timeline' }).waitFor();
    await page.screenshot({ path: path.resolve('tmp/automation-browser-proof/07-new-inbox-live-automation.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, localOnly: true, automationEnabled: true, recipient: data.settings.recipient, initialEmail: 'provider accepted', ...(checkSellerIntro ? { correctedSellerIntro: 'provider accepted' } : {}), rawLeadCount: leads.total, testIsBuyer: false, verificationRequestsByTest: 0, calendar: data.settings.calendar || 'consent needed', browserErrors: 0 }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
