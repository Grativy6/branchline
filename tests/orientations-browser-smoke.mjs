import { addLegacyDesk } from './legacy-desks-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fixture, deferred, listen } from './helpers.mjs';
import { createApp } from '../server/index.mjs';

const { chromium }=createRequire(import.meta.url)(process.env.BRANCHLINE_TEST_PLAYWRIGHT);
const output=path.resolve(process.argv[2]||'test-results/orientations');await fs.mkdir(output,{recursive:true});
const cleanup=[],f=await fixture({after:c=>cleanup.push(c)});let browser,page,release;
const report={kind:'REAL_EDGE_SYNTHETIC_PROVIDER',status:'RUNNING',checks:[],errors:[]};
try{
 await f.command('table.assign',{chatId:f.chatId,baseRevisionId:null,personalId:null,visitorModelId:f.app.store.state.models[0].id});
 await f.command('ui.update',{appearance:{theme:'starlight',reading:'relaxed'}});
 f.handler=async(_body,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{delta:{content:'A synthetic reply with its context preserved.'}}]})+'\n\n');if(release)await release.promise;res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');};
 browser=await chromium.launch({executablePath:process.env.BRANCHLINE_TEST_BROWSER,headless:true});page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));
 const closed=()=>page.waitForFunction(()=>!document.querySelector('#dialog').open);
 const close=async()=>{await page.locator('#dialog .dialog-header [data-action="close-dialog"]').click();await closed();};
 const enter=async()=>{await page.goto(f.uiUrl);await page.reload();await page.locator('.home-resume-button').first().click();await page.locator('#response-mode-controls').waitFor();};
 const choose=async m=>{await page.locator('#response-mode-'+m).click();await page.waitForFunction(m=>document.querySelector('#response-mode-'+m)?.getAttribute('aria-pressed')==='true',m);};
 await page.goto(f.uiUrl);await page.locator('#tour-skip').check();await page.locator('#tour-next').click();await enter();
 assert.equal(await page.locator('#response-mode-create').getAttribute('aria-pressed'),'true');assert.equal(await page.getByRole('group',{name:'Base Coat'}).count(),1);
 await choose('create');assert.equal(await page.locator('#dialog').isVisible(),false);
 await page.locator('#message-input').fill('A thought I want to keep while switching.');await page.locator('#response-mode-work').focus();await page.keyboard.press('Enter');await page.locator('#coat-warning-ok').waitFor();
 assert.equal(await page.locator('#dialog .dialog-body > p').innerText(),'Changing a Coat can lead to disorientation.');assert.equal(await page.locator('#coat-warning-ok').innerText(),'Ok');assert.equal(await page.locator('#coat-warning-suppress').isChecked(),false);
 await page.screenshot({path:path.join(output,'warning.png')});await page.keyboard.press('Escape');await closed();assert.equal(await page.evaluate(()=>document.activeElement.id),'response-mode-work');assert.equal(await page.locator('#message-input').inputValue(),'A thought I want to keep while switching.');assert.equal(f.requests.length,0);
 report.checks.push('Create default; no-op silent; exact warning; keyboard dismissal/focus; draft retained; no model call.');
 await choose('play');await page.locator('#coat-warning-suppress').check();await page.locator('#coat-warning-ok').click();await closed();assert.equal(f.app.store.state.ui.coatChangeWarning,false);
 await f.app.dispose();f.app=await createApp({dataDir:f.dataDir,backupDir:f.backupDir});f.url=await listen(f.app);await enter();await choose('work');assert.equal(await page.locator('#dialog').isVisible(),false);assert.equal(await page.locator('#message-input').inputValue(),'A thought I want to keep while switching.');
 report.checks.push('Suppression and draft survive backend restart.');
 release=deferred();await page.locator('#send-button').click();await page.locator('.live-reply').waitFor();assert.equal(await page.locator('#response-mode-play').isDisabled(),false);await choose('play');release.resolve();release=null;
  await page.locator('.message.assistant:not(.live-reply)').waitFor();assert.match(f.requests[0].messages[0].content,/\[Base Coat: Work\]/);assert.equal(f.app.store.state.exchanges[0].status,'completed');
 await page.locator('[data-action="reply-details"]').first().click();assert.equal(await page.locator('#reply-response-mode').innerText(),'Work');await close();
 await page.locator('#message-input').fill('A follow-up kept as a draft.');await page.getByRole('button',{name:'Ask now',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.message.assistant:not(.live-reply)').length===2);assert.match(f.requests[1].messages[0].content,/\[Base Coat: Play\]/);assert.equal(await page.locator('#message-input').inputValue(),'A follow-up kept as a draft.');
 report.checks.push('Switch during streaming preserves captured Work; next Ask uses Play without sending draft.');
 await page.locator('#settings-button').click();await page.getByRole('tab',{name:'Coats & pockets',exact:true}).click();await page.locator('#coat-warning-setting').check();await page.waitForFunction(()=>!document.querySelector('#coat-warning-setting').disabled);await close();
 await choose('create');await page.locator('#coat-warning-suppress').check();
 const failPref=async route=>{const b=route.request().postDataJSON();if(b.type==='ui.update'&&b.payload.coatChangeWarning===false)await route.fulfill({status:400,contentType:'application/json',body:'{"error":"Synthetic preference save failure"}'});else await route.continue();};
 await page.route('**/api/command',failPref);await page.locator('#coat-warning-ok').click();await page.getByText('Synthetic preference save failure',{exact:true}).first().waitFor();assert.equal(await page.locator('#dialog').isVisible(),true);assert.equal(f.app.store.state.ui.coatChangeWarning,true);
 await page.unroute('**/api/command',failPref);await close();assert.equal(f.app.store.state.ui.coatChangeWarning,false);
 report.checks.push('Settings re-enables warning; failed preference save stays open; close persists checkbox.');
 const failMode=async route=>{if(route.request().postDataJSON().type==='chat.responseMode')await route.fulfill({status:400,contentType:'application/json',body:'{"error":"Synthetic mode save failure"}'});else await route.continue();};
 await page.route('**/api/command',failMode);await page.locator('#response-mode-work').click();await page.getByText('Synthetic mode save failure',{exact:true}).first().waitFor();assert.equal(await page.locator('#dialog').isVisible(),false);assert.equal(f.app.store.state.chats[0].responseMode,'create');await page.unroute('**/api/command',failMode);await enter();
 const before=f.requests.length;await page.locator('[data-action="context-open"]').click();await page.locator('#dialog').waitFor();await close();assert.equal(f.requests.length,before);report.checks.push('Failed mode save does not change selection or show warning; cloud opens without inference.');
 await page.screenshot({path:path.join(output,'composer-desktop.png'),fullPage:true});report.layout=await page.locator('.composer-controls').evaluate(el=>Array.from(el.children).map(x=>({class:x.className,id:x.id,box:x.getBoundingClientRect().toJSON()})));
 for(const [width,zoom] of [[600,1],[480,1.25]]){await page.setViewportSize({width,height:900});await page.locator('body').evaluate((el,z)=>el.style.zoom=String(z),zoom);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('#response-mode-controls').isVisible(),true);await page.screenshot({path:path.join(output,`composer-${width}-zoom-${zoom}.png`),fullPage:true});}
 report.checks.push('Desktop, narrow and 125% zoom wrap without overflow.');
 await f.command('chat.create',{rootId:f.rootId,title:'Separate conversation'});await enter();assert.equal(await page.locator('#response-mode-create').getAttribute('aria-pressed'),'true');
 await addLegacyDesk(f,'fs','Synthetic FS world');await page.goto(f.uiUrl);await page.reload();await page.locator('.home-resume-button').first().click();assert.equal(await page.locator('#response-mode-controls').isVisible(),false);assert.deepEqual(report.errors,[]);report.checks.push('New branch defaults to Create; FS selector hidden; no page errors.');report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.stack;process.exitCode=1;await page?.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});console.error(error.stack);}
finally{release?.resolve();await browser?.close();for(const c of cleanup.reverse())await c();report.requests=f.requests;report.workspace=f.dir;await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks,error:report.error,output}));}
