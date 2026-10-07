import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers.mjs';
import {compileMessages, measureContext} from '../server/model.mjs';
import {protocolMessages} from '../server/handoff.mjs';
import {modelTransport} from '../server/model-format.mjs';
import {PAL_GUIDE, PAL_ACCOUNT_HINT} from '../server/pal-guide.mjs';
import {beginCarry, chatMessages} from '../server/context-carry.mjs';
import {beginMindReflection} from '../server/mind.mjs';
import {parallelBasis} from '../server/parallel-state.mjs';
const count=messages=>messages.map(m=>m.content).join('\n').split(PAL_GUIDE).length-1;

test('compact method is counted once in ordinary and plain-dialogue inputs, with no saved extra turn',async t=>{
  const f=await fixture(t), before=structuredClone(f.app.store.state.messages), text='Tell a short story about a snail.';
  const messages=compileMessages(f.app.store.state,f.chatId,text);
  assert.equal(count(messages),1);assert.equal(count(protocolMessages(messages)),1);
  assert.equal(measureContext(f.app.store.state,f.chatId,text).characters,messages.reduce((sum,m)=>sum+m.content.length,0));
  const transport=modelTransport({...f.app.store.state.models[0],inputFormat:'plain-dialogue-v1'},messages);
  assert.equal(transport.input.prompt.split(PAL_GUIDE).length-1,1);
  assert.deepEqual(f.app.store.state.messages,before);assert.equal(f.requests.length,0);
});

test('desk handoff and explicit MIND preparation keep conditions and losses without altering output schemas',async t=>{
  const f=await fixture(t);const exchangeId=await f.exchange('The span is 2 m; the load is unmeasured. Keep the unknown load.');
  for(let i=0;i<8;i++)await f.command('message.note',{chatId:f.chatId,content:'A recorded distinction with its conditions. '.repeat(80)});
  const snapshot=f.app.store.state, carry=beginCarry(structuredClone(snapshot),{chatId:f.chatId,speaker:'visiting',baseId:null,lastMessageId:chatMessages(snapshot,f.chatId).at(-1).id});
  assert.equal(count(carry.messages),1);assert(carry.messages[0].content.includes(PAL_ACCOUNT_HINT));assert.match(carry.messages[0].content,/account/);
  const mind=beginMindReflection(structuredClone(snapshot),{chatId:f.chatId,exchangeId,sourceTurnIds:[exchangeId],target:'mind',speaker:null,requestId:'pal_mind_fixture',baseAccountId:null});
  assert.equal(count(protocolMessages(mind.messages)),1);assert(mind.messages[0].content.includes(PAL_ACCOUNT_HINT));assert.match(mind.messages[0].content,/Return JSON only/);
  assert.equal(f.requests.length,1,'preparation creates no implicit reflection call');
});

test('all three hearth episodes inherit the same compact method without expanding their effect grant',async t=>{
  const f=await fixture(t);await f.command('parallel.settings',{baseRevisionId:null,enabled:true,automaticRequests:false,confirmAutomatic:false});
  f.handler=(_body,response)=>{response.writeHead(200,{'content-type':'text/event-stream'});response.end('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify({outcome:'completed',message:'The supplied dimensions are retained; the load remains unmeasured.',replies:[]})},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');};
  const started=await f.post('/api/hearth/start',{requestId:'pal_hearth_fixture',chatId:f.chatId,content:'Compare two ways to support a bench, retaining the unknown load.',directions:['Examine geometry','Examine material limits'],seat:'legacy',cloudApproved:false,basisHash:parallelBasis(f.app.store.state,f.chatId)});
  assert.equal(started.status,202,JSON.stringify(started.body));
  for(let i=0;i<300 && f.app.store.state.parallel.runs[0].status!=='completed';i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(f.app.store.state.parallel.runs[0].status,'completed');assert.equal(f.requests.length,3);
  for(const request of f.requests){assert.equal(count(request.messages),1);assert.equal(request.tools,undefined);}
  for(const record of f.app.store.state.handoffs.records.filter(r=>r.kind==='context.to_model'))assert.equal(record.detail.capability.tools,undefined);
});
