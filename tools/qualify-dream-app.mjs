// Real local inference/training, with synthetic app data and no cloud account.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createApp} from '../server/index.mjs';
import {DreamWorker,atomicJson} from '../server/dream-worker.mjs';
const root=process.argv[2],bundled=process.argv[3],runtime=process.argv[4];if(!root||!bundled||!runtime||runtime.startsWith('--'))throw new Error('Supply an isolated qualification directory, the installed bundled-model directory and an explicit training runtime configuration.');
await fs.mkdir(root,{recursive:true});const log=await fs.open(path.join(root,'events.jsonl'),'a');
const app=await createApp({dataDir:path.join(root,'workspace'),bundledDir:bundled,modelOptions:{codex:{close(){},async status(){return {connected:false,models:[]};}},dreamOptions:{runtimeFile:runtime,workerFactory:(engine,file,{onEvent})=>new DreamWorker(engine,file,{onEvent:async event=>{await log.appendFile(JSON.stringify({at:new Date().toISOString(),...event})+'\n');await onEvent(event);if(['phase','progress','finished'].includes(event.kind))console.log(JSON.stringify(event));}})}}});
try{
  const person=app.store.state.personalParticipants[0];assert(person,'The isolated stock model was configured');const before=person.currentGenerationId;
  let id;if(process.argv.includes('--resume')){id=app.store.state.dreamTraining.runs.at(-1).id;await app.dreams.control({id,action:'resume'});console.log(JSON.stringify({resumed:id}));}
  else{const note=await app.dreams.saveNote({kind:'manual',personalId:person.id,name:'A small conversational repair',focus:'conversation',text:'User: I want to think about a small garden, but I am still exploring.\nAssistant: I have prepared a complete construction plan.\nUser: Slow down. Please stay in the discussion with me; I have not decided what to build.\nAssistant: Understood. We can keep the useful ideas without treating them as decisions. What would make this a pleasant space for you?\nUser: Room to sit, and something growing that changes through the seasons.\nAssistant: A seat and a changing garden give us two useful starting points. We can explore their relationship before choosing a layout.'});
  ({id}=await app.dreams.start({personalId:person.id}));console.log(JSON.stringify({started:id,note:note.id}));}
  let last='';while(true){const r=app.dreams.run(id);if(r.message!==last){last=r.message;console.log(JSON.stringify({status:r.status,message:last}));}if(['ready','failed','stopped','interrupted','suspended'].includes(r.status))break;await delay(1000);}
  const run=app.dreams.run(id);assert.equal(run.status,'ready',run.error??run.message);
  assert.equal(app.store.state.personalParticipants[0].currentGenerationId,before);
  const replies=await app.dreams.tryCandidate({id,prompt:'Hello from a setup check. Please reply in one brief sentence with a greeting and the answer to 2 + 3.'});
  assert.equal(replies.answers.length,2);assert(replies.answers.every(a=>a.text.trim()));
  await app.dreams.adopt({id});const adopted=app.store.state.personalParticipants[0].currentGenerationId;assert.notEqual(adopted,before);
  await app.dreams.adopt({id,previous:true});assert.equal(app.store.state.personalParticipants[0].currentGenerationId,before);
  const report={status:'PASS',runId:id,preparationModel:run.preparer.name,trained:run.result,originalKeptDuringTraining:true,adoptedAndReturned:true,replies:replies.answers,fixture:root};await atomicJson(path.join(root,'qualification.json'),report);console.log(JSON.stringify(report));
}finally{await app.dispose();await log.close();}
