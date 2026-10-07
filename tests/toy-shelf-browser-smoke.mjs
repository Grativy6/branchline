// Real Edge interactions. Workspaces and every provider response are synthetic.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fixture } from './helpers.mjs';
import { addLegacyDesk } from './legacy-desks-fixture.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.BRANCHLINE_TEST_PLAYWRIGHT);
const output = path.resolve(process.argv[2]); await fs.mkdir(output, { recursive:true });
const cleanup=[], f=await fixture({after:fn=>cleanup.push(fn)}), report={kind:'REAL_EDGE_SYNTHETIC_WORKSPACE',status:'RUNNING',checks:[],layout:[]};
let browser, page;
const wait=async fn=>{for(let i=0;i<120;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Expected saved state was not reached');};
const check=s=>report.checks.push(s);
try {
  await f.command('ui.update',{welcomeTour:{version:1,completedAt:new Date().toISOString(),skipped:true},appearance:{theme:'starlight',reading:'standard'},toyShelf:{height:null,order:['fs','desk','tend'],hidden:['tend']}});
  browser=await chromium.launch({executablePath:process.env.BRANCHLINE_TEST_BROWSER,headless:true});
  page=await browser.newPage({viewport:{width:1280,height:1000}});page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',err=>errors.push(err.message));
  await page.goto(f.uiUrl); await page.locator('.toy-shelf').waitFor();
  assert.deepEqual(await page.locator('.toy-tile > span:last-child').allTextContents(),['New desk','Book of PEACHES']);
  assert(await page.locator('.home-tree').evaluate(el=>el.getBoundingClientRect().width)>=116);
  assert(await page.locator('.brand-mark').evaluate(el=>el.getBoundingClientRect().width)>=38);
  for (const [id, title] of [['desk','Create a desk']]) {
    await page.locator(`.toy-tile[data-shelf-id=${id}]`).click();await page.getByRole('heading',{name:title,exact:true}).waitFor();
    await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(f.app.store.state.roots.length,1);
  }
  assert.equal(await page.locator('.toy-slot').count(),1);assert.equal(await page.locator('.toy-shelf-size').count(),0);assert.equal(await page.locator('.toy-slot').getAttribute('aria-hidden'),'true');assert.deepEqual(f.app.store.state.ui.toyShelf.order,['fs','desk','tend']);check('Two active tiles, one decorative slot and no visible pixel count. Old shelf preferences read without changing stored history. Cancel has no effect.');
  await page.locator('[data-action=peaches-open]').click(); await page.getByRole('heading',{name:'Book of PEACHES',exact:true}).waitFor(); await page.getByText('Coming later.',{exact:true}).waitFor(); await page.getByRole('button',{name:'Got it',exact:true}).click(); assert.equal(f.app.store.state.roots.length,1); assert.equal(f.requests.length,0);
  const grip=page.locator('.toy-shelf-grip'); await grip.scrollIntoViewIfNeeded(); await grip.focus();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await wait(()=>f.app.store.state.ui.toyShelf?.height===288);
  let bounds=await grip.boundingBox();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();
  await page.mouse.move(bounds.x+bounds.width/2+100,bounds.y+bounds.height/2+70,{steps:12});await page.mouse.up();
  await wait(()=>f.app.store.state.ui.toyShelf?.height===358);
  const width=await page.locator('.toy-shelf').evaluate(el=>el.offsetWidth);
  bounds=await grip.boundingBox();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2+20);
  await grip.evaluate(el=>el.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true})));await page.mouse.up();
  await wait(()=>f.app.store.state.ui.toyShelf?.height===378);assert.equal(await page.locator('.toy-shelf').evaluate(el=>el.offsetWidth),width);
  assert.equal(f.app.store.state.ui.settingsSize,undefined);assert.equal(f.app.store.state.ui.sketchSize,undefined);
  await page.reload();assert.equal(await page.locator('.toy-shelf').evaluate(el=>el.offsetHeight),378);
  await page.setViewportSize({width:1280,height:420});await page.waitForTimeout(120);
  assert(await page.locator('.toy-shelf').evaluate(el=>el.offsetHeight)<378);assert.equal(f.app.store.state.ui.toyShelf.height,378);
  await page.setViewportSize({width:1280,height:1000});await page.waitForTimeout(120);assert.equal(await page.locator('.toy-shelf').evaluate(el=>el.offsetHeight),378);
  check('Keyboard, pointer capture and cancellation persist only height; reload and temporary viewport fitting retain the preference independently.');
  await page.getByRole('button',{name:'Manage Shelves',exact:true}).click();
  await page.getByRole('tab',{name:'Toy Shelf',exact:true}).waitFor();
  assert.deepEqual(await page.locator('.shelf-setting-row').first().getAttribute('data-shelf-id'),'desk');
  await page.locator('#toy-shelf-settings input[name=desk]').uncheck();
  await page.locator('#toy-shelf-settings input[name=peaches]').uncheck();
  await page.getByRole('button',{name:'Save shelf',exact:true}).click();
  await wait(()=>f.app.store.state.ui.toyShelf.hidden.length===2);
  assert.deepEqual(f.app.store.state.ui.toyShelf.order,['desk','peaches']);
  await page.locator('#dialog [data-action=close-dialog]').click();
  assert.equal(await page.locator('.toy-tile').count(),0);assert.equal(await page.locator('.toy-slot').count(),1);
  await page.reload();await page.locator('.toy-shelf').waitFor();assert.equal(await page.locator('.toy-tile').count(),0);
  await page.getByRole('button',{name:'Manage Shelves',exact:true}).click();await page.getByRole('button',{name:'Restore default arrangement',exact:true}).click();
  await page.getByRole('button',{name:'Save shelf',exact:true}).click();await wait(()=>f.app.store.state.ui.toyShelf.hidden.length===0);
  await page.getByRole('button',{name:'Reset height',exact:true}).click();await wait(()=>f.app.store.state.ui.toyShelf.height===null);
  await page.locator('#dialog [data-action=close-dialog]').click();check('Order, visibility, all-hidden recovery, defaults and reset survive reopen without changing desks or permissions.');
  for(const theme of ['garden','starlight','paper'])for(const size of [1280,390]) {
    await page.setViewportSize({width:size,height:1000});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await page.locator('.toy-shelf').scrollIntoViewIfNeeded();await page.waitForTimeout(180);
    const layout=await page.locator('.toy-shelf').evaluate(el=>({width:innerWidth,pageOverflow:document.documentElement.scrollWidth>innerWidth,shelfOverflow:el.scrollWidth>el.clientWidth,height:el.offsetHeight}));
    assert.equal(layout.pageOverflow,false);assert.equal(layout.shelfOverflow,false);report.layout.push({theme,...layout});
    await page.screenshot({path:path.join(output,`home-${theme}-${size}.png`)});
  }
  await page.setViewportSize({width:980,height:800});await page.evaluate(()=>{document.documentElement.style.zoom='1.5';document.documentElement.dataset.theme='starlight';});await page.waitForTimeout(200);
  await page.locator('.toy-shelf').scrollIntoViewIfNeeded(); const zoom = await page.locator('.toy-shelf').evaluate(el=>({right:el.getBoundingClientRect().right,left:el.getBoundingClientRect().left,viewport:innerWidth,scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth})); report.zoom=zoom; assert(zoom.right<=zoom.viewport+1 && zoom.left>=0); assert(zoom.scroll<=zoom.client+1);
  await page.locator('.toy-shelf-grip').scrollIntoViewIfNeeded();await page.locator('.toy-shelf-grip').focus();await page.keyboard.press('ArrowDown');await wait(()=>f.app.store.state.ui.toyShelf.height===264);
  await page.screenshot({path:path.join(output,'home-zoom.png')});await page.evaluate(()=>document.documentElement.style.zoom='');await page.setViewportSize({width:1280,height:1000});
  check('All themes at desktop and narrow widths, plus 150% layout zoom; tiles scroll and controls remain reachable.');
  for(const [id,mode] of [['desk','personal']]) {
    await page.locator('.toy-tile[data-shelf-id='+id+']').click();await page.locator('#new-root-form [name=name]').fill('Shelf '+id);
    await page.locator('#new-root-form [type=submit]').click();await page.locator('#dialog').waitFor({state:'hidden'});
    assert.equal(f.app.store.state.roots.at(-1).mode,mode);assert.equal(f.app.store.state.chats.at(-1).table.assignments.at(-1).visitorModelId,null);
    await page.locator('#mode-home').click();
  }
  check('New desk retains ordinary empty-chair defaults; retired creation paths are absent.');
  // Fail an actual preference write, then ensure Close retries rather than claiming success.
  let failures=1;
  await page.route('**/api/command',async route=>{const body=route.request().postDataJSON();if(failures&&body?.payload?.toyShelf){failures--;await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Synthetic shelf write failure'})});}else await route.continue();});
  await page.locator('.toy-shelf-grip').focus();await page.keyboard.press('ArrowDown');await page.getByText('Shelf height was not saved:',{exact:false}).first().waitFor();
  assert.equal(f.app.store.state.ui.toyShelf.height,264);
  await page.evaluate(()=>window.branchlinePrepareClose());await page.waitForFunction(()=>window.branchlineCloseState.status!=='saving');assert.equal(await page.evaluate(()=>window.branchlineCloseState.status),'ready');assert.equal(f.app.store.state.ui.toyShelf.height,288);
  await page.reload();assert.equal(await page.locator('.toy-shelf').evaluate(el=>el.offsetHeight),288);
  check('A failed save is reported; ordinary close retries and preserves the intended height.');
  // No delay between keyboard adjustment and close: pending write must be flushed.
  await page.locator('.toy-shelf-grip').focus();await page.keyboard.press('ArrowDown');await page.evaluate(()=>window.branchlinePrepareClose());await page.waitForFunction(()=>window.branchlineCloseState.status!=='saving');assert.equal(await page.evaluate(()=>window.branchlineCloseState.status),'ready');assert.equal(f.app.store.state.ui.toyShelf.height,312);
  assert.equal(f.requests.length,0);assert.deepEqual(errors,[]);check('Immediate close flushes the resize; zero inference requests and no browser errors.');
  for (const kind of ['tend','fs']) {
    const {root,chat}=await addLegacyDesk(f,kind);
    await f.command('message.note',{chatId:chat.id,content:'Preserved '+kind+' note.'});
    await f.command('draft.save',{chatId:chat.id,text:'Unsent '+kind+' draft.'});
    await page.reload();await page.locator('.toy-shelf').waitFor();await page.locator('[data-action=home-resume][data-id="'+chat.id+'"]').click();
    await page.getByText('Preserved '+kind+' note.',{exact:true}).waitFor();
    assert.equal(await page.locator('#message-input').inputValue(),'Unsent '+kind+' draft.');
    await page.locator('[data-action=harnesses]').click();
    assert.equal(await page.locator('#harness-form [name=personal]').inputValue(),kind==='fs'?'finis-solutus':'tend');
    await page.locator('#harness-form [type=submit]').click();await page.locator('#harness-form').waitFor({state:'hidden'});
    assert.equal(await page.locator('#message-input').inputValue(),'Unsent '+kind+' draft.');
    await page.locator('[data-action=desks]').click();
    assert.equal(await page.getByRole('button',{name:'New Finis Solutus table',exact:true}).count(),0);
    await page.locator('#dialog [data-action=new-root]').click();await page.getByRole('heading',{name:'Create a desk',exact:true}).waitFor();
    await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('#mode-home').click();
    assert.equal(f.app.store.state.roots.find(r=>r.id===root.id).mode,root.mode);
  }
  await page.locator('[data-action=library][data-id=harnesses]').click();
  assert.equal(await page.getByText('Finis Solutus · starter',{exact:true}).count(),0);
  assert.equal(await page.getByText('Tend · starter',{exact:true}).count(),0);
  assert.equal(f.requests.length,0);assert.deepEqual(errors,[]);
  check('Existing retired desks reopen with notes, unsent drafts and exact selected Coats. Saving leaves their choices intact; new desks and the Coat library have no retired starters.');
  report.status='PASS';report.errors=errors;
} catch(err) {report.status='FAIL';report.error=err.stack;await page?.screenshot({path:path.join(output,'failure.png')});throw err;}
finally {await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();for(const fn of cleanup.reverse())await fn();}
console.log(JSON.stringify(report));
