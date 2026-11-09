import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {cloudFixture} from './crew-fixtures.mjs';
import {until} from './desk-helpers.mjs';
const f=await cloudFixture(),errors=[];
f.codex.status=async()=>({connected:true,pending:false,account:{email:'fixture@example.test',plan:'fixture'},models:[{id:'gpt-6-astra',name:'Fixture Astra'}],rates:{rateLimits:{limitId:'fixture',limitName:'Fixture allowance',primary:{usedPercent:25,windowDurationMins:300,resetsAt:1900000000}}}});
const r=f.app.store.state.chats[0].seating,m=f.app.store.state.models.find(m=>m.runtime==='codex');
await f.command('table.roster.chair',{chatId:f.chatId,baseRevisionId:r.revisionId,chairId:r.visitors[0].id,name:'Observer🔭',modelId:m.id,personalId:null,coat:null});
await new Promise(resolve=>f.app.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})}),page=await browser.newPage({viewport:{width:1365,height:950}});
page.on('pageerror',e=>errors.push(e.message));await fs.mkdir('.test-output',{recursive:true});
try{
  await page.goto(`http://127.0.0.1:${f.app.address().port}/#session=${f.app.sessionToken}`);await page.locator('#tour-skip').check();await page.locator('#tour-next').click();await page.locator(`[data-action="select-chat"][data-id="${f.chatId}"]`).click();
  await page.getByRole('button',{name:'All',exact:true}).click();await page.locator('#tools-enabled').uncheck();await page.locator('#message-input').fill('Work independently on the fixture.');await page.locator('#send-button').click();
  await until(()=>f.codex.calls.length===2,'two active chairs');
  await page.getByRole('button',{name:'Select',exact:true}).click();await page.getByRole('button',{name:'Select Builder🛠️',exact:true}).click();
  await page.locator('#message-input').fill('Please incorporate this correction.');await page.locator('#send-button').click();
  const queued=page.locator('#crew-queued-inputs article').filter({hasText:'Please incorporate this correction.'});await queued.locator('[data-crew-action="steer"]').click();
  await until(()=>f.codex.calls[0].amendments.length===1,'steering delivered');assert.equal(f.codex.calls[1].amendments.length,0);assert.equal(f.app.deskTasks.entries.size,2);
  f.codex.calls[0].usage({source:'codex_thread_total',sourceId:'fixture-a',threadId:'fixture-a',turnId:'turn-a',inputTokens:100,outputTokens:20,cachedInputTokens:50,reasoningTokens:10,totalTokens:120});
  f.codex.calls[0].usage({source:'codex_thread_total',sourceId:'fixture-a',threadId:'fixture-a',turnId:'turn-a',inputTokens:100,outputTokens:20,cachedInputTokens:50,reasoningTokens:10,totalTokens:120});
  await page.locator('#crew-resource-button').waitFor();await page.locator('#crew-resource-button').click();await page.getByText('Fixture allowance',{exact:true}).waitFor();
  await page.screenshot({path:'.test-output/crew-subscription-meter.png'});assert((await page.locator('#crew-resource-view').innerText()).includes('75% left'));await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.locator('#settings-button').click();await page.locator('[data-action="settings-tab"][data-id="conversation"]').click();await page.locator('#busy-input-form [value="queue-only"]').check();await page.locator('#busy-input-form [type="submit"]').click();await page.locator('#settings-button').click();
  await page.locator('#message-input').fill('This one should wait.');await page.locator('#send-button').click();const waiting=page.locator('#crew-queued-inputs article').filter({hasText:'This one should wait.'});await waiting.waitFor();assert.equal(await waiting.locator('[data-crew-action="steer"]').count(),0);
  f.codex.calls[1].finish();await until(()=>f.app.deskTasks.entries.size===1,'observer finished independently');assert.equal(f.codex.calls.length,2);
  f.codex.calls[0].finish();await until(()=>f.codex.calls.length===3,'queued turn after work');f.codex.calls[2].finish();await until(()=>f.app.deskTasks.entries.size===0,'finished');
  assert.equal(f.app.store.state.exchanges.length,3);const usage=f.app.store.state.deskWork.events.find(e=>e.kind==='task.usage');assert.equal(usage.detail.totalTokens,120);
  assert.deepEqual(errors,[]);const result={status:'PASS',queueFirst:true,steerNow:true,otherChairContinued:true,queueOnly:true,accountMeter:true,duplicateUsageNotAdded:true,modelTurns:3,errors,fixture:f.dir};
  await fs.writeFile('.test-output/crew-steering-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){await page.screenshot({path:'.test-output/crew-steering-browser-failure.png'});console.error(JSON.stringify({error:error.message,errors,visibleError:await page.locator('#error-text').textContent().catch(()=>''),calls:f.codex.calls.length}));throw error;}
finally{await browser.close();await f.close();}
