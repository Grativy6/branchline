import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { Store } from '../server/store.mjs';
import { harnessSnapshot } from '../server/harnesses.mjs';
import { harnessChoice } from '../public/harness-catalog.js';
import { previewHarnessImport, exportHarness } from '../server/harness-files.mjs';
import { POCKET_PROFILE, BUILTIN_PROVIDER } from '../public/coat-pockets.js';
import { COAT_PROFILE, HARNESS_PROFILE } from '../public/harness-format.js';
import { makeToolContract, validToolContract } from '../server/tool-contract.mjs';
import { turnOptions } from '../public/table.js';
import { currentAssignment } from '../server/table.mjs';
import { agentSettings } from '../server/parallel-state.mjs';

const binding = tool => ({ tool, provider: BUILTIN_PROVIDER });
const pockets = (...tools) => ({ profile: POCKET_PROFILE, selected: tools.map(binding) });
const content = (...tools) => ({ name: 'Synthetic Coat', description: '', instructions: 'Use evidence and explain clearly.', pockets: pockets(...tools) });
const use = (f, seat = 'shared') => ({ chatId: f.chatId, baseRevisionId: harnessChoice(f.app.store.state.chats[0]).id, seat });
const coat = async (f, tools, seat = 'shared', extra = {}) => { await f.command('harness.create', { content: { ...content(...tools), ...extra }, use: use(f, seat) }); return f.app.store.state.customHarnesses.at(-1).id; };
const offered = body => (body.tools ?? []).map(t => t.function.name);
const wire = (res, calls = null) => {
  res.writeHead(200, {'content-type': 'text/event-stream'});
  const delta = calls ? {tool_calls:calls.map((c,index)=>({index,id:'call_'+index,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))} : {content:'A complete synthetic answer.'};
  res.end('data: '+JSON.stringify({choices:[{delta,finish_reason:calls?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n');
};
const send = (f, extra = {}) => f.post('/api/exchange', {chatId:f.chatId,content:'Synthetic task',toolsEnabled:true,...extra});
const file = doc => ({name:'coat.json',base64:Buffer.from(JSON.stringify(doc)).toString('base64')});
async function table(f) {
  const model=f.app.store.state.models[0];
  await f.command('model.save', {name:'Second synthetic',model:'synthetic-two',baseUrl:model.baseUrl});
  await f.command('personal.create',{name:'Synthetic personal',modelId:model.id,baseIdentity:'synthetic/base'});
  await f.command('table.assign',{chatId:f.chatId,baseRevisionId:null,personalId:f.app.store.state.personalParticipants[0].id,visitorModelId:f.app.store.state.models[1].id});
}
const turn = (f, seat='personal', kind='send') => turnOptions(f.app.store.state,f.app.store.state.chats[0],seat,kind);

test('legacy Coats keep exact old snapshots and file format after a pockets revision and full journal replay',async t=>{
  const f=await fixture(t), legacy=content(); delete legacy.pockets;
  await f.command('harness.create',{content:legacy,use:use(f)});
  const id=f.app.store.state.customHarnesses[0].id, before=harnessSnapshot(f.app.store.state,f.chatId);
  await f.exchange(); const old=structuredClone(f.app.store.state.exchanges[0]);
  await f.command('harness.revise',{id,baseVersion:1,content:content('read_clock')});
  assert.deepEqual(harnessSnapshot(f.app.store.state,f.chatId),before);
  assert.equal(Object.hasOwn(before.preset,'pockets'),false);
  assert.equal(JSON.parse(exportHarness(f.app.store.state,{id,version:1}).text).profile,HARNESS_PROFILE);
  const exported=JSON.parse(exportHarness(f.app.store.state,{id,version:2}).text);
  assert.equal(exported.profile,COAT_PROFILE);assert.deepEqual(previewHarnessImport(file(exported)).content,content('read_clock'));
  const state=structuredClone(f.app.store.state);await f.app.store.close();
  const replay=new Store(f.dataDir,{checkpoints:false});await replay.open();
  assert.deepEqual(replay.state,state);assert.deepEqual(replay.state.exchanges[0],old);await replay.close();
});

test('Both uses each model exact pockets; swapping away and back restores them; a changed Coat holds the follow-up',async t=>{
  const f=await fixture(t);await table(f);await coat(f,['read_clock'],'personal');await coat(f,['run_calculation'],'visiting');
  await f.command('table.replySettings',{chatId:f.chatId,baseRevisionId:currentAssignment(f.app.store.state,f.chatId).id,mode:'both',speaker:'personal'});
  f.handler=(_body,res)=>wire(res);
  assert.equal((await send(f,turn(f))).status,200);const parent=f.app.store.state.exchanges.at(-1);
  const follow={...turn(f,'visiting','ask'),requestId:parent.request.followUp.requestId,replyMode:'single',followUpOf:parent.id};
  assert.equal((await send(f,{...follow,content:undefined})).status,200);
  assert.deepEqual(offered(f.requests[0]),['read_clock']);assert.deepEqual(offered(f.requests[1]),['run_calculation']);
  await f.command('table.assign',{chatId:f.chatId,baseRevisionId:currentAssignment(f.app.store.state,f.chatId).id,personalId:f.app.store.state.personalParticipants[0].id,visitorModelId:f.app.store.state.models[0].id});
  const contract=makeToolContract(f.app.store.state,{chatId:f.chatId,model:f.app.store.state.models[0],enabled:true,seat:'visiting'});
  assert.notDeepEqual(contract.tools,['run_calculation']);assert(validToolContract(contract,f.app.store.state.models[0]));
  await f.command('table.assign',{chatId:f.chatId,baseRevisionId:currentAssignment(f.app.store.state,f.chatId).id,personalId:f.app.store.state.personalParticipants[0].id,visitorModelId:f.app.store.state.models[1].id});
  assert.deepEqual(makeToolContract(f.app.store.state,{chatId:f.chatId,model:f.app.store.state.models[1],enabled:true,seat:'visiting'}).tools,['run_calculation']);
  await f.command('table.replySettings',{chatId:f.chatId,baseRevisionId:currentAssignment(f.app.store.state,f.chatId).id,mode:'both',speaker:'personal'});
  assert.equal((await send(f,turn(f))).status,200);const pending=f.app.store.state.exchanges.at(-1);
  const stale={...turn(f,'visiting','ask'),requestId:pending.request.followUp.requestId,replyMode:'single',followUpOf:pending.id};
  await coat(f,[],'visiting');
  assert.equal((await send(f,{...stale,content:undefined})).status,400);assert.equal(f.requests.length,3);
});

test('Tools switch, empty pockets, and agent opt-ins remain independent',async t=>{
  const f=await fixture(t);await coat(f,['read_clock']);f.handler=(_body,res)=>wire(res);
  await send(f,{toolsEnabled:false});assert.deepEqual(offered(f.requests[0]),[]);
  await coat(f,[], 'shared', {instructions:''});await send(f);assert.deepEqual(offered(f.requests[1]),[]);
  assert.equal(agentSettings(f.app.store.state).enabled,false);
  await f.command('parallel.settings',{baseRevisionId:agentSettings(f.app.store.state).id,enabled:true,automaticRequests:true,confirmAutomatic:true});
  await send(f);assert.deepEqual(offered(f.requests[2]),['request_parallel_approach','request_hearth']);
  const saved=structuredClone(f.app.store.state.customHarnesses);
  await f.command('parallel.settings',{baseRevisionId:agentSettings(f.app.store.state).id,enabled:false,automaticRequests:false,confirmAutomatic:false});
  assert.deepEqual(f.app.store.state.customHarnesses,saved);
});

test('unavailable providers survive round-trip without substitution; imports cannot carry executable grants or credentials',async t=>{
  const f=await fixture(t), unknown={profile:POCKET_PROFILE,selected:[{tool:'read_clock',provider:'example.external/1'},{tool:'future_tool',provider:'example.plugin/1'}]};
  const id=await coat(f,[], 'shared', {pockets:unknown});
  const doc=JSON.parse(exportHarness(f.app.store.state,{id,version:1}).text);
  assert.deepEqual(previewHarnessImport(file(doc)).content.pockets,unknown);
  f.handler=(body,res)=>{assert.deepEqual(offered(body),[]);wire(res);};assert.equal((await send(f)).status,200);
  for(const modify of [d=>{d.pockets.selected[0].token='secret';},d=>{d.pockets.permission='execute';},d=>{d.pockets.selected.push(d.pockets.selected[0]);},d=>{d.endpoint='https://example.com';},d=>{d.profile='branchline.coat/99';},d=>{d.profile=HARNESS_PROFILE;}]) {
    const bad=structuredClone(doc);modify(bad);assert.throws(()=>previewHarnessImport(file(bad)));
  }
});

test('a model attempting an excluded public-page tool gets a refusal with no network effect, then continues',async t=>{
  let connections=0;const f=await fixture(t,{modelOptions:{pageReader:async()=>{connections++;return {text:'Must not run'};}}});
  await coat(f,['read_clock']);let round=0;
  f.handler=(body,res)=>{
    assert.deepEqual(offered(body),['read_clock']);
    if(round++===0)return wire(res,[{name:'fetch_public_page',args:{url:'https://example.com',reason:'Excluded tool attempt'}}]);
    const reply=JSON.parse(body.messages.at(-1).content);assert.equal(reply.ok,false);assert.match(reply.error,/not available/);wire(res);
  };
  assert.equal((await send(f)).status,200);assert.equal(connections,0);assert.equal(round,2);
  assert.equal(f.app.store.state.handoffs.records.some(r=>r.kind==='operation.started'&&r.detail.tool==='fetch_public_page'),false);
});

test('model-requested peers intersect their own Coat with the originating tools instead of regaining excluded tools',async t=>{
  const f=await fixture(t);await table(f);await coat(f,['read_clock'],'personal');await coat(f,['read_clock','run_calculation'],'visiting');
  await f.command('parallel.settings',{baseRevisionId:agentSettings(f.app.store.state).id,enabled:true,automaticRequests:true,confirmAutomatic:true});
  let original=0, peer=0;
  f.handler=(body,res)=>{
    if(body.messages.some(m=>m.content?.startsWith('[Branchline task view:'))) {peer++;assert.deepEqual(offered(body),['read_clock']);return wire(res);}
    if(original++===0)return wire(res,[{name:'request_parallel_approach',args:{model_id:f.app.store.state.models[1].id,angle:'Check the timeline.',reason:'A second angle helps.'}}]);
    assert.equal(JSON.parse(body.messages.at(-1).content).ok,true);wire(res);
  };
  assert.equal((await send(f,turn(f))).status,200);
  for(let i=0;i<300&&f.app.store.state.parallel.runs.some(r=>['queued','running'].includes(r.status));i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(peer,1);assert.equal(f.app.store.state.parallel.runs[0].status,'completed');
  const saved=f.app.store.state.parallel.jobs[0].toolContract;assert.deepEqual(saved.ceiling,[binding('read_clock')]);
  assert.deepEqual(saved.coat.pockets,pockets('read_clock','run_calculation'));
});
