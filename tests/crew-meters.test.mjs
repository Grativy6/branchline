import test from 'node:test';
import assert from 'node:assert/strict';
import { UsageAccumulator, codexUsage, accountMeters, parseNvidia, HardwareMeter, ResourceMeters, groupChairUsage } from '../server/resource-meters.mjs';
import { ReplyMetrics, validateReplyMetrics } from '../server/reply-metrics.mjs';
import { fixture } from './desk-helpers.mjs';

test('usage snapshots reconcile duplicates and late updates without mixing threads',()=>{
  const totals=new UsageAccumulator();
  const one=codexUsage({threadId:'a',turnId:'a1',tokenUsage:{total:{inputTokens:100,outputTokens:20,totalTokens:120,cachedInputTokens:50,reasoningOutputTokens:12}}});
  totals.observe(one);totals.observe(one);assert.equal(totals.snapshot().totalTokens,120);
  totals.observe({...one,inputTokens:90,outputTokens:10,totalTokens:100});assert.equal(totals.snapshot().totalTokens,120);
  totals.observe({...one,inputTokens:110,outputTokens:30,totalTokens:140});assert.equal(totals.snapshot().totalTokens,140);
  totals.observe({...one,sourceId:'b',threadId:'b',turnId:'b1'});assert.equal(totals.snapshot().totalTokens,260);assert.equal(totals.snapshot().observations,2);
  totals.observe({source:'api',sourceId:'missing',inputTokens:null,outputTokens:null});assert.equal(totals.snapshot().totalTokens,null);
});
test('allowance meters preserve actual buckets, missing fields and reset evidence',()=>{
  const view=accountMeters({accountId:'fixture',ordinaryUsageAllowed:null,rateLimitsByLimitId:{first:{limitName:'Shared allowance',primary:{usedPercent:25,windowDurationMins:300,resetsAt:10}},second:{primary:{usedPercent:0},credits:{balance:'4',hasCredits:true}}}},'2026-11-08T00:00:00Z');
  assert.equal(view.scope,'account');assert.equal(view.buckets.length,2);assert.equal(view.buckets[0].windows[0].durationMinutes,300);
  assert.equal(view.buckets[1].windows[0].durationMinutes,null);assert.equal(view.ordinaryUsageAllowed,null);
  assert.equal(accountMeters({}).buckets.length,0);assert.equal(accountMeters({rateLimits:{primary:{}}}).buckets[0].windows[0].usedPercent,null);
});
test('GPU measurements retain device scope, exact units, multiple cards and unavailable values',()=>{
  const devices=parseNvidia('0, GPU-fixture, "Fixture, A", 30, 2048, 8192\n1, GPU-other, Fixture B, [N/A], N/A, 4096\n');
  assert.equal(devices.length,2);assert.equal(devices[0].name,'Fixture, A');assert.equal(devices[0].usedBytes,2147483648);assert.equal(devices[0].scope,'whole_device');
  assert.equal(devices[1].utilizationPercent,null);assert.equal(devices[1].usedBytes,null);assert.equal(devices[1].totalBytes,4294967296);
  assert.deepEqual(parseNvidia('unrecognized driver output'),[]);
});
test('hardware sampling is cached, passive and honest when GPU data is unavailable',async()=>{
  let time=10000,idle=100,total=200,queries=0;
  const meter=new HardwareMeter({clock:()=>time,system:{cpus:()=>[{times:{idle,user:total-idle}}],totalmem:()=>16000,freemem:()=>4000},query:async()=>{queries++;throw new Error('Unavailable');}});
  idle+=20;total+=100;const a=await meter.sample();assert.equal(a.cpu.utilizationPercent,80);assert.equal(a.memory.usedBytes,12000);assert(a.gpuError);
  assert.equal(await meter.sample(),a);assert.equal(queries,1);time+=4000;await meter.sample();assert.equal(queries,2);
});
test('reply metrics preserve old records while accounting for more than nine rounds',()=>{
  const metrics=new ReplyMetrics(()=>0);
  for(let round=0;round<12;round++){metrics.beginRound(round);metrics.observe({usage:{prompt_tokens:10,completion_tokens:5,completion_tokens_details:{reasoning_tokens:1}}});}
  const all=metrics.snapshot();assert.equal(all.rounds,12);assert.equal(all.version,2);assert.equal(all.inputTokens,120);assert.equal(all.outputTokens,60);validateReplyMetrics(all);
  const legacy={...all,version:1,rounds:9};validateReplyMetrics(legacy);assert.throws(()=>validateReplyMetrics({...all,version:1}));
});
test('an account change clears the prior meter and does not generate a model response',async()=>{
  const f=await fixture();try{
    let reads=0;const codex={accountRevision:1,rates:null,async meterStatus(){reads++;this.rates={accountId:'account-'+this.accountRevision,rateLimits:{primary:{usedPercent:this.accountRevision*10}}};return {connected:true,rates:this.rates,account:{plan:'fixture'}};}};
    await f.command('model.save',{name:'Cloud',model:'gpt-6-astra',runtime:'codex',baseUrl:'codex://chatgpt',thinking:false});
    const r=f.app.store.state.chats[0].seating,m=f.app.store.state.models.find(m=>m.name==='Cloud');
    await f.command('table.roster.chair',{chatId:f.chatId,baseRevisionId:r.revisionId,chairId:r.desk.id,name:'Cloud',modelId:m.id,personalId:null,coat:null});
    const meters=new ResourceMeters({store:f.app.store,codex,deskTasks:f.app.deskTasks,localRunner:f.app.localRunner,hardware:{sample:async()=>({gpus:[],cpu:{},memory:{}})}});
    const first=await meters.view(f.chatId);assert.equal(first.subscription.accountId,'account-1');
    codex.accountRevision=2;codex.rates=null;const second=await meters.view(f.chatId);assert.equal(second.subscription.accountId,'account-2');assert.equal(second.subscription.buckets[0].windows[0].usedPercent,20);
    assert.equal(reads,2);assert.equal(f.requests.length,0);
  }finally{await f.close();}
});

test('chair totals keep duplicate-model identities separate and distinguish incomplete counts',()=>{
  const turns=Array.from({length:40},(_,i)=>({taskId:'t'+i,chatId:'chat',chairId:'builder',chair:i<20?'Old name':'Builder',model:'Shared model',status:'completed',usage:{inputTokens:100,outputTokens:10,cachedInputTokens:20,reasoningTokens:5}}));
  turns.push({...turns[39],usage:{...turns[39].usage,inputTokens:120}});
  turns.push({taskId:'other',chatId:'chat',chairId:'tester',chair:'Builder',model:'Shared model',status:'completed',usage:{inputTokens:50,outputTokens:0,cachedInputTokens:null,reasoningTokens:0}});
  turns.push({taskId:'missing',chatId:'chat',chairId:'tester',chair:'Builder',model:'Shared model',status:'failed',usage:null});
  turns.push({taskId:'live',chatId:'elsewhere',chairId:'builder',chair:'Builder',model:'Shared model',status:'running',usage:{inputTokens:0,outputTokens:0,cachedInputTokens:0,reasoningTokens:0}});
  const groups=groupChairUsage(turns,new Map([['chat:builder','Renamed builder']]));
  assert.equal(groups.length,3);assert.equal(groups[0].chair,'Renamed builder');assert.equal(groups[0].turns.length,40);
  assert.deepEqual(groups[0].totals.inputTokens,{value:4020,measured:40,partial:false});assert.equal(groups[0].totals.outputTokens.value,400);
  assert.deepEqual(groups[1].totals.inputTokens,{value:50,measured:1,partial:true});assert.deepEqual(groups[1].totals.cachedInputTokens,{value:null,measured:0,partial:true});
  assert.equal(groups[1].totals.outputTokens.value,0);assert.equal(groups[2].totals.inputTokens.value,0);assert.equal(groups[2].totals.inputTokens.partial,true);assert.equal(groups[2].active,1);
});

test('resource totals include the full conversation and use one current usage measurement per turn',async()=>{
  const f=await fixture();try{
    const state=structuredClone(f.app.store.state),id=state.chats[0].seating.desk.id;
    const tasks=Array.from({length:35},(_,i)=>({id:'task'+i,chatId:f.chatId,chairId:id,label:'Old chair label',model:{name:'Fixture'},status:'completed',startedAt:'2026-11-09T00:00:00Z',exchangeId:'e'+i}));
    state.deskWork={events:tasks.flatMap(t=>[{taskId:t.id,kind:'task.usage',detail:{inputTokens:1,outputTokens:1}},{taskId:t.id,kind:'task.usage',detail:{inputTokens:10,outputTokens:2}}])};
    tasks[0].usage={inputTokens:30,outputTokens:5};tasks.push({...tasks[0],id:'outside',chatId:'outside'});
    const deskTasks={entries:new Map(),status:()=>tasks};
    const meters=new ResourceMeters({store:{state},codex:{},deskTasks,localRunner:{status:()=>({phase:'stopped'})},hardware:{sample:async()=>({gpus:[],cpu:{},memory:{}})}});
    const view=await meters.view(f.chatId);assert.equal(view.chairs.length,1);assert.equal(view.chairs[0].turns.length,35);
    assert.equal(view.chairs[0].chair,'Hearthline');assert.equal(view.chairs[0].totals.inputTokens.value,370);assert.equal(view.chairs[0].totals.outputTokens.value,73);
    assert.equal(f.requests.length,0);
  }finally{await f.close();}
});
