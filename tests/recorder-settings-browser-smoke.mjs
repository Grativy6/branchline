import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fixture, listen } from './helpers.mjs';
import { createApp } from '../server/index.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.BRANCHLINE_TEST_PLAYWRIGHT);
const output=path.resolve(process.argv[2]);await fs.mkdir(output,{recursive:true});
const cleanup=[],f=await fixture({after:c=>cleanup.push(c)});
const report={kind:'REAL_EDGE_SYNTHETIC_WORKSPACE',status:'RUNNING',checks:[],errors:[]};let browser,page;
try {
  await f.command('ui.update',{appearance:{theme:'starlight',reading:'relaxed'},welcomeTour:{version:1,completedAt:new Date().toISOString(),skipped:true}});
  await f.command('model.save',{name:'Independent reviewer',model:'reviewer-model',baseUrl:f.app.store.state.models[0].baseUrl});
  const reviewer=f.app.store.state.models.at(-1);
  await f.command('draft.save',{chatId:f.chatId,text:'Unsent thought preserved through all these menus.'});
  browser=await chromium.launch({executablePath:process.env.BRANCHLINE_TEST_BROWSER,headless:true});
  page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));
  const enter=async()=>{await page.goto(f.uiUrl);await page.reload();await page.locator('.home-resume-button').first().click();await page.locator('#message-input').waitFor();};
  const close=async()=>{await page.locator('#dialog .dialog-header [data-action="close-dialog"]').click();await page.waitForFunction(()=>!document.querySelector('#dialog').open);};
  const tab=async name=>page.getByRole('tab',{name,exact:true}).click();
  await enter();await page.locator('[data-action="harnesses"]').click();
  assert.equal(await page.locator('#dialog').getAttribute('class'),'app-dialog coat-picker-dialog');
  assert.equal(await page.locator('#dialog [role="tablist"]').count(),0);await close();
  await page.locator('#settings-button').click();await tab('Coats & pockets');assert.equal(await page.locator('#harness-form').count(),0);
  const wardrobe=await page.locator('.settings-content').innerText();await tab('Appearance');await tab('Coats & pockets');assert.equal(await page.locator('.settings-content').innerText(),wardrobe);
  report.checks.push('Chat Coat popup is standalone; Settings has a consistent general wardrobe.');
  await close();await page.locator('[data-action="harnesses"]').click();await page.locator('[data-action="harness-new"]').click();
  await page.locator('#harness-editor-form [name="name"]').fill('Branch-origin Coat');
  await page.locator('#harness-editor-form [name="instructions"]').fill('Keep the original branch target.');
  const target=await page.locator('#harness-editor-form label:has(select[name="seat"])').innerText();
  await close();await page.locator('#settings-button').click();await tab('Coats & pockets');await page.locator('[data-action="harness-resume"]').click();
  assert.equal(await page.locator('#harness-editor-form label:has(select[name="seat"])').innerText(),target);
  await page.locator('#harness-editor-form button[value="save"]').click();await page.locator('[data-action="harness-new"]').waitFor();
  assert.equal(f.app.store.state.chats[0].harnessSelections?.length ?? 0,0);
  report.checks.push('Branch-origin draft keeps its explicit target through the general wardrobe; library-only save does not apply it.');
  await page.locator('[data-action="harness-new"]').click();await page.locator('#harness-editor-form [name="name"]').fill('A preserved Coat draft');
  await tab('Resources');await tab('Coats & pockets');await page.locator('[data-action="harness-resume"]').click();
  assert.equal(await page.locator('#harness-editor-form [name="name"]').inputValue(),'A preserved Coat draft');
  await close();await page.locator('[data-action="harnesses"]').click();await close();
  assert.equal(await page.locator('#message-input').inputValue(),'Unsent thought preserved through all these menus.');
  await page.locator('#settings-button').click();await tab('Conversation');
  const selector=page.locator('#conversation-settings-form select[name="speaker"]');
  assert.equal(await selector.locator('optgroup').count(),2);await selector.selectOption('model:'+reviewer.id);
  assert.match(await page.locator('.recorder-role').innerText(),/Outside reviewer/);
  await page.locator('#conversation-settings-form button[type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('Conversation settings saved'));
  assert.equal(f.app.store.state.chats[0].carrySettings.speaker,'model:'+reviewer.id);
  const grip=page.locator('.settings-resize');await grip.focus();for(let i=0;i<6;i++)await page.keyboard.press('ArrowRight');for(let i=0;i<3;i++)await page.keyboard.press('ArrowUp');
  await page.waitForFunction(()=>document.querySelector('#dialog').getBoundingClientRect().width>900);
  const sized=await page.locator('#dialog').boundingBox();await page.waitForTimeout(350);assert(f.app.store.state.ui.settingsSize.width>900);
  await tab('Resources');assert.equal(Math.round((await page.locator('#dialog').boundingBox()).width),Math.round(sized.width));
  await close();await page.locator('[data-action="harnesses"]').click();assert.equal(await page.locator('.settings-resize').count(),0);assert((await page.locator('#dialog').boundingBox()).width<=760);await close();
  await f.app.dispose();f.app=await createApp({dataDir:f.dataDir,backupDir:f.backupDir});f.url=await listen(f.app);await enter();await page.locator('#settings-button').click();
  assert.equal(Math.round((await page.locator('#dialog').boundingBox()).width),Math.round(sized.width));
  report.checks.push('Grouped recorder choice saves; Coat draft and chat draft survive navigation; size survives tabs, reopen and app restart without leaking to Coat popup.');
  await tab('Resources');const input=page.locator('#resources-form [name="inputCharacters"]');await input.fill('74000');
  const g=await page.locator('.settings-resize').boundingBox();await page.mouse.move(g.x+16,g.y+16);await page.mouse.down();await page.mouse.move(g.x-220,g.y-35,{steps:8});await page.mouse.up();
  assert.equal(await input.inputValue(),'74000');const preferred=await page.locator('#dialog').boundingBox();await page.waitForTimeout(350);
  for(const [width,height] of [[480,760],[360,550],[700,380]]) {
    await page.setViewportSize({width,height});
    for(const name of ['Conversation','Resources','Models','Coats & pockets','Agents','Appearance','Message info','Workspace','Advanced','About & licences']){
      await tab(name);const box=await page.locator('#dialog').boundingBox();assert(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1);
      const closeBox=await page.locator('#dialog .dialog-header [data-action="close-dialog"]').boundingBox();assert(closeBox.y>=0&&closeBox.x+closeBox.width<=width);
    }
    await page.screenshot({path:path.join(output,`settings-${width}-${height}.png`)});
  }
  await page.setViewportSize({width:1280,height:900});await tab('Models');
  assert.equal(Math.round((await page.locator('#dialog').boundingBox()).width),Math.round(preferred.width));
  assert.equal(await page.locator('.settings-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),1);
  await page.screenshot({path:path.join(output,'settings-narrow-in-wide-app.png')});
  await page.locator('.settings-size-reset').click();await page.waitForTimeout(250);assert.equal(f.app.store.state.ui.settingsSize,null);
  await page.setViewportSize({width:600,height:600});await page.locator('body').evaluate(el=>{el.style.zoom='1.25';window.dispatchEvent(new Event('resize'));});const zoomBox=await page.locator('#dialog').boundingBox();assert(zoomBox.x>=0&&zoomBox.y>=0&&zoomBox.x+zoomBox.width<=601&&zoomBox.y+zoomBox.height<=601);await page.screenshot({path:path.join(output,'settings-zoom.png')});
  await page.locator('body').evaluate(el=>el.style.zoom='1');await close();await page.keyboard.press('Escape');
  assert.equal(f.requests.length,0);assert.deepEqual(report.errors,[]);report.checks.push('Pointer/keyboard resize preserves fields; every Settings tab fits narrow and short windows; preferred shape returns, columns reflow, reset works; no model calls.');
  report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.stack;process.exitCode=1;await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});console.error(error.stack);}
finally{await browser?.close();for(const c of cleanup.reverse())await c();report.workspace=f.dir;await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
