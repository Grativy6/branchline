import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {writeGguf} from './local-model-fixtures.mjs';
import {ggufMetadata,inspectGguf} from '../server/gguf.mjs';
import {fixture,until,input} from './desk-helpers.mjs';
import {LocalRunner} from '../server/local-runner.mjs';
import {contextBudget} from '../server/context-budget.mjs';
import {localFileFor} from '../server/local-model-state.mjs';
import {replayJournal} from '../server/journal.mjs';

test('GGUF preview reads identity and prompt format without reading the weight payload',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'branchline-gguf-'));
  const bytes=await writeGguf(path.join(dir,'base.gguf'));
  assert.equal(ggufMetadata(bytes).inputFormat,'plain-dialogue-v1');assert.equal(ggufMetadata(bytes).contextLength,8192);
  const chat=await writeGguf(path.join(dir,'chat.gguf'),{template:'{{ messages }}'});assert.equal(ggufMetadata(chat).inputFormat,'chat');
  await writeGguf(path.join(dir,'mmproj-test.gguf'),{architecture:'clip'});assert((await inspectGguf(path.join(dir,'mmproj-test.gguf'))).unsupportedReason);
  await writeGguf(path.join(dir,'noted.gguf'),{description:''});await fs.writeFile(path.join(dir,'noted.md'),'# Model note\n\nA supplied local description.');assert.equal((await inspectGguf(path.join(dir,'noted.gguf'))).description,'A supplied local description.');
  assert.throws(()=>ggufMetadata(bytes.subarray(0,30)));const malformed=Buffer.from(bytes);malformed.writeBigUInt64LE(9999999999n,16);assert.throws(()=>ggufMetadata(malformed));
});

test('search previews files; explicit Add persists identity, deduplicates and removes only the library entry',async()=>{
  const f=await fixture();try{
    const dir=path.join(f.dir,'models');await fs.mkdir(dir);await writeGguf(path.join(dir,'base.gguf'));await writeGguf(path.join(dir,'mmproj.gguf'),{architecture:'clip'});
    const before=f.app.store.state.models.length;
    await f.app.localModels.startSearch({folder:dir});await until(()=>f.app.localModels.searchView().phase==='complete','search');
    const search=f.app.localModels.searchView(),candidate=search.candidates.find(c=>!c.unsupportedReason);
    assert.equal(f.app.store.state.models.length,before);assert.equal(f.requests.length,0);
    const added=await f.app.localModels.add({searchId:search.id,candidateId:candidate.candidateId,name:'My local model'},new AbortController().signal);
    const model=f.app.store.state.models.find(m=>m.id===added.modelId);assert.equal(model.runtime,'gguf');assert.equal(model.inputFormat,'plain-dialogue-v1');assert.equal((await f.app.localModels.list()).models.length,1);
    const duplicate=await f.app.localModels.add({searchId:search.id,candidateId:candidate.candidateId,name:'Another name'},new AbortController().signal);assert.equal(duplicate.modelId,added.modelId);assert(duplicate.alreadyAdded);
    await f.app.localModels.remove(added.modelId);assert.equal((await f.app.localModels.list()).models.length,0);assert((await fs.stat(candidate.path)).isFile());
    await f.app.localModels.add({searchId:search.id,candidateId:candidate.candidateId,name:'Return'},new AbortController().signal);assert.equal((await f.app.localModels.list()).models[0].modelId,added.modelId);
    assert.equal(f.requests.length,0);const replay=await replayJournal(path.join(f.dir,'workspace/events.jsonl'));assert.equal(localFileFor(replay.state,model).sha256,localFileFor(f.app.store.state,model).sha256);
    await fs.appendFile(candidate.path,'changed');await assert.rejects(f.app.localModels.add({searchId:search.id,candidateId:candidate.candidateId,name:'Changed'},new AbortController().signal),/changed/);
  }finally{await f.close();}
});

test('local-file requests share the existing local slot and retain their selected completion transport', {timeout:15000},async()=>{
  const f=await fixture();try{
    const dir=path.join(f.dir,'models');await fs.mkdir(dir);await writeGguf(path.join(dir,'base.gguf'));
    await f.app.localModels.startSearch({folder:dir});await until(()=>f.app.localModels.searchView().phase==='complete','search');const s=f.app.localModels.searchView();
    const added=await f.app.localModels.add({searchId:s.id,candidateId:s.candidates[0].candidateId,name:'Local'},new AbortController().signal);
    const model=f.app.store.state.models.find(m=>m.id===added.modelId);
    for(const seat of ['desk','visitor']){const r=f.app.store.state.chats[0].seating,c=seat==='desk'?r.desk:r.visitors[0];await f.command('table.roster.chair',{chatId:f.chatId,baseRevisionId:r.revisionId,chairId:c.id,name:c.name,modelId:model.id,personalId:null,coat:null});}
    f.app.localRunner.fetch=(_model,_url,options)=>fetch(f.fakeUrl+'/completions',options);
    await f.app.deskTasks.admit(input(f,'@hearthline One @qwen Two','files_queue'));
    await until(()=>f.requests.length===1,'first local request');assert.equal(f.app.deskTasks.status()[1].phase,'Waiting for local runtime slot');assert(f.requests[0].body.prompt.includes('Assistant:\n'));assert(f.requests[0].body.prompt.startsWith('System:\nYou are a local AI model running in Branchline. You will work collaboratively at a metaphorical desk.\n\nUser:\n'));assert(!f.requests[0].body.prompt.includes('[Working method'));assert(!f.requests[0].body.prompt.includes('[Conversation chair]'));assert(!f.requests[0].body.messages);
    const finish=q=>{q.res.writeHead(200,{'content-type':'text/event-stream'});q.res.end('data: '+JSON.stringify({choices:[{text:'Hello from the fixture.',finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');};finish(f.requests[0]);
    await until(()=>f.requests.length===2,'queued local request');finish(f.requests[1]);await until(()=>f.app.deskTasks.status().every(t=>t.status==='completed'),()=>JSON.stringify(f.app.deskTasks.status()));
    const budget=await contextBudget(model,{localRunner:f.app.localRunner});assert.equal(budget.configuredTokens,8192);assert.equal(budget.loadedTokens,null);
  }finally{await f.close();}
});

test('owned runner switches files, retains Qwen controls, and closes only its own processes',async()=>{
  const events=[];const make=id=>({open:async()=>{},status:()=>({available:true,phase:'idle',busy:false,contextTokens:8192}),fetch:async()=>{events.push('fetch:'+id);return id;},beforeOtherLocal:async()=>events.push('unload:'+id),unload:async()=>events.push('unload:'+id),setPreference:async()=>events.push('cpu:'+id),close:async()=>events.push('close:'+id),restoreContext(){}});
  const model={id:'m',runtime:'gguf',model:'branchline-file-'+'a'.repeat(64),baseUrl:'http://127.0.0.1:0/v1',inputFormat:'chat'},file={id:'f',modelId:'m',sha256:'a'.repeat(64),metadata:{name:'File'},contextTokens:8192};
  const runner=new LocalRunner('unused',{getState:()=>({localModels:{files:[file]}}),bundled:make('qwen'),runnerFactory:()=>make('file')});
  await runner.open();await runner.fetch({runtime:'bundled'},'',{});await runner.fetch(model,'',{});await runner.unloadBundled();assert.equal(events.filter(e=>e==='unload:file').length,0);
  await runner.fetch({runtime:'bundled'},'',{});assert(events.includes('unload:file'));await runner.close();assert(events.includes('close:qwen')&&events.includes('close:file'));
});

test('a pending file open retains the local slot before a Dream can reserve it',async()=>{
  let release;const opening=new Promise(resolve=>release=resolve),events=[];
  const make=id=>({async open(){if(id==='file')await opening;},status:()=>({busy:false,available:true}),async unload(){},async beforeOtherLocal(){},async close(){},async fetch(){events.push(id);return id;}});
  const file={id:'file',modelId:'model',sha256:'a'.repeat(64),metadata:{inputFormat:'chat'},contextTokens:8192},model={id:'model',runtime:'gguf',model:'branchline-file-'+'a'.repeat(64),baseUrl:'http://127.0.0.1:0/v1',inputFormat:'chat'};
  const runner=new LocalRunner('unused',{getState:()=>({localModels:{files:[file]}}),bundled:make('stock'),runnerFactory:()=>make('file')});
  const request=runner.fetch(model,'',{});assert.equal(await runner.reserveDream('dream'),false);release();assert.equal(await request,'file');assert.equal(await runner.reserveDream('dream'),true);
  await assert.rejects(runner.fetch(model,'',{}),/Dream is using/);assert.deepEqual(events,['file']);runner.releaseDream('dream');await runner.close();
});
