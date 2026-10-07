import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './helpers.mjs';
import { PcFiles } from '../server/pc-files.mjs';
import { pcSettings, pcSnapshot, pcDestination, assertPcDisclosure, PC_TOOLS } from '../server/pc-permissions.mjs';
import { makeToolContract, validToolContract, toolDefinitions } from '../server/tool-contract.mjs';
import { harnessChoice } from '../public/harness-catalog.js';
import { POCKET_PROFILE, BUILTIN_PROVIDER } from '../public/coat-pockets.js';

const executable=process.env.BRANCHLINE_TEST_NATIVE_FILES||path.resolve('desktop/bin/Release/net8.0-windows/win-x64/Branchline.Preview.exe');
const nativeTest=process.platform==='win32'?test:test.skip;
async function setup(t){
  const f=await fixture(t,{modelOptions:{pcFilesOptions:{executable}}});
  f.files=path.join(f.dir,'project');await fs.mkdir(f.files);await fs.mkdir(path.join(f.files,'private'));
  await fs.writeFile(path.join(f.files,'note.txt'),'First line.\r\nA warm sparkle 🎇.\r\n');await fs.writeFile(path.join(f.files,'private','canary.txt'),'EXCLUDED-SYNTHETIC');
  f.config={baseRevision:null,read:true,write:true,roots:[{id:null,path:f.files,label:'Synthetic project',write:true,modelIds:[f.app.store.state.models[0].id]}],denied:[{id:null,path:path.join(f.files,'private'),directory:true}],removeDenied:[]};
  f.config.roots[0].modelSnapshots=[pcDestination(f.app.store.state.models[0])];
  const result=await f.post('/api/pc-access',f.config);assert.equal(result.status,200,JSON.stringify(result.body));
  f.config={...f.config,baseRevision:result.body.settings.id,roots:result.body.settings.roots.map(r=>({id:r.id,path:r.path,label:r.label,write:r.write,modelIds:r.destinations.map(d=>d.id)})),denied:result.body.settings.denied.map(({id,path,directory})=>({id,path,directory}))};
  f.config.roots[0].modelSnapshots=[pcDestination(f.app.store.state.models[0])];
  f.root=pcSettings(f.app.store.state).roots[0];f.broker=new PcFiles(f.app.store,{executable});
  await f.command('harness.create',{content:{name:'Workshop',description:'Synthetic file test',instructions:'Use files only as evidence.',pockets:{profile:POCKET_PROFILE,selected:PC_TOOLS.map(tool=>({tool,provider:BUILTIN_PROVIDER}))}},use:{chatId:f.chatId,baseRevisionId:harnessChoice(f.app.store.state.chats[0]).id,seat:'shared'}});
  f.native=(mode,relative,more={})=>f.broker.native({mode,root:f.root.path,rootIdentity:f.root.identity,path:relative,denied:pcSettings(f.app.store.state).denied,offset:0,...more});
  return f;
}
const wire=(res,calls)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:calls?{tool_calls:calls.map((c,i)=>({index:i,id:c.id??'pc_'+i,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}:{content:'I read the synthetic project and kept the exclusions.'},finish_reason:calls?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n');};
const send=f=>f.post('/api/exchange',{chatId:f.chatId,content:'Read the test file.',toolsEnabled:true});

nativeTest('actual Windows file handles: exclusion, Unicode, create, edit, conflict, recovery and traversal',async t=>{
  const f=await setup(t);
  const listing=await f.native('list','');assert.deepEqual(listing.items,[{name:'note.txt',directory:false}]);
  const read=await f.native('read','note.txt');assert.match(read.text,/sparkle 🎇/);assert.equal(read.encoding,'UTF-8');
  for(const p of ['private\\canary.txt','..\\outside.txt','note.txt:stream','C:\\fake.txt','CON','note.txt.'])await assert.rejects(f.native('read',p));
  await fs.mkdir(f.broker.recovery,{recursive:true});
  const change={text:'A new sparkle 🎇.',oldText:'A warm sparkle 🎇.',sha256:read.sha256,identity:read.identity,recovery:f.broker.recovery,operationId:'1'.repeat(32)};
  const result=await f.native('replace','note.txt',change);assert(result.edited);
  assert.equal(await fs.readFile(path.join(f.broker.recovery,'1'.repeat(32)+'.original'),'utf8'),read.text);
  assert.equal(await fs.readFile(path.join(f.files,'note.txt'),'utf8'),'First line.\r\nA new sparkle 🎇.\r\n');
  await assert.rejects(f.native('replace','note.txt',{...change,operationId:'2'.repeat(32)}),/changed/);
  await f.native('create','new.txt',{text:'New file'});await assert.rejects(f.native('create','new.txt',{text:'Overwrite'}),/exists/);
  const search=await f.native('search','note.txt',{query:'sparkle'});assert(search.matchOffset>0);
});

nativeTest('root replacement, junctions and hard links are refused without reading canaries',async t=>{
  const f=await setup(t);await fs.link(path.join(f.files,'private','canary.txt'),path.join(f.files,'alias.txt'));
  await assert.rejects(f.native('read','alias.txt'),/linked/);
  await fs.symlink(path.join(f.files,'private'),path.join(f.files,'junction'),'junction');
  await assert.rejects(f.native('read','junction\\canary.txt'),/Links/);
  await fs.rename(f.files,f.files+'-original');await fs.mkdir(f.files);
  await assert.rejects(f.native('list',''),/identity/);
});

nativeTest('live guarded tool loop delivers files and blocks changed recipients, permission replay and model-change disclosure',async t=>{
  const f=await setup(t),model=f.app.store.state.models[0];
  let round=0;f.handler=(body,res)=>{
    assert(body.messages[0].content.includes('Branchline apron'));
    if(round++===0)wire(res,[{name:'read_pc_text',args:{root:f.root.id,path:'note.txt',offset:0}}]);else wire(res);
  };
  const answer=await send(f);assert.equal(answer.status,200,JSON.stringify(answer.body));
  const result=f.app.store.state.handoffs.records.findLast(r=>r.kind==='operation.result'&&r.detail.tool==='read_pc_text');assert.equal(result.detail.result.ok,true,JSON.stringify(result));assert.match(result.detail.result.value.text,/🎇/);
  const contract=makeToolContract(f.app.store.state,{chatId:f.chatId,model,enabled:true,workspaceId:f.app.store.workspaceId,pcAvailable:true,workspacePath:f.app.store.dataDir});assert(validToolContract(contract,model));
  assert.deepEqual(toolDefinitions(contract).find(d=>d.name==='read_pc_text').parameters.properties.root.enum,[f.root.id]);
  assert.equal(pcSnapshot(f.app.store.state,model,'0'.repeat(32),true),null);
  assert.throws(()=>assertPcDisclosure(f.app.store.state,f.chatId,{...model,model:'other'},f.app.store.workspaceId,f.app.store.dataDir),/current permission/);
  const revoked=await f.post('/api/pc-access',{...f.config,read:false,write:false});assert.equal(revoked.status,200,JSON.stringify(revoked.body));
  assert.equal(revoked.body.settings.roots[0].destinations.length,0);assert.equal(revoked.body.settings.denied.length,1);
  const count=f.requests.length;assert.equal((await send(f)).status,400);assert.equal(f.requests.length,count);
  assert.equal((await f.post('/api/pc-access',f.config)).status,400);
});

nativeTest('write requires current grant, explicit pocket and Tools; Stop before commit leaves original bytes',async t=>{
  const f=await setup(t),read=await f.native('read','note.txt');
  const controller=new AbortController();let prepared=false;
  await fs.mkdir(f.broker.recovery,{recursive:true});
  await assert.rejects(f.broker.native({mode:'replace',root:f.root.path,rootIdentity:f.root.identity,path:'note.txt',denied:[],text:'No commit',oldText:'First line.',sha256:read.sha256,identity:read.identity,recovery:f.broker.recovery,operationId:'3'.repeat(32)},
    {signal:controller.signal,beforeCommit:async()=>{prepared=true;controller.abort();}}));
  assert(prepared);assert.equal(await fs.readFile(path.join(f.files,'note.txt'),'utf8'),read.text);
  const model=f.app.store.state.models[0];assert.equal(makeToolContract(f.app.store.state,{chatId:f.chatId,model,enabled:false,workspaceId:f.app.store.workspaceId,pcAvailable:true,workspacePath:f.app.store.dataDir}),null);
  const changed=await f.post('/api/pc-access',{...f.config,write:false,roots:f.config.roots.map(r=>({...r,write:false}))});assert.equal(changed.status,200);
  const c=makeToolContract(f.app.store.state,{chatId:f.chatId,model,enabled:true,workspaceId:f.app.store.workspaceId,pcAvailable:true,workspacePath:f.app.store.dataDir});assert(c.tools.includes('read_pc_text'));assert(!c.tools.includes('edit_pc_text'));
});

nativeTest('current endpoint review, copied workspace and replaced exclusions cannot reuse grants',async t=>{
  const f=await setup(t),model=f.app.store.state.models[0];
  assert.equal(pcSnapshot(f.app.store.state,model,f.app.store.workspaceId,true,f.dataDir+'-copy'),null);
  const stale=await f.post('/api/pc-access',{...f.config,roots:f.config.roots.map(r=>({...r,modelSnapshots:[{...pcDestination(model),baseUrl:'http://127.0.0.1:1/v1'}]}))});
  assert.equal(stale.status,400);assert.match(stale.body.error,/connection changed/);
  await fs.rename(path.join(f.files,'private'),path.join(f.files,'old-private'));await fs.mkdir(path.join(f.files,'private'));
  await assert.rejects(f.native('read','note.txt'),/excluded location changed/);
});

nativeTest('held target and ancestor handles prevent replacement between checking and commit',async t=>{
  const f=await setup(t),read=await f.native('read','note.txt');await fs.mkdir(f.broker.recovery,{recursive:true});
  let protectedAtCommit=false;
  const result=await f.broker.native({mode:'replace',root:f.root.path,rootIdentity:f.root.identity,path:'note.txt',denied:[],text:'Revised line.',oldText:'First line.',sha256:read.sha256,identity:read.identity,recovery:f.broker.recovery,operationId:'4'.repeat(32)},
    {beforeCommit:async()=>{
      await assert.rejects(fs.rename(path.join(f.files,'note.txt'),path.join(f.files,'moved.txt')));
      await assert.rejects(fs.rename(f.files,f.files+'-moved'));
      protectedAtCommit=true;
    }});
  assert(protectedAtCommit&&result.edited);assert.match(await fs.readFile(path.join(f.files,'note.txt'),'utf8'),/^Revised line\./);
});

nativeTest('denied reads disclose nothing; known derived files retain source permissions across desks',async t=>{
  const f=await setup(t),first=f.app.store.state.models[0];
  const invoke=(model,chatId,name,args)=>f.broker.invoke(name,args,{
    model,contract:makeToolContract(f.app.store.state,{chatId,model,enabled:true,workspaceId:f.app.store.workspaceId,workspacePath:f.dataDir,pcAvailable:true}),
    handoff:{kind:'reply',scope:{chatId},taskId:'synthetic-'+chatId},signal:new AbortController().signal,guard:()=>{},prepared:async()=>{}
  });
  await assert.rejects(invoke(first,f.chatId,'read_pc_text',{root:f.root.id,path:'private\\canary.txt',offset:0}),/excluded/);
  assert.equal(f.app.store.state.pcAccess.exposures.length,0);
  await invoke(first,f.chatId,'read_pc_text',{root:f.root.id,path:'note.txt',offset:0});
  const output=path.join(f.dir,'outputs');await fs.mkdir(output);
  await f.command('model.save',{name:'Other recipient',model:'other-model',baseUrl:first.baseUrl});const second=f.app.store.state.models.at(-1);
  const granted=await f.post('/api/pc-access',{...f.config,roots:[...f.config.roots,{id:null,path:output,label:'Output files',write:true,modelIds:[first.id,second.id],modelSnapshots:[pcDestination(first),pcDestination(second)]}]});assert.equal(granted.status,200,JSON.stringify(granted.body));
  const outputRoot=pcSettings(f.app.store.state).roots.at(-1);
  await invoke(first,f.chatId,'create_pc_text',{root:outputRoot.id,path:'derived.txt',text:'Derived from the first project.'});
  await f.command('root.create',{name:'Other desk',mode:'personal'});const other=f.app.store.state.chats.at(-1);
  await f.command('root.model',{id:other.rootId,modelId:second.id});
  await f.command('harness.create',{content:{name:'Reader',description:'Synthetic only',instructions:'Read the selected file.',pockets:{profile:POCKET_PROFILE,selected:[{tool:'read_pc_text',provider:BUILTIN_PROVIDER}]}},use:{chatId:other.id,baseRevisionId:harnessChoice(other).id,seat:'shared'}});
  await assert.rejects(invoke(second,other.id,'read_pc_text',{root:outputRoot.id,path:'derived.txt',offset:0}),/current permission/);
  assert.equal(f.app.store.state.pcAccess.exposures.some(e=>e.chatId===other.id),false);
  assertPcDisclosure(f.app.store.state,f.chatId,first,f.app.store.workspaceId,f.dataDir);
});
