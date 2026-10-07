import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred } from './helpers.mjs';
import { Store } from '../server/store.mjs';
import { archiveRevision, archivePreview } from '../server/model-archives.mjs';
import { resolveRecorder } from '../server/carry-recorder.mjs';
import { savedPeer } from '../server/continuing-hearth.mjs';
import { activeModels, archiveRecord } from '../public/model-archives.js';
import { visiblePersonalModels } from '../public/dream-records.js';
const payload=(f,extra={})=>({modelId:f.modelId,personalIds:archivePreview(f.app.store.state,f.modelId).personalIds,baseRevision:archiveRevision(f.app.store.state),files:'retained',copies:[],...extra});
async function setup(t){const f=await fixture(t);f.modelId=f.app.store.state.models[0].id;await f.command('personal.create',{name:'Aster',modelId:f.modelId,baseIdentity:'synthetic/base'});f.personId=f.app.store.state.personalParticipants[0].id;await f.command('table.assign',{chatId:f.chatId,baseRevisionId:null,personalId:f.personId,visitorModelId:f.modelId});await f.command('message.note',{chatId:f.chatId,content:'Original correction stays attributed.'});await f.command('draft.save',{chatId:f.chatId,text:'Unsent 🌱'});return f;}

test('archive preserves identity, assignments and draft; all new work is refused without provider calls',async t=>{
  const f=await setup(t),before=structuredClone(f.app.store.state);
  await f.command('modelArchive.archive',payload(f));
  for(const key of ['models','personalParticipants','roots','chats','messages','drafts','harnesses','agentProfiles','dreamHistory'])assert.deepEqual(f.app.store.state[key],before[key],key);
  assert.equal(activeModels(f.app.store.state).length,0);assert.equal(visiblePersonalModels(f.app.store.state).length,0);
  const input={requestId:'archive_probe',chatId:f.chatId,content:'New work',speaker:'personal',baseRevisionId:before.chats[0].table.assignments.at(-1).id,lastMessageId:before.messages.at(-1).id};
  assert.equal((await f.post('/api/exchange',input)).status,400);
  assert.throws(()=>resolveRecorder(f.app.store.state,f.chatId,'model:'+f.modelId),/archived/);
  assert.throws(()=>resolveRecorder(f.app.store.state,f.chatId,'personal'),/archived/);
  assert.throws(()=>savedPeer(f.app.store.state,f.chatId,'model:'+f.modelId),/archived/);
  assert.equal((await f.post('/api/command',{type:'personal.create',payload:{name:'new',modelId:f.modelId,baseIdentity:'synthetic/base'}})).status,400);
  assert.equal((await f.post('/api/command',{type:'root.model',payload:{id:f.rootId,modelId:f.modelId}})).status,400);
  assert.equal(f.requests.length,0);assert.equal(f.app.store.state.drafts[f.chatId],'Unsent 🌱');
  const backup=await f.post('/api/storage/backup');assert.equal(backup.status,201);assert.equal((await f.post('/api/storage/verify',{id:backup.body.backup.id})).status,200);
  await f.app.dispose();const store=new Store(f.dataDir);await store.open();t.after(()=>store.close());assert.equal(archiveRecord(store.state,f.modelId).archived,true);assert.deepEqual(store.state.messages,before.messages);
});
test('shared connections require exact acknowledged personal entries; unrelated same-base models remain active',async t=>{
  const f=await setup(t);await f.command('personal.create',{name:'Aster shared',modelId:f.modelId,baseIdentity:'synthetic/base'});
  const bad=payload(f,{personalIds:[f.personId]});assert.equal((await f.post('/api/command',{type:'modelArchive.archive',payload:bad})).status,400);
  await f.command('model.save',{name:'Different identity',model:'synthetic-model',baseUrl:f.app.store.state.models[0].baseUrl});const other=f.app.store.state.models.at(-1).id;
  await f.command('personal.create',{name:'Different person',modelId:other,baseIdentity:'synthetic/base'});
  const fresh=payload(f);await f.command('modelArchive.archive',fresh);assert.deepEqual(activeModels(f.app.store.state).map(m=>m.id),[other]);assert.equal(visiblePersonalModels(f.app.store.state).length,1);
  assert.equal((await f.post('/api/command',{type:'modelArchive.archive',payload:fresh})).status,400);
});
test('returning visibility never asserts that absent files have been restored',async t=>{
  const f=await setup(t);await f.command('modelArchive.archive',payload(f,{files:'elsewhere',copies:[{label:'Main',path:'X:\\Example snapshot',checkedAt:null,manifestSha256:null,logicalBytes:12}]}));
  await f.command('modelArchive.restore',{modelId:f.modelId,baseRevision:archiveRevision(f.app.store.state)});
  assert.equal(activeModels(f.app.store.state).length,1);assert.throws(()=>resolveRecorder(f.app.store.state,f.chatId,'model:'+f.modelId),/Files archived/);assert.equal(f.requests.length,0);
  await f.command('modelArchive.filesReady',{modelId:f.modelId,baseRevision:archiveRevision(f.app.store.state)});assert.equal(resolveRecorder(f.app.store.state,f.chatId,'model:'+f.modelId).model.id,f.modelId);assert.equal(f.requests.length,0);
  const original=structuredClone(f.app.store.state.modelArchives);
  await assert.rejects(f.app.store.transact(s=>{s.modelArchives[0].copies[0].path='changed';return s;}),/cannot be rewritten/);assert.deepEqual(f.app.store.state.modelArchives,original);
  assert.equal((await f.post('/api/command',{type:'model.delete',payload:{id:f.modelId}})).status,400);
});
test('active replies hold archival changes and preserve the requested draft',async t=>{
  const f=await setup(t),gate=deferred(),entered=deferred();f.handler=async(_,res)=>{entered.resolve();await gate.promise;res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:'Synthetic completion'},finish_reason:'stop'}]}));};
  const request=f.post('/api/exchange',{requestId:'archive_active_probe',chatId:f.chatId,content:'Working',speaker:'personal',baseRevisionId:f.app.store.state.chats[0].table.assignments.at(-1).id,lastMessageId:f.app.store.state.messages.at(-1).id});await Promise.race([entered.promise,request.then(r=>{throw Error(JSON.stringify(r));})]);
  try{const r=await f.post('/api/command',{type:'modelArchive.archive',payload:payload(f)});assert.equal(r.status,400);assert.match(r.body.error,/already working/);assert.equal(f.app.store.state.modelArchives,undefined);}finally{gate.resolve();await request;}
});
test('malformed archive locations and stale actions cannot mutate saved state',async t=>{
  const f=await setup(t),before=structuredClone(f.app.store.state);
  for(const extra of [{copies:[{path:'x'}]},{files:'ready'},{copies:[],authority:'execute'},{personalIds:[f.personId,f.personId]}]){const r=await f.post('/api/command',{type:'modelArchive.archive',payload:payload(f,extra)});assert.equal(r.status,400);assert.deepEqual(f.app.store.state,before);}
});
