import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fixture} from './helpers.mjs';
import {COAT_PROFILE} from '../public/harness-format.js';
import {POCKET_PROFILE, BUILTIN_PROVIDER} from '../public/coat-pockets.js';
const {chromium}=createRequire(import.meta.url)(process.env.BRANCHLINE_TEST_PLAYWRIGHT);
const out=path.resolve(process.env.BRANCHLINE_TEST_REPORT||'test-results/coats-ui');await fs.mkdir(out,{recursive:true});
const cleanups=[], f=await fixture({after:fn=>cleanups.push(fn)});let browser,page;
try {
  const model=f.app.store.state.models[0];
  await f.command('personal.create',{name:'Synthetic personal',modelId:model.id,baseIdentity:'synthetic/base'});
  await f.command('table.assign',{chatId:f.chatId,baseRevisionId:null,personalId:f.app.store.state.personalParticipants[0].id,visitorModelId:model.id});
  await f.command('ui.update',{appearance:{theme:'starlight',reading:'relaxed'}});
  f.handler=(body,res)=>{assert.deepEqual((body.tools??[]).map(t=>t.function.name),['read_clock']);res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:'The Coat kept its pocket choice.'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');};
  browser=await chromium.launch({executablePath:process.env.BRANCHLINE_TEST_BROWSER,headless:true});page=await browser.newPage({viewport:{width:1240,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const editor=()=>page.locator('#harness-editor-form'), close=()=>page.locator('#dialog .dialog-header [data-action="close-dialog"]').click();
  await page.goto(f.uiUrl);await page.locator('.home-resume-button').first().click();
  await page.locator('[data-action="harnesses"]').click();await page.locator('[data-action="harness-new"]').click();
  assert.equal(await editor().locator('[data-pocket-tool]:checked').count(),6);
  await editor().locator('[name="name"]').fill('Clock coat');
  for(const box of await editor().locator('[data-pocket-tool]:not([data-pocket-tool="read_clock"])').all())await box.uncheck();
  await editor().locator('.coat-pockets').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'pockets.png')});
  await editor().getByRole('button',{name:'Save and use here',exact:true}).click();await page.locator('#dialog').waitFor({state:'hidden'});
  assert.deepEqual(f.app.store.state.customHarnesses[0].versions[0].pockets.selected,[{tool:'read_clock',provider:BUILTIN_PROVIDER}]);
  await page.locator('#message-input').fill('Test the selected clock pocket.');await page.locator('#send-button').click();await page.locator('.message.assistant:not(.live-reply)').first().waitFor();await page.locator('#cancel-button').waitFor({state:'hidden'});
  await page.locator('[data-action="reply-details"]').first().click();assert.match(await page.locator('#dialog').innerText(),/Tools offered for this reply\s+Read the clock\./);await close();
  await page.locator('[data-action="harnesses"]').click();await page.locator('[data-action="harness-take-off"][data-name="personal"]').click();
  assert.equal(await page.locator('#harness-form [name="personal"]').inputValue(),'conversation');
  await page.locator('#harness-form [type="submit"]').click();await page.locator('#dialog').waitFor({state:'hidden'});
  assert.equal(f.app.store.state.chats[0].harnessSelections.at(-1).personal.id,'conversation');assert.equal(f.app.store.state.messages.length,2);
  await page.locator('#mode-home').click();await page.getByRole('button',{name:'My Coats',exact:true}).click();
  const imported={profile:COAT_PROFILE,name:'Other provider',description:'Imported preference',instructions:'',pockets:{profile:POCKET_PROFILE,selected:[{tool:'read_clock',provider:'example.clock/1'}]}};
  await page.locator('#harness-import-file').setInputFiles({name:'coat.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))});await editor().waitFor();
  assert.match(await editor().innerText(),/Unavailable · example.clock\/1/);
  assert.equal(await editor().locator('[data-pocket-tool="read_clock"]').getAttribute('data-pocket-provider'),'example.clock/1');
  for(const width of [390,320]) {await page.setViewportSize({width,height:850});await editor().locator('.coat-pockets').scrollIntoViewIfNeeded();assert.equal(await editor().evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);await page.screenshot({path:path.join(out,'pockets-'+width+'.png')});}
  await page.setViewportSize({width:1240,height:900});await page.getByRole('button',{name:'Choose the built-in tool',exact:true}).click();
  assert.equal(await editor().locator('[data-pocket-tool="read_clock"]').getAttribute('data-pocket-provider'),BUILTIN_PROVIDER);
  await editor().getByRole('button',{name:'Save to library',exact:true}).click();await page.getByText('Other provider · v1',{exact:true}).waitFor();
  assert.deepEqual(f.app.store.state.customHarnesses[1].versions[0].pockets.selected,[{tool:'read_clock',provider:BUILTIN_PROVIDER}]);
  assert.deepEqual(errors,[]);const report={status:'PASS',syntheticOnly:true,checks:['six visible defaults','checkbox subset saved with empty instruction text','offered-tool receipt','take off Coat preserves conversation','unavailable imported provider visible','explicit provider replacement','320px and 390px pocket layouts','no page errors']};await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
} catch(error){await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}
finally {await browser?.close();for(const cleanup of cleanups.reverse())await cleanup();}
