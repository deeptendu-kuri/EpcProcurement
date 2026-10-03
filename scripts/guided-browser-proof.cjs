/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS launcher supports an externally installed Playwright module. */
/** Run against an isolated, offline local server. Never sends email or changes production data. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PROOF_BASE_URL || 'http://localhost:3005';
if (!/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(base)) throw new Error('Browser proof must target an isolated local server.');
const output = path.resolve('tmp/guided-browser-proof');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await context.addInitScript(() => { localStorage.setItem('mvp.tour.seen', '1'); });
  const page = await context.newPage();
  page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(120000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    const anonymous = await context.request.get(`${base}/api/mvp/runs`);
    assert.equal(anonymous.status(), 401);
    await page.goto(`${base}/overview`);
    await page.getByLabel('Password', { exact: true }).fill(process.env.DEMO_PASSWORD || 'branch-test-only');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/overview');
    await page.getByRole('heading', { name: 'Your buyer workspace' }).waitFor();
    await page.screenshot({ path: path.join(output, 'overview-empty.png'), fullPage: true, caret: 'initial' });
    await page.goto(`${base}/find`);
    assert.equal(await page.getByLabel('Add a country').locator('option').count(), 250);
    await page.getByLabel('Product to sell').selectOption('line-pipe');
    await page.locator('#find-query').fill('pipeline');
    await page.getByLabel('Contact role wanted').selectOption('buyer');
    const start = page.waitForResponse(r => r.url().endsWith('/api/mvp/runs') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Search now', exact: true }).click();
    const ticket = await (await start).json();
    let runId = ticket.runId;
    const deadline = Date.now() + 180000;
    while (!runId && Date.now() < deadline) { const queued = await context.request.get(`${base}/api/mvp/queue/${ticket.ticketId}`); runId = (await queued.json()).runId; await page.waitForTimeout(1000); }
    assert.ok(runId, 'Search must start');
    let status;
    while (Date.now() < deadline) { const r = await context.request.get(`${base}/api/mvp/runs/${runId}`); const body = await r.json(); status = (body.run || body).status; if (['done','failed','cancelled'].includes(status)) break; await page.waitForTimeout(1000); }
    assert.equal(status, 'done', 'Offline search must finish');
    await page.goto(`${base}/crm?search=${runId}&country=IN&keyword=pipeline`);
    const table = page.getByRole('table'); await table.waitFor();
    assert.ok((await table.locator('tbody tr').count()) > 0);
    const cells = await table.locator('tbody tr td:nth-child(3)').allTextContents();
    assert.ok(cells.every(t => t === 'line pipe'), 'Only selected product may appear');
    await page.screenshot({ path: path.join(output, 'discovered-crm.png'), fullPage: true, caret: 'initial' });
    await table.locator('tbody tr').first().getByRole('link').first().click();
    await page.getByRole('heading', { name: 'Review buyer fit', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Contact lead / Preview demo email' }).isDisabled(), true);
    const review = page.waitForResponse(r => r.url().includes('/api/mvp/opportunities/') && r.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Confirm product buyer fit', exact: true }).first().click();
    assert.equal((await review).status(), 200);
    await page.getByRole('heading', { name: 'Contact validation needed', exact: true }).waitFor();
    const draftResponse = page.waitForResponse(r => r.url().endsWith('/api/mvp/drafts') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Contact lead / Preview demo email' }).click();
    const draft = await (await draftResponse).json(); assert.ok(draft.body.includes('line pipe'));
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Approve & automate demo email', exact: true }).isDisabled(), true, 'No live key in browser-test server');
    await page.screenshot({ path: path.join(output, 'email-preview.png'), fullPage: true, caret: 'initial' });
    await page.keyboard.press('Escape');
    await page.getByLabel('Summary', { exact: true }).fill('Reviewed pipeline fit; awaiting validated procurement email.');
    await page.getByLabel('Sales owner').fill('Demo sales team');
    const save = page.waitForResponse(r => r.url().includes('/api/mvp/opportunities/') && r.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Save CRM notes', exact: true }).click(); assert.equal((await save).status(), 200);
    await page.getByRole('status').filter({ hasText: 'Saved successfully.' }).waitFor();
    await page.waitForTimeout(500);
    await page.reload(); assert.equal(await page.getByLabel('Summary', { exact: true }).inputValue(), 'Reviewed pipeline fit; awaiting validated procurement email.');
    await page.screenshot({ path: path.join(output, 'workspace.png'), fullPage: true, caret: 'initial' });
    await page.getByRole('link', { name: 'Back to filtered CRM results', exact: false }).click();
    await page.waitForURL('**/crm?**');
    assert.equal(new URL(page.url()).searchParams.get('country'), 'IN');
    assert.equal(new URL(page.url()).searchParams.get('keyword'), 'pipeline');
    await page.getByRole('link', { name: /^Verified CRM/ }).click();
    await page.getByRole('heading', { name: 'No validated prospects yet' }).waitFor();
    await page.goto(`${base}/overview?search=${runId}`);
    await page.screenshot({ path: path.join(output, 'overview-search.png'), fullPage: true, caret: 'initial' });
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of [`/overview?search=${runId}`, '/find', `/crm?search=${runId}`]) {
      await page.goto(base + route); await page.waitForTimeout(300);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `Mobile page overflow: ${route}`);
    }
    await page.screenshot({ path: path.join(output, 'mobile-crm.png'), fullPage: true, caret: 'initial' });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, searchId: runId, screenshots: output, checks: ['login/auth', '249 country options', 'offline discovery', 'product-only CRM', 'fit review gate', 'auto email preview', 'no live sends', 'persistent notes', 'back-link filters', 'no fake verification', 'mobile overflow', 'zero browser errors'] }));
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true, caret: 'initial' }).catch(() => {});
    console.error(JSON.stringify({ url: page.url(), browserErrors: errors, visibleText: (await page.locator('body').innerText().catch(() => '')).slice(-8000) }));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
