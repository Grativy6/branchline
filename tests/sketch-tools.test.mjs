import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred } from './helpers.mjs';
import { sketchDestination, sketchHead } from '../public/sketch-format.js';
import { harnessChoice } from '../public/harness-catalog.js';
import { BUILTIN_PROVIDER, POCKET_PROFILE } from '../public/coat-pockets.js';
import { makeToolContract } from '../server/tool-contract.mjs';
const wire=(res,calls=null)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:calls?{tool_calls:calls.map((c,i)=>({index:i,id:c.id??'call_'+i,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}:{content:'Synthetic reply.'},finish_reason:calls?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n');};
const send=(f,extra={})=>f.post('/api/exchange',{chatId:f.chatId,content:'Keep our plan.',toolsEnabled:true,...extra});
const create={action:'create',id:'',revision:'',old_text:'',title:'A plan',text:'Keep this unresolved. No action permission.',stage:'ideas'};
const list={action:'list',id:'',revision:'',query:'',archived:false,offset:0};
const results=f=>f.app.store.state.handoffs.records.filter(r=>r.kind==='operation.result'&&r.detail.toolProfile).map(r=>r.detail.result);
async function allow(f,access='edit'){
 const m=f.app.store.state.models[0];await f.command('sketch.grant',{modelId:m.id,destination:sketchDestination(m),access});
}
async function pockets(f){await f.command('harness.create',{content:{name:'Book tools',description:'',instructions:'',pockets:{profile:POCKET_PROFILE,selected:['read_sketch_book','write_sketch'].map(tool=>({tool,provider:BUILTIN_PROVIDER}))}},use:{chatId:f.chatId,baseRevisionId:harnessChoice(f.app.store.state.chats[0]).id,seat:'shared'}});}
test('permission, Coat pockets and Tools are independent; helpers do not inherit book access',async t=>{
 const f=await fixture(t);await pockets(f);let offered=[];f.handler=(b,r)=>{offered=b.tools?.map(t=>t.function.name)??[];wire(r);};
 await send(f);assert.deepEqual(offered,[]);
 await allow(f,'read');await send(f);assert.deepEqual(offered,['read_sketch_book']);
 await allow(f);await send(f,{toolsEnabled:false});assert.deepEqual(offered,[]);
 const c=makeToolContract(f.app.store.state,{chatId:f.chatId,model:f.app.store.state.models[0],enabled:true});assert.deepEqual(c.tools,[]);
});
test('model creates, searches and edits across desks with exact attribution; duplicate call makes one revision',async t=>{
 const f=await fixture(t);await pockets(f);await allow(f);let round=0;
 f.handler=(b,r)=>{if(round++===0)wire(r,[{name:'write_sketch',args:create,id:'same'},{name:'write_sketch',args:create,id:'same'}]);else wire(r);};
 assert.equal((await send(f)).status,200);let s=f.app.store.state.sketchBook.records[0];assert(s,JSON.stringify(results(f)));
 assert.equal(s.revisions.length,1);assert.equal(sketchHead(s).author.kind,'model');assert.equal(sketchHead(s).author.modelId,f.app.store.state.models[0].id);
 const origin=structuredClone(s.origin);await f.command('root.create',{name:'Another desk',mode:'personal'});const root=f.app.store.state.roots.at(-1);await f.command('root.model',{id:root.id,modelId:f.app.store.state.models[0].id});
 // Read from the original chat still covers records from other desks, without reading those chats.
 await f.command('sketch.save',{id:null,baseRevisionId:null,originChatId:f.app.store.state.chats.at(-1).id,sourceMessageId:null,title:'Other room',text:'Memory, not the whole chat.',stage:'ideas',requestId:'manual_other'});
 round=0;f.handler=(b,r)=>{if(round++===0)wire(r,[{name:'read_sketch_book',args:list}]);else{assert.equal(JSON.parse(b.messages.at(-1).content).value.items.length,2);wire(r);}};await send(f);
 round=0;f.handler=(b,r)=>{if(round++===0)wire(r,[{name:'write_sketch',args:{...create,action:'edit',id:s.id,revision:sketchHead(s).id,old_text:'unresolved',text:'open',stage:'in-process'}}]);else wire(r);};assert.equal((await send(f)).status,200);
 s=f.app.store.state.sketchBook.records[0];assert.equal(s.revisions.length,2);assert.deepEqual(s.origin,origin);assert.match(sketchHead(s).text,/Keep this open/);
});
test('read-only, revoked grants, stale revisions and forged fields cannot write',async t=>{
 const f=await fixture(t);await pockets(f);await allow(f,'read');let round=0;
 f.handler=(b,r)=>round++===0?wire(r,[{name:'write_sketch',args:create}]):wire(r);await send(f);assert.equal(f.app.store.state.sketchBook.records.length,0);
 await allow(f);const entered=deferred(),finish=deferred();t.after(()=>finish.resolve());round=0;
 f.handler=async(b,r)=>{if(round++===0){entered.resolve();await finish.promise;wire(r,[{name:'write_sketch',args:create}]);}else wire(r);};
 const run=send(f);await entered.promise;await allow(f,'off');finish.resolve();await run;assert.equal(f.app.store.state.sketchBook.records.length,0);assert.match(results(f).at(-1).error,/off or changed/);
 await allow(f);round=0;f.handler=(b,r)=>round++===0?wire(r,[{name:'write_sketch',args:{...create,sourceMessageId:'forged'}}]):wire(r);await send(f);assert.equal(f.app.store.state.sketchBook.records.length,0);
});
test('a sketch exposure requires review before context is sent to a different connection',async t=>{
 const f=await fixture(t);await pockets(f);await allow(f);let round=0;f.handler=(b,r)=>round++===0?wire(r,[{name:'write_sketch',args:create}]):wire(r);await send(f);
 const m=f.app.store.state.models[0];await f.command('model.save',{name:'Other model',baseUrl:m.baseUrl,model:'another'});const other=f.app.store.state.models.at(-1);await f.command('root.model',{id:f.rootId,modelId:other.id});
 const count=f.requests.length;const blocked=await send(f);assert.equal(blocked.status,400);assert.match(blocked.body.error,/Sketch Book/);assert.equal(f.requests.length,count);
 await f.command('sketch.grant',{modelId:other.id,destination:sketchDestination(other),access:'read'});f.handler=(b,r)=>wire(r);assert.equal((await send(f)).status,200);
});
test('a concurrent user edit wins; a model can neither overwrite it nor impersonate a saved author',async t=>{
 const f=await fixture(t);await pockets(f);await allow(f);let round=0;f.handler=(b,r)=>round++===0?wire(r,[{name:'write_sketch',args:create}]):wire(r);await send(f);const s=f.app.store.state.sketchBook.records[0],head=sketchHead(s);
 const entered=deferred(),finish=deferred();t.after(()=>finish.resolve());round=0;f.handler=async(b,r)=>{if(round++===0){entered.resolve();await finish.promise;wire(r,[{name:'write_sketch',args:{...create,action:'edit',id:s.id,revision:head.id,old_text:'unresolved',text:'decided'}}]);}else wire(r);};
 const run=send(f);await entered.promise;await f.command('sketch.save',{id:s.id,baseRevisionId:head.id,originChatId:null,sourceMessageId:null,title:head.title,text:'Human correction stays.',stage:'in-process',requestId:'concurrent_human'});finish.resolve();await run;
 assert.equal(sketchHead(f.app.store.state.sketchBook.records[0]).text,'Human correction stays.');assert.match(results(f).at(-1).error,/changed/);
 await assert.rejects(f.app.store.transact(state=>{const forged=structuredClone(state.sketchBook.records[0].revisions[0]);forged.id='sketchrev_forged';state.sketchBook.records[0].revisions.push(forged);return state;}),/revision|live exact/);
});
test('Stop before a proposed write prevents it; Stop after a saved write keeps the receipt',async t=>{
 const f=await fixture(t);await pockets(f);await allow(f);let round=0;const entered=deferred(),finish=deferred();t.after(()=>finish.resolve());
 f.handler=async(b,r)=>{entered.resolve();await finish.promise;wire(r,[{name:'write_sketch',args:create}]);};const first=send(f);await entered.promise;await f.post('/api/cancel',{chatId:f.chatId});finish.resolve();await first;assert.equal(f.app.store.state.sketchBook.records.length,0);
 const secondEntered=deferred(),secondFinish=deferred();t.after(()=>secondFinish.resolve());f.handler=async(b,r)=>{if(round++===0)wire(r,[{name:'write_sketch',args:create}]);else{secondEntered.resolve();await secondFinish.promise;wire(r);}};
 const second=send(f);await secondEntered.promise;assert.equal(f.app.store.state.sketchBook.records.length,1);await f.post('/api/cancel',{chatId:f.chatId});secondFinish.resolve();await second;assert.equal(f.app.store.state.sketchBook.records.length,1);assert.equal(results(f).at(-1).value.saved,true);
});
test('book results never open source history and budgets bound arguments and reading',async t=>{
 const f=await fixture(t);await pockets(f);await allow(f);let round=0;
 f.handler=(b,r)=>round++===0?wire(r,[{name:'write_sketch',args:{...create,text:'x'.repeat(13000)}}]):wire(r);await send(f);assert.equal(f.app.store.state.sketchBook.records.length,0);
 round=0;f.handler=(b,r)=>round++===0?wire(r,[{name:'read_chat_source',args:{source_id:'M1',offset:0}},{name:'read_sketch_book',args:{...list,chatId:'another_branch'}}]):wire(r);await send(f);assert(results(f).slice(-2).every(r=>!r.ok));
 const m=f.app.store.state.models[0];await f.command('model.save',{...m,baseUrl:'http://127.0.0.1:9/v1'});
 assert.deepEqual(makeToolContract(f.app.store.state,{chatId:f.chatId,model:f.app.store.state.models[0],enabled:true,workspaceId:f.app.store.workspaceId}).tools,[]);
});
