// Explicit real stock-Qwen check. Two requests, hard ceiling of 4 / 600 seconds.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import os from 'node:os';
import {createApp} from '../server/index.mjs';
import {listen} from './helpers.mjs';
import {turnOptions} from '../public/table.js';
import {dreamRevision} from '../server/dream-history.mjs';
import {RESOURCE_DEFAULTS} from '../public/resource-settings.js';
const out=path.resolve(process.env.BRANCHLINE_TEST_REPORT),base=path.resolve(process.env.BRANCHLINE_TEST_ROOT);
await fs.mkdir(out,{recursive:true});await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,'real-dream-'));
const app=await createApp({dataDir:path.join(dir,'workspace'),bundledDir:path.resolve(process.argv[2])}),url=await listen(app),headers={'x-branchline-session':app.sessionToken,'content-type':'application/json'};
const report={status:'RUNNING',model:'Stock Qwen3.5-4B',privateDreamsUsed:false,workspace:dir,calls:[],measuredMs:0,limit:{requests:4,milliseconds:600000},hardware:{platform:os.platform(),architecture:os.arch(),cpu:os.cpus()[0].model,totalMemory:os.totalmem()},limitation:'Same stock weights before and after a recorded generation change. This does not demonstrate training or restore of different learned weights.'};
const save=()=>fs.writeFile(path.join(out,'qwen-dream.json'),JSON.stringify(report,null,2));
const post=async(route,body)=>{const r=await fetch(url+route,{method:'POST',headers,body:JSON.stringify(body)}),v=await r.json();assert(r.ok,v.error);return v;};
try {
  const s=app.store.state,person=s.personalParticipants[0],chat=s.chats[0],model=s.models[0];assert.equal(model.runtime,'bundled');
  await post('/api/command',{type:'root.resources',payload:{id:chat.rootId,resources:{...RESOURCE_DEFAULTS,replyTokens:128,replySeconds:180}}});
  async function reply(content){
    assert(report.calls.length<4&&report.measuredMs<600000);const call={content,status:'STARTED'};report.calls.push(call);await save();
    const start=performance.now();try{await post('/api/exchange',{chatId:chat.id,content,...turnOptions(app.store.state,app.store.state.chats[0],'personal','send')});call.status=app.store.state.exchanges.at(-1).status;call.reply=app.store.state.messages.findLast(m=>m.role==='assistant').content;assert.equal(call.status,'completed');}
    finally{call.elapsedMs=performance.now()-start;report.measuredMs+=call.elapsedMs;call.runner=app.localRunner.status();await save();}return app.store.state;
  }
  await reply('Our imaginary greenhouse is named Marigold. Please acknowledge the name in one short sentence.');
  const before=structuredClone(app.store.state),originalGeneration=before.personalParticipants[0].currentGenerationId;
  await post('/api/command',{type:'dream.record',payload:{personalId:person.id,baseRevision:dreamRevision(app.store.state),topic:'Synthetic saved stock state',occurredAt:null,summary:'A same-weight continuity check only.',observations:'No training took place.',outcome:'unadopted',modelId:model.id,sources:[{chatId:chat.id,messageId:before.messages.at(-1).id}]}});
  const record=app.store.state.dreamHistory.records.at(-1);
  await post('/api/dreams/restore',{personalId:person.id,dreamId:record.id,baseRevision:dreamRevision(app.store.state)});
  assert.notEqual(app.store.state.personalParticipants[0].currentGenerationId,originalGeneration);assert.deepEqual(app.store.state.messages,before.messages);
  await reply('What is the name of our imaginary greenhouse? Answer with its name in one sentence.');
  const turn=app.store.state.exchanges.at(-1);assert.equal(turn.speaker.generationId,record.generationId);
  const receipt=app.store.state.handoffs.records.find(r=>r.id===turn.handoff.contextId);assert.match(JSON.stringify(receipt.detail.inputMessages),/Earlier recorded state of the same personal model/);assert.match(report.calls.at(-1).reply,/Marigold/i);
  report.transition=app.store.state.dreamHistory.transitions.at(-1);report.status='PASS';
} catch(error){report.status='FAILED';report.error=error.message;process.exitCode=1;}
finally {await save();await app.dispose();console.log(JSON.stringify(report));}
