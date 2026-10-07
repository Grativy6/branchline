import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { fixture } from './helpers.mjs';

const require = createRequire(import.meta.url);
const playwrightPath = process.env.BRANCHLINE_TEST_PLAYWRIGHT;
const browserPath = process.env.BRANCHLINE_TEST_BROWSER;
if (!playwrightPath || !browserPath) throw new Error('Set the existing Playwright and browser paths; this check installs nothing.');
const { chromium } = require(playwrightPath);
const cleanups = [];
const f = await fixture({ after: cleanup => cleanups.push(cleanup) });
let browser;
try {
  f.handler = async (body, res) => {
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'A **synthetic reply** with its context preserved.' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
    } else res.end(JSON.stringify({ choices: [{ message: { content: '<script>This is unapplied text, not code.</script>' }, finish_reason: 'length' }] }));
  };
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(f.uiUrl);
  await page.locator('.home-resume-button').first().click();
  const choose = async name => {
    const waiting = page.waitForEvent('filechooser');
    await page.locator('#attach-file').click();
    await (await waiting).setFiles({ name, mimeType: 'text/plain', buffer: Buffer.from('Synthetic selected text.\r\n<script>File content stays text.</script> 💛') });
    await page.locator('#attached-file-name').filter({ hasText: name }).waitFor();
  };
  await choose('remove-me.md');
  await page.locator('#remove-file').click();
  assert.equal(await page.locator('#attached-file').isVisible(), false);
  await choose('selected-notes.md');
  await page.locator('#message-input').fill('Show me the continuing thread.');
  await page.locator('#send-button').click();
  await page.locator('[data-action="reply-details"]').last().waitFor();
  assert.equal(f.app.store.state.exchanges.at(-1).selectedFile.name, 'selected-notes.md');
  assert.ok(f.requests[0].messages.some(m => m.content.includes('Synthetic selected text.')));
  assert.equal(await page.locator('#attached-file').isVisible(), false);
  await page.locator('.file-copy summary').click();
  assert.match(await page.locator('.file-text').innerText(), /File content stays text/);
  assert.equal(await page.locator('.file-copy script').count(), 0);
  await page.locator('[data-action="reply-details"]').last().click();
  await page.getByText('Handoff trace', { exact: true }).click();
  await page.getByText('Context supplied to the model', { exact: false }).waitFor();
  await page.getByText('Selected file read', { exact: false }).waitFor();
  assert.match(await page.locator('#dialog').innerText(), /app tools recorded for this episode/);
  assert.match(await page.locator('#dialog').innerText(), /does not establish limits on the separate model server/);
  const outputs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test-results', process.env.BRANCHLINE_TEST_RUN || '.');
  await fs.mkdir(outputs, { recursive: true });
  await page.screenshot({ path: path.join(outputs, 'reply-handoff.png'), fullPage: true });
  await page.locator('#dialog .dialog-header [data-action="close-dialog"]').click();
  const exchangeId = f.app.store.state.exchanges.at(-1).id;
  assert.equal((await f.reflect(exchangeId, 'heart')).status, 409);
  await page.reload(); await page.locator('.home-resume-button').first().click();
  await page.locator('#details-toggle').click();
  await page.getByText('Reflection history (1)', { exact: true }).click();
  await page.getByText('Retained text (not applied)', { exact: true }).click();
  await page.getByText('<script>This is unapplied text, not code.</script>', { exact: true }).waitFor();
  assert.equal(await page.locator('.continuity-history script').count(), 0);
  await page.screenshot({ path: path.join(outputs, 'held-reflection.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'PASS', checks: ['file picker and removal work', 'selected copy reaches local model', 'file text is inspectable and escaped', 'normal chat renders', 'reply trace opens', 'file read receipt is visible', 'capability is visible', 'held reflection is inspectable', 'retained text is escaped', 'no browser errors'], workspace: f.dir, screenshots: outputs }));
} finally {
  await browser?.close();
  for (const cleanup of cleanups.reverse()) await cleanup();
}
