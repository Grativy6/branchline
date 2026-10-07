// Real browser and journal with injected network failures; no external model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fixture,deferred} from './helpers.mjs';
import {applySketchCommand,sketchHead} from '../server/sketches.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.BRANCHLINE_TEST_PLAYWRIGHT);
const output=path.resolve(process.argv[2]);await fs.mkdir(output,{recursive:true});
const cleanup=[],f=await fixture({after:c=>cleanup.push(c)},{modelOptions:{timeoutMs:60000}}),report={kind:'REAL_EDGE_SYNTHETIC_ARCHIVE_HEAVY_WORKSPACE',status:'RUNNING',checks:[],timing:{},errors:[]};let browser,page,release;
const wait=async fn=>{for(let n=0;n<100;n++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Expected durable state was not reached.');};
const head=()=>sketchHead(f.app.store.state.sketchBook.records[250]);
try{
  await f.command('ui.update',{appearance:{theme:'starlight',reading:'relaxed'},welcomeTour:{version:1,skipped:true,completedAt:new Date().toISOString()}});
  let start=performance.now();
  await f.app.store.transact(state=>{
    for(let i=0;i<300;i++){
      const base={id:null,baseRevisionId:null,originChatId:f.chatId,sourceMessageId:null,title:`Plan ${String(i).padStart(3,'0')}`,text:'Synthetic memory. '.repeat(60)+(i===250?'\n<script>window.SKETCH_UNSAFE=true</script> [unsafe](javascript:alert(1))':''),stage:['ideas','in-process','schematics'][i%3],requestId:'sized_'+i};
      applySketchCommand(state,'sketch.save',base);const s=state.sketchBook.records.at(-1);
      if(i<25)for(let r=1;r<5;r++)applySketchCommand(state,'sketch.save',{...base,id:s.id,baseRevisionId:sketchHead(s).id,originChatId:null,text:base.text+' revision '+r,requestId:'sized_'+i+'_'+r});
      if(i<250)applySketchCommand(state,'sketch.archive',{id:s.id,baseRevisionId:sketchHead(s).id});
    }
    return state;
  });report.timing.seedMs=performance.now()-start;report.records=300;report.archived=250;report.revisions=400;
  start=performance.now();await fetch(f.url+'/api/state',{headers:f.headers}).then(r=>r.json());report.timing.stateReadMs=performance.now()-start;
  browser=await chromium.launch({executablePath:process.env.BRANCHLINE_TEST_BROWSER,headless:true});page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(f.uiUrl);await page.locator('.home-resume-button').first().click();await page.locator('#settings-button').click();await page.getByRole('tab',{name:'Coats & pockets',exact:true}).click();await page.getByRole('button',{name:'Sketch Book model access',exact:true}).click();await page.locator('.sketch-access').waitFor();await page.getByRole('button',{name:'Done',exact:true}).click();
  assert.equal(await page.locator('.sketch-item').count(),50);await page.locator('.sketch-item').filter({hasText:'Plan 250'}).click();await page.getByRole('button',{name:'Edit sketch',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.SKETCH_UNSAFE),undefined);assert.equal(await page.locator('#sketch-sheet script, #sketch-sheet a[href^="javascript:"]').count(),0);
  const id=f.app.store.state.sketchBook.records[250].id,base=head().id,typed='Typed while another editor saves. 🎇\nKeep this exact.';
  await page.locator('#sketch-editor [name=text]').fill(typed);await wait(()=>f.app.store.state.ui.sketchDraft?.text===typed);
  await f.command('sketch.save',{id,baseRevisionId:base,originChatId:null,sourceMessageId:null,title:'Plan 250',text:'Concurrent saved correction.',stage:'in-process',requestId:'concurrent_writer'});
  await page.getByRole('button',{name:'Save sketch',exact:true}).click();await page.getByText('This sketch changed.',{exact:false}).waitFor();assert.equal(await page.locator('#sketch-editor [name=text]').inputValue(),typed);assert.equal(head().text,'Concurrent saved correction.');
  await page.getByRole('button',{name:'Save draft as a new sketch',exact:true}).click();await page.locator('#sketch-sheet').waitFor({state:'hidden'});assert.equal(f.app.store.state.sketchBook.records.at(-1).revisions[0].text,typed);report.checks.push('Concurrent revision is retained; conflicting editor text can be saved separately. Unsafe Markdown stays inert.');
  await page.getByRole('button',{name:'Edit sketch',exact:true}).click();const failureText=typed+'\nNot lost on failed save.';await page.locator('#sketch-editor [name=text]').fill(failureText);
  let failSave=true,failDraft=false;
  await page.route('**/api/command',async route=>{const b=route.request().postDataJSON();if(failSave&&b.type==='sketch.save'||failDraft&&b.type==='ui.update'&&Object.hasOwn(b.payload,'sketchDraft'))return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic disk unavailable.'})});return route.continue();});
  await page.getByRole('button',{name:'Save sketch',exact:true}).click();await page.getByText('Synthetic disk unavailable.',{exact:true}).waitFor();assert.equal(await page.locator('#sketch-editor [name=text]').inputValue(),failureText);
  failSave=false;await page.getByRole('button',{name:'Save sketch',exact:true}).click();await page.locator('#sketch-sheet').waitFor({state:'hidden'});assert.equal(f.app.store.state.sketchBook.records.at(-1).revisions.at(-1).text,failureText);
  await page.getByRole('button',{name:'Edit sketch',exact:true}).click();failDraft=true;await page.locator('#sketch-editor [name=text]').fill(failureText+'\nUnsaved final line.');await page.evaluate(()=>window.branchlinePrepareClose());await page.waitForFunction(()=>window.branchlineCloseState.status!=='saving');assert.equal(await page.evaluate(()=>window.branchlineCloseState.status),'failed');assert.equal(await page.locator('#sketch-editor [name=text]').inputValue(),failureText+'\nUnsaved final line.');
  failDraft=false;await page.evaluate(()=>window.branchlinePrepareClose());await page.waitForFunction(()=>window.branchlineCloseState.status!=='saving');assert.equal(await page.evaluate(()=>window.branchlineCloseState.status),'ready');await page.reload();await page.locator('#open-sketch-book').click();await page.getByRole('button',{name:'Resume draft',exact:true}).click();assert.equal(await page.locator('#sketch-editor [name=text]').inputValue(),failureText+'\nUnsaved final line.');report.checks.push('Failed save and failed close keep exact editor text; retry persists it through reload.');
  await page.getByRole('button',{name:'Discard draft',exact:true}).click();await page.locator('#sketch-confirm [data-sketch-action=accept-confirm]').click();await page.locator('#sketch-sheet').waitFor({state:'hidden'});await page.getByRole('button',{name:'Close Sketch Book',exact:true}).click();
  // Hold a pre-edit poll while an episode is pending, then deliver it after typing.
  await page.locator('.home-resume-button').first().click();f.handler=(_b,_res)=>{};const pending=f.post('/api/exchange',{chatId:f.chatId,content:'Synthetic pending reply for Activity.'});await wait(()=>f.requests.length===1);
  const captured=deferred();release=deferred();let intercept=true;
  await page.route('**/api/state',async route=>{if(!intercept)return route.continue();intercept=false;const response=await route.fetch();const body=await response.body();captured.resolve();await release.promise;return route.fulfill({response,body});});
  await page.reload();await captured.promise;release.resolve();await page.locator('.home-resume-button').first().click();await page.locator('#open-sketch-book').click();await page.getByRole('button',{name:'Edit sketch',exact:true}).click();
  const savedSelection=await page.locator('#sketch-editor [name=text]').inputValue();const staleCaptured=deferred();release=deferred();let stale=true;
  await page.unroute('**/api/state');await page.route('**/api/state',async route=>{if(!stale)return route.continue();stale=false;const response=await route.fetch();const body=await response.body();staleCaptured.resolve();await release.promise;return route.fulfill({response,body});});
  await staleCaptured.promise;start=performance.now();const newest=savedSelection+'\nTyping stays here despite an old poll. 🕯';await page.locator('#sketch-editor [name=text]').fill(newest);release.resolve();await wait(()=>f.app.store.state.ui.sketchDraft?.text===newest);report.timing.editorPersistMs=performance.now()-start;assert.equal(await page.locator('#sketch-editor [name=text]').inputValue(),newest);
  assert(await page.locator('#sketch-sheet #work-controls').isVisible());await page.locator('#work-controls summary').click();await page.locator('#stop-all-episodes').click();assert.equal((await pending).status,409);assert.equal(f.app.store.state.exchanges.at(-1).status,'cancelled');assert.equal(await page.locator('#sketch-editor [name=text]').inputValue(),newest);report.checks.push('Delayed poll cannot replace typed sketch text; Activity/Stop works inside the editor.');
  await page.getByRole('button',{name:'Close',exact:true}).click();await page.locator('#sketch-sheet').waitFor({state:'hidden'});await page.getByRole('button',{name:'Archives',exact:true}).click();assert.equal(await page.locator('.sketch-item').count(),250);await page.screenshot({path:path.join(output,'archive-heavy-starlight.png')});
  for(const theme of ['paper','garden','starlight']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:path.join(output,`book-${theme}.png`)});}
  report.checks.push('300-sketch library with 250 archived records and 400 original revisions remains usable in all themes.');assert.deepEqual(report.errors,[]);report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.stack;process.exitCode=1;await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});console.error(error.stack);}finally{release?.resolve();await browser?.close();for(const c of cleanup.reverse())await c();report.workspace=f.dataDir;await fs.writeFile(path.join(output,'sketch-recovery.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
