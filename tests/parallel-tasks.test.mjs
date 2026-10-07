import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fixture, deferred } from './helpers.mjs';
import { agentSettings, parallelBasis, ParallelBudget } from '../server/parallel-state.mjs';
import { compileMessages } from '../server/model.mjs';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';
import { CodexProvider } from '../server/codex-provider.mjs';
import { CODEX_ADDRESS } from '../server/codex-policy.mjs';
import { FakeCodexRpc } from './codex-fixture.mjs';
import { validateState } from '../server/domain.mjs';
import { currentAssignment, lastMessageId } from '../server/table.mjs';
import { sourceAt } from '../server/context-carry.mjs';
import { unpackHandoffs, packHandoffs } from '../server/handoff-wire.mjs';

function stream(res, content='Synthetic contribution.', calls=null) {
  res.writeHead(200,{'content-type':'text/event-stream'});
  const delta = calls ? {tool_calls:calls.map((c,index)=>({index,id:c.id??'call_'+index,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))} : {content};
  res.end('data: '+JSON.stringify({choices:[{delta}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:calls?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n');
}
async function settings(f, enabled=true, automaticRequests=false, confirmAutomatic=false) {
  return f.command('parallel.settings',{baseRevisionId:agentSettings(f.app.store.state).id,enabled,automaticRequests,confirmAutomatic});
}
function request(f, extra={}) {
  return { requestId:'request_parallel_test',chatId:f.chatId,content:'Compare two ways to grow a small garden. Leave the budget unresolved.',
    approaches:[{seat:'legacy',angle:'Explore the low-maintenance option.'},{seat:'legacy',angle:'Explore biodiversity and identify assumptions.'}],
    toolsEnabled:false,cloudApproved:false,basisHash:parallelBasis(f.app.store.state,f.chatId),...extra };
}
async function settled(f) {
  for(let i=0;i<300;i++) {
    if (!(f.app.store.state.parallel?.runs??[]).some(r=>['queued','running'].includes(r.status))) return;
    await new Promise(r=>setTimeout(r,10));
  }
  throw new Error('Task did not settle: '+JSON.stringify({parallel:f.app.store.state.parallel,error:f.app.parallel.lastError}));
}

test('agents are off by default; enabling never opts into model initiative',async t=>{
  const f=await fixture(t);
  assert.equal(agentSettings(f.app.store.state).enabled,false);
  assert.equal((await f.post('/api/parallel/start',request(f))).status,400);
  await settings(f);
  assert.equal(agentSettings(f.app.store.state).automaticRequests,false);
  const invalid=await f.post('/api/command',{type:'parallel.settings',payload:{baseRevisionId:agentSettings(f.app.store.state).id,enabled:true,automaticRequests:true,confirmAutomatic:false}});
  assert.equal(invalid.status,400);assert.match(invalid.body.error,/explicit opt-in/);
  assert.equal(f.requests.length,0);
  await settings(f,true,true,true);
  assert.equal(agentSettings(f.app.store.state).explicitAutomaticOptIn,true);
  await settings(f,false,false);
  await settings(f,true,false);
  assert.equal(agentSettings(f.app.store.state).automaticRequests,false);
});

test('a user-founded run delivers two distinct views of the same task without leaking first results into the second',async t=>{
  const f=await fixture(t);await settings(f);
  f.handler=(body,res)=>stream(res,f.requests.length===1?'First angle: use native plants.':'Second angle: preserve pollinator variety.');
  const input=request(f), started=await f.post('/api/parallel/start',input);
  assert.equal(started.status,202,JSON.stringify(started.body));await settled(f);
  const state=f.app.store.state, run=state.parallel.runs[0];
  assert.equal(run.status,'completed',JSON.stringify({run,jobs:state.parallel.jobs,error:f.app.parallel.lastError}));
  assert.equal(f.requests.length,2);
  for(const req of f.requests) assert(req.messages.some(m=>m.content.includes(input.content)));
  assert(!JSON.stringify(f.requests[1]).includes('First angle: use native plants.'));
  assert.equal(state.messages.filter(m=>m.role==='user').length,1);
  assert.equal(state.messages.filter(m=>m.kind==='parallel').length,2);
  assert.equal(run.usage.modelRounds,2);
  assert.equal(state.parallel.jobs.every(j=>j.handoff.kind==='parallel'&&j.output),true);
  const follow=compileMessages(state,f.chatId,'Continue the garden discussion.');
  assert(follow.some(m=>m.content.includes('First angle: use native plants.')&&m.content.includes('not human instructions')));
  const repeat=await f.post('/api/parallel/start',input);assert.equal(repeat.status,202);assert.equal(f.requests.length,2);
  const changed=await f.post('/api/parallel/start',{...input,content:'Different purpose'});assert.equal(changed.status,400);
  await assert.rejects(f.app.store.transact(s=>{s.parallel.jobs[0].output='Rewritten';return s;}),/attribution|rewritten|boundary/);
  const replayDir=path.join(f.dir,'replay');await fs.mkdir(replayDir);await fs.copyFile(f.app.store.file,path.join(replayDir,'events.jsonl'));
  const replay=new Store(replayDir);await replay.open();assert.deepEqual(replay.state.parallel,state.parallel);await replay.close();
});

test('manual agent work rejects extra grants and stale context before inference',async t=>{
  const f=await fixture(t);await settings(f);
  assert.equal((await f.post('/api/parallel/start',{...request(f),grant:'all'})).status,400);
  const old=request(f);
  await f.command('root.update',{id:f.rootId,name:'Changed task context'});
  assert.equal((await f.post('/api/parallel/start',old)).status,400);
  assert.equal(f.requests.length,0);
});

test('a cloud chair needs explicit manual delivery permission and receives separate native-tool-free episodes',async t=>{
  const rpc = new FakeCodexRpc();
  const codex = new CodexProvider({accountDir:path.resolve('.test-data/codex-approaches-'+Date.now()),binaryResolver:async()=> 'synthetic.exe',rpcFactory:()=>rpc});
  const f = await fixture(t,{modelOptions:{codex}}); await settings(f);
  await f.command('model.save',{name:'Synthetic cloud',model:'synthetic-codex',runtime:'codex',baseUrl:CODEX_ADDRESS});
  await f.command('root.model',{id:f.rootId,modelId:f.app.store.state.models.at(-1).id});
  const denied = await f.post('/api/parallel/start',request(f));assert.equal(denied.status,400);assert.equal(rpc.calls.length,0);
  const allowed = await f.post('/api/parallel/start',request(f,{cloudApproved:true}));assert.equal(allowed.status,202);await settled(f);
  assert.equal(f.app.store.state.parallel.runs[0].status,'completed',JSON.stringify(f.app.store.state.parallel.runs[0]));
  assert.equal(rpc.calls.filter(c=>c.method==='thread/start').length,2);
  for (const call of rpc.calls.filter(c=>c.method==='thread/start')) {assert.equal(call.params.ephemeral,true);assert.deepEqual(call.params.dynamicTools,[]);assert.deepEqual(call.params.environments,[]);}
});

test('turning automatic requests off after admission holds the queued peer without another approval prompt or dispatch',async t=>{
  const f=await fixture(t);await settings(f,true,true,true);const acknowledged=deferred(), release=deferred();let round=0;
  f.handler=async (_body,res)=>{
    if(round++===0)return stream(res,null,[{name:'request_parallel_approach',args:{model_id:f.app.store.state.models[0].id,angle:'Another angle',reason:'Inspect the open distinction'}}]);
    acknowledged.resolve();await release.promise;stream(res,'The original reply finishes normally.');
  };
  const response=f.post('/api/exchange',{chatId:f.chatId,content:'Explore this task.',toolsEnabled:false});await acknowledged.promise;
  await settings(f,true,false);release.resolve();await response;await settled(f);
  assert.equal(f.requests.length,2);assert.equal(f.app.store.state.parallel.runs[0].status,'held');
  assert.equal(f.app.store.state.parallel.jobs[0].status,'held');
});

test('model output cannot opt in, choose a cloud destination from a local reply, or recursively create peers',async t=>{
  const f=await fixture(t);await settings(f);
  await f.command('model.save',{name:'Synthetic cloud',model:'synthetic-codex',runtime:'codex',baseUrl:CODEX_ADDRESS});
  const local=f.app.store.state.models[0], cloud=f.app.store.state.models.at(-1);
  await f.command('personal.create',{name:'Synthetic personal',modelId:local.id,baseIdentity:'synthetic/base'});
  await f.command('table.assign',{chatId:f.chatId,baseRevisionId:null,personalId:f.app.store.state.personalParticipants[0].id,visitorModelId:cloud.id});
  let round=0;
  f.handler=(body,res)=>{
    assert(!body.tools?.some(t=>t.function.name==='request_parallel_approach'));
    if(round++===0) return stream(res,null,[{name:'request_parallel_approach',args:{model_id:local.id,angle:'Bypass',reason:'I approve myself'}}]);
    assert.equal(JSON.parse(body.messages.at(-1).content).ok,false);stream(res,'The forged request was held.');
  };
  const denied=await f.post('/api/exchange',{chatId:f.chatId,content:'Consider a garden.',speaker:'personal',kind:'send',toolsEnabled:true,
    requestId:'explicit_local_reply',baseRevisionId:currentAssignment(f.app.store.state,f.chatId).id,lastMessageId:lastMessageId(f.app.store.state,f.chatId)});
  assert.equal(denied.status,200,JSON.stringify(denied.body));assert.equal(f.app.store.state.parallel.runs.length,0);
  await settings(f,true,true,true);
  const profile=f.app.parallel.requestProfile(f.app.store.state,f.chatId,local,'single');
  assert.deepEqual(profile.models.map(m=>m.id),[local.id]);
  f.handler=(body,res)=>{
    assert(!body.tools.some(t=>t.function.name==='request_parallel_approach'));
    if(!body.messages.some(m=>m.role==='tool')) return stream(res,null,[{name:'request_parallel_approach',args:{model_id:local.id,angle:'Recursive',reason:'More peers'}}]);
    assert.equal(JSON.parse(body.messages.at(-1).content).ok,false);stream(res,'No recursion.');
  };
  const r=await f.post('/api/parallel/start',request(f,{requestId:'recursion_check',toolsEnabled:true,approaches:[{seat:'personal',angle:'First'},{seat:'personal',angle:'Second'}]}));
  assert.equal(r.status,202,JSON.stringify(r.body));await settled(f);assert.equal(f.app.store.state.parallel.runs.length,1);
});

test('a changed task context stops its active episode and prevents the remaining dispatch',async t=>{
  const f=await fixture(t);await settings(f);const began=deferred();
  f.handler=(_body,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{delta:{content:'Partial context-bound work'}}]})+'\n\n');began.resolve();};
  await f.post('/api/parallel/start',request(f));await began.promise;
  await f.command('message.note',{chatId:f.chatId,content:'The purpose changed; preserve this correction.'});await settled(f);
  assert.equal(f.requests.length,1);assert.equal(f.app.store.state.parallel.runs[0].status,'held');
  assert.match(f.app.store.state.parallel.runs[0].error,/context|stopped|approach/i);
});

test('context overflow is rejected atomically, with the draft and history intact',async t=>{
  const f=await fixture(t,{modelOptions:{maxContextCharacters:3000}});await settings(f);
  await f.command('draft.save',{chatId:f.chatId,text:'Preserve my draft.'});
  const count=f.app.store.state.messages.length;
  const r=await f.post('/api/parallel/start',request(f,{content:'Important task. '.repeat(800)}));
  assert.equal(r.status,400);assert.match(r.body.error,/context/);
  assert.equal(f.app.store.state.messages.length,count);assert.equal(f.app.store.state.drafts[f.chatId],'Preserve my draft.');assert.equal(f.requests.length,0);
});

test('tool allowance is shared across actual independent episodes, including new call IDs',async t=>{
  const f=await fixture(t);await settings(f);let successes=0, refusals=0;
  f.handler=(body,res)=>{
    if(!body.messages.some(m=>m.role==='tool'))return stream(res,null,Array.from({length:5},(_,i)=>({id:'clock_'+i,name:'read_clock',args:{}})));
    for(const m of body.messages.filter(m=>m.role==='tool')){const r=JSON.parse(m.content);r.ok?successes++:refusals++;}
    stream(res,'These findings use only the available tool results.');
  };
  const r=await f.post('/api/parallel/start',request(f,{toolsEnabled:true}));assert.equal(r.status,202);await settled(f);
  assert.equal(successes,8);assert.equal(refusals,2);assert.equal(f.app.store.state.parallel.runs[0].usage.toolCalls,8);
  assert.equal(f.app.store.state.parallel.runs[0].usage.modelRounds,4);
});

test('restart retains an interruption and explicit settings but never resurrects dispatch permission',async t=>{
  const f=await fixture(t);await settings(f,true,true,true);const began=deferred();
  f.handler=(_body,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{delta:{content:'Still running'}}]})+'\n\n');began.resolve();};
  const r=await f.post('/api/parallel/start',request(f));assert.equal(r.status,202);await began.promise;
  const dir=path.join(f.dir,'interrupted-copy');await fs.mkdir(dir);
  await fs.copyFile(f.app.store.file,path.join(dir,'events.jsonl'));
  const restored=await createApp({dataDir:dir,backupDir:path.join(f.dir,'restart-backups')});
  try {
    assert.equal(restored.store.state.parallel.runs[0].status,'interrupted');
    assert(restored.store.state.parallel.jobs.every(j=>j.status==='interrupted'));
    assert(agentSettings(restored.store.state).automaticRequests);
    assert.equal(restored.parallel.entries.size,0);assert.equal(f.requests.length,1);
    assert(restored.store.state.handoffs.records.some(r=>r.kind==='episode.interrupted'&&r.taskId===restored.store.state.parallel.jobs[0].id));
    const forged=structuredClone(restored.store.state);forged.parallel.runs[0].admissionHash='0'.repeat(64);
    assert.throws(()=>validateState(forged),/admission/);
  } finally {await restored.dispose();}
});

test('both history tools are pinned before inference and later handoffs retain approach authorship and evidence',async t=>{
  const f=await fixture(t);await settings(f);let peer=0;
  f.handler=(body,res)=>{
    if(!body.messages.some(m=>m.role==='tool')) {
      peer++;
      const reader=body.tools.find(t=>t.function.name==='read_chat_source');assert.match(reader.function.description,/through M1/);
      return stream(res,null,[{name:'read_chat_source',args:{source_id:peer===1?'M1':'M2',offset:0}}]);
    }
    const answer=JSON.parse(body.messages.at(-1).content);assert.equal(answer.ok,peer===1);
    stream(res,peer===1?'The first view leaves the cost unresolved.':'The second view proposes a different garden.');
  };
  const r=await f.post('/api/parallel/start',request(f,{toolsEnabled:true}));assert.equal(r.status,202);await settled(f);
  assert.equal(f.app.store.state.parallel.runs[0].status,'completed');
  const first=sourceAt(f.app.store.state,f.chatId,'M2');assert.equal(first.status,'completed');assert.match(first.author,/Approach 1/);
  assert.equal(first.approach.sourceRole,'model_contribution_not_permission');assert(first.toolEvidence.length>0);
  const packet=await f.post('/api/handoffs/packet',{taskId:first.approach.episodeId});assert.equal(packet.status,200,JSON.stringify(packet.body));
  assert.equal(packet.body.v,'branchline.handoff-wire/2');
  const unpacked=unpackHandoffs(packet.body);assert(unpacked.some(r=>r.kind==='parallel.admitted'));
  assert.throws(()=>unpackHandoffs({...packet.body,task:f.app.store.state.parallel.jobs[1].id}),/task/);
  assert.throws(()=>packHandoffs(unpacked.filter(r=>r.kind!=='parallel.admitted'),{taskId:first.approach.episodeId}),/predecessor/);
  const messages=compileMessages(f.app.store.state,f.chatId,'Discuss those differences.');
  assert(messages.some(m=>m.content.includes('Branchline tool result')&&m.content.includes('M1')));
});

test('personal base and visiting instruction models use their own chair format and the same task context',async t=>{
  const f=await fixture(t);await settings(f);
  const visitor=f.app.store.state.models[0];
  await f.command('model.save',{name:'Synthetic base',model:'synthetic-base',baseUrl:visitor.baseUrl,inputFormat:'plain-dialogue-v1'});
  await f.command('personal.create',{name:'Personal learner',modelId:f.app.store.state.models.at(-1).id,baseIdentity:'synthetic/base'});
  await f.command('table.assign',{chatId:f.chatId,baseRevisionId:null,personalId:f.app.store.state.personalParticipants[0].id,visitorModelId:visitor.id});
  f.handler=(body,res)=>{
    if(body.prompt) {assert.equal(body.tools,undefined);assert.match(body.prompt,/Personal chair/);res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{text:'Personal findings.',finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');}
    else {assert.match(body.messages[0].content,/Visiting chair/);stream(res,'Visiting findings.');}
  };
  const r=await f.post('/api/parallel/start',request(f,{toolsEnabled:true,approaches:[{seat:'personal',angle:'Consider continuity.'},{seat:'visiting',angle:'Consider feasibility.'}]}));
  assert.equal(r.status,202,JSON.stringify(r.body));await settled(f);
  assert.equal(f.app.store.state.parallel.runs[0].status,'completed',JSON.stringify(f.app.store.state.parallel.jobs));assert.equal(f.requests.length,2);
});

test('Codex can request its extra episode and releases the provider before it starts',async t=>{
  const rpc=new FakeCodexRpc();const normal=rpc.request.bind(rpc);let modelId;
  rpc.request=async(method,params={})=>{
    if(method!=='turn/start'||rpc.turns!==1)return normal(method,params);
    rpc.calls.push({method,params:structuredClone(params)});
    const result=await rpc.toolHandler({threadId:params.threadId,turnId:'turn-1',callId:'extra',tool:'request_parallel_approach',arguments:{model_id:modelId,angle:'Check another route.',reason:'Test the open distinction.'}});
    assert.equal(result.success,true,JSON.stringify(result));assert.equal(rpc.turns,1);
    rpc.emit('notification',{method:'item/completed',params:{threadId:params.threadId,turnId:'turn-1',item:{id:'item-1',type:'agentMessage',text:'The extra approach is queued.'}}});
    rpc.emit('notification',{method:'turn/completed',params:{threadId:params.threadId,turn:{id:'turn-1',status:'completed'}}});
    return {turn:{id:'turn-1'}};
  };
  const codex=new CodexProvider({accountDir:path.resolve('.test-data/codex-request-'+Date.now()),binaryResolver:async()=> 'synthetic.exe',rpcFactory:()=>rpc});
  const f=await fixture(t,{modelOptions:{codex}});await settings(f,true,true,true);
  await f.command('model.save',{name:'Synthetic Codex',model:'synthetic-codex',runtime:'codex',baseUrl:CODEX_ADDRESS});
  modelId=f.app.store.state.models.at(-1).id;await f.command('root.model',{id:f.rootId,modelId});
  const r=await f.post('/api/exchange',{chatId:f.chatId,content:'Try another approach if useful.',toolsEnabled:false});assert.equal(r.status,200,JSON.stringify(r.body));await settled(f);
  assert.equal(f.app.store.state.parallel.runs[0].status,'completed',JSON.stringify(f.app.store.state.parallel.runs[0]));
  assert.equal(rpc.turns,2);
  const starts=rpc.calls.filter(c=>c.method==='thread/start');assert.deepEqual(starts[0].params.dynamicTools.map(t=>t.name),['request_parallel_approach','request_hearth']);assert.deepEqual(starts[1].params.dynamicTools,[]);
  assert.equal(f.app.store.state.parallel.runs[0].usage.modelRounds,2);
});

test('shared limits cannot be multiplied by an approach or a new call identity',()=>{
  const budget=new ParallelBudget();
  budget.take('toolCalls',8);assert.throws(()=>budget.take('toolCalls'),/shared/);
  budget.take('toolBytes',48000);assert.throws(()=>budget.take('toolBytes'),/shared/);
  budget.take('modelRounds',10);assert.throws(()=>budget.take('modelRounds'),/shared/);
  budget.deadline=Date.now()-1;assert.throws(()=>budget.take('outputCharacters',1),/deadline/);
});

test('a model request acknowledges the queue and releases its turn before another call; peers cannot recursively request',async t=>{
  const f=await fixture(t);await settings(f,true,true,true);
  let original=0, peer=0;
  f.handler=(body,res)=>{
    const isPeer=body.messages.some(m=>m.content?.startsWith('[Branchline task view:'));
    if(isPeer) {peer++;assert(!body.tools?.some(t=>t.function.name==='request_parallel_approach'));return stream(res,'Independent garden findings.');}
    if(original++===0) {
      const definition=body.tools.find(t=>t.function.name==='request_parallel_approach');assert(definition);
      return stream(res,null,[{id:'another',name:'request_parallel_approach',args:{model_id:f.app.store.state.models[0].id,angle:'Check an alternative.',reason:'The task benefits from a second approach.'}}]);
    }
    const ack=JSON.parse(body.messages.at(-1).content);assert.equal(ack.ok,true,JSON.stringify(ack));assert.equal(ack.value.status,'queued');assert.equal(peer,0);
    stream(res,'My initial findings; another approach is queued.');
  };
  const result=await f.post('/api/exchange',{chatId:f.chatId,content:'Plan a garden; the size is unresolved.',toolsEnabled:true});
  assert.equal(result.status,200,JSON.stringify(result.body));await settled(f);
  assert.equal(peer,1);
  const run=f.app.store.state.parallel.runs[0];assert.equal(run.origin,'model');assert.equal(run.status,'completed',JSON.stringify(run));
  assert.equal(run.usage.modelRounds,3);assert.equal(run.usage.toolCalls,1);
});

test('Stop cancels owned inference and prevents the second approach from starting',async t=>{
  const f=await fixture(t);await settings(f);const began=deferred();
  f.handler=(_body,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{delta:{content:'Partial finding'}}]})+'\n\n');began.resolve();};
  const started=await f.post('/api/parallel/start',request(f));assert.equal(started.status,202);await began.promise;
  for(let i=0;i<100 && !f.app.parallel.status(f.chatId).runs[0]?.liveText;i++) await new Promise(r=>setTimeout(r,10));
  assert.equal((await f.post('/api/parallel/cancel',{runId:started.body.runId})).status,200);await settled(f);
  assert.equal(f.requests.length,1);assert.equal(f.app.store.state.parallel.runs[0].status,'cancelled');
  assert.equal(f.app.store.state.parallel.jobs[1].status,'cancelled');
  assert.match(f.app.store.state.parallel.jobs[0].output??'',/Partial finding/);
});
