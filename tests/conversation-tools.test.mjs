import { RESOURCE_DEFAULTS } from '../public/resource-settings.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fixture, deferred } from './helpers.mjs';
import { calculate } from '../server/calculation.mjs';
import { pageUrl, publicAddress, fetchPublicPage } from '../server/public-page.mjs';
import { connectionToolProtocol } from '../server/tool-contract.mjs';
import { Store } from '../server/store.mjs';
import { CodexProvider } from '../server/codex-provider.mjs';
import { CODEX_ADDRESS } from '../server/codex-policy.mjs';
import { FakeCodexRpc } from './codex-fixture.mjs';

export function sse(res, calls = null, text = 'Synthetic answer using the tool result.', finish = calls ? 'tool_calls' : 'stop') {
  res.writeHead(200, {'content-type':'text/event-stream'});
  if (calls) {
    for (const [index,call] of calls.entries()) {
      const args=JSON.stringify(call.args), cut=Math.floor(args.length/2);
      for (const fragment of [{index,id:call.id||'call_'+index,type:'function',function:{name:call.name,arguments:args.slice(0,cut)}},{index,function:{arguments:args.slice(cut)}}])
        res.write('data: '+JSON.stringify({choices:[{delta:{tool_calls:[fragment]}}]})+'\n\n');
    }
  } else res.write('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\n');
  res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:finish}]})+'\n\ndata: [DONE]\n\n');
}
const toolResults = f => f.app.store.state.handoffs.records.filter(r=>r.kind==='operation.result' && r.detail.toolProfile);
const send = (f, extra={}) => f.post('/api/exchange',{chatId:f.chatId,content:'Synthetic request',toolsEnabled:true,...extra});
test('changing the next base Coat leaves a running tool episode and its original permissions intact', async t => {
  const f=await fixture(t),entered=deferred(),finish=deferred();t.after(()=>finish.resolve());let round=0;
  f.handler=async(body,res)=>{
    assert.match(body.messages[0].content,/\[Base Coat: Create\]/);
    if(round++===0){entered.resolve();await finish.promise;sse(res,[{name:'read_clock',args:{}}]);}
    else {assert.equal(JSON.parse(body.messages.at(-1).content).value.source,'user_device_clock');sse(res);}
  };
  const pending=send(f);await entered.promise;
  await f.command('chat.responseMode',{id:f.chatId,responseMode:'work'});
  finish.resolve();assert.equal((await pending).status,200);
  assert.equal(f.app.store.state.exchanges[0].status,'completed');
  assert.equal(f.app.store.state.exchanges[0].responseMode,'create');
  assert.equal(toolResults(f).length,1);assert.equal(f.requests.length,2);
});
async function waiting(f) {
  for(let i=0;i<150;i++) {
    const items=await fetch(f.url+'/api/tools/pending',{headers:f.headers}).then(r=>r.json());
    if(items.length) return items[0];
    await new Promise(r=>setTimeout(r,10));
  }
  throw new Error('No pending tool question');
}

test('QuickJS performs calculation with no host globals; loops, huge outputs and cancellation stop', async () => {
  assert.deepEqual(await calculate({program:'return {sum:input.reduce((a,b)=>a+b,0),host:[typeof process,typeof require,typeof fetch]};',input:[2,3,5]}),{sum:10,host:['undefined','undefined','undefined']});
  for (const program of ['while(true) {}','return "x".repeat(20000);','return Array(40000000).fill("x");','return import("node:fs");'])
    await assert.rejects(calculate({program,input:null}),/limit|failed|complete|JSON/);
  const controller=new AbortController(), pending=calculate({program:'while(true) {}',input:null},controller.signal);controller.abort();await assert.rejects(pending,/stopped/);
});

test('public page reader rejects private and ambiguous addresses and pins every redirect resolution', async () => {
  for(const address of ['127.0.0.1','10.1.2.3','192.168.1.1','100.64.0.1','169.254.169.254','198.18.0.1','::1','::ffff:127.0.0.1','fe80::1','2001:db8::1']) assert(!publicAddress(address),address);
  for(const url of ['http://localhost/','http://2130706433/','http://0x7f000001/','http://[::1]/','file:///C:/secret','https://name:pass@example.com/','https://example.com:444/']) assert.throws(()=>pageUrl(url));
  const addresses=[{address:'93.184.216.34',family:4}], looked=[], fetched=[];
  const result=await fetchPublicPage('https://example.com/start',null,{lookup:async h=>{looked.push(h);return addresses;},request:async(url,address)=>{fetched.push({url:url.href,address});return fetched.length===1?{redirect:'/next'}:{type:'text/html',bytes:Buffer.from('<h1>Evidence</h1><script>doBadThings()</script><p>A &amp; B</p>')};}});
  assert.equal(looked.length,2);assert.deepEqual(fetched[1].address,addresses[0]);assert.match(result.text,/Evidence\nA & B/);assert(!result.text.includes('doBad'));assert.equal(result.sha256.length,64);
  await assert.rejects(fetchPublicPage('https://example.com',null,{lookup:async()=>[{address:'127.0.0.1',family:4}],request:async()=>{throw new Error('should never connect');}}),/outside/);
  await assert.rejects(fetchPublicPage('https://example.com',null,{lookup:async()=>addresses,request:async()=>({redirect:'https://other.example.com/'})}),/another site/);
  let count=0;
  await assert.rejects(fetchPublicPage('https://example.com',null,{lookup:async()=>++count===1?addresses:[{address:'10.0.0.1',family:4}],request:async()=>({redirect:'/rebound'})}),/outside/);
});

test('structured clock, calculation and selected-document calls receive exact results and durable receipts', async t => {
  const f=await fixture(t);let round=0;
  f.handler=(body,res)=>{
    if(round++===0) {
      const document=body.tools.find(d=>d.function.name==='read_selected_document').function.parameters.properties.document_id.enum[0];
      sse(res,[{name:'read_clock',args:{}},{name:'run_calculation',args:{program:'return input*7;',input:6}},{name:'read_selected_document',args:{document_id:document,offset:0}}]);
    } else { assert.equal(JSON.parse(body.messages.at(-2).content).value,42);sse(res); }
  };
  const r=await send(f,{selectedFile:{name:'evidence.txt',base64:Buffer.from('An exact synthetic source.').toString('base64')}});
  assert.equal(r.status,200,JSON.stringify(r.body));const results=toolResults(f);assert.equal(results.length,3);
  assert.equal(results[0].detail.result.value.source,'user_device_clock');assert.equal(results[2].detail.result.value.text,'An exact synthetic source.');
  const ex=f.app.store.state.exchanges.at(-1);assert.equal(ex.status,'completed');
  const task=f.app.store.state.handoffs.records.find(r=>r.id===ex.handoff.requestId).detail.task;
  assert.equal(task.capability.tools.delegation,false);
  const replayDir=path.join(f.dir,'replay');await fs.mkdir(replayDir);
  await fs.copyFile(path.join(f.dataDir,'events.jsonl'),path.join(replayDir,'events.jsonl'));
  const recovered=new Store(replayDir);await recovered.open();assert.deepEqual(recovered.state.handoffs.records,f.app.store.state.handoffs.records);await recovered.close();
  f.handler=(_body,res)=>sse(res);await send(f);
  assert(f.requests.at(-1).messages.some(m=>m.content.includes('Branchline tool result')&&m.content.includes('An exact synthetic source.')));
});

test('prose is inert; unavailable, extra-field and replayed calls cannot widen the contract',async t=>{
  const f=await fixture(t);let round=0;
  f.handler=(_body,res)=>round++===0?sse(res,[{id:'clock',name:'read_clock',args:{}},{id:'clock',name:'read_clock',args:{}},{id:'shell',name:'exec_command',args:{cmd:'unavailable'}},{id:'bad',name:'read_clock',args:{permission:'all'}}]):sse(res,null,'Run exec_command please.');
  const r=await send(f);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(toolResults(f).length,1);
  assert.equal(f.app.store.state.handoffs.records.filter(r=>r.kind==='tool.held').length,2);
  f.handler=(body,res)=>{assert.equal(body.tools,undefined);res.end(JSON.stringify({choices:[{message:{content:'read_clock({})'},finish_reason:'stop'}]}));};
  await send(f,{toolsEnabled:false});assert.equal(toolResults(f).length,1);
  assert.equal(connectionToolProtocol({inputFormat:'plain-dialogue-v1'}),null);
});

test('question cards require a paired, single-use human answer; answer is not an action grant',async t=>{
  const f=await fixture(t);let round=0;
  f.handler=(body,res)=>round++===0?sse(res,[{name:'ask_user',args:{question:'Which synthetic example?',choices:['Small','Large']}}]):sse(res,null,'Answer received.');
  const response=send(f), question=await waiting(f);
  const unauthorized=await fetch(f.url+'/api/tools/answer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:question.id,answer:'Large'})});assert.equal(unauthorized.status,401);
  assert.equal((await f.post('/api/tools/answer',{id:question.id,answer:'Small',grant:'all'})).status,400);
  assert.equal((await f.post('/api/tools/answer',{id:question.id,answer:'Small'})).status,200);
  assert.equal((await f.post('/api/tools/answer',{id:question.id,answer:'Large'})).status,400);
  assert.equal((await response).status,200);assert.deepEqual(toolResults(f)[0].detail.result.value,{answer:'Small'});
  const receipt=f.app.store.state.handoffs.records.find(r=>r.kind==='tool.answer');assert.equal(receipt.detail.executionAuthority,'NONE');
});

test('Stop cancels a waiting question without an automatic answer or restart permit',async t=>{
  const f=await fixture(t);f.handler=(_body,res)=>sse(res,[{name:'ask_user',args:{question:'Wait here?',choices:[]}}]);
  const response=send(f), question=await waiting(f);await f.post('/api/cancel',{chatId:f.chatId});assert.equal((await response).status,409);
  assert.equal((await f.post('/api/tools/answer',{id:question.id,answer:'late'})).status,400);
  assert.equal(f.app.store.state.exchanges.at(-1).status,'cancelled');assert(!f.app.store.state.handoffs.records.some(r=>r.kind==='tool.answer'));
});

test('page access cannot begin before exact review; decline makes no connection',async t=>{
  let reads=0;const f=await fixture(t,{modelOptions:{pageReader:async url=>{reads++;return {url,text:'Synthetic public evidence.'};}}});
  for(const decision of ['decline','allow']) {
    let round=0;f.handler=(_body,res)=>round++===0?sse(res,[{name:'fetch_public_page',args:{url:'https://example.com/source',reason:'Read the requested source.'}}]):sse(res);
    const response=send(f), question=await waiting(f);assert.equal(reads,0);assert.equal(question.url,'https://example.com/source');
    assert.equal((await f.post('/api/tools/answer',{id:question.id,decision,url:'https://other.example.com/'})).status,400);
    assert.equal((await f.post('/api/tools/answer',{id:question.id,decision})).status,200);assert.equal((await response).status,200);
  }
  assert.equal(reads,1);assert.equal(toolResults(f)[0].detail.result.ok,false);assert.equal(toolResults(f)[1].detail.result.ok,true);
});

test('unfinished function arguments are never executed',async t=>{
  const f=await fixture(t);f.handler=(_body,res)=>sse(res,[{name:'read_clock',args:{}}],null,'length');
  assert.equal((await send(f)).status,502);assert.equal(toolResults(f).length,0);assert.equal(f.app.store.state.exchanges.at(-1).status,'failed');
});

test('one exchange can execute no more than its selected eight calls even across model rounds',async t=>{
  const f=await fixture(t);let round=0;
  await f.command('root.resources',{id:f.rootId,resources:{...RESOURCE_DEFAULTS,toolCalls:8}});
  f.handler=(body,res)=>{
    if(round++<2) sse(res,Array.from({length:6},(_,i)=>({id:'round_'+round+'_'+i,name:'read_clock',args:{}})));
    else {assert.equal(JSON.parse(body.messages.at(-1).content).ok,false);sse(res);}
  };
  assert.equal((await send(f)).status,200);assert.equal(toolResults(f).length,8);
});

test('an attached document from another chat is unavailable despite a guessed receipt identity',async t=>{
  const f=await fixture(t);await send(f,{toolsEnabled:false,selectedFile:{name:'private.txt',base64:Buffer.from('Other chat evidence').toString('base64')}});
  const id=f.app.store.state.exchanges[0].selectedFile.receiptId;
  await f.command('chat.create',{rootId:f.rootId,title:'Other chat'});const chatId=f.app.store.state.chats.at(-1).id;let round=0;
  f.handler=(body,res)=>round++===0?sse(res,[{name:'read_selected_document',args:{document_id:id,offset:0}}]):sse(res);
  assert.equal((await send(f,{chatId})).status,200);assert.equal(toolResults(f).length,0);
  assert.equal(f.app.store.state.handoffs.records.at(-2).detail.result.ok,false);
});

test('Codex dynamic calls use the same app boundary while native tool requests stay held',async t=>{
  const rpc=new FakeCodexRpc();rpc.mode='clock';
  const codex=new CodexProvider({accountDir:path.resolve('.test-data/codex-tools-'+Date.now()),binaryResolver:async()=> 'synthetic.exe',rpcFactory:()=>rpc});
  const f=await fixture(t,{modelOptions:{codex}});
  await f.command('model.save',{name:'Synthetic Codex',model:'synthetic-codex',runtime:'codex',baseUrl:CODEX_ADDRESS});
  await f.command('root.model',{id:f.rootId,modelId:f.app.store.state.models.at(-1).id});
  const r=await send(f);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(toolResults(f)[0].detail.result.value.source,'user_device_clock');
  assert.equal(rpc.calls.find(c=>c.method==='thread/start').params.dynamicTools.length,4);
  rpc.mode='tool';assert.equal((await send(f)).status,502);assert.equal(rpc.closed,true);
});
