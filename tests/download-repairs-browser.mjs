import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createApp} from '../server/index.mjs';
import {configureHearthline} from '../server/hearthline-profile-setup.mjs';
import {exportAgentProfile} from '../server/agent-profiles.mjs';
import {workRecord} from '../server/work-access.mjs';
import {digest} from '../server/integrity.mjs';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'branchline-download-repair-'));
const runner={async open(){return this;},async close(){},status(){return {available:true,busy:false,phase:'idle',contextTokens:8192};},bundledStatus(){return this.status();}};
const app=await createApp({dataDir:path.join(dir,'workspace'),modelOptions:{localRunner:runner,codex:{close(){},async status(){return {connected:false,models:[]};}}}});
await app.store.transact(configureHearthline);const chat=app.store.state.chats[0];
await app.store.transact(s=>{workRecord(s,'artifacts',{chatId:chat.id,taskId:'synthetic_task',kind:'text_artifact',name:'notes.txt',text:'Synthetic saved output.',textHash:digest('Synthetic saved output.'),provenance:{role:'synthetic'}});return s;});
const profileId=app.store.state.agentProfiles.profiles.at(-1).id;
await new Promise(r=>app.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})}),page=await browser.newPage({acceptDownloads:true,viewport:{width:1280,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
async function download(button){const waiting=page.waitForEvent('download');await button.click();const d=await waiting;return {name:d.suggestedFilename(),bytes:await fs.readFile(await d.path())};}
try{
  await page.goto(`http://127.0.0.1:${app.address().port}/#session=${app.sessionToken}`);await page.locator('#tour-skip').check();await page.locator('#tour-next').click();await page.locator(`[data-action="select-chat"][data-id="${chat.id}"]`).click();
  await page.locator('#settings-button').click();await page.locator('[data-action="settings-tab"][data-id="models"]').click();
  await page.locator('#settings-page [data-action="agent-profile-open"]').first().click();
  const profile=await download(page.locator('#dialog[open] a[data-export][href^="/api/agent-profiles/export"]').first());
  assert.deepEqual(JSON.parse(profile.bytes.toString('utf8')),exportAgentProfile(app.store.state,profileId));await page.keyboard.press('Escape');
  await page.locator('#settings-button').click();await page.locator('#work-controls > summary').click();await page.locator('#work-controls [data-action="work-outputs"]').click();
  const output=await download(page.locator('#dialog[open] a[data-export][href^="/api/work-tools/output"]').first());assert.equal(output.bytes.toString('utf8'),'Synthetic saved output.');assert.deepEqual(errors,[]);
  await fs.mkdir('.test-output',{recursive:true});await page.screenshot({path:'.test-output/download-repairs.png'});console.log(JSON.stringify({status:'PASS',profile:profile.name,output:output.name,downloadedBytesMatch:true,errors}));
}finally{await browser.close();await app.dispose();}
