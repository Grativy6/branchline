import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {fixture,finish,until,input} from './desk-helpers.mjs';
import {routeChairPrompt} from '../public/chair-mentions.js';
import {homeAllowed,homeFolderAccess,homeDestination} from '../server/home-state.mjs';
import {Home} from '../server/home.mjs';
import {makeToolContract,validToolContract} from '../server/tool-contract.mjs';
import {harnessSnapshot} from '../server/harnesses.mjs';
import {pcDestination} from '../server/pc-permissions.mjs';
import {CodexRpc} from '../server/codex-rpc.mjs';
import {CodexProvider} from '../server/codex-provider.mjs';
import {CODEX_CONFIG,CODEX_VERSION} from '../server/codex-policy.mjs';

const chairs=[{id:'a',name:'Astra',modelId:'ma'},{id:'s',name:'Sol',modelId:'ms'},{id:'l',name:'Luna',modelId:'ml'}];
test('recipient-only mentions, optional sections and All have distinct routing',()=>{
 const p=routeChairPrompt('Review this idea. @Astra Work on it. @Sol Try to break it. @Luna',chairs,'a');
 assert.deepEqual(p.errors,[]);assert.equal(p.sharedContext,'Review this idea.');assert.equal(p.sections.length,3);assert.equal(p.sections[2].content,'');
 assert.equal(routeChairPrompt('Hello @Astra @Sol @Luna',chairs,'a').sections.length,3);
 const all=routeChairPrompt('Hello everybody.',chairs,'a','all');assert(all.broadcast);assert(all.sections.every(s=>s.content==='Hello everybody.'));
 assert.deepEqual(routeChairPrompt('Hello @Sol @Luna',chairs,'a','all').sections.map(s=>s.chairId),['s','l']);
 assert.deepEqual(routeChairPrompt('@Astra One. @Sol Two. @Astra Three.',chairs,'a').sections.map(s=>s.content),['One.\n\nThree.','Two.']);
 assert.equal(routeChairPrompt('@Luna',chairs,'a').errors.length,0);
});

async function three(f){
 await f.command('model.save',{name:'Luna',model:'luna',baseUrl:f.fakeUrl,runtime:'compatible',thinking:false});
 const chat=f.app.store.state.chats.find(c=>c.id===f.chatId),m=f.app.store.state.models.find(m=>m.name==='Luna');
 await f.command('table.roster.chair',{chatId:f.chatId,baseRevisionId:chat.seating.revisionId,chairId:null,name:'Luna',modelId:m.id,personalId:null,coat:null});
 return f.app.store.state.chats.find(c=>c.id===f.chatId).seating;
}
const selected=r=>r.speaker==='personal'?r.desk.id:r.selectedVisitorId;
test('All admits three independent tasks and empty addressed sections still reply',{timeout:15000},async()=>{
 const f=await fixture();try{
  let r=await three(f);await f.command('table.replySettings',{chatId:f.chatId,baseRevisionId:r.revisionId,mode:'all',speaker:'personal'});
  const batch=await f.app.deskTasks.admit({...input(f,'The complete shared message.','crew_all'),replyMode:'all'});
  assert.equal(batch.taskIds.length,3);await until(()=>f.requests.length===3,'three All requests');
  assert(f.app.store.state.deskWork.tasks.every(t=>t.content==='The complete shared message.'));
  for(const q of f.requests)finish(q);await until(()=>f.app.store.state.deskWork.tasks.every(t=>t.status==='completed'),'All finished');
  const next=await f.app.deskTasks.admit({...input(f,'Same question. @Hearthline @Qwen @Luna','crew_mentions'),replyMode:'all'});
  assert.equal(next.taskIds.length,3);await until(()=>f.requests.length===6,'empty sections reached models');
  for(const q of f.requests.slice(3))finish(q);await until(()=>f.app.store.state.deskWork.tasks.every(t=>t.status==='completed'),'mentions finished');
 }finally{await f.close();}
});
test('highlight selects any chair and Alternate advances through the occupied desk',{timeout:15000},async()=>{
 const f=await fixture();try{
  let r=await three(f);const order=[r.desk,...r.visitors].map(c=>c.id);
  await f.command('table.roster.select',{chatId:f.chatId,baseRevisionId:r.revisionId,chairId:order[2]});r=f.app.store.state.chats[0].seating;assert.equal(selected(r),order[2]);assert.equal(r.mode,'single');
  await f.command('table.roster.select',{chatId:f.chatId,baseRevisionId:r.revisionId,chairId:order[0]});r=f.app.store.state.chats[0].seating;
  await f.command('table.replySettings',{chatId:f.chatId,baseRevisionId:r.revisionId,mode:'alternate',speaker:'personal'});
  for(let n=0;n<3;n++){
   r=f.app.store.state.chats[0].seating;assert.equal(selected(r),order[n]);
   const b={...input(f,'Take this turn.','crew_alternate_'+n),speaker:r.speaker,replyMode:'alternate'};
   await f.app.deskTasks.admit(b);await until(()=>f.requests.length===n+1,'alternating request');finish(f.requests[n]);
   await until(()=>f.app.store.state.deskWork.tasks.every(t=>t.status==='completed'),'alternating completion');
  }
  assert.equal(selected(f.app.store.state.chats[0].seating),order[0]);
 }finally{await f.close();}
});

function sources(){
 const model={id:'m1',name:'One',model:'one',runtime:'codex',baseUrl:'codex://chatgpt'},other={...model,id:'m2',name:'Two',model:'two'};
 const workspaceId='a'.repeat(32),workspacePath='C:\\BranchlineFixture\\workspace';
 const home={id:'home_before',at:'2026-01-01T00:00:00Z',enabled:true,workspaceId,workspacePath,config:{profile:'hearthline.shelf-read/1',roots:[{id:'home-root',path:'D:\\Sources\\Home'}],orientation:[]},guidance:null,destinations:[homeDestination(model),homeDestination(other)]};
 const pc={id:'p'.repeat(32),workspaceId,workspacePath,read:true,write:true,roots:[{id:'r',directory:true,path:'D:\\Sources',write:true,destinations:[pcDestination(model)]}],denied:[]};
 return {model,other,state:{models:[model,other],home:{profile:'branchline.home/1',settings:[home],arrivals:[],exposures:[]},pcAccess:{settings:[pc]}}};
}
test('Home uses an equivalent folder grant and respects revocation and exclusions',()=>{
 const {state:s,model}=sources();s.home.settings[0].destinations=[];
 assert(homeAllowed(s,model));const pc=s.pcAccess.settings[0];
 pc.read=false;assert(!homeAllowed(s,model));pc.read=true;
 pc.roots[0].frontDoor=true;assert(!homeFolderAccess(s,model));delete pc.roots[0].frontDoor;
 pc.denied=[{path:'D:\\Sources\\Home\\Private'}];assert(!homeFolderAccess(s,model));pc.denied=[];
 pc.protectedPaths=['D:\\Sources\\Home\\runtime'];assert(!homeFolderAccess(s,model));pc.protectedPaths=[];
 pc.workspaceId='different';assert(!homeFolderAccess(s,model));
});
test('equivalent Home grants are reconciled without deleting Home-only readers',async()=>{
 const {state,model,other}=sources(),original=structuredClone(state.home.settings[0]);
 const store={state,workspaceId:original.workspaceId,dataDir:original.workspacePath,async transact(fn){this.state=fn(this.state);}};const home=new Home(store);
 await home.reconcileFolderSharing();assert.deepEqual(state.home.settings[0],original);assert.equal(state.home.settings.length,2);
 assert.deepEqual(state.home.settings.at(-1).destinations,[homeDestination(other)]);assert(homeAllowed(state,model));
 state.pcAccess.settings[0].read=false;assert(!homeAllowed(state,model));assert(homeAllowed(state,other));
});
test('normal Coats inherit granted PC tools, while explicit custom choices remain exact',async()=>{
 const f=await fixture();try{
  const s=structuredClone(f.app.store.state),m=s.models[0],chat=s.chats.find(c=>c.id===f.chatId),workspaceId=f.app.store.workspaceId,workspacePath=f.app.store.dataDir;
  s.pcAccess={settings:[{id:'c'.repeat(32),workspaceId,workspacePath,read:true,write:true,roots:[{id:'b'.repeat(32),label:'Files',path:'D:\\Fixture',directory:true,write:true,destinations:[pcDestination(m)]}],denied:[]}]};
  const opts={chatId:chat.id,model:m,enabled:true,seat:'personal',workspaceId,workspacePath,pcAvailable:true,chairId:chat.seating.desk.id};
  const contract=makeToolContract(s,opts),tools=contract.tools;assert(tools.includes('read_pc_text'));assert(tools.includes('edit_pc_text'));assert.equal(contract.pc.roots[0].path,'D:\\Fixture');assert(validToolContract(contract,m));
  const legacy=structuredClone(contract);legacy.coat.pockets=null;delete legacy.inheritFileTools;legacy.bindings=legacy.bindings.filter(b=>!b.tool.endsWith('_pc_text')&&b.tool!=='list_pc_files');legacy.tools=legacy.bindings.map(b=>b.tool);delete legacy.pc.roots[0].path;assert(validToolContract(legacy,m),'Historical default pockets remain valid');
  const snapshot=harnessSnapshot(s,chat.id,'personal');snapshot.preset.pockets={profile:'branchline.coat-pockets/1',selected:[]};
  assert.deepEqual(makeToolContract(s,{...opts,coatSnapshot:snapshot}).tools,[]);
  s.pcAccess.settings[0].roots[0].write=false;assert(!makeToolContract(s,opts).tools.includes('edit_pc_text'));
 }finally{await f.close();}
});

test('Codex RPC routes concurrent tool requests by thread, including unknown-thread failures',async()=>{
 const writes=[],child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new Writable({write(chunk,encoding,done){writes.push(JSON.parse(chunk.toString()));done();}});child.kill=()=>{child.killed=true;};
 const rpc=new CodexRpc('fixture',[],{spawnProcess:()=>child});const seen=[];
 rpc.registerToolHandler('a',async p=>{await new Promise(r=>setTimeout(r,15));seen.push(p.threadId);return {proof:'A'};});
 rpc.registerToolHandler('b',async p=>{seen.push(p.threadId);return {proof:'B'};});
 let blocked;rpc.on('blockedRequest',e=>blocked=e);
 for(const [id,threadId]of[[1,'a'],[2,'b'],[3,'unknown']])child.stdout.write(JSON.stringify({id,method:'item/tool/call',params:{threadId}})+'\n');
 await until(()=>writes.length===3,'RPC responses');assert.equal(writes.find(w=>w.id===1).result.proof,'A');assert.equal(writes.find(w=>w.id===2).result.proof,'B');assert(writes.find(w=>w.id===3).error);assert.equal(blocked.params.threadId,'unknown');assert.deepEqual(seen,['b','a']);rpc.close();
});

class StreamRpc extends EventEmitter {
 closed=false;next=0;handlers=new Map();threads=new Map();interrupts=[];
 notify(){} registerToolHandler(id,fn){this.handlers.set(id,fn);return()=>this.handlers.delete(id);}
 async request(method,p){
  if(method==='initialize')return {userAgent:'codex/'+CODEX_VERSION};
  if(method==='config/read')return {config:{...structuredClone(CODEX_CONFIG),chatgpt_base_url:'https://chatgpt.com/backend-api/'},layers:[{name:{type:'sessionFlags'},config:structuredClone(CODEX_CONFIG)}]};
  if(method==='account/read')return {account:{type:'chatgpt',email:'fixture@example.test',planType:'plus'}};
  if(method==='model/list')return {data:['one','two','three'].map(model=>({model,displayName:model}))};
  if(method==='thread/start'){const id='thread-'+(++this.next);return {thread:{id},model:p.model,modelProvider:'openai',approvalPolicy:'never',approvalsReviewer:'user',sandbox:{type:'readOnly'},instructionSources:[],runtimeWorkspaceRoots:[]};}
  if(method==='turn/start'){const id=p.threadId+'-turn';this.threads.set(p.threadId,{id,model:p.model});return {turn:{id}};}
  if(method==='turn/interrupt'){this.interrupts.push(p);this.emit('notification',{method:'turn/completed',params:{...p,turn:{status:'interrupted'}}});return {};}
  return {};
 }
 finish(id,text){const turnId=this.threads.get(id).id;this.emit('notification',{method:'item/agentMessage/delta',params:{threadId:id,turnId,itemId:id+'-answer',delta:text}});this.emit('notification',{method:'turn/completed',params:{threadId:id,turnId,turn:{status:'completed'}}});}
 close(){this.closed=true;this.emit('disconnected',new Error('Closed'));}
}
test('stopping one concurrent Codex turn leaves its peers and their handlers alive',async()=>{
 const rpc=new StreamRpc(),p=new CodexProvider({accountDir:process.cwd(),binaryResolver:async()=>'/fixture',rpcFactory:()=>rpc});
 const stops=[new AbortController(),new AbortController(),new AbortController()];
 const jobs=['one','two','three'].map((model,i)=>(async()=>{let text='';for await(const part of p.stream({model},[{role:'user',content:'Hi'}],stops[i].signal,{tools:{definitions:[],invoke(){}}}))text+=part.text;return text;})());
 const stopped=assert.rejects(jobs[0],/stopped|aborted|interrupted/i);
 await until(()=>rpc.threads.size===3,'concurrent turns');assert.equal(rpc.handlers.size,3);stops[0].abort();await stopped;
 assert(!rpc.closed);assert.equal(rpc.interrupts.length,1);assert.equal(rpc.interrupts[0].threadId,'thread-1');assert.equal(rpc.handlers.size,2);
 rpc.finish('thread-3','Third');rpc.finish('thread-2','Second');assert.deepEqual(await Promise.all(jobs.slice(1)),['Second','Third']);assert.equal(rpc.handlers.size,0);assert.equal(p.activeCalls.size,0);p.close();
});
