import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { CodexProvider } from '../server/codex-provider.mjs';
import { CODEX_CONFIG, CODEX_VERSION } from '../server/codex-policy.mjs';
import { until } from './desk-helpers.mjs';
class Rpc extends EventEmitter {
  closed=false;turns=new Map();requests=[];next=0;rejectSteer=false;
  notify(){} registerToolHandler(){return()=>{};}
  async request(method,params){
    this.requests.push({method,params});
    if(method==='initialize')return {userAgent:'codex/'+CODEX_VERSION};
    if(method==='config/read')return {config:{...structuredClone(CODEX_CONFIG),chatgpt_base_url:'https://chatgpt.com/backend-api/'},layers:[{name:{type:'sessionFlags'},config:structuredClone(CODEX_CONFIG)}]};
    if(method==='account/read')return {account:{type:'chatgpt',email:'fixture@example.test',planType:'plus'}};
    if(method==='model/list')return {data:[{model:'gpt-6-astra',displayName:'Fixture'}]};
    if(method==='thread/start')return {thread:{id:'thread-'+(++this.next)},model:params.model,modelProvider:'openai',approvalPolicy:'never',approvalsReviewer:'user',sandbox:{type:'readOnly'},instructionSources:[],runtimeWorkspaceRoots:[]};
    if(method==='turn/start'){const id=params.threadId+'-turn';this.turns.set(params.threadId,id);return {turn:{id}};}
    if(method==='turn/steer'){if(this.rejectSteer)throw Object.assign(new Error('Turn no longer active'),{providerRejected:true});assert.equal(params.expectedTurnId,this.turns.get(params.threadId));return {turnId:params.expectedTurnId};}
    return {};
  }
  event(threadId,method,params){this.emit('notification',{method,params:{threadId,turnId:this.turns.get(threadId),...params}});}
  finish(threadId){this.event(threadId,'item/agentMessage/delta',{itemId:threadId+'-answer',delta:'Done'});this.event(threadId,'turn/completed',{turn:{status:'completed'}});}
  close(){this.closed=true;}
}
test('pinned Codex steering targets one live turn, carries exact picture bytes and records isolated usage',async()=>{
  const rpc=new Rpc(),provider=new CodexProvider({accountDir:process.cwd(),rpcFactory:()=>rpc,binaryResolver:async()=>'/fixture'}),ready=[],usage=[[],[]],answers=['',''];
  const jobs=[0,1].map(i=>(async()=>{for await(const part of provider.stream({model:'gpt-6-astra'},[{role:'user',content:'Work'}],new AbortController().signal,{onSteerReady:fn=>{ready[i]=fn;},onUsage:value=>usage[i].push(value)}))answers[i]+=part.text;})());
  await until(()=>ready[0]&&ready[1],'both live steering handles');
  const bytes=Buffer.from('synthetic image payload'),hash=crypto.createHash('sha256').update(bytes).digest('hex');
  const image={type:'branchline_image',sha256:hash,mimeType:'image/png',width:2,height:2,byteLength:bytes.length,selectionId:'picture-fixture'};
  const original=ready[0];await original({id:'input-fixture',content:'Human correction',images:[image],imageData:new Map([[hash,'data:image/png;base64,'+bytes.toString('base64')]])});
  const sent=rpc.requests.find(r=>r.method==='turn/steer').params;assert.equal(sent.threadId,'thread-1');assert.equal(sent.expectedTurnId,'thread-1-turn');assert(sent.input.some(p=>p.type==='image'&&p.url.endsWith(bytes.toString('base64'))));
  rpc.event('thread-2','thread/tokenUsage/updated',{tokenUsage:{total:{inputTokens:100,outputTokens:20,cachedInputTokens:50,reasoningOutputTokens:10,totalTokens:120}}});
  assert.equal(usage[0].length,0);assert.equal(usage[1][0].totalTokens,120);
  rpc.rejectSteer=true;await assert.rejects(ready[1]({id:'rejected',content:'A correction'}),error=>error.providerRejected===true);
  assert(!rpc.requests.some(r=>r.method==='turn/interrupt'));rpc.finish('thread-1');rpc.finish('thread-2');await Promise.all(jobs);assert.deepEqual(answers,['Done','Done']);
  assert.equal((await original({content:'Too late'})).accepted,false);assert.equal(rpc.requests.filter(r=>r.method==='turn/start').length,2);assert.equal(ready[0],null);assert.equal(ready[1],null);provider.close();
});
