import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fixture, listen } from './helpers.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.BRANCHLINE_TEST_PLAYWRIGHT);
const out = path.resolve(process.env.BRANCHLINE_TEST_REPORT || 'test-results/image-tools-ui');
await fs.mkdir(out, { recursive: true });
const cleanup = [], f = await fixture({ after: fn => cleanup.push(fn) });
const requests = [], upstream = http.createServer((req, res) => {
  requests.push(req.method + ' ' + req.url);
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(req.url.endsWith('/version') ? { version: '6.14.2-synthetic' } : { models: [{ type: 'main', key: 'synthetic', name: '<img onerror="bad()">', base: 'sdxl' }] }));
});
const origin = await listen(upstream);
let browser, page;
try {
  browser = await chromium.launch({ executablePath: process.env.BRANCHLINE_TEST_BROWSER, headless: true });
  page = await browser.newPage({ viewport: { width: 1240, height: 950 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(f.uiUrl);
  await page.getByRole('button', { name: 'Image tools', exact: true }).click();
  assert.deepEqual(requests, []);
  const form = () => page.locator('#image-provider-form');
  await form().locator('[name="endpoint"]').fill(origin);
  await form().getByRole('button', { name: 'Save connection', exact: true }).click();
  await form().getByRole('button', { name: 'Check saved connection', exact: true }).waitFor();
  assert.deepEqual(requests, []);
  await form().getByRole('button', { name: 'Check saved connection', exact: true }).click();
  await page.getByText('Invoke responded · 6.14.2-synthetic', { exact: true }).waitFor();
  assert.equal(requests.length, 2);
  assert.match(await page.locator('#image-provider-panel').innerText(), /capacity has not been measured/);
  await page.getByText('Reported image models', { exact: true }).click();
  assert.equal(await page.locator('#image-provider-panel img').count(), 0);
  for (const width of [1240, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    assert.equal(await page.locator('#image-provider-panel').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    await page.screenshot({ path: path.join(out, 'image-tools-' + width + '.png') });
  }
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload(); await page.getByRole('button', { name: 'Image tools', exact: true }).click();
  assert.equal(await form().locator('[name="endpoint"]').inputValue(), origin);
  assert.match(await page.locator('#image-provider-panel').innerText(), /Connection not checked/);
  assert.equal(requests.length, 2);
  await form().getByRole('button', { name: 'Disconnect', exact: true }).click();
  await form().getByRole('button', { name: 'Check saved connection', exact: true }).waitFor({ state: 'detached' });
  assert.equal(f.app.store.state.imageConnection.revisions.at(-1).endpoint, null);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('[data-action="dream-about"]').click();
  assert.match(await page.locator('#dialog').innerText(), /Dream training needs extra computing power/);
  await page.screenshot({ path: path.join(out, 'dream-compute.png') });
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  await page.getByRole('button', { name: 'My Coats', exact: true }).click();
  await page.getByRole('button', { name: 'New coat', exact: true }).click();
  assert.equal(await page.locator('[data-pocket-tool]').count(), 6);
  await page.getByRole('button', { name: 'Set up image tools', exact: true }).click();
  await page.locator('#image-provider-panel').waitFor();
  assert.deepEqual(errors, []); assert.equal(requests.length, 2); assert.equal(f.requests.length, 0);
  const report = { status: 'PASS', syntheticOnly: true, checks: ['Home setup entry', 'save without network', 'explicit two-GET check', 'no image generation or model inference', 'untrusted labels escaped', '320px/390px/desktop layouts', 'saved address survives reload', 'old check not shown as current', 'disconnect retains history', 'Dream guidance separate', 'six original Coat pockets intact', 'no page errors'] };
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
} catch (error) { await page?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); throw error; }
finally { await browser?.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); for (const fn of cleanup.reverse()) await fn(); }
