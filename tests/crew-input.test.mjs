import { cloudFixture } from './crew-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, input, finish, until } from './desk-helpers.mjs';
import { inputDelivery, taskInput } from '../public/desk-input.js';
import { validateReplyProvenance } from '../server/reply-provenance.mjs';
import { replayJournal } from '../server/journal.mjs';
import sharp from 'sharp';
import path from 'node:path';
import {createApp} from '../server/index.mjs';

test('queue edit preserves original task and dispatches the edited human text once', async () => {
  const f = await fixture();
  try {
    await f.app.deskTasks.admit(input(f, 'First', 'input_first')); await until(() => f.requests.length === 1, 'first call');
    const q = await f.app.deskTasks.admit(input(f, 'Original queued wording', 'input_edit'));
    await f.app.deskTasks.editInput(q.taskIds[0], 'Edited queued wording');
    const task = f.app.store.state.deskWork.tasks.find(t => t.id === q.taskIds[0]);
    assert.equal(task.content, 'Original queued wording'); assert.equal(taskInput(f.app.store.state, task), 'Edited queued wording');
    finish(f.requests[0]); await until(() => f.requests.length === 2, 'edited request');
    assert(JSON.stringify(f.requests[1].body.messages.at(-1)).includes('Edited queued wording')); finish(f.requests[1]);
    await f.app.deskTasks.waitForTask(task.id); assert.equal(f.requests.length, 2);
  } finally { await f.close(); }
});
test('promoting a queued input reaches its active turn once with immutable amendment receipts', { timeout: 15000 }, async () => {
  const f = await cloudFixture();
  try {
    const first = await f.app.deskTasks.admit(input(f, 'Original assignment', 'steer_first'));
    await until(() => f.codex.calls.length === 1 && f.app.deskTasks.entries.get(first.taskIds[0])?.steer, 'steering available');
    const next = await f.app.deskTasks.admit(input(f, 'Human correction', 'steer_second'));
    await f.app.deskTasks.editInput(next.taskIds[0], 'Corrected direction');
    const result = await f.app.deskTasks.promoteInput(next.taskIds[0]); assert.equal(result.state, 'accepted');
    await f.app.deskTasks.promoteInput(next.taskIds[0]); assert.equal(f.codex.calls[0].amendments.length, 1);
    assert.equal(f.codex.calls[0].amendments[0].content, 'Corrected direction');
    f.codex.calls[0].finish(); await f.app.deskTasks.waitForTask(first.taskIds[0]);
    assert.equal(f.codex.calls.length, 1);
    const target = f.app.store.state.deskWork.tasks.find(t => t.id === first.taskIds[0]); assert.equal(target.content, 'Original assignment'); assert.equal(target.status, 'completed');
    const records = f.app.store.state.handoffs.records.filter(r => r.taskId === target.exchangeId), amendment = records.find(r => r.kind === 'input.amendment.accepted');
    assert(amendment); assert(records.find(r => r.kind === 'model.to_record').parents.includes(amendment.id));
    validateReplyProvenance(f.app.store.state);
    const replay = await replayJournal(f.app.store.file); assert.equal(inputDelivery(replay.state, next.taskIds[0]).state, 'accepted');
  } finally { await f.close(); }
});
test('direct steering is opt-in, Queue only disables it, and a rejected input remains queued', { timeout: 15000 }, async () => {
  const f = await cloudFixture();
  try {
    await f.command('input.preference', { mode: 'steer-directly' });
    const a = await f.app.deskTasks.admit(input(f, 'Work', 'direct_first')); await until(() => f.codex.calls.length === 1, 'active call');
    const b = await f.app.deskTasks.admit(input(f, 'Immediate correction', 'direct_second')); assert.equal(inputDelivery(f.app.store.state,b.taskIds[0]).state,'accepted');
    await f.command('input.preference', { mode: 'queue-only' });
    const c = await f.app.deskTasks.admit(input(f, 'Leave queued', 'only_queue')); await assert.rejects(f.app.deskTasks.promoteInput(c.taskIds[0]), /disabled/);
    await f.command('input.preference', { mode: 'queue-first' }); f.codex.calls[0].reject = true;
    const rejected = await f.app.deskTasks.promoteInput(c.taskIds[0]); assert.equal(rejected.state,'queued');
    f.codex.calls[0].finish(); await f.app.deskTasks.waitForTask(a.taskIds[0]); await until(()=>f.codex.calls.length===2,'rejected input received next turn');
    assert(JSON.stringify(f.codex.calls[1].messages.at(-1)).includes('Leave queued')); f.codex.calls[1].finish(); await f.app.deskTasks.waitForTask(c.taskIds[0]);
  } finally { await f.close(); }
});
test('an uncertain steering acknowledgement never silently repeats the input', { timeout: 15000 }, async () => {
  const f = await cloudFixture();
  try {
    const a=await f.app.deskTasks.admit(input(f,'Work','uncertain_first'));await until(()=>f.codex.calls.length===1,'active');
    const b=await f.app.deskTasks.admit(input(f,'A correction','uncertain_input'));f.codex.calls[0].uncertain=true;
    assert.equal((await f.app.deskTasks.promoteInput(b.taskIds[0])).state,'uncertain');f.codex.calls[0].finish();await f.app.deskTasks.waitForTask(a.taskIds[0]);
    for(let i=0;i<50;i++)await f.app.deskTasks.pump();assert.equal(f.codex.calls.length,1);
    assert.equal((await f.app.deskTasks.promoteInput(b.taskIds[0])).state,'uncertain');
    await f.app.deskTasks.cancel(b.taskIds[0],{pauseChair:false});
  } finally { await f.close(); }
});
test('a connection without in-flight steering waits for its next turn without interruption', async () => {
  const f=await fixture();try{
    const a=await f.app.deskTasks.admit(input(f,'Local work','local_first'));await until(()=>f.requests.length===1,'local request');
    const b=await f.app.deskTasks.admit(input(f,'Local follow-up','local_next'));
    const result=await f.app.deskTasks.promoteInput(b.taskIds[0]);assert.equal(result.state,'queued');assert.equal(f.requests.length,1);assert(!f.requests[0].res.destroyed);
    finish(f.requests[0]);await f.app.deskTasks.waitForTask(a.taskIds[0]);await until(()=>f.requests.length===2,'next local turn');finish(f.requests[1]);await f.app.deskTasks.waitForTask(b.taskIds[0]);
  }finally{await f.close();}
});

test('a picture selected during work follows the steering recipient and survives history', {timeout:15000}, async()=>{
  const f=await cloudFixture();try{
    await new Promise(r=>f.app.listen(0,'127.0.0.1',r));
    const post=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${f.app.address().port}`+route,{method:'POST',headers:{'content-type':'application/json','x-branchline-session':f.app.sessionToken},body:JSON.stringify(body)});const value=await response.json();assert(response.ok,value.error);return value;};
    const a=await f.app.deskTasks.admit(input(f,'Continue working.','picture_first'));await until(()=>f.codex.calls.length===1,'active call');
    const png=await sharp({create:{width:24,height:20,channels:3,background:'#f08a32'}}).png().toBuffer();
    const selected=await post('/api/images/select',{chatId:f.chatId,image:{name:'new-evidence.png',base64:png.toString('base64'),origin:'pick'}});
    const roster=f.app.store.state.chats[0].seating,plan=await post('/api/images/plan',{chatId:f.chatId,chairIds:[roster.desk.id],baseRevisionId:roster.revisionId});
    const b=await f.app.deskTasks.admit({...input(f,'Use this picture as evidence.','picture_steer'),imagePlanId:plan.id});
    assert.equal((await f.app.deskTasks.promoteInput(b.taskIds[0])).state,'accepted');
    const incoming=f.codex.calls[0].amendments[0];assert.equal(incoming.images[0].selectionId,selected.image.id);assert(incoming.imageData.get(incoming.images[0].sha256).startsWith('data:image/png;base64,'));
    f.codex.calls[0].finish();await f.app.deskTasks.waitForTask(a.taskIds[0]);assert.equal(f.codex.calls.length,1);
    assert.deepEqual(f.app.store.state.images.active[f.chatId],[]);assert.equal(f.app.store.state.images.selections.length,1);
    const record=f.app.store.state.handoffs.records.find(r=>r.kind==='input.amendment.accepted');assert.equal(record.detail.input.images[0].selectionId,selected.image.id);
    validateReplyProvenance(f.app.store.state);
  }finally{await f.close();}
});

test('a finished target leaves a single queued next turn instead of losing or duplicating the message',async()=>{
  const f=await cloudFixture();try{
    const a=await f.app.deskTasks.admit(input(f,'Work','race_first'));await until(()=>f.codex.calls.length===1,'active');
    const b=await f.app.deskTasks.admit(input(f,'A late correction','race_next'));
    f.codex.calls[0].completed=true;
    assert.equal((await f.app.deskTasks.promoteInput(b.taskIds[0])).state,'queued');
    f.codex.calls[0].finish();await f.app.deskTasks.waitForTask(a.taskIds[0]);await until(()=>f.codex.calls.length===2,'next turn');
    assert.equal(f.codex.calls[0].amendments.length,0);f.codex.calls[1].finish();await f.app.deskTasks.waitForTask(b.taskIds[0]);assert.equal(f.codex.calls.length,2);
  }finally{await f.close();}
});

test('closing retains unsent human input and reopening waits for explicit Send queued', {timeout:15000}, async()=>{
  const f=await fixture();let reopened;
  try{
    await f.app.deskTasks.admit(input(f,'Current work','restart_current'));await until(()=>f.requests.length===1,'current turn');
    const queued=await f.app.deskTasks.admit(input(f,'Saved queued message','restart_queue'));
    await f.app.dispose();
    reopened=await createApp({dataDir:path.join(f.dir,'workspace'),bundledDir:path.join(f.dir,'no-model'),modelOptions:{codex:{close(){},async status(){return {connected:false,models:[]};}}}});
    assert.equal(inputDelivery(reopened.store.state,queued.taskIds[0]).state,'held');
    for(let i=0;i<50;i++)await reopened.deskTasks.pump();assert.equal(f.requests.length,1);
    await reopened.deskTasks.editInput(queued.taskIds[0],'Edited after reopening');assert.equal(inputDelivery(reopened.store.state,queued.taskIds[0]).state,'held');
    await reopened.deskTasks.releaseInput(queued.taskIds[0]);await until(()=>f.requests.length===2,'explicitly released turn');
    assert(JSON.stringify(f.requests[1].body.messages.at(-1)).includes('Edited after reopening'));finish(f.requests[1]);await reopened.deskTasks.waitForTask(queued.taskIds[0]);assert.equal(f.requests.length,2);
  }finally{await reopened?.dispose();await f.close();}
});
