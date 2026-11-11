import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createApp} from '../server/index.mjs';
import {applyCommand} from '../server/domain.mjs';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'branchline-desk-icon-'));
const runner={async open(){return this;},async close(){},status(){return {available:true,busy:false,phase:'idle',contextTokens:8192};},bundledStatus(){return this.status();}};
const app=await createApp({dataDir:path.join(dir,'workspace'),modelOptions:{localRunner:runner,codex:{close(){},async status(){return {connected:false,models:[]};}}}});
await new Promise(r=>app.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})}),page=await browser.newPage({viewport:{width:1250,height:850}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));await fs.mkdir('.test-output',{recursive:true});
try{
  const person=app.store.state.personalParticipants[0],chat=app.store.state.chats[0];assert(person);
  await page.goto(`http://127.0.0.1:${app.address().port}/#session=${app.sessionToken}`);await page.locator('#tour-skip').check();await page.locator('#tour-next').click();await page.locator(`[data-action="select-chat"][data-id="${chat.id}"]`).click();
  const button=page.getByRole('button',{name:'Edit Desk Model',exact:true});await button.waitFor();const originalSize=await button.boundingBox(),card=await page.locator('.personal-chair').boundingBox();assert(originalSize.x-card.x>=8,'the icon clears the selected-card border');assert(await page.locator('.desk-onion').isVisible());await page.screenshot({path:'.test-output/desk-icon-rings.png'});
  await button.click();await page.locator('#dialog[open]').waitFor();await page.keyboard.press('Escape');
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="15" fill="#7047a3"/><circle cx="40" cy="40" r="22" fill="#ffd65c"/></svg>';
  await app.dreams.portrait({personalId:person.id,data:'data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64')});await page.reload();await page.locator(`[data-action="select-chat"][data-id="${chat.id}"]`).click();
  await page.waitForFunction(()=>document.querySelector('.desk-personal-icon')?.naturalWidth>0);assert(!(await page.locator('.desk-onion').isVisible()));const photoSize=await button.boundingBox();assert.equal(photoSize.width,originalSize.width);assert.equal(photoSize.height,originalSize.height);await page.screenshot({path:'.test-output/desk-icon-picture.png'});
  await page.route('**/dream-portraits/*.webp',route=>route.fulfill({status:404,body:''}));await page.reload();await page.locator(`[data-action="select-chat"][data-id="${chat.id}"]`).click();await page.locator('.desk-onion').waitFor({state:'visible'});assert(!(await page.locator('.desk-personal-icon').isVisible()));
  const r=app.store.state.chats[0].seating;await app.store.transact(s=>applyCommand(s,{type:'table.roster.chair',payload:{chatId:chat.id,baseRevisionId:r.revisionId,chairId:r.desk.id,name:'Same connection, no personal identity',modelId:r.desk.modelId,personalId:null,coat:null}}));
  await page.reload();await page.locator(`[data-action="select-chat"][data-id="${chat.id}"]`).click();await page.locator('.desk-onion').waitFor({state:'visible'});assert.equal(await page.locator('.desk-personal-icon').count(),0);assert(await page.locator('.desk-onion').isVisible());assert.deepEqual(errors,[]);
  const report={status:'PASS',rings:true,personalPicture:true,sameButtonSize:true,borderInset:originalSize.x-card.x,menuWorks:true,unavailablePictureFallback:true,noCrossIdentityPicture:true,errors,fixture:dir};await fs.writeFile('.test-output/desk-icon-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){await page.screenshot({path:'.test-output/desk-icon-failure.png'});throw error;}
finally{await browser.close();await app.dispose();}
