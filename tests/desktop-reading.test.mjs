import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,deferred} from './helpers.mjs';
import {RESOURCE_DEFAULTS} from '../public/resource-settings.js';
function wire(res,{id,document,offset,text='Page notes retained.'}={}) {
 res.writeHead(200,{'content-type':'text/event-stream'});
 res.write('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\n');
 if(id)res.write('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id,type:'function',function:{name:'read_selected_document',arguments:JSON.stringify({document_id:document,offset})}}]}}]})+'\n\n');
 res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:id?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n');
}
const results=f=>f.app.store.state.handoffs.records.filter(r=>r.kind==='operation.result'&&r.detail.tool==='read_selected_document'&&r.detail.result?.ok);
test('128 KiB sequential reading exceeds eight rounds within a smaller window and retains exact receipts and cross-page notes',async t=>{
 const f=await fixture(t,{modelOptions:{maxContextCharacters:30000}});let next=4000,round=0;
 const text='First relation: shelf belongs to Iris. '.padEnd(131035,'x')+' Last relation: Iris chooses green.   ';assert(Buffer.byteLength(text)>=131072);
 await f.command('root.resources',{id:f.rootId,resources:{...RESOURCE_DEFAULTS,fileBytes:262144,toolCalls:40,toolResultBytes:250000}});
 f.handler=(body,res)=>{
  assert(body.messages.reduce((n,m)=>n+(m.content?.length??0),0)<30000);round++;
  const doc=body.tools.find(t=>t.function.name==='read_selected_document').function.parameters.properties.document_id.enum[0];
  const prior=body.messages.filter(m=>m.role==='tool').at(-1);if(prior){const r=JSON.parse(prior.content);assert.equal(r.ok,true);next=r.value.nextOffset;}
  if(next===null)return wire(res,{text:'The two source relations connect Iris to the shelf and to green; all page receipts are present.'});
  wire(res,{id:'page_'+next,document:doc,offset:next,text:'Preserved note: Iris owns the shelf; reopen range zero for exact wording.'});
 };
 const result=await f.post('/api/exchange',{chatId:f.chatId,content:'Read this whole text in order and connect the first and last facts.',toolsEnabled:true,selectedFile:{name:'128-kib.txt',base64:Buffer.from(text).toString('base64')}});
 assert.equal(result.status,200,result.body.error);assert(round>8);assert.equal(results(f).at(-1).detail.result.value.nextOffset,null);
 let restored=text.slice(0,4000);for(const r of results(f))restored+=r.detail.result.value.text;assert.equal(restored,text);
 assert(f.requests.at(-1).messages.some(m=>m.role==='tool'&&m.content.includes('Previously delivered page')));
 assert.equal(f.app.store.state.exchanges[0].selectedFile.text,text);
});
test('stopping a document sequence keeps the delivered offset and permits explicit resumption',async t=>{
 const f=await fixture(t),waiting=deferred(),release=deferred();t.after(()=>release.resolve());let round=0;
 const text='start '.padEnd(130000,'a');
 f.handler=async(body,res)=>{const doc=body.tools.find(t=>t.function.name==='read_selected_document').function.parameters.properties.document_id.enum[0];if(round++===0)return wire(res,{id:'one',document:doc,offset:4000});waiting.resolve();await release.promise;wire(res,{text:'Late response.'});};
 const pending=f.post('/api/exchange',{chatId:f.chatId,content:'Read in order.',toolsEnabled:true,selectedFile:{name:'sequence.txt',base64:Buffer.from(text).toString('base64')}});await waiting.promise;
 assert.equal((await f.post('/api/cancel',{chatId:f.chatId})).status,200);release.resolve();assert.equal((await pending).status,409);
 const delivered=results(f);assert.equal(delivered.length,1);assert.equal(delivered[0].detail.result.value.nextOffset,8000);const doc=delivered[0].detail.result.value.documentId;
 round=0;f.handler=(body,res)=>round++===0?wire(res,{id:'resume',document:doc,offset:8000}):wire(res,{text:'Resumed from 8000; later pages remain unread.'});
 const resumed=await f.post('/api/exchange',{chatId:f.chatId,content:'Resume at offset 8000 for one page, then report what remains.',toolsEnabled:true});assert.equal(resumed.status,200,resumed.body.error);assert.equal(results(f).at(-1).detail.result.value.offset,8000);
});
