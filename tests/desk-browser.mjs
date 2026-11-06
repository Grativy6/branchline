import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fixture, finish, until } from './desk-helpers.mjs';
const f=await fixture(),errors=[];
await new Promise(r=>f.app.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
const page=await browser.newPage({viewport:{width:1365,height:950}});
page.on('pageerror',e=>errors.push(e.message));
await fs.mkdir('.test-output',{recursive:true});
try{
  await page.goto(`http://127.0.0.1:${f.app.address().port}/#session=${f.app.sessionToken}`);
  await page.locator('#tour-skip').check();
  await page.locator('#tour-next').click();
  await page.locator(`[data-action="select-chat"][data-id="${f.chatId}"]`).click();
  await page.locator('#message-input').fill('@hearthline Draft a greeting. @qwen Check the greeting.');
  await page.locator('#tools-enabled').uncheck();
  assert.equal(await page.locator('.chair-route').count(),2);
  await page.locator('#send-button').click();
  await until(()=>f.requests.length===2,()=>JSON.stringify({tasks:f.app.store.state.deskWork?.tasks,errors}),8000);
  await page.locator('#work-controls > summary').click();
  await page.waitForFunction(()=>document.querySelectorAll('.activity-current .activity-task').length===2);
  await page.waitForFunction(()=>[...document.querySelectorAll('.activity-current .activity-status')].every(e=>e.textContent==='Working'));
  assert.equal(await page.locator('.activity-current .activity-task').count(),2);
  const menuFits=()=>page.waitForFunction(()=>{const r=document.querySelector('#work-controls .work-menu').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;},null,{timeout:5000});
  await menuFits();
  await page.screenshot({path:'.test-output/desk-browser-concurrent.png'});
  for(const width of [800,390]){
    await page.setViewportSize({width,height:950});
    await menuFits();
    await page.screenshot({path:`.test-output/desk-browser-activity-${width}.png`});
  }
  await page.setViewportSize({width:1365,height:950});
  await menuFits();
  finish(f.requests[1],'Qwen checked the greeting.');
  await until(()=>f.app.store.state.deskWork.tasks.some(t=>t.status==='completed'),'Qwen completion');
  await page.waitForFunction(()=>document.querySelectorAll('.activity-current .activity-task').length===1);
  await page.locator('.activity-current [data-desk-action="stop"]').click();
  await until(()=>f.app.store.state.deskWork.tasks.every(t=>!['running','preparing','stopping'].includes(t.status)),()=>JSON.stringify(f.app.store.state.deskWork.tasks));
  assert.deepEqual(f.app.store.state.deskWork.tasks.map(t=>t.status),['cancelled','completed']);
  await page.locator('#work-controls > summary').click();
  await page.locator('#open-chair-drawers').click();
  await page.locator('#dialog [data-desk-action="drawer"]').first().click();
  await page.getByText('Inspecting recorded chair work.',{exact:false}).waitFor();
  await page.screenshot({path:'.test-output/desk-browser-drawer.png'});
  assert.deepEqual(errors,[]);
  const result={status:'PASS',concurrentRequests:2,independentStop:true,routingPreview:true,drawerInspector:true,activityFitsWidths:[1365,800,390],errors,workspace:f.dir};
  await fs.writeFile('.test-output/desk-browser-result.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}catch(error){
  console.error(JSON.stringify({menu:await page.locator('#work-controls .work-menu').evaluate(e=>({rect:e.getBoundingClientRect().toJSON(),style:e.getAttribute('style'),parent:e.parentElement.tagName,open:e.parentElement.open})).catch(()=>null)}));
  await page.screenshot({path:'.test-output/desk-browser-failure.png'}).catch(()=>{});
  console.error(JSON.stringify({error:error.message,pageErrors:errors,visibleError:await page.locator('#error-text').textContent().catch(()=>''),body:(await page.locator('body').innerText()).slice(0,1500)}));
  process.exitCode=1;
}finally{await browser.close();await f.close();}
