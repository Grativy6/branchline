import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fixture,until} from './desk-helpers.mjs';

let connected=true,problem=null;
let models=[{id:'gpt-fixture-one',name:'Fixture One',isDefault:true},{id:'gpt-fixture-two',name:'Fixture Two'}];
const codex={close(){},async status(){return {connected,account:connected?{email:'fixture@example.test',plan:'plus'}:null,models:connected?models:[],pending:false,error:problem};},async logout(){connected=false;return {connected:false};}};
const f=await fixture({codex}),errors=[];
await new Promise(r=>f.app.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
const page=await browser.newPage({viewport:{width:1280,height:950}});
page.on('pageerror',e=>errors.push(e.message));
await fs.mkdir('.test-output',{recursive:true});
try{
  await page.goto(`http://127.0.0.1:${f.app.address().port}/#session=${f.app.sessionToken}`);
  await page.locator('#tour-skip').check();await page.locator('#tour-next').click();
  await page.locator(`[data-action="select-chat"][data-id="${f.chatId}"]`).click();
  await until(()=>f.app.store.state.models.filter(m=>m.runtime==='codex').length===2,'automatic startup registration');
  await page.locator('#settings-button').click();
  await page.locator('[data-action="settings-tab"][data-id="models"]').click();
  const card=page.locator('#chatgpt-connection');
  await card.getByRole('status').filter({hasText:'Connected'}).waitFor();
  assert.match(await card.innerText(),/Connected · Plus/);
  assert.equal(await card.locator('.chatgpt-models li').count(),2);
  assert.equal(await page.locator('[data-action="codex-save"]').count(),0);
  assert.equal(await page.getByRole('button',{name:'ChatGPT connection & models',exact:true}).count(),0);
  await card.screenshot({path:'.test-output/chatgpt-inline-connected.png'});
  for(const width of [1280,390]){
    await page.setViewportSize({width,height:950});
    const layout=await card.evaluate(e=>{const panel=e.querySelector('#chatgpt-connection-status'),intro=panel.firstElementChild.getBoundingClientRect(),notice=panel.querySelector('.notice').getBoundingClientRect();return {stacked:notice.top>=intro.bottom-1,panelWidth:panel.getBoundingClientRect().width,cardWidth:e.getBoundingClientRect().width,pageFits:document.documentElement.scrollWidth<=innerWidth};});
    assert(layout.stacked&&layout.pageFits&&layout.panelWidth>layout.cardWidth*.8,JSON.stringify({width,...layout}));
  }
  await card.screenshot({path:'.test-output/chatgpt-inline-narrow.png'});
  await page.setViewportSize({width:1280,height:950});
  await page.locator('.advanced-settings > summary').click();
  await page.locator('#model-form input[name="name"]').fill('Unfinished local model');
  models=[...models,{id:'gpt-newly-offered',name:'Newly Offered'}];
  let failStateOnce=true;
  await page.route('**/api/state',async route=>{
    if(failStateOnce){failStateOnce=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic state refresh failure'})});}
    else await route.continue();
  });
  await card.getByRole('button',{name:'Refresh models',exact:true}).click();
  await until(()=>f.app.store.state.models.some(m=>m.model==='gpt-newly-offered'),'new catalog model registered');
  await card.getByRole('alert').waitFor();assert.match(await card.innerText(),/Connected · Plus/);
  await card.getByRole('button',{name:'Refresh models',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('#chatgpt-connection .chatgpt-models li').length===3);
  await page.waitForFunction(()=>!document.querySelector('#chatgpt-connection [role="alert"]'));
  assert.equal(await page.locator('#model-form input[name="name"]').inputValue(),'Unfinished local model');
  await page.locator('#settings-button').click();
  await page.getByRole('button',{name:'Add Chair',exact:true}).click();
  const choices=await page.locator('#chair-model-select').innerText();
  for(const name of ['Fixture One','Fixture Two','Newly Offered'])assert(choices.includes(name),name);
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.locator('#settings-button').click();await page.locator('[data-action="settings-tab"][data-id="models"]').click();
  problem='The model list could not be refreshed.';
  await card.getByRole('button',{name:'Refresh models',exact:true}).click();
  await card.getByRole('alert').waitFor();assert.match(await card.innerText(),/Connected · Plus/);
  assert.equal(await card.locator('.chatgpt-models li').count(),3);
  problem=null;
  await card.getByRole('button',{name:'Sign out of Branchline',exact:true}).click();
  await card.getByRole('button',{name:'Sign in with ChatGPT',exact:true}).waitFor();
  assert.equal(f.app.store.state.models.filter(m=>m.runtime==='codex').length,3,'saved identities retained on sign-out');
  await card.screenshot({path:'.test-output/chatgpt-inline-signed-out.png'});
  assert.deepEqual(errors,[]);
  const result={status:'PASS',inlineConnection:true,automaticModels:3,noPerModelImport:true,chairOptionsUpdated:true,localDraftPreserved:true,connectedStatusSurvivesCatalogError:true,savedModelsRetainedOnSignOut:true,pageErrors:errors};
  await fs.writeFile('.test-output/chatgpt-models-browser.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(error){await page.screenshot({path:'.test-output/chatgpt-models-failure.png'}).catch(()=>{});console.error(JSON.stringify({error:error.message,pageErrors:errors,body:(await page.locator('body').innerText()).slice(-2200)}));process.exitCode=1;}
finally{await browser.close();await f.close();}
