import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fixture,until,input} from './desk-helpers.mjs';
const f=await fixture({reply:q=>{q.res.writeHead(200,{'content-type':'text/event-stream'});q.res.end(`data: ${JSON.stringify({choices:[{delta:{content:'Fixture reply'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10,prompt_tokens_details:{cached_tokens:20},completion_tokens_details:{reasoning_tokens:5}}})}\n\ndata: [DONE]\n\n`);}}),errors=[];
await new Promise(r=>f.app.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
const page=await browser.newPage({viewport:{width:1010,height:850}});page.on('pageerror',e=>errors.push(e.message));await fs.mkdir('.test-output',{recursive:true});
try{
  await page.goto(`http://127.0.0.1:${f.app.address().port}/#session=${f.app.sessionToken}`);await page.locator('#tour-skip').check();await page.locator('#tour-next').click();
  await page.locator(`[data-action="select-chat"][data-id="${f.chatId}"]`).click();await page.getByRole('button',{name:'All',exact:true}).click();
  for(let i=0;i<3;i++){await page.locator('#message-input').fill('Round '+i);await page.locator('#send-button').click();await until(()=>f.app.store.state.deskWork?.tasks.length===(i+1)*2&&f.app.store.state.deskWork.tasks.every(t=>t.status==='completed'),()=>JSON.stringify({tasks:f.app.deskTasks.status(),requests:f.requests.length,errors}));await page.getByText('Fixture reply',{exact:true}).nth((i+1)*2-1).waitFor();}
  await page.locator('#crew-resource-button').click();await page.locator('.resource-chair').first().waitFor();
  assert.equal(await page.locator('.resource-chair').count(),2);assert.equal(await page.locator('.resource-chair-details').count(),0);
  assert.equal(await page.locator('.resource-chair').first().locator('td').nth(1).innerText(),'300');
  assert((await page.locator('.resource-chair').first().innerText()).includes('3 exchanges'));
  await page.locator('.resource-chair').first().scrollIntoViewIfNeeded();await page.screenshot({path:'.test-output/crew-usage-grouped.png'});
  await page.locator('[data-crew-action="usage-details"]').first().click();assert.equal(await page.locator('.resource-chair-details tbody tr').count(),3);
  const first=f.app.store.state.chats[0].seating.desk.id;
  await f.app.deskTasks.admit(input(f,'A new exchange while expanded','usage_new'),null,{chairIds:[first]});
  await until(()=>f.app.store.state.deskWork.tasks.length===7&&f.app.store.state.deskWork.tasks.every(t=>t.status==='completed'),'seventh exchange');
  await page.waitForFunction(()=>document.querySelector('.resource-chair')?.textContent.includes('4 exchanges'));
  assert.equal(await page.locator('.resource-chair-details tbody tr').count(),4);assert.equal(await page.locator('.resource-chair').first().locator('td').nth(1).innerText(),'400');
  assert.equal(await page.locator('[data-crew-action="usage-details"]').first().getAttribute('aria-expanded'),'true');
  await page.screenshot({path:'.test-output/crew-usage-expanded.png'});
  await page.locator('[data-crew-action="usage-details"]').first().click();assert.equal(await page.locator('.resource-chair-details').count(),0);
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();await page.reload();await page.locator(`[data-action="select-chat"][data-id="${f.chatId}"]`).click();await page.locator('#crew-resource-button').click();await page.locator('.resource-chair').first().waitFor();
  assert.equal(await page.locator('.resource-chair').count(),2);assert.equal(await page.locator('.resource-chair').first().locator('td').nth(1).innerText(),'400');assert.deepEqual(errors,[]);
  const result={status:'PASS',oneRowPerChair:true,totalsAcrossAllExchanges:true,expandCollapse:true,expansionSurvivesUpdates:true,reload:true,fixtureCalls:f.requests.length,errors,fixture:f.dir};
  await fs.writeFile('.test-output/crew-usage-browser.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(error){await page.screenshot({path:'.test-output/crew-usage-failure.png'});throw error;}
finally{await browser.close();await f.close();}
