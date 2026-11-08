import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fixture} from './desk-helpers.mjs';
const baseline=process.argv.includes('--baseline'),f=await fixture(),errors=[];
await f.command('model.save',{name:'Luna',model:'luna',runtime:'compatible',baseUrl:f.fakeUrl,thinking:false});
let r=f.app.store.state.chats[0].seating;
await f.command('table.roster.chair',{chatId:f.chatId,baseRevisionId:r.revisionId,chairId:null,name:'Luna',modelId:f.app.store.state.models.at(-1).id,personalId:null,coat:null});
await new Promise(resolve=>f.app.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
const page=await browser.newPage({viewport:{width:1010,height:714}});page.on('pageerror',e=>errors.push(e.message));
await fs.mkdir('.test-output',{recursive:true});
try{
 await page.goto(`http://127.0.0.1:${f.app.address().port}/#session=${f.app.sessionToken}`);await page.locator('#tour-skip').check();await page.locator('#tour-next').click();
 await page.locator(`[data-action="select-chat"][data-id="${f.chatId}"]`).click();await page.getByRole('button',{name:'All',exact:true}).waitFor();
 const sizes=[];
 for(const width of [1365,1010,800,390]){
  await page.setViewportSize({width,height:714});
  if(width<760&&await page.locator('#app-shell').evaluate(e=>e.classList.contains('nav-open')))await page.getByRole('button',{name:'Close navigation',exact:true}).click();
  await page.waitForTimeout(300);
  sizes.push(await page.evaluate(()=>({width:innerWidth,header:document.querySelector('.topbar').getBoundingClientRect().height,conversation:document.querySelector('#conversation').getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth})));
  await page.screenshot({path:`.test-output/compact-${baseline?'before':'after'}-${width}.png`});
 }
 if(!baseline){
  assert(sizes.every(s=>!s.overflow));
  const previous=JSON.parse(await fs.readFile(new URL('./fixtures/compact-header-before.json',import.meta.url),'utf8'));
  for(const size of sizes.filter(s=>process.platform==='linux'&&s.width>=800))assert(size.header<previous.sizes.find(s=>s.width===size.width).header,'Header must give back space at '+size.width);
  await page.setViewportSize({width:1365,height:950});await page.waitForTimeout(100);
  assert(!await page.locator('[data-chair-scroll="left"]').isVisible());assert(!await page.locator('[data-chair-scroll="right"]').isVisible());
  for(let i=0;i<7;i++){r=f.app.store.state.chats[0].seating;await f.command('table.roster.chair',{chatId:f.chatId,baseRevisionId:r.revisionId,chairId:null,name:'Visitor '+i,modelId:f.app.store.state.models[0].id,personalId:null,coat:null});}
  await page.locator('.visitor-row').filter({hasText:'Visitor 6'}).waitFor();await page.waitForTimeout(100);
  const list=page.locator('.visitors-list'),left=page.locator('[data-chair-scroll="left"]'),right=page.locator('[data-chair-scroll="right"]');
  await list.evaluate(e=>{e.scrollLeft=0;e.dispatchEvent(new Event('scroll'));});await page.waitForTimeout(60);assert(!await left.isVisible());assert(await right.isVisible());
  const selected=()=>page.locator('.personal-chair .chair-picker[aria-pressed="true"],.visitor-row[aria-selected="true"]').getAttribute('data-id');
  const before=await selected();await right.click();await page.waitForTimeout(250);assert(await left.isVisible());assert(await right.isVisible());assert.equal(await selected(),before);
  await list.evaluate(e=>{e.scrollLeft=e.scrollWidth;e.dispatchEvent(new Event('scroll'));});await page.waitForTimeout(60);assert(await left.isVisible());assert(!await right.isVisible());
  await page.getByRole('button',{name:'Edit selected visitor',exact:true}).isDisabled();
  await page.locator('.visitor-row').last().focus();await page.keyboard.press('Enter');await page.locator('.visitor-row[aria-selected="true"]').filter({hasText:'Visitor 6'}).waitFor();
  await page.getByRole('button',{name:'Edit selected visitor',exact:true}).click();await page.getByRole('heading',{name:'Edit visiting chair'}).waitFor();await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.locator('.visitor-order summary').click();assert(await page.getByRole('button',{name:'Move chair earlier'}).isEnabled());assert(!await page.getByRole('button',{name:'Move chair later'}).isEnabled());
  await page.locator('.visitor-order summary').click();
  const chosen=await selected();await page.locator('.visitor-row').last().focus();await page.keyboard.press('ArrowLeft');assert.equal(await selected(),chosen);
  assert.equal(await page.evaluate(()=>document.activeElement.textContent.includes('Visitor 5')),true);
  await page.evaluate(()=>document.documentElement.style.fontSize='20px');await page.waitForTimeout(100);assert(await left.isVisible());
  await page.evaluate(()=>document.documentElement.style.fontSize='');
  for(const chair of [...f.app.store.state.chats[0].seating.visitors].slice(1)){r=f.app.store.state.chats[0].seating;await f.command('table.roster.remove',{chatId:f.chatId,baseRevisionId:r.revisionId,chairId:chair.id});}
  await page.waitForFunction(()=>document.querySelectorAll('.visitor-row').length===1);assert(!await left.isVisible());assert(!await right.isVisible());
  r=f.app.store.state.chats[0].seating;await f.command('table.roster.remove',{chatId:f.chatId,baseRevisionId:r.revisionId,chairId:r.visitors[0].id});
  await page.locator('.visitor-empty').waitFor();assert(!await left.isVisible());assert(!await right.isVisible());
 }
 assert.deepEqual(errors,[]);const result={status:'PASS',baseline,sizes,...(!baseline?{conditionalArrows:true,scrollPreservesSelection:true,arrangementRetained:true}:{}),pageErrors:errors};
 await fs.writeFile(`.test-output/compact-${baseline?'before':'after'}.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(error){await page.screenshot({path:'.test-output/compact-failure.png'}).catch(()=>{});throw error;}
finally{await browser.close();await f.close();}
