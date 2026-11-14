import {returnMap,readReturnSource} from '../server/return-map.mjs';
import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fixture,input,until} from './desk-helpers.mjs';
import {writeDeskArtifact} from '../server/desk-work.mjs';
const f=await fixture({hold:false}),errors=[];
await f.command('harness.create',{content:{name:'Blue test coat',description:'',instructions:'Reply normally.'}});
const customId=f.app.store.state.customHarnesses.at(-1).id;
await f.command('harness.options',{id:customId,options:{color:'#2563eb',thinking:false,thinkingContextCharacters:4000}});
const seat=f.app.store.state.chats[0].seating;await f.command('table.roster.chair',{chatId:f.chatId,baseRevisionId:seat.revisionId,chairId:seat.desk.id,name:'Hearthline',modelId:seat.desk.modelId,personalId:null,coat:{id:customId,version:1}});
await f.app.deskTasks.admit(input(f,'Say hello.'));await until(()=>f.app.store.state.deskWork.tasks[0].status==='completed','first reply');
const author=f.app.store.state.deskWork.tasks[0];
await f.app.store.transact(s=>{writeDeskArtifact(s,author,{title:'A shared work log',text:'WORK_LOG_CONTENT: the result is recorded here.'});return s;});
const workSource=returnMap(f.app.store.state,f.chatId,author.selection).slots.task.artifacts.routes[0].source;
const sharedBefore=readReturnSource(f.app.store.state,f.chatId,author.selection,{source:workSource}).text;
f.app.deskTasks.execute=async()=>{throw new Error('Old preparation failure.');};
const failed=await f.app.deskTasks.admit(input(f,'An old unsent request.','failed_request'));
await until(()=>f.app.store.state.deskWork.tasks.at(-1).status==='failed','old failure');
await new Promise(r=>f.app.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
const page=await browser.newPage({viewport:{width:1250,height:900}});page.on('pageerror',e=>errors.push(e.message));
await fs.mkdir('.test-output',{recursive:true});
try{
 await page.goto(`http://127.0.0.1:${f.app.address().port}/#session=${f.app.sessionToken}`);await page.locator('#tour-skip').check();await page.locator('#tour-next').click();
 await page.locator(`[data-action="select-chat"][data-id="${f.chatId}"]`).click();await page.locator('#message-input').waitFor({state:'visible'});
 assert.equal(await page.locator('#conversation .desk-artifact').count(),0);
 await page.locator('.message.assistant[data-coat-color]').first().waitFor();
 const colors=await page.evaluate(()=>{
  const card=document.querySelector('.message.assistant[data-coat-color]'),canvas=document.createElement('canvas'),c=canvas.getContext('2d');
  const rgb=color=>{c.clearRect(0,0,1,1);c.fillStyle=color;c.fillRect(0,0,1,1);return [...c.getImageData(0,0,1,1).data].slice(0,3).map(v=>v/255);};
  const lum=values=>values.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
  const result=[];document.documentElement.style.setProperty('--background-opacity','10%');
  for(const theme of ['garden','starlight','paper'])for(const color of ['#2563eb','#dc2626','#eab308','#000000','#ffffff']){
   document.documentElement.dataset.theme=theme;card.style.setProperty('--coat-color',color);document.documentElement.dataset.backdropActive='false';const ordinary=getComputedStyle(card).backgroundColor;
   document.documentElement.dataset.backdropActive='true';const s=getComputedStyle(card),a=lum(rgb(s.color)),b=lum(rgb(s.backgroundColor));
   result.push({theme,color,ordinary,native:s.backgroundColor,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)});
  }
  document.documentElement.dataset.theme='garden';card.style.setProperty('--coat-color',card.dataset.coatColor);return result;
 });
 assert(colors.every(r=>r.ordinary===r.native),JSON.stringify(colors));assert(colors.every(r=>r.contrast>=4.5),JSON.stringify(colors));
 await page.locator('#work-controls > summary').click();const toggle=page.locator('[data-show-shared-work]');assert.equal(await toggle.isChecked(),false);await toggle.check();
 await page.locator('#conversation .desk-artifact').waitFor();await page.reload();await page.locator(`[data-action="select-chat"][data-id="${f.chatId}"]`).click();await page.locator('#message-input').waitFor({state:'visible'});await page.locator('#conversation .desk-artifact').waitFor();
 await page.locator('#work-controls > summary').click();await toggle.uncheck();await until(()=>f.app.store.state.ui.showSharedWorkInChat===false,'saved display choice');await page.waitForFunction(()=>!document.querySelector('#conversation .desk-artifact'));await page.locator('#work-controls > summary').click();
 await page.locator('#message-input').fill('Keep this new unfinished message.');await page.locator(`[data-action="discard-unsent-request"][data-id="${failed.batchId}"]`).click();
 await page.waitForFunction(id=>!document.querySelector(`[data-message-id="${id}"]`),failed.batchId);assert.equal(await page.locator('#message-input').inputValue(),'Keep this new unfinished message.');
 await until(()=>f.app.store.state.drafts[f.chatId]==='Keep this new unfinished message.','new draft retained');
 await page.locator('#open-chair-drawers').click();await page.locator('#dialog [data-desk-action="shared-work"]').click();await page.getByText('WORK_LOG_CONTENT: the result is recorded here.',{exact:true}).waitFor();await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.reload();await page.locator(`[data-action="select-chat"][data-id="${f.chatId}"]`).click();await page.locator('#message-input').waitFor({state:'visible'});assert.equal(await page.locator('#conversation .desk-artifact').count(),0);assert.equal(await page.locator(`[data-message-id="${failed.batchId}"]`).count(),0);
 assert.equal(await page.locator('#message-input').inputValue(),'Keep this new unfinished message.');
 assert(sharedBefore.includes('WORK_LOG_CONTENT'));assert(readReturnSource(f.app.store.state,f.chatId,author.selection,{source:workSource}).text.includes('WORK_LOG_CONTENT'));
 await page.evaluate(()=>{document.documentElement.dataset.backdropActive='true';document.documentElement.style.setProperty('--background-opacity','40%');});
 await page.screenshot({path:'.test-output/chat-cleanup-backdrop.png'});assert.deepEqual(errors,[]);
 const result={status:'PASS',sharedWorkHiddenByDefault:true,inspectableThroughDrawers:true,togglePersists:true,unsentRequestDiscarded:true,unrelatedDraftKept:true,reload:true,nativeTintCases:colors.length,minContrast:Math.min(...colors.map(r=>r.contrast)),errors};
 await fs.writeFile('.test-output/chat-cleanup-browser.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(e){await page.screenshot({path:'.test-output/chat-cleanup-failure.png'});throw e;}
finally{await browser.close();await f.close();}
