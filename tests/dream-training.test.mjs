import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Store} from '../server/store.mjs';
import {configureBundledModel} from '../server/bundled-setup.mjs';
import {Dreams,preparedEpisodes,sourceWindows} from '../server/dream-training.mjs';
import {dreamNotes,currentDreamRun} from '../public/dream-training-state.js';
import {writeGguf} from './local-model-fixtures.mjs';
import {atomicJson} from '../server/dream-worker.mjs';
import {StorageManager} from '../server/storage.mjs';
import {captureDreamSource} from '../server/dream-training-state.mjs';
import {applyCommand} from '../server/domain.mjs';
import {cleanDreamExport} from '../server/dream-cleanup.mjs';
const wait=async f=>{for(let i=0;i<300;i++){if(f())return;await delay(10);}throw new Error('Timed out waiting for Dream state');};

async function fixture(options={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'branchline-dreams-')),store=new Store(path.join(dir,'workspace'),{checkpoints:false});await store.open();await store.transact(s=>configureBundledModel(s,{fresh:true}));
  const runtimeFile=path.join(dir,'runtime.json');await atomicJson(runtimeFile,{profile:'branchline.dream-runtime/1',backend:'native',python:'fixture-python',basePath:dir,baseRevision:'fixture-base'});
  const calls=[],workers=[];let lease=null;
  const runner={bundled:{manifest:{profile:'synthetic-bundled'},async verify(){}},async reserveDream(id){if(lease&&lease!==id)return false;lease=id;return true;},releaseDream(id){if(lease===id)lease=null;},forDream(){return this;},async unload(){},rememberVerifiedFile(){},async probeFile(){return {loaded:true}}};
  const generate=async(model,messages)=>{calls.push({model,messages});return {content:JSON.stringify({episodes:[{messages:[{role:'user',content:'Please slow down and help me understand.'},{role:'assistant',content:'We can take this one step at a time and keep the useful context.'}]}]})};};
  const workerFactory=(engine,file,{onEvent})=>{
    let intent='run';const worker={file,event:onEvent,async control(value){intent=value;},async run(){
      await onEvent({kind:'phase',phase:'training',message:'Synthetic worker'});while(intent==='run'||intent==='hold'){if(worker.finish)break;await delay(10);}
      if(worker.error)throw new Error(worker.error);if(intent==='suspend')return {status:'suspended',checkpoint:true};if(intent==='stop')return {status:'stopped'};
      const root=path.dirname(file);await fs.mkdir(path.join(root,'adapter'),{recursive:true});await fs.writeFile(path.join(root,'adapter','adapter_model.safetensors'),'synthetic adapter bytes');await writeGguf(path.join(root,'candidate.gguf'),{template:'{{ messages }}',seed:2});return {status:'ready',modelFile:'candidate.gguf',adapter:'adapter',step:2,examples:1,loss:1};
    }};workers.push(worker);return worker;
  };
  const dreams=new Dreams(store,{localRunner:runner,runtimeFile,generate,workerFactory,...options});await dreams.recover();
  return {dir,store,dreams,calls,workers,runner,person:store.state.personalParticipants[0].id,async close(){await dreams.close();await store.close();await fs.rm(dir,{recursive:true,force:true});}};
}
test('manual notes need no model approval; revisions and per-model use retain the source',async()=>{
  const f=await fixture();try{
    const n=await f.dreams.saveNote({kind:'manual',personalId:f.person,name:'Finding the thread again',focus:'conversation',text:'A misunderstanding happened. We slowed down, corrected it, and continued.'});
    assert.equal(f.calls.length,0);assert.equal((await f.dreams.note(n.id)).source.text.includes('misunderstanding'),true);
    const edit=await f.dreams.saveNote({kind:'manual',noteId:n.noteId,baseRevisionId:n.id,personalId:f.person,name:n.name,focus:'conversation',text:'The original remains; this is the later note.'});
    assert.equal((await f.dreams.note(n.id)).source.text.includes('misunderstanding'),true);assert.equal(dreamNotes(f.store.state,f.person)[0].id,edit.id);
    await f.dreams.choice({personalId:f.person,noteId:n.noteId,included:false});assert.equal(dreamNotes(f.store.state,f.person)[0].included,false);
  }finally{await f.close();}
});
test('Suspend keeps the frozen batch; Cancel releases a hold; Stop keeps later edits and prior generation',async()=>{
  const f=await fixture();try{
    const initial=f.store.state.personalParticipants[0].currentGenerationId,n=await f.dreams.saveNote({kind:'manual',personalId:f.person,name:'Workflow',focus:'workflow',text:'Inspect the input, make the change, check the result, and explain it.'});
    const {id}=await f.dreams.start({personalId:f.person});await wait(()=>f.workers.length===1);
    await f.dreams.control({id,action:'hold'});assert.equal(f.dreams.run(id).status,'pausing');await f.dreams.control({id,action:'cancel-hold'});
    await f.workers[0].event({kind:'phase',phase:'exporting',message:'Exporting saved work'});await f.dreams.control({id,action:'hold'});await f.dreams.control({id,action:'cancel-hold'});assert.equal(f.dreams.run(id).status,'exporting');
    await f.dreams.control({id,action:'suspend'});await wait(()=>f.dreams.run(id).status==='suspended'&&!f.dreams.active.has(id));
    await f.dreams.saveNote({kind:'manual',noteId:n.noteId,baseRevisionId:n.id,personalId:f.person,name:'Workflow edited later',focus:'workflow',text:'A newer edit that must survive stopping the old Dream.'});
    await f.dreams.control({id,action:'resume'});await wait(()=>f.workers.length===2);assert.equal(f.calls.length,1,'a completed preparation is reused');
    await f.dreams.control({id,action:'stop'});await wait(()=>f.dreams.run(id).status==='stopped');
    assert.equal(f.store.state.personalParticipants[0].currentGenerationId,initial);assert.equal(dreamNotes(f.store.state,f.person)[0].name,'Workflow edited later');assert.equal(currentDreamRun(f.store.state,f.person),null);
  }finally{await f.close();}
});
test('a finished candidate is separate until adoption; processed notes do not repeat on a schedule',async()=>{
  const f=await fixture();try{
    const old=f.store.state.personalParticipants[0].currentGenerationId,n=await f.dreams.saveNote({kind:'manual',personalId:f.person,name:'A conversation arc',focus:'conversation',text:'Question, uncertainty, correction, and a useful return.'});
    await f.dreams.choice({personalId:f.person,noteId:n.noteId,included:true});const {id}=await f.dreams.start({personalId:f.person});await wait(()=>f.workers.length);f.workers[0].finish=true;
    await wait(()=>['ready','failed'].includes(f.dreams.run(id).status));assert.equal(f.dreams.run(id).status,'ready',f.dreams.run(id).error);
    assert.equal(f.store.state.personalParticipants[0].currentGenerationId,old);assert.equal(dreamNotes(f.store.state,f.person)[0].included,false);
    await f.dreams.adopt({id});assert.equal(f.store.state.personalParticipants[0].currentGenerationId,f.dreams.run(id).candidate.generationId);assert.equal(f.store.state.personalParticipants[0].generations[0].id,old);await f.dreams.adopt({id,previous:true});assert.equal(f.store.state.personalParticipants[0].currentGenerationId,old);
    const notes=f.store.state.dreamTraining.notes.length;await f.store.close();const reopened=new Store(f.store.dataDir,{checkpoints:false});await reopened.open();assert.equal(reopened.state.dreamTraining.notes.length,notes);await reopened.close();
  }finally{await f.close();}
});
test('long notes retain their whole episode through overlapping windows; format checks do not grade content',()=>{
  const text='A mistake and its correction.\n\n'.repeat(1400),windows=sourceWindows({text},10000);assert.equal(windows[0].start,0);assert.equal(windows.at(-1).end,text.length);for(let i=1;i<windows.length;i++)assert.ok(windows[i].start<windows[i-1].end);
  const parsed=preparedEpisodes(JSON.stringify({episodes:[{messages:[{role:'user',content:'An unresolved question.'},{role:'assistant',content:'It is still unresolved.'}]}]}),'episode');assert.equal(parsed[0].episodeId,'episode_0');assert.throws(()=>preparedEpisodes('not json','x'),/readable training/);
});
test('a workspace backup carries the complete Dream note and trained artifact into recovery',async()=>{
  const f=await fixture();try{
    const note=await f.dreams.saveNote({kind:'manual',personalId:f.person,name:'Retained conversation',focus:'conversation',text:'First we misunderstood. Then we slowed down, corrected the assumptions, and continued.'});
    const {id}=await f.dreams.start({personalId:f.person});await wait(()=>f.workers.length);f.workers[0].finish=true;await wait(()=>f.dreams.run(id).status==='ready');
    const storage=new StorageManager(f.store,path.join(f.dir,'backups')),backup=await storage.backup(),restored=await storage.restoreCopy(backup.id);
    const source=JSON.parse(await fs.readFile(path.join(restored.restoredPath,'dreams','notes',note.id+'.json'),'utf8'));assert.equal(source.text.includes('corrected the assumptions'),true);
    assert.ok((await fs.stat(path.join(restored.restoredPath,'dreams','runs',id,'candidate.gguf'))).size>0);
    assert.equal(await fs.readFile(path.join(restored.restoredPath,'dreams','runs',id,'adapter','adapter_model.safetensors'),'utf8'),'synthetic adapter bytes');
  }finally{await f.close();}
});

test('message, rendered passage, range, branch and desk marks keep their source cutoff and selection',()=>{
  const s={chats:[{id:'chat_a',rootId:'desk_a'},{id:'chat_b',rootId:'desk_a'}],messages:[
    {id:'m1',chatId:'chat_a',role:'user',content:'Let us explore before deciding.'},
    {id:'m2',chatId:'chat_a',role:'assistant',content:'**A rushed plan.**'},
    {id:'m3',chatId:'chat_a',role:'user',content:'Please slow down.'},
    {id:'m4',chatId:'chat_a',role:'assistant',content:'We can keep exploring.'},
    {id:'m5',chatId:'chat_b',role:'user',content:'Another branch.'}]};
  const response=captureDreamSource(s,{kind:'message',chatId:'chat_a',messageIds:['m2']});
  assert.deepEqual(response.messages.map(m=>m.id),['m1','m2']);assert.deepEqual(response.selectedIds,['m2']);assert.equal(response.messages[0].selected,false);
  const passage=captureDreamSource(s,{kind:'passage',chatId:'chat_a',messageIds:['m2','m3'],text:'A rushed plan.\n\nPlease slow down.'});
  assert.equal(passage.selectedText,'A rushed plan.\n\nPlease slow down.');assert.equal(passage.messages[1].content,'**A rushed plan.**');
  assert.deepEqual(captureDreamSource(s,{kind:'range',chatId:'chat_a',messageIds:['m2','m3']}).selectedIds,['m2','m3']);
  const branch=captureDreamSource(s,{kind:'conversation',chatId:'chat_a'}),desk=captureDreamSource(s,{kind:'desk',rootId:'desk_a'});
  s.messages.push({id:'m6',chatId:'chat_a',role:'assistant',content:'Added after marking.'});
  assert.equal(branch.messages.length,4);assert.equal(desk.messages.length,5);assert(!desk.text.includes('Added after'));
});

test('schedules stay quiet without notes, bind the preparer, and do not repeat a stopped occurrence',async()=>{
  let time=Date.parse('2026-11-10T01:00:00Z');const f=await fixture({clock:()=>time});
  try{
    const schedule={date:'2026-11-10',time:'01:01',zone:'UTC',repeat:'interval',intervalMinutes:1,weekdays:[]};
    await f.dreams.schedule({personalId:f.person,schedule,missed:'skip',enabled:true});time+=60000;await f.dreams.tick();assert.equal(f.calls.length,0);assert.equal(f.store.state.dreamTraining.runs.length,0);
    await f.store.transact(s=>applyCommand(s,{type:'model.save',payload:{name:'Preparation helper',model:'helper',baseUrl:'http://127.0.0.1:1234/v1',runtime:'compatible',thinking:false}}));
    const helper=f.store.state.models.at(-1).id;await f.dreams.settings({preparerModelId:helper});await f.dreams.schedule({personalId:f.person,schedule,missed:'skip',enabled:true});await f.dreams.settings({preparerModelId:null});
    await f.dreams.saveNote({kind:'manual',personalId:f.person,name:'One workflow',focus:'workflow',text:'Read, try, observe and correct.'});time+=60000;await f.dreams.tick();await wait(()=>f.workers.length===1);
    const run=f.store.state.dreamTraining.runs[0];assert.equal(run.preparer.id,helper);await f.dreams.tick();assert.equal(f.workers.length,1);
    await f.dreams.control({id:run.id,action:'stop'});await wait(()=>f.dreams.run(run.id).status==='stopped');await f.dreams.tick();assert.equal(f.store.state.dreamTraining.runs.length,1);
  }finally{await f.close();}
});

test('concurrent Start requests admit one run; an unloadable artifact never becomes a generation',async()=>{
  const f=await fixture();try{
    const before=f.store.state.personalParticipants[0].currentGenerationId;await f.dreams.saveNote({kind:'manual',personalId:f.person,name:'A note',focus:'conversation',text:'A short conversation to retain.'});
    const requests=await Promise.allSettled([f.dreams.start({personalId:f.person}),f.dreams.start({personalId:f.person})]);assert.equal(requests.filter(r=>r.status==='fulfilled').length,1);
    await wait(()=>f.workers.length===1);const id=f.store.state.dreamTraining.runs[0].id;f.runner.probeFile=async()=>{throw new Error('Missing model tensor');};f.workers[0].finish=true;
    await wait(()=>f.dreams.run(id).status==='interrupted');assert.equal(f.dreams.run(id).candidate,null);assert.equal(f.store.state.personalParticipants[0].currentGenerationId,before);assert.equal(f.dreams.run(id).loadError,'Missing model tensor');
  }finally{await f.close();}
});

test('a failed checkpoint save is interrupted rather than reported as suspended',async()=>{
  const f=await fixture();try{
    await f.dreams.saveNote({kind:'manual',personalId:f.person,name:'A note',focus:'workflow',text:'Keep the recorded evidence.'});const {id}=await f.dreams.start({personalId:f.person});await wait(()=>f.workers.length===1);
    f.workers[0].error='Checkpoint could not be written: disk full';await f.dreams.control({id,action:'suspend'});await wait(()=>!f.dreams.active.has(id));
    assert.equal(f.dreams.run(id).status,'interrupted');assert.match(f.dreams.run(id).message,/disk full/);assert.equal(f.dreams.run(id).candidate,null);
  }finally{await f.close();}
});

test('temporary preparation failure resumes at the unfinished note without repeating completed work',async()=>{
  let calls=0;const names=[];
  const f=await fixture({generate:async(_model,messages)=>{calls++;names.push(JSON.parse(messages[1].content).name);if(calls===2)throw new Error('Synthetic temporary fetch failure');return {content:JSON.stringify({episodes:[{messages:[{role:'user',content:'Keep this conversation.'},{role:'assistant',content:'We can continue from the saved work.'}]}]})};}});
  try{
    await f.dreams.saveNote({kind:'manual',personalId:f.person,name:'First note',focus:'conversation',text:'First source.'});
    await f.dreams.saveNote({kind:'manual',personalId:f.person,name:'Second note',focus:'workflow',text:'Second source.'});
    const {id}=await f.dreams.start({personalId:f.person});await wait(()=>!f.dreams.active.has(id));
    assert.equal(f.dreams.run(id).status,'interrupted');assert.equal(f.dreams.run(id).preparedItems,1);
    await f.dreams.control({id,action:'resume'});await wait(()=>f.workers.length===1);
    assert.deepEqual(names,['First note','Second note','Second note']);await f.dreams.control({id,action:'stop'});
  }finally{await f.close();}
});

test('Resume freezes rehearsal too, and a replacement note excludes its older revision',async()=>{
  const f=await fixture();try{
    const a=await f.dreams.saveNote({kind:'manual',personalId:f.person,name:'First',focus:'conversation',text:'First conversation.'});
    const first=await f.dreams.start({personalId:f.person});await wait(()=>f.workers.length===1);f.workers[0].finish=true;await wait(()=>f.dreams.run(first.id).status==='ready');await f.dreams.adopt({id:first.id});
    const b=await f.dreams.saveNote({kind:'manual',personalId:f.person,name:'Second',focus:'workflow',text:'Second conversation.'});
    const second=await f.dreams.start({personalId:f.person});await wait(()=>f.workers.length===2);
    const file=path.join(f.dreams.dir(second.id),'examples.json'),before=await fs.readFile(file,'utf8');assert.equal(JSON.parse(before).length,2);
    await f.dreams.control({id:second.id,action:'suspend'});await wait(()=>!f.dreams.active.has(second.id));
    await f.dreams.choice({personalId:f.person,noteId:a.noteId,included:false});
    await f.dreams.saveNote({kind:'manual',noteId:b.noteId,baseRevisionId:b.id,name:'Second edited',focus:'workflow',text:'A later correction.'});
    await f.dreams.control({id:second.id,action:'resume'});await wait(()=>f.workers.length===3);assert.equal(await fs.readFile(file,'utf8'),before);
    await f.dreams.control({id:second.id,action:'stop'});await wait(()=>!f.dreams.active.has(second.id));
    await f.dreams.choice({personalId:f.person,noteId:b.noteId,included:false});
    const correction=await f.dreams.saveNote({kind:'manual',noteId:a.noteId,baseRevisionId:a.id,name:'First corrected',focus:'conversation',text:'The corrected first conversation.'});await f.dreams.choice({personalId:f.person,noteId:a.noteId,included:true});
    const third=await f.dreams.start({personalId:f.person});await wait(()=>f.workers.length===4);
    const examples=JSON.parse(await fs.readFile(path.join(f.dreams.dir(third.id),'examples.json'),'utf8'));
    assert.equal(examples.length,1);assert.equal(examples[0].sourceRevisionId,correction.id);await f.dreams.control({id:third.id,action:'stop'});
  }finally{await f.close();}
});

test('Stop wins over a late thermal event; validated export cleanup preserves the model and notes',async()=>{
  const f=await fixture();try{
    await f.dreams.saveNote({kind:'manual',personalId:f.person,name:'Thermal control',focus:'workflow',text:'Keep explicit Stop.'});
    const {id}=await f.dreams.start({personalId:f.person});await wait(()=>f.workers.length===1);
    await f.dreams.control({id,action:'stop'});await f.workers[0].event({kind:'thermal_pause',message:'Synthetic hot sample'});await wait(()=>!f.dreams.active.has(id));assert.equal(f.dreams.run(id).status,'stopped');
    const run=f.dreams.dir(id),scratch=path.join(run,'export-work','merged');await fs.mkdir(scratch,{recursive:true});await fs.writeFile(path.join(scratch,'weights.bin'),'temporary bytes');await fs.writeFile(path.join(run,'candidate.gguf'),'retained candidate');
    const cleaned=await cleanDreamExport(f.store.dataDir,id);assert.equal(cleaned.files,1);assert.equal(await fs.readFile(path.join(run,'candidate.gguf'),'utf8'),'retained candidate');
    const outside=path.join(f.dir,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'keep'),'untouched');await fs.symlink(outside,path.join(run,'export-work'),process.platform==='win32'?'junction':'dir');
    await assert.rejects(cleanDreamExport(f.store.dataDir,id),/owned Dream/);assert.equal(await fs.readFile(path.join(outside,'keep'),'utf8'),'untouched');
  }finally{await f.close();}
});
