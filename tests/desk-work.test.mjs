import { fixture, finish, until, input } from './desk-helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChairPrompt } from '../public/chair-mentions.js';
import { activityRows } from '../server/activity.mjs';
import { writeDrawer, readDrawer, writeDeskArtifact, inspectChairLog, deskContext, preserveDeskWork } from '../server/desk-work.mjs';

const chairs=[{id:'a',name:'Hearthline'},{id:'b',name:'Qwen'},{id:'c',name:'Long Name'}];
test('Activity counts a chair once while its started event is still being saved',()=>{
  const state={roots:[{id:'r',name:'Desk'}],chats:[{id:'c',rootId:'r',title:'Chat'}],
    deskWork:{tasks:[{id:'t',exchangeId:null}]},
    exchanges:[{id:'e',chatId:'c',status:'pending',request:{deskTaskId:'t'}}]};
  const manager={status:()=>[{id:'t',chatId:'c',content:'Work',label:'Qwen',model:{name:'Qwen'},status:'preparing',exchangeId:null}]};
  const active=activityRows(state,manager).filter(r=>r.active);
  assert.equal(active.length,1);assert.equal(active[0].type,'chair');
});
test('addresses inline and multiline sections with shared leading context',()=>{
  const p=parseChairPrompt('Work together. @hearthline Draft it. @qwen Check it.',chairs,'a');
  assert.deepEqual(p.errors,[]);assert.equal(p.sharedContext,'Work together.');assert.deepEqual(p.sections.map(s=>[s.chairId,s.content]),[['a','Draft it.'],['b','Check it.']]);
  assert.equal(parseChairPrompt('@{Long Name} Hello',chairs).sections[0].chairId,'c');
});
test('literal mentions do not dispatch; invalid recipients cannot partially route',()=>{
  for(const s of ['email user@qwen.test','`@qwen no`','```text\n@qwen no\n```','"@qwen example"','\\@qwen literal','> @qwen quotation'])assert.equal(parseChairPrompt(s,chairs,'a').routed,false,s);
  assert.ok(parseChairPrompt('@qwen yes @missing no',chairs).errors.length);
  assert.deepEqual(parseChairPrompt('@qwen',chairs).errors,[]);
  assert.ok(parseChairPrompt('@qwen go',[...chairs,{id:'d',name:'Qwen'}]).errors.length);
});

test('two chairs overlap, finish independently and preserve their original assignments',{timeout:15000},async()=>{
  const f=await fixture();try{
    const body=input(f,'@hearthline FIRST_TASK @qwen SECOND_TASK');
    const admitted=await f.app.deskTasks.admit(body);
    await until(()=>f.requests.length===2,()=>JSON.stringify(f.app.store.state.deskWork.tasks.map(t=>({status:t.status,error:t.error})))+' '+f.app.deskTasks.lastError);
    assert.equal(f.app.store.state.exchanges.filter(e=>e.status==='pending').length,2);
    assert.equal(new Set(f.app.store.state.exchanges.map(e=>e.speaker.chairId)).size,2);
    assert.match(JSON.stringify(f.requests[0].body.messages.at(-1)),/FIRST_TASK/);assert.match(JSON.stringify(f.requests[1].body.messages.at(-1)),/SECOND_TASK/);
    finish(f.requests[1],'Qwen finished first');finish(f.requests[0],'Hearthline finished second');
    await until(()=>f.app.store.state.deskWork.tasks.every(t=>t.status==='completed'),()=>JSON.stringify(f.app.store.state.deskWork.tasks.map(t=>({status:t.status,error:t.error})))+' '+f.app.deskTasks.lastError);
    assert.equal(f.app.store.state.messages.filter(m=>m.role==='assistant').length,2);
    const replay=await f.app.deskTasks.admit(body);assert.deepEqual(replay.taskIds,admitted.taskIds);assert.equal(replay.replayed,true);assert.equal(f.requests.length,2);
  }finally{await f.close();}
});
test('drawer isolation, attributed inspection and shared edit conflicts preserve both drafts',{timeout:10000},async()=>{
  const f=await fixture({hold:false});try{
    await f.app.deskTasks.admit(input(f,'@hearthline first @qwen second'));
    await until(()=>f.app.store.state.deskWork.tasks.every(t=>t.status==='completed'),()=>JSON.stringify(f.app.store.state.deskWork.tasks));
    const state=structuredClone(f.app.store.state),[a,b]=state.deskWork.tasks;
    assert.throws(()=>writeDrawer(state,a,{name:'New note',text:'Safe draft',revision:'v1'}),/new note.*empty string/);
    assert.throws(()=>writeDeskArtifact(state,a,{id:'',title:'New shared work',text:'Safe draft',revision:'v1'}),/new shared artifact.*empty strings/);
    const saved=writeDrawer(state,a,{name:'Unfinished',text:'PRIVATE_A_CAVEAT',revision:''});
    assert.equal(readDrawer(state,b,{name:'',offset:0}).notes.length,0);
    assert.ok(!JSON.stringify(deskContext(state,b.chatId,b.selection)).includes('PRIVATE_A_CAVEAT'));
    assert.match(inspectChairLog(state,b,{chair_id:a.chairId,query:'PRIVATE_A_CAVEAT',offset:0}).text,/PRIVATE_A_CAVEAT/);
    assert.match(inspectChairLog(state,b,{chair_id:a.chairId}).view,/historical|Historical/);
    const artifact=writeDeskArtifact(state,a,{title:'Shared',text:'v1',id:'',revision:''});
    writeDeskArtifact(state,b,{title:'Shared',text:'v2',id:artifact.id,revision:artifact.revision});
    const clash=writeDeskArtifact(state,a,{title:'Shared',text:'preserve this',id:artifact.id,revision:artifact.revision});
    assert.equal(clash.conflict,true);assert.equal(readDrawer(state,a,{name:clash.proposal.name,offset:0}).text,'preserve this');
    const before=structuredClone(state);state.deskWork.drawers[0].chairId=b.chairId;assert.throws(()=>preserveDeskWork(before,state),/changed its chair/);
    assert.ok(saved.revision);
  }finally{await f.close();}
});
