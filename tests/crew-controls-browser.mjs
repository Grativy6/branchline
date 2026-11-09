import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fixture, finish, callTool, until } from './desk-helpers.mjs';
const f=await fixture(),errors=[];
await new Promise(r=>f.app.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
const page=await browser.newPage({viewport:{width:1365,height:950}});page.on('pageerror',e=>errors.push(e.message));await fs.mkdir('.test-output',{recursive:true});
try{
  await page.goto(`http://127.0.0.1:${f.app.address().port}/#session=${f.app.sessionToken}`);await page.locator('#tour-skip').check();await page.locator('#tour-next').click();
  await page.locator(`[data-action="select-chat"][data-id="${f.chatId}"]`).click();
  // A user creates the extra chair and chooses its existing model and Coat.
  for(const name of ['Tester🧪','🧩Designer A','Designer B🔬','Recorder📋','Scout🔭']){
    await page.locator('[data-action="visitor-add"]').click();const editor=page.locator('#roster-chair-form');
    await editor.locator('[name="name"]').fill(name);await editor.locator('[name="modelId"]').selectOption(f.app.store.state.models[0].id);
    const coat=await editor.locator('[name="coat"] option').nth(1).getAttribute('value');await editor.locator('[name="coat"]').selectOption(coat);await editor.locator('[type="submit"]').click();
    await until(()=>f.app.store.state.chats[0].seating.visitors.some(c=>c.name===name),'UI-created chair');
    const created=f.app.store.state.chats[0].seating.visitors.find(c=>c.name===name);assert(created.coat);assert.equal(created.modelId,f.app.store.state.models[0].id);
  }
  await page.locator('#message-input').fill('/goal Compare the fixture and record the evidence.');await page.locator('#send-button').click();
  await page.locator('#crew-goal-form').waitFor();assert.equal(f.requests.length,0);
  await page.locator('#crew-goal-form [type="submit"]').click();await until(()=>f.app.store.state.deskWork?.goals?.length===1,'goal saved');assert.equal(f.requests.length,0);
  await page.screenshot({path:'.test-output/crew-goal-saved.png'});
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();assert.equal(await page.locator('#message-input').inputValue(),'');
  await page.getByRole('button',{name:'All',exact:true}).click();await page.locator('#tools-enabled').uncheck();await page.locator('#crew-goal-button').click();
  await page.locator('[data-crew-action="start"]').click();await until(()=>f.requests.length===7,()=>JSON.stringify({tasks:f.app.store.state.deskWork.tasks,error:f.app.deskTasks.lastError}));
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.getByRole('button',{name:'Select',exact:true}).click();await page.getByRole('button',{name:'Select Hearthline',exact:true}).click();
  await page.locator('#message-input').fill('Queued human question');await page.locator('#send-button').click();
  const queuedCard=page.locator('#crew-queued-inputs article').filter({hasText:'Queued human question'});await queuedCard.locator('[data-crew-action="edit"]').waitFor();await queuedCard.locator('[data-crew-action="edit"]').click();
  await page.locator('#crew-input-form [name="text"]').fill('Edited human question');await page.locator('#crew-input-form [type="submit"]').click();
  await page.locator('#crew-queued-inputs').getByText('Edited human question',{exact:true}).waitFor();
  await page.locator('#crew-queued-inputs [data-crew-action="remove"]').click();
  const response={status:'complete',summary:'Observed fixture check completed.',next_step:'',wait_for:'none',wait_id:'',after:'',evidence:[]};
  for(const q of f.requests.slice(0,7))callTool(q,'report_goal_work',response,'done_'+f.requests.indexOf(q));
  await until(()=>f.requests.length===14,'seven reported outcomes');for(const q of f.requests.slice(7))finish(q,'The recorded check is complete.');
  await until(()=>f.app.deskTasks.goals(f.chatId)[0].status==='completed','goal completed');
  await page.locator('#crew-goal-button').click();await page.locator('#goal-live-status').getByText('Assignments reported complete',{exact:true}).waitFor();assert.equal(await page.locator('.goal-lane').count(),7);
  await page.screenshot({path:'.test-output/crew-goal-complete.png'});await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.locator('#open-toy-shelf').click();await page.locator('#dialog [data-action="blackboard-open"]').click();await page.locator('.conversation-goal-board').waitFor();assert.equal(await page.locator('.conversation-goal-board .blackboard-item').count(),7);await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.locator('#crew-resource-button').waitFor();await page.locator('#crew-resource-button').click();await page.getByText('Fixture GPU',{exact:true}).waitFor();
  assert((await page.locator('#crew-resource-view').innerText()).includes('Whole device'));await page.screenshot({path:'.test-output/crew-resources.png'});
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();await page.locator('#settings-button').click();await page.locator('[data-action="settings-tab"][data-id="conversation"]').click();
  assert.deepEqual(await page.locator('#busy-input-form [name="mode"]').evaluateAll(nodes=>nodes.map(n=>n.value)),['queue-first','steer-directly','queue-only']);
  await page.locator('#busy-input-form [value="queue-only"]').check();await page.locator('#busy-input-form [type="submit"]').click();
  await until(()=>f.app.store.state.ui.busyInputMode==='queue-only','input preference saved');await page.reload();await page.locator(`[data-action="select-chat"][data-id="${f.chatId}"]`).click();await page.locator('#crew-goal-button').click();
  await page.locator('#goal-live-status').getByText('Assignments reported complete',{exact:true}).waitFor();assert.equal(f.app.store.state.ui.busyInputMode,'queue-only');assert.equal(f.requests.length,14);
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.locator('#details-toggle').click();await page.locator('#new-chat').click();await page.locator('#new-branch-form [name="title"]').fill('Independent goal branch');await page.locator('#new-branch-form [type="submit"]').click();
  await until(()=>f.app.store.state.chats.length===2,'new branch');await page.locator('#crew-goal-button').click();await page.getByText('Copy a goal from another conversation',{exact:true}).click();await page.locator('[data-crew-action="copy-goal"]').click();
  await until(()=>f.app.store.state.deskWork.goals.length===2,'copied goal');assert.notEqual(f.app.store.state.deskWork.goals[0].id,f.app.store.state.deskWork.goals[1].id);assert.equal(f.requests.length,14);
  assert.deepEqual(errors,[]);const result={status:'PASS',userCreatedChairAndCoat:true,duplicateModelChairs:true,slashGoalNoCall:true,savedGoal:true,sevenGoalTasks:true,queuedEditAndRemove:true,threeInputModes:true,resources:true,reload:true,independentGoalCopy:true,sharedBlackboard:true,modelCalls:14,errors,fixture:f.dir};
  await fs.writeFile('.test-output/crew-controls-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){await page.screenshot({path:'.test-output/crew-controls-failure.png'});console.error(JSON.stringify({error:error.message,errors,visibleError:await page.locator('#error-text').textContent().catch(()=>''),tasks:f.app.store.state.deskWork?.tasks.map(t=>({status:t.status,error:t.error}))}));throw error;}
finally{await browser.close();await f.close();}
