// Real Edge; synthetic workspace, no model requests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fixture } from './helpers.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.BRANCHLINE_TEST_PLAYWRIGHT);
const output=path.resolve(process.env.BRANCHLINE_TEST_REPORT);await fs.mkdir(output,{recursive:true});
const cleanups=[],f=await fixture({after:fn=>cleanups.push(fn)}),errors=[];let browser,page;
const report={kind:'REAL_EDGE_SYNTHETIC_WORKSPACE',status:'RUNNING',checks:[]};
try{
 const modelId=f.app.store.state.models[0].id;await f.command('personal.create',{name:'Aster',modelId,baseIdentity:'synthetic/base'});const personId=f.app.store.state.personalParticipants[0].id;
 await f.command('table.assign',{chatId:f.chatId,baseRevisionId:null,personalId:personId,visitorModelId:null});
 await f.command('message.note',{chatId:f.chatId,content:'Keep my original garden correction.'});await f.command('draft.save',{chatId:f.chatId,text:'Unsent question 🌱'});
 await f.command('ui.update',{appearance:{theme:'starlight',reading:'standard'},welcomeTour:{version:1,skipped:true,completedAt:new Date().toISOString()}});
 browser=await chromium.launch({executablePath:process.env.BRANCHLINE_TEST_BROWSER,headless:true});page=await browser.newPage({viewport:{width:1280,height:960}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(f.uiUrl);await page.locator('.toy-shelf').waitFor();
 await page.locator('[data-action=library][data-id=personal]').click();await page.locator('.personal-model-card').waitFor();
 const border=await page.locator('.personal-model-card .dream-review-button').evaluate(el=>getComputedStyle(el).borderTopWidth);assert.equal(border,'1px');
 await page.locator('[data-action=model-archive]').click();await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(f.app.store.state.modelArchives,undefined);
 await page.locator('[data-action=library][data-id=personal]').click();await page.locator('[data-action=model-archive]').click();await page.locator('[data-action=model-archive-confirm]').click();
 await page.getByRole('heading',{name:'Archived models',exact:true}).waitFor();await page.getByText('Original model files reported retained.',{exact:false}).waitFor();
 assert.equal(f.app.store.state.modelArchives.at(-1).archived,true);assert.equal(f.app.store.state.drafts[f.chatId],'Unsent question 🌱');
 await page.locator('#dialog [data-action=dream-review]').click();await page.getByRole('heading',{name:'Review Dreams · Aster',exact:true}).waitFor();await page.locator('#dream-review [data-dream-action=close]').click();
 await page.locator('#dialog [data-action=model-archive-details]').click();await page.getByRole('heading',{name:'Archive details',exact:true}).waitFor();await page.locator('[data-action=model-archives]').click();
 for(const theme of ['garden','starlight','paper'])for(const width of [1280,390]){
  await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  assert(await page.locator('#dialog').evaluate(el=>el.getBoundingClientRect().right<=innerWidth+1));await page.screenshot({path:path.join(output,`archive-${theme}-${width}.png`)});
 }
 await page.setViewportSize({width:1280,height:960});await page.locator('#dialog [data-action=close-dialog]').click();
 await page.locator('[data-action=home-resume][data-id="'+f.chatId+'"]').click();await page.getByText('Keep my original garden correction.',{exact:true}).waitFor();
 assert.equal(await page.locator('#message-input').inputValue(),'Unsent question 🌱');await page.locator('.personal-chair').getByText('Aster · Archived',{exact:true}).waitFor();
 await page.locator('[data-action=model-archives]').click();await page.locator('[data-action=model-unarchive]').click();await page.locator('[data-action=model-archive-confirm]').click();
 await page.getByRole('heading',{name:'Archived models',exact:true}).waitFor();assert.equal(f.app.store.state.modelArchives.at(-1).archived,false);assert.equal(f.requests.length,0);
 await page.locator('#dialog [data-action=close-dialog]').click();await page.locator('#mode-home').click();await page.locator('[data-action=library][data-id=personal]').click();await page.locator('.personal-model-card').getByText('Aster',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);report.status='PASS';report.checks=['Archive confirmation and cancel','Dream history stays reachable','Three palettes and narrow width','Historical chair and draft preserved','Explicit return to list','No model calls'];
}catch(error){report.status='FAIL';report.error=error.stack;await page?.screenshot({path:path.join(output,'failure.png')});throw error;}
finally{await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser?.close();for(const cleanup of cleanups.reverse())await cleanup();}
console.log(JSON.stringify(report));
