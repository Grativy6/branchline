import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred } from './helpers.mjs';
import { activeCarry, readyCarry, chatMessages } from '../server/context-carry.mjs';
import { validateState } from '../server/domain.mjs';
import { carrySettings } from '../public/resource-settings.js';
import { recorderSelect } from '../public/recorder.js';
import { validSettingsSize } from '../public/settings-size.js';
import { profileDestination } from '../server/agent-profiles.mjs';
import { currentAssignment, lastMessageId } from '../server/table.mjs';

async function setup(t) {
  const f = await fixture(t);
  await f.command('model.save', { name: 'Outside reviewer', model: 'reviewer-model', baseUrl: f.app.store.state.models[0].baseUrl });
  f.reviewer = f.app.store.state.models.at(-1);
  for (let i=0;i<12;i++) await f.command('message.note',{chatId:f.chatId,content:`Source ${i}: consideration is not a decision. `+'The route remains open, with its correction and attribution. '.repeat(55)});
  await f.command('draft.save',{chatId:f.chatId,text:'Unsent and private to the composer.'});
  f.input = speaker => ({chatId:f.chatId,speaker,baseId:activeCarry(f.app.store.state,f.chatId)?.id??null,lastMessageId:chatMessages(f.app.store.state,f.chatId).at(-1).id});
  f.responseText=JSON.stringify({account:'The choice remains open, following the original distinction [M1].'});
  return f;
}

test('outside recorder writes attributed shared carry without taking a chair; next reply activates it',async t=>{
  const f=await setup(t), before=structuredClone(f.app.store.state), choice='model:'+f.reviewer.id;
  await f.command('chat.carrySettings',{id:f.chatId,settings:{...carrySettings(before.chats[0]),speaker:choice}});
  const result=await f.post('/api/context-carry/prepare',f.input(choice));assert.equal(result.status,200,JSON.stringify(result.body));
  const ready=readyCarry(f.app.store.state,f.chatId);assert(ready);assert.equal(activeCarry(f.app.store.state,f.chatId),null);
  assert.equal(ready.recorder.role,'reviewer');assert.equal(ready.modelLabel,f.reviewer.name);
  assert.equal(f.requests[0].model,'reviewer-model');assert.equal(f.requests[0].tools,undefined);
  assert.match(f.requests[0].messages[0].content,/outside reviewer/);
  assert(!JSON.stringify(f.requests[0]).includes(before.drafts[f.chatId]));
  for(const key of ['messages','drafts','roots','models'])assert.deepEqual(f.app.store.state[key],before[key]);
  const task=f.app.store.state.handoffs.records.find(r=>r.kind==='ui.intent').detail.task;
  assert.deepEqual(task.allowedEffects,['record_context_account']);assert.equal(task.selection.seat,'recorder');
  f.responseText='A reply after the reviewed account.';
  const reply=await f.post('/api/exchange',{chatId:f.chatId,content:'Continue with the uncertainty intact.'});assert.equal(reply.status,200,JSON.stringify(reply.body));
  assert.equal(activeCarry(f.app.store.state,f.chatId).id,ready.id);
  assert.equal(f.requests.at(-1).model,before.models[0].model);
  assert(f.requests.at(-1).messages.some(m=>m.content.includes('written by an outside reviewer')));
  assert.deepEqual(f.app.store.state.messages.slice(0,before.messages.length),before.messages);
  validateState(f.app.store.state);
});

test('outside recorder queued behind a reply is held if its saved choice changes',async t=>{
  const f=await setup(t), entered=deferred(), release=deferred(); t.after(()=>release.resolve());
  const choice='model:'+f.reviewer.id;
  await f.command('chat.carrySettings',{id:f.chatId,settings:{...carrySettings(f.app.store.state.chats[0]),speaker:choice}});
  const frozen=f.input(choice);
  f.handler=async(_body,res)=>{entered.resolve();await release.promise;res.end(JSON.stringify({choices:[{message:{content:'A completed ordinary reply.'},finish_reason:'stop'}]}));};
  const reply=f.post('/api/exchange',{chatId:f.chatId,content:'A reply while the recorder waits.'});await entered.promise;
  const queued=await f.post('/api/context-carry/start',frozen);assert.equal(queued.body.status,'queued');
  const change={id:f.chatId,settings:{...carrySettings(f.app.store.state.chats[0]),speaker:'visiting'}};
  assert.equal((await f.post('/api/command',{type:'chat.carrySettings',payload:change})).status,400);
  // Simulate a state change after enqueue to test the dispatch recheck itself.
  await f.app.store.transact(state=>{state.chats[0].carrySettings=change.settings;return state;});
  release.resolve();assert.equal((await reply).status,200);
  for(let i=0;i<60;i++){if(f.app.reflections.status(f.chatId).result?.error)break;await new Promise(r=>setTimeout(r,20));}
  assert.match(f.app.reflections.status(f.chatId).result?.error ?? '',/changed while queued/);
  assert.equal(f.requests.length,1);assert.equal(readyCarry(f.app.store.state,f.chatId),null);
  assert.equal(f.app.store.state.drafts[f.chatId],'Unsent and private to the composer.');
});

test('outside reviewer cannot receive selected profile history without its own sharing clearance',async t=>{
  const f=await setup(t), model=f.app.store.state.models[0];
  await f.command('personal.create',{name:'Synthetic personal',modelId:model.id,baseIdentity:'synthetic/base'});
  const personal=f.app.store.state.personalParticipants[0];
  await f.command('table.assign',{chatId:f.chatId,baseRevisionId:null,personalId:personal.id,visitorModelId:model.id});
  await f.command('profile.import',{bundle:{schema:'branchline.agent-profile/1',name:'Private synthetic guidance',description:'Fixture',entries:[{path:'AGENTS.md',role:'guidance',scope:'agent',text:'Keep the synthetic violet shelf.',source:null}]},replaces:null});
  await f.command('profile.connect',{personalId:personal.id,baseSelectionId:null,profileId:f.app.store.state.agentProfiles.profiles[0].id,paths:['AGENTS.md'],models:[{id:model.id,destination:profileDestination(model)}]});
  f.responseText='Recorded selected guidance.';
  assert.equal((await f.post('/api/exchange',{chatId:f.chatId,speaker:'personal',kind:'send',requestId:'request_profile_recorder',baseRevisionId:currentAssignment(f.app.store.state,f.chatId).id,lastMessageId:lastMessageId(f.app.store.state,f.chatId),content:'Record this.'})).status,200);
  const calls=f.requests.length, originals=structuredClone(f.app.store.state.messages);
  const result=await f.post('/api/context-carry/prepare',f.input('model:'+f.reviewer.id));
  assert.notEqual(result.status,200);assert.match(result.body.error,/sharing|not cleared/i);assert.equal(f.requests.length,calls);
  assert.deepEqual(f.app.store.state.messages,originals);assert.equal(readyCarry(f.app.store.state,f.chatId),null);
});

test('participant brief is distinct and recorder source/identity cannot be silently changed',async t=>{
  const f=await setup(t);
  const result=await f.post('/api/context-carry/prepare',f.input('visiting'));assert.equal(result.status,200,JSON.stringify(result.body));
  const record=readyCarry(f.app.store.state,f.chatId);assert.equal(record.recorder.role,'participant');
  assert.match(f.requests[0].messages[0].content,/participant account from the Visiting chair/);
  const forged=structuredClone(f.app.store.state);forged.contextCarry.records[0].recorder.role='reviewer';assert.throws(()=>validateState(forged),/generation record/);
  const missing=await f.post('/api/context-carry/prepare',f.input('model:missing'));assert.notEqual(missing.status,200);assert.equal(f.requests.length,1);
});

test('changing an outside recorder in flight holds its result and preserves originals and draft',async t=>{
  const f=await setup(t), entered=deferred(), release=deferred(), originals=structuredClone(f.app.store.state.messages);
  t.after(()=>release.resolve());
  f.handler=async(_body,res)=>{entered.resolve();await release.promise;res.end(JSON.stringify({choices:[{message:{content:f.responseText},finish_reason:'stop'}]}));};
  const pending=f.post('/api/context-carry/prepare',f.input('model:'+f.reviewer.id));await entered.promise;
  await f.command('model.save',{id:f.reviewer.id,name:f.reviewer.name,model:'replacement-model',baseUrl:f.reviewer.baseUrl});release.resolve();
  const result=await pending;assert.notEqual(result.status,200);assert.equal(readyCarry(f.app.store.state,f.chatId),null);
  assert.deepEqual(f.app.store.state.messages,originals);assert.equal(f.app.store.state.drafts[f.chatId],'Unsent and private to the composer.');
});

test('automatic outside recorder binds saved connection; Settings geometry stays local and bounded',async t=>{
  const f=await setup(t), s=f.app.store.state, choice='model:'+f.reviewer.id;
  await f.command('chat.carrySettings',{id:f.chatId,settings:{...carrySettings(s.chats[0]),speaker:choice,automatic:true}});
  const saved=f.app.store.state.chats[0].carryWriter;assert.match(saved,/^[a-f0-9]{64}$/);
  const markup=recorderSelect(f.app.store.state,f.app.store.state.chats[0]);assert.match(markup,/outside reviewer/);assert.match(markup,/selected/);
  await f.command('root.model',{id:f.rootId,modelId:f.reviewer.id});
  const seated=recorderSelect(f.app.store.state,f.app.store.state.chats[0]);assert.match(seated,/Saved reviewer.*now in the Visiting chair/);assert(!seated.includes('Saved recorder unavailable'));
  await f.command('ui.update',{settingsSize:{width:930,height:510}});assert.deepEqual(f.app.store.state.ui.settingsSize,{width:930,height:510});
  assert.equal((await f.post('/api/command',{type:'ui.update',payload:{settingsSize:{width:NaN,height:10}}})).status,400);
  assert.equal(validSettingsSize({width:1000000,height:100}),false);
  await f.command('ui.update',{settingsSize:null});assert.equal(f.app.store.state.ui.settingsSize,null);
  assert.equal(f.requests.length,0);
});
