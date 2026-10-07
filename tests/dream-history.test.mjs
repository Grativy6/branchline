import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred } from './helpers.mjs';
import { dreamRevision, dreamView } from '../server/dream-history.mjs';
import { currentAssignment, lastMessageId } from '../server/table.mjs';
import { BUNDLED_PROFILE } from '../server/bundled-profile.mjs';
import { visiblePersonalModels } from '../public/dream-records.js';
import { Store } from '../server/store.mjs';
import { resolvedCoat } from '../public/harness-catalog.js';
import { profileDestination } from '../server/agent-profiles.mjs';

async function setup(t) {
  const runner={available:false,manifest:{profile:'synthetic-restore-check'},open:async()=>{},status(){return {available:this.available};},
    verify:async()=>{},ensure:async()=>{},beforeOtherLocal:async()=>{},close:async()=>{},cancel:async()=>{},stop:async()=>{}};
  const f=await fixture(t,{modelOptions:{localRunner:runner}});f.runner=runner;
  await f.command('personal.create',{name:'Aster',modelId:f.app.store.state.models[0].id,baseIdentity:'synthetic/base'});
  f.personalId=f.app.store.state.personalParticipants[0].id;
  await f.command('table.assign',{chatId:f.chatId,baseRevisionId:null,personalId:f.personalId,visitorModelId:null});
  f.dream=async(type,p={})=>f.command(type,{personalId:f.personalId,baseRevision:dreamRevision(f.app.store.state),...p});
  f.record=async(p={})=>f.dream('dream.record',{topic:'Synthetic garden lesson',occurredAt:'2026-10-01T12:00:00Z',summary:'Selected garden discussion.',observations:'No training took place in this test.',outcome:'unadopted',modelId:null,sources:[],...p});
  return f;
}
test('recording and reviewing a Dream does not activate it or call a model; notes and origin are separate',async t=>{
  const f=await setup(t),initial=structuredClone(f.app.store.state.personalParticipants[0]);
  await f.record({outcome:'applied'});
  assert.deepEqual(f.app.store.state.personalParticipants[0],initial);
  const d=f.app.store.state.dreamHistory.records[0];
  await f.dream('dream.note',{dreamId:d.id,text:'My editable note.',baseNoteId:null});
  const before=structuredClone(f.app.store.state);
  const response=await fetch(f.url+'/api/dreams/view?id='+f.personalId,{headers:f.headers}),view=await response.json();
  assert.equal(view.origin.adapterStatus,'unknown');assert.equal(view.notes[0].text,'My editable note.');
  assert.deepEqual(f.app.store.state,before);assert.equal(f.requests.length,0);
  await f.dream('dream.origin',{origin:{baseModel:'supplied/base',baseRevision:'rev1',adapterStatus:'none',adapterIdentifier:'',adapterDigest:null,evidence:'User supplied.',claimedStartedAt:'2026-01-01T00:00:00Z'}});
  assert.equal(dreamView(f.app.store.state,f.personalId).origin.standing,'user_declared');
  assert.equal(f.app.store.state.dreamHistory.records[0].summary,d.summary);
  const exportResponse=await fetch(f.url+'/api/dreams/export?id='+f.personalId,{headers:f.headers});
  assert.equal((await exportResponse.json()).format,'branchline.dream-history/1');
});
test('malformed records, note conflicts and attempted direct restore cannot mutate history',async t=>{
  const f=await setup(t);await f.record();const d=f.app.store.state.dreamHistory.records[0];
  const rev=dreamRevision(f.app.store.state),base={personalId:f.personalId,baseRevision:rev};
  for(const [type,p]of [['dream.note',{dreamId:d.id,text:'x',baseNoteId:'wrong'}],['dream.restore',{dreamId:d.id}],['dream.record',{topic:'x',sources:[],authority:'grant'}]]) {
    const before=structuredClone(f.app.store.state),r=await f.post('/api/command',{type,payload:{...base,...p}});assert.equal(r.status,400);assert.deepEqual(f.app.store.state,before);
  }
  await f.dream('dream.note',{dreamId:d.id,text:'first',baseNoteId:null});
  const stale=await f.post('/api/command',{type:'dream.note',payload:{...base,dreamId:d.id,text:'stale',baseNoteId:null}});
  assert.equal(stale.status,400);
  await assert.rejects(f.app.store.transact(s=>{s.dreamHistory.records[0].summary='rewritten';return s;}),/cannot be rewritten/);
  await assert.rejects(f.app.store.transact(s=>{s.dreamHistory.notes=[];return s;}),/cannot be rewritten/);
});
test('explicit organization keeps same-base identities separate until confirmed, preserving replies and coats',async t=>{
  const f=await setup(t);await f.command('personal.create',{name:'Aster old experiment',modelId:f.app.store.state.models[0].id,baseIdentity:'synthetic/base'});
  const member=f.app.store.state.personalParticipants.at(-1).id;
  await f.command('table.assign',{chatId:f.chatId,baseRevisionId:currentAssignment(f.app.store.state,f.chatId).id,personalId:member,visitorModelId:null});
  const firstReply=await f.post('/api/exchange',{chatId:f.chatId,speaker:'personal',kind:'send',content:'Synthetic greeting',requestId:'before-group',baseRevisionId:currentAssignment(f.app.store.state,f.chatId).id,lastMessageId:null});
  assert.equal(firstReply.status,200,JSON.stringify(firstReply.body));
  const original=structuredClone(f.app.store.state.messages),exchanges=structuredClone(f.app.store.state.exchanges);
  const coat=resolvedCoat(f.app.store.state,f.app.store.state.chats[0],'personal').ref;
  assert.equal(visiblePersonalModels(f.app.store.state).length,2);
  const p={personalId:f.personalId,baseRevision:dreamRevision(f.app.store.state),members:[member],evidence:'I associate this earlier test with Aster.'};
  const before=structuredClone(f.app.store.state),preview=await f.post('/api/dreams/organize-preview',p);
  assert.equal(preview.status,200);assert.deepEqual(f.app.store.state,before);
  await f.command('dream.organize',p);assert.equal(visiblePersonalModels(f.app.store.state).length,1);
  assert.deepEqual(f.app.store.state.messages,original);assert.deepEqual(f.app.store.state.exchanges,exchanges);
  assert.equal(currentAssignment(f.app.store.state,f.chatId).personalId,f.personalId);
  assert.deepEqual(resolvedCoat(f.app.store.state,f.app.store.state.chats[0],'personal').ref,coat);
  assert.equal(f.app.store.state.dreamHistory.records[0].occurredAt,null);
  const nextReply=await f.post('/api/exchange',{chatId:f.chatId,speaker:'personal',kind:'ask',requestId:'after-group',baseRevisionId:currentAssignment(f.app.store.state,f.chatId).id,lastMessageId:lastMessageId(f.app.store.state,f.chatId)});
  assert.equal(nextReply.status,200,JSON.stringify(nextReply.body));
  assert.match(JSON.stringify(f.requests.at(-1).messages),/Earlier recorded state of the same personal model/);
  await f.dream('dream.unlink',{memberId:member,evidence:'Keep separate after review.'});
  assert.equal(visiblePersonalModels(f.app.store.state).length,2);assert.deepEqual(f.app.store.state.messages.slice(0,original.length),original);
});
test('cancelled recovery and all-stop cannot activate a state; competing model work is held',async t=>{
  const f=await setup(t);await f.command('model.save',{...BUNDLED_PROFILE});await f.record({modelId:f.app.store.state.models.at(-1).id});f.runner.available=true;
  const d=f.app.store.state.dreamHistory.records[0],before=f.app.store.state.personalParticipants[0].currentGenerationId,entered=deferred();
  f.runner.verify=async signal=>{entered.resolve();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('Verification cancelled.')),{once:true}));};
  const pending=f.post('/api/dreams/restore',{personalId:f.personalId,dreamId:d.id,baseRevision:dreamRevision(f.app.store.state)});await entered.promise;
  const reply=await f.post('/api/exchange',{chatId:f.chatId,speaker:'personal',kind:'send',content:'Must not run during recovery.',requestId:'held-recovery',baseRevisionId:currentAssignment(f.app.store.state,f.chatId).id,lastMessageId:null});
  assert.equal(reply.status,400);assert.equal(f.requests.length,0);
  assert.equal((await f.post('/api/work/stop',{scope:'all'})).status,200);assert.equal((await pending).status,400);
  assert.equal(f.app.store.state.personalParticipants[0].currentGenerationId,before);assert.equal(f.app.store.state.dreamHistory.transitions.length,0);assert.equal(f.app.store.dreamRecoveryPending,false);
});
test('origin corrections and organization replay preserve all earlier evidence',async t=>{
  const f=await setup(t);const base={baseModel:'synthetic/base',baseRevision:'',adapterStatus:'unknown',adapterIdentifier:'',adapterDigest:null,evidence:'Declared source.',claimedStartedAt:null};
  await f.dream('dream.origin',{origin:base});const prior=structuredClone(f.app.store.state.dreamHistory.origins[0]);
  await f.dream('dream.origin',{origin:{...base,adapterStatus:'none',evidence:'Corrected from my own saved record.'}});
  assert.deepEqual(f.app.store.state.dreamHistory.origins[0],prior);assert.equal(dreamView(f.app.store.state,f.personalId).origin.adapterStatus,'none');
  await f.command('personal.create',{name:'A different person',modelId:f.app.store.state.models[0].id,baseIdentity:'synthetic/base'});
  const input={personalId:f.personalId,baseRevision:dreamRevision(f.app.store.state),members:[f.app.store.state.personalParticipants.at(-1).id],evidence:'Explicit synthetic relation.'};
  await f.command('dream.organize',input);const saved=structuredClone(f.app.store.state);
  assert.equal((await f.post('/api/command',{type:'dream.organize',payload:input})).status,400);assert.deepEqual(f.app.store.state,saved);
});
test('source reader is bounded to the recorded conversation cutoff, including archived sources',async t=>{
  const f=await setup(t);await f.command('message.note',{chatId:f.chatId,content:'Source before cutoff.'});
  const message=f.app.store.state.messages.at(-1);
  await f.record({sources:[{chatId:f.chatId,messageId:message.id}]});
  await f.command('message.note',{chatId:f.chatId,content:'Tail after the Dream source.'});
  const d=f.app.store.state.dreamHistory.records[0];
  const response=await fetch(f.url+`/api/dreams/source?id=${f.personalId}&dreamId=${d.id}&index=0`,{headers:f.headers});
  const body=await response.json();assert.equal(response.status,200);assert.equal(body.messages.length,1);assert.equal(body.nextOffset,null);
  assert.doesNotMatch(JSON.stringify(body),/Tail after/);
});
test('supported restore appends a checked transition; failed and stale checks keep prior state',async t=>{
  const f=await setup(t);await f.command('model.save',{...BUNDLED_PROFILE});const bundled=f.app.store.state.models.at(-1);
  await f.record({modelId:bundled.id});const d=f.app.store.state.dreamHistory.records[0];f.runner.available=true;
  const request=()=>({personalId:f.personalId,dreamId:d.id,baseRevision:dreamRevision(f.app.store.state)});
  const old=structuredClone(f.app.store.state),oldGeneration=old.personalParticipants[0].currentGenerationId;
  f.runner.verify=async()=>{throw new Error('Synthetic damaged file.');};
  assert.equal((await f.post('/api/dreams/restore',request())).status,400);assert.deepEqual(f.app.store.state,old);
  f.runner.verify=async()=>{};
  assert.equal((await f.post('/api/dreams/restore',request())).status,200);
  const after=f.app.store.state;assert.notEqual(after.personalParticipants[0].currentGenerationId,oldGeneration);
  assert.equal(after.personalParticipants[0].currentGenerationId,d.generationId);assert.equal(after.dreamHistory.transitions.length,1);
  assert.equal((await f.post('/api/dreams/restore',{personalId:f.personalId,dreamId:d.id,baseRevision:dreamRevision(old)})).status,400);
  const saved=structuredClone(after);await f.app.store.close();const reopened=new Store(f.dataDir);await reopened.open();assert.deepEqual(reopened.state,saved);await reopened.close();
});
test('different Agent profiles hold organization without combining their sources or choices',async t=>{
  const f=await setup(t);await f.command('personal.create',{name:'Earlier entry',modelId:f.app.store.state.models[0].id,baseIdentity:'synthetic/base'});const member=f.app.store.state.personalParticipants.at(-1).id;
  await f.command('profile.import',{replaces:null,bundle:{schema:'branchline.agent-profile/1',name:'Different guidance',description:'Synthetic profile conflict.',entries:[{path:'AGENTS.md',role:'guidance',scope:'agent',text:'A distinct user-approved instruction.',source:null}]}});
  await f.command('profile.connect',{personalId:member,baseSelectionId:null,profileId:f.app.store.state.agentProfiles.profiles[0].id,paths:['AGENTS.md'],models:f.app.store.state.models.map(m=>({id:m.id,destination:profileDestination(m)}))});
  const before=structuredClone(f.app.store.state),input={personalId:f.personalId,baseRevision:dreamRevision(before),members:[member],evidence:'A claimed connection with a conflicting profile.'};
  const preview=await f.post('/api/dreams/organize-preview',input);assert.equal(preview.status,200);assert.match(preview.body.conflicts.join(' '),/different Agent profile/);
  assert.equal((await f.post('/api/command',{type:'dream.organize',payload:input})).status,400);assert.deepEqual(f.app.store.state,before);
});
test('changed connection, wrong owner and save failure do not mark a checkpoint current',async t=>{
  const f=await setup(t);await f.command('model.save',{...BUNDLED_PROFILE});const model=f.app.store.state.models.at(-1);await f.record({modelId:model.id});const d=f.app.store.state.dreamHistory.records[0];f.runner.available=true;
  const request=personalId=>({personalId:personalId??f.personalId,dreamId:d.id,baseRevision:dreamRevision(f.app.store.state)});
  await f.command('personal.create',{name:'Someone else',modelId:model.id,baseIdentity:'synthetic/other'});
  assert.equal((await f.post('/api/dreams/restore',request(f.app.store.state.personalParticipants.at(-1).id))).status,400);
  const old=structuredClone(f.app.store.state);f.runner.ensure=async()=>{f.app.store.writeFault=new Error('Synthetic persistence failure.');};
  assert.equal((await f.post('/api/dreams/restore',request())).status,400);assert.deepEqual(f.app.store.state,old);f.app.store.writeFault=null;
  await f.command('model.save',{...model,name:'A corrected display label'});
  assert.equal((await f.post('/api/dreams/restore-preview',request())).status,400);assert.equal(f.app.store.state.dreamHistory.transitions.length,0);
});
