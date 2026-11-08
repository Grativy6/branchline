import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fixture,finish,until} from './desk-helpers.mjs';
import {deskEvent} from '../server/desk-work.mjs';
const f=await fixture(),errors=[];
await f.command('model.save',{name:'Luna',model:'luna',runtime:'compatible',baseUrl:f.fakeUrl,thinking:false});
let roster=f.app.store.state.chats[0].seating;
await f.command('table.roster.chair',{chatId:f.chatId,baseRevisionId:roster.revisionId,chairId:null,name:'Luna',modelId:f.app.store.state.models.find(m=>m.name==='Luna').id,personalId:null,coat:null});
await new Promise(r=>f.app.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
const page=await browser.newPage({viewport:{width:1365,height:950}});page.on('pageerror',e=>errors.push(e.message));await fs.mkdir('.test-output',{recursive:true});
try{
 await page.goto(`http://127.0.0.1:${f.app.address().port}/#session=${f.app.sessionToken}`);await page.locator('#tour-skip').check();await page.locator('#tour-next').click();
 await page.locator(`[data-action="select-chat"][data-id="${f.chatId}"]`).click();await page.getByRole('button',{name:'All',exact:true}).waitFor();
 assert.equal(await page.locator('.reply-chair-buttons').count(),0);
 assert.deepEqual(await page.locator('.reply-pattern-buttons button').allTextContents(),['Select','Alternate','All']);
 const highlightCount=()=>page.locator('.personal-chair .chair-picker[aria-pressed="true"],.visitor-row[aria-selected="true"]').count();assert.equal(await highlightCount(),1);
 await page.locator('.visitor-row').filter({hasText:'Qwen'}).click();await page.locator('.visitor-row[aria-selected="true"]').filter({hasText:'Qwen'}).waitFor();assert.equal(await highlightCount(),1);assert.equal(await page.locator('.personal-chair .chair-picker').getAttribute('aria-pressed'),'false');
 await page.getByRole('button',{name:'Edit Desk Model',exact:true}).click();await page.getByRole('heading',{name:'Desk Model',exact:true}).waitFor();assert.equal(await page.locator('.visitor-row[aria-selected="true"]').count(),1);
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();await page.getByRole('button',{name:'Select Hearthline',exact:true}).click();await page.locator('.personal-chair .chair-picker[aria-pressed="true"]').waitFor();assert.equal(await highlightCount(),1);assert.equal(await page.locator('.visitor-row[aria-selected="true"]').count(),0);assert.equal(await page.locator('[data-action="visitor-remove"]').isEnabled(),false);
 await page.locator('#tools-enabled').uncheck();await page.locator('#message-input').fill('Just saying hello. @Hearthline @Qwen @Luna');
 assert.equal(await page.locator('.chair-route').count(),3);assert.equal(await page.locator('.chair-routes .message-error').count(),0);assert.equal(await page.locator('.chair-route').filter({hasText:'Receives the shared prompt'}).count(),3);
 await page.locator('#send-button').click();await until(()=>f.requests.length===3,'three empty-section calls');for(const q of f.requests)finish(q);await until(()=>f.app.store.state.deskWork.tasks.every(t=>t.status==='completed'),'first batch done');
 await page.getByRole('button',{name:'All',exact:true}).click();await page.locator('[data-action="reply-pattern"][data-id="all"][aria-pressed="true"]').waitFor();assert.equal(await page.locator('#chair-routing').isVisible(),false);await page.locator('#message-input').fill('Everyone receives this exact prompt.');assert.equal(await page.locator('.chair-route').count(),0);assert.equal(await page.locator('#chair-routing').isVisible(),false);await page.locator('#send-button').click();await until(()=>f.requests.length===6,'three All calls');
 for(const q of f.requests.slice(3))finish(q);await until(()=>f.app.store.state.deskWork.tasks.every(t=>t.status==='completed'),'All batch done');
 await page.locator('#message-input').fill('Shared question. @Qwen @Luna');assert.equal(await page.locator('.chair-route').count(),2);await page.locator('#message-input').fill('');
 // A rich-text copy must contain only the highlighted conversation fragment.
 await page.context().grantPermissions(['clipboard-read','clipboard-write']);
 await page.locator('#message-input').fill('UNSELECTED_DRAFT_MARKER');
 await f.app.store.transact(s=>{deskEvent(s,s.deskWork.tasks[0],'log.inspected',{message:'CLOSED_LOG_MARKER'});return s;});
 await page.locator('.desk-events summary').waitFor();
 const selectedText=await page.evaluate(()=>{
   const start=document.querySelector('#conversation .assistant .message-body p').firstChild;
   const end=document.querySelector('.desk-events summary').firstChild;
   const range=document.createRange();range.setStart(start,2);range.setEnd(end,end.textContent.length);
   const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
   window.copyEndpoints={start,end};return selection.toString();
 });
 assert(selectedText.length>0);assert(!selectedText.includes('UNSELECTED_DRAFT_MARKER'));
 await f.app.store.transact(s=>{s.roots[0].name='Updated desk title';return s;});
 await page.locator('.root-name').filter({hasText:'Updated desk title'}).waitFor();
 assert.deepEqual(await page.evaluate(()=>({text:getSelection().toString(),start:copyEndpoints.start.isConnected,end:copyEndpoints.end.isConnected})),{text:selectedText,start:true,end:true});
 await page.keyboard.press('Control+c');
 const copied=await page.evaluate(async()=>{
   const items=await navigator.clipboard.read(),item=items.find(i=>i.types.includes('text/html'));
   return {text:await navigator.clipboard.readText(),html:item?await(await item.getType('text/html')).text():''};
 });
 assert.equal(copied.text,selectedText);assert(copied.html.includes('Desk activity'));
 for(const extra of ['UNSELECTED_DRAFT_MARKER','CLOSED_LOG_MARKER','composer-form','model-select','response-mode-description','Save note'])assert(!copied.html.includes(extra),extra+' leaked into clipboard');
 await page.evaluate(()=>getSelection().removeAllRanges());await page.locator('#message-input').fill('');
 await page.getByRole('button',{name:'Select Hearthline',exact:true}).click();await page.getByRole('button',{name:'Alternate',exact:true}).click();await page.locator('[data-action="reply-pattern"][data-id="alternate"][aria-pressed="true"]').waitFor();await page.locator('#message-input').fill('Take a turn.');await page.locator('#send-button').click();await until(()=>f.requests.length===7,'alternating turn');finish(f.requests[6]);await until(()=>f.app.store.state.deskWork.tasks.every(t=>t.status==='completed'),'alternating reply');await page.locator('.visitor-row[aria-selected="true"]').filter({hasText:'Qwen'}).waitFor();
 for(const width of [1365,800,390]){await page.setViewportSize({width,height:950});if(width<760&&await page.locator('#app-shell').evaluate(e=>e.classList.contains('nav-open')))await page.getByRole('button',{name:'Close navigation',exact:true}).click();assert.equal(await highlightCount(),1);assert(await page.getByRole('button',{name:'Edit Desk Model',exact:true}).isVisible());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`.test-output/desk-crew-${width}.png`});}
 await page.setViewportSize({width:1365,height:950});
 await page.route('**/api/home/status',route=>route.fulfill({json:{available:true,folderRecipientIds:f.app.store.state.models.slice(0,2).map(m=>m.id),settings:{id:'synthetic-home',enabled:true,config:{roots:[{id:'source',label:'Home',path:'D:\\Fixture'}],orientation:[]},guidance:null,destinations:[]}}}));
 await page.locator('#settings-button').click();await page.locator('[data-action="settings-tab"][data-id="models"]').click();await page.locator('[data-action="home-sources"]').click();
 await page.getByText('Uses existing folder access for',{exact:false}).waitFor();assert.equal(await page.locator('#home-settings-form input[name="modelId"]').count(),1);
 await page.getByRole('button',{name:'Manage folder access',exact:true}).click();await page.locator('#settings-page-title').filter({hasText:'Agents'}).waitFor();
 assert.deepEqual(errors,[]);const result={status:'PASS',modes:['Select','Alternate','All'],singleHeaderHighlight:true,iconOpensExistingMenu:true,optionalDirections:true,allAndSubsetRouting:true,allPreviewHidden:true,selectedClipboardFragment:true,selectionSurvivesUnrelatedRefresh:true,alternateAdvancesHighlight:true,homeReusesFolderAccess:true,homeAccessLinkWorks:true,widths:[1365,800,390],pageErrors:errors};await fs.writeFile('.test-output/desk-crew-browser.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(e){await page.screenshot({path:'.test-output/desk-crew-failure.png'}).catch(()=>{});console.error(JSON.stringify({error:e.message,pageErrors:errors,body:(await page.locator('body').innerText()).slice(-1800)}));throw e;}
finally{await browser.close();await f.close();}
