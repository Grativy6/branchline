// Explicit local model/UI qualification. No personal workspace or external account.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createApp} from '../server/index.mjs';
import {listen} from './helpers.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.BRANCHLINE_TEST_PLAYWRIGHT);
const dir=await fs.mkdtemp(path.resolve('.test-data/bundled-ui-'));
const app=await createApp({dataDir:dir,bundledDir:path.resolve(process.argv[2])});const url=await listen(app);
const report={status:'RUNNING',syntheticOnly:true,checks:[]};let browser;
try {
  browser=await chromium.launch({executablePath:process.env.BRANCHLINE_TEST_BROWSER,headless:true});
  const page=await browser.newPage({viewport:{width:1360,height:1000}});page.setDefaultTimeout(30000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url+'/#session='+app.sessionToken);await page.locator('.home-resume-button').first().click();
  assert.equal(app.localRunner.child,null);assert.equal(await page.locator('#message-input').isEnabled(),true);
  assert.equal(await page.locator('.empty-chat [data-action="models"]').count(),0);
  report.checks.push('Fresh Personal chair ready without first loading the model');
  await page.locator('#message-input').fill('Give a long numbered description of an imaginary garden.');await page.locator('#send-button').click();
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#message-input').disabled);
  assert.equal(app.localRunner.requests,0);report.checks.push('Stop during first load returns the composer');
  await page.locator('#message-input').fill('Name a fictional garden Lantern and describe it in two sentences.');await page.locator('#send-button').click();
  await page.waitForFunction(()=>document.querySelectorAll('.message.assistant:not(.live-reply)').length>=1,null,{timeout:180000});
  await page.waitForFunction(()=>!document.querySelector('#message-input').disabled,null,{timeout:180000});
  assert.match(app.store.state.messages.filter(m=>m.role==='assistant').at(-1).content,/Lantern/i);
  await page.screenshot({path:'test-results/v081/bundled-first-chat.png',fullPage:true});
  report.checks.push('Real Qwen response rendered after cancellation and retry');
  const pid=app.localRunner.child.pid;
  report.runnerMemory=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`Get-Process -Id ${pid} | Select-Object WorkingSet64,PeakWorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true}));
  try { report.gpuMemoryTotalMiB=execFileSync('nvidia-smi',['--query-gpu=memory.used,memory.total','--format=csv,noheader,nounits'],{encoding:'utf8',windowsHide:true}).trim(); } catch { report.gpuMemoryTotalMiB=null; }
  report.resourceNote='One resident sample after text; GPU memory is whole-device, not exclusive ownership or minimum requirement.';
  await page.locator('#settings-button').click();
  await page.locator('[data-action="settings-tab"][data-id="models"]').click();
  await page.locator('[data-action="local-model"]').first().click();
  await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/local-model/control')),page.getByRole('button',{name:'Unload',exact:true}).click()]);
  assert.equal(app.localRunner.child,null);await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/local-model/control')),page.getByRole('button',{name:'Use CPU',exact:true}).click()]);assert.equal(app.localRunner.preference,'cpu');
  report.checks.push('Model settings unload and CPU control work');assert.deepEqual(errors,[]);report.status='PASS';
} catch(error){report.status='FAIL';report.error=error.message;throw error;}
finally {await browser?.close();await app.dispose();report.runnerStopped=app.localRunner.child===null;await fs.writeFile('test-results/v081/bundled-browser.json',JSON.stringify(report,null,2)+'\n');}
