import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fixture, finish, callTool, until, input } from './desk-helpers.mjs';
import { BUNDLED_PROFILE } from '../server/bundled-profile.mjs';
import { createApp } from '../server/index.mjs';
import { activityRows } from '../server/activity.mjs';
import { writeDrawer, readDrawer, readDeskRecord, writeDeskArtifact } from '../server/desk-work.mjs';

test('real tool contract keeps drawer contents private until explicit log inspection',{timeout:15000},async()=>{
  let stage='write',owner;
  const f=await fixture({reply:q=>{
    if(q.body.messages.some(m=>m.role==='tool'))return finish(q,'The requested step is complete.');
    if(stage==='write')return callTool(q,'write_drawer',{name:'Working assumption',text:'PRIVATE_CAVEAT_4F91',revision:''});
    assert.ok(!JSON.stringify(q.body.messages).includes('PRIVATE_CAVEAT_4F91'),'Peer initial input must exclude unpublished notes');
    callTool(q,'inspect_chair_log',{chair_id:owner,query:'PRIVATE_CAVEAT_4F91',offset:0});
  }});
  try{
    owner=f.app.store.state.chats[0].seating.desk.id;
    await f.app.deskTasks.admit({...input(f,'@hearthline Keep a working note.'),toolsEnabled:true});
    await until(()=>f.app.store.state.deskWork.tasks.every(t=>t.status==='completed'),()=>JSON.stringify(f.app.store.state.deskWork.tasks));
    assert.equal(f.app.store.state.deskWork.drawers.find(d=>d.chairId===owner).notes[0].revisions[0].text,'PRIVATE_CAVEAT_4F91');
    stage='inspect';
    await f.app.deskTasks.admit({...input(f,'@qwen Inspect the other chair’s log for its working assumption.','request_inspection'),toolsEnabled:true});
    await until(()=>f.app.store.state.deskWork.tasks.every(t=>t.status==='completed'),()=>JSON.stringify(f.app.store.state.deskWork.tasks));
    const recorded=f.app.store.state.handoffs.records.findLast(r=>r.detail?.tool==='inspect_chair_log'&&r.kind==='operation.result');
    assert.equal(recorded.detail.result.ok,true,JSON.stringify(recorded.detail.result));
    assert.match(recorded.detail.result.value.text,/PRIVATE_CAVEAT_4F91/);assert.match(recorded.detail.result.value.view,/Historical log inspection/);
    assert.ok(f.app.store.state.deskWork.events.some(e=>e.kind==='log.inspected'&&e.visibility==='inspection'));
  }finally{await f.close();}
});
test('one local slot queues a peer with a precise reason while an independent connection runs',{timeout:15000},async()=>{
  const f=await fixture();try{
    await f.command('model.save',{...BUNDLED_PROFILE,name:'Included test Qwen'});
    const local=f.app.store.state.models.at(-1);
    for(let n=0;n<2;n++){const r=f.app.store.state.chats[0].seating;await f.command('table.roster.chair',{chatId:f.chatId,baseRevisionId:r.revisionId,chairId:n===0?r.desk.id:r.visitors[0].id,modelId:local.id,name:n===0?'QwenOne':'QwenTwo',personalId:null,coat:null});}
    let r=f.app.store.state.chats[0].seating;await f.command('table.roster.chair',{chatId:f.chatId,baseRevisionId:r.revisionId,chairId:null,modelId:f.app.store.state.models[0].id,name:'AstraTest',personalId:null,coat:null});
    f.app.localRunner.fetch=(_model,_url,options)=>fetch(f.fakeUrl+'/chat/completions',options);
    await f.app.deskTasks.admit(input(f,'@QwenOne FIRST @QwenTwo SECOND @AstraTest INDEPENDENT'));
    await until(()=>f.requests.length===2,()=>JSON.stringify(f.app.store.state.deskWork.tasks));
    const tasks=f.app.store.state.deskWork.tasks;assert.equal(tasks[1].status,'waiting');assert.equal(tasks[1].phase,'Waiting for local runtime slot');assert.ok(['running','preparing'].includes(tasks[2].status));
    assert.ok(activityRows(f.app.store.state,f.app.deskTasks).some(r=>r.phase==='Waiting for local runtime slot'));
    finish(f.requests.find(q=>q.body.model===BUNDLED_PROFILE.model),'First local task finished');
    await until(()=>f.requests.length===3,'Second local task should start after the slot is released');
    for(const q of f.requests)finish(q);
    await until(()=>f.app.store.state.deskWork.tasks.every(t=>t.status==='completed'),()=>JSON.stringify(f.app.store.state.deskWork.tasks));
  }finally{await f.close();}
});
test('stop all covers preparation and waiting tasks; saved records survive restart',{timeout:15000},async()=>{
  const f=await fixture();let again;
  try{
    await f.app.deskTasks.admit(input(f,'@hearthline FIRST @hearthline QUEUED @qwen THIRD'));
    await f.app.deskTasks.stopAll();
    await until(()=>f.app.store.state.deskWork.tasks.every(t=>['cancelled','failed'].includes(t.status)),()=>JSON.stringify(f.app.store.state.deskWork.tasks));
    const count=f.requests.length;await new Promise(r=>setTimeout(r,500));assert.equal(f.requests.length,count,'Stopped queued work must not start');
    const ids=f.app.store.state.deskWork.tasks.map(t=>t.id);await f.close();
    again=await createApp({dataDir:path.join(f.dir,'workspace'),bundledDir:path.join(f.dir,'no-model'),modelOptions:{codex:{close(){}}}});
    assert.deepEqual(again.store.state.deskWork.tasks.map(t=>t.id),ids);assert.equal(again.store.state.deskWork.drawers.length,2);assert.equal(again.deskTasks.entries.size,0);
  }finally{if(again)await again.dispose();else await f.close();}
});
test('peer handoff starts a distinct chair task without impersonating a human message',{timeout:15000},async()=>{
  let peer;
  const f=await fixture({reply:q=>{
    if(q.body.model==='hearthline'&&!q.body.messages.some(m=>m.role==='tool'))callTool(q,'send_chair_message',{chair_id:peer,message:'Check the source and report back.',request_reply:true});
    else finish(q,'Recorded result.');
  }});
  try{
    peer=f.app.store.state.chats[0].seating.visitors[0].id;
    await f.app.deskTasks.admit({...input(f,'@hearthline Ask Qwen for a source check.'),toolsEnabled:true});
    await until(()=>f.app.store.state.deskWork.tasks.length===2&&f.app.store.state.deskWork.tasks.every(t=>t.status==='completed'),()=>JSON.stringify(f.app.store.state.handoffs.records.filter(r=>r.kind==='operation.result').map(r=>r.detail.result)));
    const tasks=f.app.store.state.deskWork.tasks;assert.equal(tasks[1].originTaskId,tasks[0].id);assert.equal(tasks[1].chainId,tasks[0].chainId);
    assert.equal(f.app.store.state.messages.filter(m=>m.role==='user').length,1,'A model message must not be stored as a new human message');
    assert.ok(f.app.store.state.deskWork.events.some(e=>e.kind==='chair.message'));
  }finally{await f.close();}
});

test('work at another desk and selecting another visitor do not disturb a running chair',{timeout:15000},async()=>{
  const f=await fixture();try{
    let r=f.app.store.state.chats[0].seating;
    await f.command('table.roster.chair',{chatId:f.chatId,baseRevisionId:r.revisionId,chairId:null,modelId:f.app.store.state.models[0].id,name:'Third chair',personalId:null,coat:null});
    await f.app.deskTasks.admit(input(f,'@qwen FIRST_DESK'));
    await until(()=>f.requests.length===1,'First request');
    r=f.app.store.state.chats[0].seating;await f.command('table.roster.select',{chatId:f.chatId,baseRevisionId:r.revisionId,chairId:r.visitors[1].id});
    await f.command('root.create',{mode:'personal',name:'Another desk'});
    const other=f.app.store.state.chats.at(-1).id;
    await f.command('table.roster.start',{chatId:other});
    r=f.app.store.state.chats.at(-1).seating;await f.command('table.roster.chair',{chatId:other,baseRevisionId:r.revisionId,chairId:r.desk.id,modelId:f.app.store.state.models[0].id,name:'Other',personalId:null,coat:null});
    await f.app.deskTasks.admit(input({...f,chatId:other},'@other SECOND_DESK','request_other_desk'));
    await until(()=>f.requests.length===2,'Second desk should overlap');
    assert.equal(new Set(activityRows(f.app.store.state,f.app.deskTasks).filter(r=>r.active).map(r=>r.rootId)).size,2);
    for(const q of f.requests)finish(q);
    await until(()=>f.app.store.state.deskWork.tasks.every(t=>t.status==='completed'),()=>JSON.stringify(f.app.store.state.deskWork.tasks));
  }finally{await f.close();}
});

test('drawer follows stable chair through rename, replacement, removal and restoration',{timeout:10000},async()=>{
  const f=await fixture({hold:false});try{
    await f.app.deskTasks.admit(input(f,'@qwen Keep my work'));
    await until(()=>f.app.store.state.deskWork.tasks.every(t=>t.status==='completed'),'Task completion');
    const task=f.app.store.state.deskWork.tasks[0];
    await f.app.store.transact(s=>{writeDrawer(s,task,{name:'Return point',text:'Retained original work',revision:''});return s;});
    let r=f.app.store.state.chats[0].seating;
    await f.command('table.roster.chair',{chatId:f.chatId,baseRevisionId:r.revisionId,chairId:task.chairId,modelId:f.app.store.state.models[0].id,name:'Renamed',personalId:null,coat:null});
    r=f.app.store.state.chats[0].seating;await f.command('table.roster.remove',{chatId:f.chatId,baseRevisionId:r.revisionId,chairId:task.chairId});
    assert.equal(readDrawer(f.app.store.state,task,{name:'Return point'}).author,'Qwen');
    r=f.app.store.state.chats[0].seating;await f.command('table.roster.undo',{chatId:f.chatId,baseRevisionId:r.revisionId});
    assert.equal(f.app.store.state.chats[0].seating.visitors[0].id,task.chairId);
    assert.equal(readDrawer(f.app.store.state,task,{name:'Return point'}).text,'Retained original work');
    const state=structuredClone(f.app.store.state),shared=writeDeskArtifact(state,task,{id:'',title:'Long source',text:'A'.repeat(25000),revision:''});
    const first=readDeskRecord(state,task.chatId,{id:shared.id,revision:shared.revision,offset:0});assert.equal(first.text.length,6000);assert.ok(first.nextOffset);
    const next=readDeskRecord(state,task.chatId,{id:shared.id,revision:first.revision,offset:first.nextOffset});assert.equal(next.hash,first.hash);
  }finally{await f.close();}
});

test('unknown and stale recipients are rejected before any part is dispatched',{timeout:10000},async()=>{
  const f=await fixture();try{
    await assert.rejects(f.app.deskTasks.admit(input(f,'@hearthline valid @missing wrong')),/No chair/);
    const stale=input(f,'@qwen stale'),r=f.app.store.state.chats[0].seating;
    await f.command('table.roster.chair',{chatId:f.chatId,baseRevisionId:r.revisionId,chairId:r.visitors[0].id,modelId:r.visitors[0].modelId,name:'Renamed',personalId:null,coat:null});
    await assert.rejects(f.app.deskTasks.admit(stale),/chairs changed/);
    assert.equal(f.requests.length,0);assert.equal(f.app.store.state.deskWork?.tasks.length??0,0);
  }finally{await f.close();}
});

test('a running Plan appears once and can overlap an independent desk task',{timeout:15000},async()=>{
  const f=await fixture();try{
    await f.app.deskTasks.admit(input(f,'@hearthline Foreground work'));
    await until(()=>f.requests.length===1,'Foreground request');
    const plan=await f.app.plans.save({id:null,name:'Concurrent Plan',task:'A literal @qwen example is part of this saved instruction.',rootId:null,workRootId:null,modelId:f.app.store.state.models[1].id,coat:null,
      schedule:{date:'2026-11-05',time:'12:00',zone:'UTC',repeat:'once',weekdays:[],intervalMinutes:60},seconds:30,toolCalls:8,missed:'skip',enabled:false});
    await f.app.plans.action({id:plan.id,action:'run'});
    await until(()=>f.requests.length===2,()=>JSON.stringify(f.app.store.state.plans.runs)+' '+JSON.stringify(f.app.store.state.deskWork.tasks));
    const active=activityRows(f.app.store.state,f.app.deskTasks).filter(r=>r.active);assert.equal(active.length,2,JSON.stringify(active));assert.equal(new Set(active.map(r=>r.rootId)).size,2);
    for(const q of f.requests)finish(q,'Plan outcome: completed');
    await until(()=>f.app.store.state.plans.runs[0].status==='finished',()=>JSON.stringify(f.app.store.state.plans.runs));
  }finally{await f.close();}
});

test('simultaneous duplicate sends share one admitted batch',{timeout:10000},async()=>{
  const f=await fixture();try{
    const body=input(f,'@hearthline A @qwen B'),results=await Promise.all([f.app.deskTasks.admit(body),f.app.deskTasks.admit(body)]);
    assert.equal(results[0].batchId,results[1].batchId);assert.deepEqual(results[0].taskIds,results[1].taskIds);
    await until(()=>f.requests.length===2,'Only two dispatched requests');assert.equal(f.app.store.state.deskWork.tasks.length,2);
  }finally{await f.close();}
});
