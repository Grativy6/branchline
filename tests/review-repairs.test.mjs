import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fixture, deferred } from './helpers.mjs';
import { Store } from '../server/store.mjs';
import { validateState, applyCommand } from '../server/domain.mjs';
import { carryBasis } from '../server/context-carry.mjs';
import { parallelBasis, agentSettings } from '../server/parallel-state.mjs';

async function until(predicate) {
  for (let i=0;i<250;i++) { if(predicate())return; await new Promise(r=>setTimeout(r,10)); }
  throw new Error('Condition did not settle.');
}

test('draft leaf updates keep history exact, enforce input limits and replay through the existing journal', async t => {
  const f=await fixture(t);
  await f.exchange('An attributed synthetic turn.');
  const before=structuredClone(f.app.store.state);
  const expected=applyCommand(before,{type:'draft.save',payload:{chatId:f.chatId,text:'Unsent words'}});
  await f.app.store.command({type:'draft.save',payload:{chatId:f.chatId,text:'Unsent words'}},{returnState:false});
  assert.deepEqual(f.app.store.state,expected);validateState(f.app.store.state);
  for(const payload of [{chatId:'missing',text:'x'},{chatId:f.chatId,text:7},{chatId:f.chatId,text:'x'.repeat(200001)}])
    await assert.rejects(f.app.store.command({type:'draft.save',payload}));
  await assert.rejects(f.app.store.command({type:'draft.save',payload:{chatId:f.chatId,text:'bad'},authority:'owner'}));
  assert.deepEqual(f.app.store.state,expected);
  await f.app.dispose();
  const reopened=new Store(f.dataDir);await reopened.open();
  try { assert.deepEqual(reopened.state,expected); } finally { await reopened.close(); }
});

test('an incomplete Coat is saved only as editing material and malformed drafts are refused',async t=>{
  const f=await fixture(t), draft={content:{name:' ',description:'unfinished',instructions:''},pocketsCustomized:false,branch:null,seat:'shared'};
  await f.command('ui.update',{coatDraft:draft});
  assert.deepEqual(f.app.store.state.ui.coatDraft,draft);
  assert.equal(f.app.store.state.customHarnesses,undefined);
  assert.equal(f.app.store.state.chats[0].harnessSelections,undefined);
  assert.equal((await f.post('/api/command',{type:'ui.update',payload:{coatDraft:{...draft,authority:'granted'}}})).status,400);
  await f.command('ui.update',{coatDraft:null});
  assert.equal(f.app.store.state.ui.coatDraft,null);
});

test('handoff basis follows its own journal and MIND account, still notices shared guidance and keeps legacy hashing',async t=>{
  const f=await fixture(t), original=f.app.store.state, other=structuredClone(original);
  other.roots[0].continuity={heart:[],journal:[{chatId:'sibling',text:'different topic'}]};
  other.mind={accounts:[{chatId:'sibling',text:'not in this prompt'}]};
  assert.equal(carryBasis(original,f.chatId),carryBasis(other,f.chatId));
  assert.notEqual(carryBasis(original,f.chatId,'legacy/1'),carryBasis(other,f.chatId,'legacy/1'));
  other.mind.accounts.push({chatId:f.chatId,text:'own account changed'});
  assert.notEqual(carryBasis(original,f.chatId),carryBasis(other,f.chatId));
  other.mind.accounts.pop();other.roots[0].continuity.heart.push({text:'shared guidance changed'});
  assert.notEqual(carryBasis(original,f.chatId),carryBasis(other,f.chatId));
});

test('unchanged context status returns 304 while draft and runtime preparation changes invalidate it',async t=>{
  const f=await fixture(t), url=f.url+'/api/context-carry?chatId='+f.chatId+'&speaker=visiting';
  let a=await fetch(url,{headers:f.headers});assert.equal(a.status,200);const tag=a.headers.get('etag');await a.json();
  a=await fetch(url,{headers:{...f.headers,'if-none-match':tag}});assert.equal(a.status,304);
  await f.command('draft.save',{chatId:f.chatId,text:'still mine'});
  a=await fetch(url,{headers:{...f.headers,'if-none-match':tag}});assert.equal(a.status,200);const changed=a.headers.get('etag');await a.json();
  f.app.reflections.suspended.add(f.chatId);
  a=await fetch(url,{headers:{...f.headers,'if-none-match':changed}});assert.equal(a.status,200);assert.equal((await a.json()).preparationState.paused,true);
});

for(const scope of ['other-branch','same-branch','all']) test('Stop during admission: '+scope,async t=>{
  const f=await fixture(t);
  await f.command('chat.create',{rootId:f.rootId,title:'Other branch'});const other=f.app.store.state.chats.at(-1).id;
  await f.command('parallel.settings',{baseRevisionId:agentSettings(f.app.store.state).id,enabled:true,automaticRequests:false,confirmAutomatic:false});
  const gate=deferred(), prior=f.app.store.writeChain;
  f.app.store.writeChain=prior.then(()=>gate.promise);const heldChain=f.app.store.writeChain;
  const input={requestId:'admission_race',chatId:f.chatId,content:'Two synthetic approaches.',
    approaches:[{seat:'legacy',angle:'one'},{seat:'legacy',angle:'two'}],toolsEnabled:false,cloudApproved:false,basisHash:parallelBasis(f.app.store.state,f.chatId)};
  const admitted=f.post('/api/parallel/start',input);
  try {
    await until(()=>f.app.parallel.preparing && f.app.store.writeChain!==heldChain);
    const stopped=scope==='all'?f.post('/api/work/stop',{scope:'all'}):f.post('/api/cancel',{chatId:scope==='same-branch'?f.chatId:other});
    await until(()=>scope==='all'?f.app.parallel.admissionEpoch>0:f.app.parallel.chatAdmissionEpochs.size>0);
    gate.resolve();
    const result=await admitted;
    assert.equal(result.status,scope==='other-branch'?202:400,JSON.stringify(result.body));
    if(scope!=='other-branch')assert.match(result.body.error,/stopped/);
    assert.equal((await stopped).status,scope==='all'?200:404); // No ordinary exchange was running; admission still stopped.
  } finally { gate.resolve();await admitted; }
});

test('shutdown drains an in-flight keep-alive request and releases the workspace lock',async t=>{
  const f=await fixture(t), entered=deferred();
  f.handler=(_body,res)=>{entered.resolve();res.on('close',()=>{});};
  const agent=new http.Agent({keepAlive:true,maxSockets:1});t.after(()=>agent.destroy());
  const request=(route,body)=>new Promise(resolve=>{
    const req=http.request(f.url+route,{method:body?'POST':'GET',agent,headers:{...f.headers,'content-type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    req.on('error',()=>resolve(null));req.end(body?JSON.stringify(body):undefined);
  });
  const pending=request('/api/exchange',{chatId:f.chatId,content:'Synthetic in-flight turn'});
  await entered.promise;
  const start=performance.now(), close=f.app.dispose(), poll=setInterval(()=>void request('/api/state'),150);
  try { await close;await pending;assert(performance.now()-start<6500); }
  finally {clearInterval(poll);agent.destroy();}
  await assert.rejects(fs.access(path.join(f.dataDir,'.writer.lock')),{code:'ENOENT'});
  const store=new Store(f.dataDir);await store.open();
  try { assert(store.state.messages.some(m=>m.content==='Synthetic in-flight turn')); } finally {await store.close();}
});
