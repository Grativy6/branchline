import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fixture } from './helpers.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.BRANCHLINE_TEST_PLAYWRIGHT);
const output = path.resolve(process.argv[2]);
await fs.mkdir(output, { recursive:true });
const cleanup = [], f = await fixture({ after:fn => cleanup.push(fn) }, { modelOptions:{ timeoutMs:60000 } });
const report = { kind:'REAL_EDGE_SYNTHETIC_WORKSPACE_AND_PROVIDER', status:'RUNNING', checks:[], errors:[] };
let browser, page, response;
const answer = () => { response.setHeader('content-type','application/json'); response.end(JSON.stringify({ choices:[{ message:{content:'Synthetic work finished.'}, finish_reason:'stop' }] })); };
try {
  await f.command('ui.update', { appearance:{theme:'starlight',reading:'relaxed'}, welcomeTour:{ version:1, completedAt:new Date().toISOString(), skipped:true } });
  f.handler = (_body, res) => { response = res; };
  browser = await chromium.launch({ executablePath:process.env.BRANCHLINE_TEST_BROWSER, headless:true });
  page = await browser.newPage({ viewport:{width:1280,height:900} });
  page.setDefaultTimeout(10000); page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(f.uiUrl);
  const active = value => page.waitForFunction(value => document.querySelector('#work-controls').classList.contains('is-active') === value, value);
  const close = () => page.locator('#dialog .dialog-header [data-action="close-dialog"]').click();
  const icon = page.locator('.work-indicator');
  const opaque = async () => {
    const backgrounds = await page.locator('#work-controls summary, .work-menu').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
    assert(backgrounds.every(color => /^rgb\(/.test(color)), backgrounds.join(', '));
  };
  await active(false);
  await page.locator('.home-resume-button').first().click();
  await page.locator('#message-input').fill('Keep working while I open Settings.');
  await page.locator('#send-button').click();
  await active(true);
  await page.waitForFunction(() => document.querySelector('#cancel-button') && !document.querySelector('#cancel-button').hidden);
  await page.locator('#settings-button').click();
  await page.locator('#work-controls summary').click();
  await opaque(); assert(await page.locator('#stop-all-episodes').isVisible());
  assert.equal(await icon.evaluate(node => getComputedStyle(node).animationName),'work-glimmer');
  const first = await icon.evaluate(node => getComputedStyle(node).transform);
  await page.waitForTimeout(350);
  assert.notEqual(await icon.evaluate(node => getComputedStyle(node).transform), first);
  await page.screenshot({path:path.join(output,'activity-working-settings.png')});
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await icon.evaluate(node => getComputedStyle(node).animationName),'none');
  await active(true);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.getByRole('tab',{name:'Models',exact:true}).click();
  await active(true); await opaque();
  await close(); await page.locator('#mode-home').click(); await active(true);
  for (let tries=0; !response && tries<100; tries++) await page.waitForTimeout(20);
  assert(response); answer(); await active(false);
  assert.equal(await icon.evaluate(node => getComputedStyle(node).animationName),'none');
  report.checks.push('Real reply lifecycle: animated through Settings tabs and Home; opaque popup; reduced-motion stays still; completion returns to idle.');

  // A pending episode restored into the page has no local sending promise.
  // Its indicator must still settle while Home or Settings is open.
  response = null;
  const background = f.exchange('Synthetic background episode.');
  for (let tries=0; !response && tries<200; tries++) await page.waitForTimeout(20);
  assert(response); await page.reload(); await active(true);
  await page.locator('#settings-button').click();
  answer(); await background; await active(false);
  report.checks.push('Already-running work found at page open finishes while Settings is open; the shared poll does not leave a stale animation.');

  await close(); await page.locator('.home-resume-button').first().click();
  response = null;
  await page.locator('#message-input').fill('This synthetic reply will be stopped.');
  await page.locator('#send-button').click(); await active(true);
  for (let tries=0; !response && tries<100; tries++) await page.waitForTimeout(20);
  assert(response); await page.locator('#settings-button').click();
  if (!await page.locator('#work-controls').evaluate(node => node.open)) await page.locator('#work-controls summary').click();
  await page.locator('#stop-all-episodes').click(); await active(false);
  assert.equal(f.app.store.state.exchanges.at(-1).status, 'cancelled');
  assert.equal(await page.locator('#work-controls').evaluate(node => node.open), false);
  report.checks.push('Stop remains explicit inside Settings, cancels the synthetic episode and returns the icon to idle.');

  for (const theme of ['garden','paper','starlight']) {
    await page.evaluate(theme => document.documentElement.dataset.theme=theme, theme);
    await page.locator('#work-controls summary').click(); await opaque();
    await page.screenshot({path:path.join(output,`activity-${theme}.png`)});
    await page.locator('#work-controls summary').click();
  }
  assert.deepEqual(report.errors,[]); report.checks.push('Activity button and popup are opaque in all three themes.'); report.status='PASS';
} catch (error) {
  report.status='FAIL'; report.error=error.stack; process.exitCode=1;
  await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
} finally {
  await browser?.close();
  for (const fn of cleanup.reverse()) await fn();
  report.workspace=f.dir; report.syntheticRequests=f.requests.length;
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
