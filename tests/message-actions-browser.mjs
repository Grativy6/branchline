import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fixture,input,until} from './desk-helpers.mjs';
const f=await fixture({hold:false}),errors=[];let imageRequests=0;
await f.command('message.note',{chatId:f.chatId,content:'A little garden beside a cabin.'});
const plainId=f.app.store.state.messages.at(-1).id;
const text='Let us build a small garden. @hearthline Suggest a place to sit. @qwen Suggest a flowering plant.';
const batch=await f.app.deskTasks.admit(input(f,text,'gear_fixture'));
await until(()=>f.app.deskTasks.status().every(t=>t.status==='completed'),'fixture replies');
const replyId=f.app.store.state.messages.find(m=>m.role==='assistant').id;
await new Promise(r=>f.app.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})}),page=await browser.newPage({viewport:{width:1280,height:950}});
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().endsWith('/api/easel/request'))imageRequests++;});
await page.route('**/api/personal-context',route=>route.fulfill({json:{available:true,profiles:[]}}));
await fs.mkdir('.test-output',{recursive:true});
const gear=id=>page.locator(`[data-message-options="${id}"]`),menu=page.locator('#message-options-menu'),dialog=page.locator('#dream-job-dialog');
const bounds=()=>page.waitForFunction(()=>{const m=document.getElementById('message-options-menu'),r=m.getBoundingClientRect();return m.matches(':popover-open')&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;});
try{
  await page.goto(`http://127.0.0.1:${f.app.address().port}/#session=${f.app.sessionToken}`);await page.locator('#tour-skip').check();await page.locator('#tour-next').click();await page.locator(`[data-action="select-chat"][data-id="${f.chatId}"]`).click();
  await page.locator('#message-input').fill('Keep my unfinished message.');await gear(batch.batchId).waitFor();
  assert.equal(await page.locator('.message [data-action="save-sketch"],.message [data-dream-job="mark-message"],.message [data-action="reply-details"]').count(),0);
  assert(!(await page.locator('.message-meta').allTextContents()).some(t=>t.includes('Chair assignments')));
  await page.evaluate(id=>{const text=document.querySelector(`[data-message-id="${id}"] .message-body`).firstChild,r=document.createRange();r.setStart(text,0);r.setEnd(text,21);const s=getSelection();s.removeAllRanges();s.addRange(r);},batch.batchId);
  const selection=await page.evaluate(()=>getSelection().toString()),before=await page.locator('#conversation').evaluate(n=>({height:n.scrollHeight,top:n.scrollTop}));
  await gear(batch.batchId).click();await bounds();assert.equal(await page.evaluate(()=>getSelection().toString()),selection);assert.deepEqual(await page.locator('#conversation').evaluate(n=>({height:n.scrollHeight,top:n.scrollTop})),before);
  assert.deepEqual(await menu.getByRole('menuitem').allTextContents(),['Save as Dream note','Send with Pony Post','Make image']);
  await gear(replyId).click();assert.equal(await gear(batch.batchId).getAttribute('aria-expanded'),'false');assert.equal(await gear(replyId).getAttribute('aria-expanded'),'true');assert.equal(await page.locator('.message-options-menu:popover-open').count(),1);
  await page.keyboard.press('Escape');assert.equal(await gear(replyId).evaluate(n=>n===document.activeElement),true);
  await gear(replyId).press('ArrowDown');assert.equal(await menu.getByRole('menuitem').first().evaluate(n=>n===document.activeElement),true);await page.keyboard.press('End');assert.equal(await menu.getByRole('menuitem').last().evaluate(n=>n===document.activeElement),true);
  await menu.getByRole('menuitem',{name:'Details',exact:true}).click();await page.locator('#dialog[open]').waitFor();await page.keyboard.press('Escape');
  await gear(batch.batchId).click();await menu.getByRole('menuitem',{name:'Save as Dream note'}).click();await dialog.getByRole('button',{name:'Workflow',exact:true}).click();
  await until(()=>f.app.store.state.dreamTraining?.notes.length===1,'group note saved');const note=await f.app.dreams.note(f.app.store.state.dreamTraining.notes[0].id);assert.equal(note.note.focus,'workflow');assert.equal(note.source.messages.at(-1).content,text);assert.equal(note.source.messages.at(-1).deskBatchId,batch.batchId);
  await gear(replyId).click();await menu.getByRole('menuitem',{name:'Save as sketch'}).click();await page.locator('#sketch-sheet[open]').waitFor();assert.equal(await page.locator('#sketch-editor textarea').inputValue(),'Test reply');await page.getByRole('button',{name:'Close New sketch',exact:true}).click();await page.locator('[data-sketch-action="close-book"]').click();
  await gear(replyId).click();await menu.getByRole('menuitem',{name:'Save as memory'}).click();await page.locator('#personal-context-remember').waitFor();assert.equal(await page.locator('#personal-context-remember textarea').inputValue(),'Test reply');await page.keyboard.press('Escape');
  await gear(plainId).click();await menu.getByRole('menuitem',{name:'Make image'}).click();await page.locator('#easel-dialog[open]').waitFor();await page.waitForFunction(()=>document.querySelector('#easel-dialog [data-role=prompt]')?.value==='A little garden beside a cabin.');assert.equal(await page.locator('#easel-dialog [data-role="prompt"]').inputValue(),'A little garden beside a cabin.');
  const oldProject=await page.locator('#easel-dialog [data-role="projects"]').inputValue();await page.locator('#easel-dialog [data-role="prompt"]').fill('Keep this earlier image idea.');await page.locator('[data-easel="close"]').click();
  await gear(batch.batchId).click();await menu.getByRole('menuitem',{name:'Make image'}).click();await page.waitForFunction(text=>document.querySelector('#easel-dialog [data-role=prompt]')?.value===text,text);assert.equal(await page.locator('#easel-dialog [data-role="prompt"]').inputValue(),text);await page.locator('#easel-dialog [data-role="projects"]').selectOption(oldProject);await page.waitForFunction(()=>document.querySelector('#easel-dialog [data-role=prompt]')?.value==='Keep this earlier image idea.');assert.equal(await page.locator('#easel-dialog [data-role="prompt"]').inputValue(),'Keep this earlier image idea.');await page.locator('[data-easel="close"]').click();assert.equal(imageRequests,0);
  await gear(batch.batchId).click();await f.command('message.note',{chatId:f.chatId,content:'A later message arrives while options are open.'});await page.locator('.message-body').getByText('A later message arrives while options are open.',{exact:true}).waitFor();assert.equal(await gear(batch.batchId).getAttribute('aria-expanded'),'true');assert.equal(await menu.getByRole('menuitem',{name:'Make image'}).getAttribute('data-id'),batch.batchId);await bounds();await page.screenshot({path:'.test-output/message-actions-wide.png'});
  await page.locator('#message-input').click();assert.equal(await menu.isVisible(),false);assert.equal(await page.locator('#message-input').inputValue(),'Keep my unfinished message.');
  for(const width of [800,430]){await page.setViewportSize({width,height:850});await gear(replyId).click();await bounds();await page.keyboard.press('Escape');}
  await page.screenshot({path:'.test-output/message-actions-narrow.png'});assert.deepEqual(errors,[]);
  const result={status:'PASS',selectionAndScrollPreserved:true,groupPromptDream:true,sketchMemoryDetails:true,easelDraftPreserved:true,imageRequests,keyboard:true,narrowMenus:true,stableDuringUpdates:true,errors,fixture:f.dir};await fs.writeFile('.test-output/message-actions-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){await page.screenshot({path:'.test-output/message-actions-failure.png'});console.error(JSON.stringify({errors,appError:await page.locator('#error-text').textContent().catch(()=>''),menu:await menu.innerText().catch(()=>'' )}));throw error;}
finally{await browser.close();await f.close();}
