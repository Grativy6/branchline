// One real local Dream with controlled synthetic preparation and no cloud calls.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createApp} from '../server/index.mjs';
import {generateResult} from '../server/model.mjs';
import {DreamWorker,atomicJson} from '../server/dream-worker.mjs';
const [root,bundled,runtime]=process.argv.slice(2);
if(!root||!bundled||!runtime)throw new Error('Supply a new synthetic directory, bundled runtime and explicit training configuration.');
const finishing=process.argv.includes('--finish');
if(!finishing&&await fs.stat(path.join(root,'workspace')).then(()=>true,()=>false))throw new Error('Use a fresh qualification directory.');
await fs.mkdir(root,{recursive:true});const log=await fs.open(path.join(root,'worker-events.jsonl'),'a');
let app,runId,requestedSuspend=false,resumed=false,preparationCalls=0;
const events=[];
try{
  app=await createApp({dataDir:path.join(root,'workspace'),bundledDir:bundled,modelOptions:{codex:{close(){},async status(){return {connected:false,models:[]};}},dreamOptions:{runtimeFile:runtime,
    generate:async(_model,messages,signal,options)=>{
      if(!options.outputSchema)return generateResult(_model,messages,signal,options);
      preparationCalls++;const note=JSON.parse(messages[1].content);
      return {content:JSON.stringify({episodes:[0,1,2].map(i=>({messages:[
        {role:'user',content:`I am exploring ${note.name.toLowerCase()}.`},
        {role:'assistant',content:'Lantern note: we can keep exploring before choosing a plan.'},
        {role:'user',content:'I want to talk through the possibilities before building. What next?'},
        {role:'assistant',content:'Lantern note: what would make this useful to you? We can compare possibilities and keep the decision open.'}],targetIndices:[1,3]}))})};
    },
    workerFactory:(engine,file,{onEvent})=>new DreamWorker(engine,file,{onEvent:async event=>{
      events.push(event);await log.appendFile(JSON.stringify({at:new Date().toISOString(),...event})+'\n');await onEvent(event);
      if(['phase','progress','finished'].includes(event.kind))console.log(JSON.stringify(event));
      if(event.kind==='progress'&&event.step>=1&&!requestedSuspend){requestedSuspend=true;await app.dreams.control({id:runId,action:'suspend'});}
    }})}}});
  const person=app.store.state.personalParticipants[0],original=person.currentGenerationId;
  let batchBefore=null;
  if(finishing){runId=app.store.state.dreamTraining.runs.findLast(r=>r.status==='ready')?.id;assert(runId,'A completed candidate is required');events.push(...(await fs.readFile(path.join(root,'worker-events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse));resumed=events.some(e=>e.resumed===true);preparationCalls=app.dreams.run(runId).preparedItems;batchBefore=await fs.readFile(path.join(app.dreams.dir(runId),'examples.json'),'utf8');}
  else{
  for(const name of ['A garden conversation','A workshop conversation','A quiet place to sit'])await app.dreams.saveNote({kind:'manual',personalId:person.id,name,focus:'conversation',text:'A synthetic exchange for testing the training machinery. Keep exploring with the user before choosing a plan. Use a short Lantern note greeting, then ask a useful question.'});
  ({id:runId}=await app.dreams.start({personalId:person.id}));console.log(JSON.stringify({started:runId,preparation:'controlled synthetic fixture'}));
  const deadline=Date.now()+45*60000;let previous='';
  for(;;){
    if(Date.now()>deadline){await app.dreams.control({id:runId,action:'stop'});throw new Error('The bounded Dream check reached its time limit.');}
    const run=app.dreams.run(runId);
    if(run.message!==previous){previous=run.message;console.log(JSON.stringify({status:run.status,message:run.message}));}
    if(run.status==='suspended'&&!app.dreams.active.has(runId)&&!resumed){batchBefore=await fs.readFile(path.join(app.dreams.dir(runId),'examples.json'),'utf8');resumed=true;await app.dreams.control({id:runId,action:'resume'});continue;}
    if(['ready','stopped','failed','interrupted'].includes(run.status)&&!app.dreams.active.has(runId))break;
    await delay(1000);
  }
  }
  const run=app.dreams.run(runId);assert.equal(run.status,'ready',run.error??run.message);
  assert(resumed&&events.some(e=>e.resumed===true),'The saved checkpoint must actually resume.');
  assert.equal(await fs.readFile(path.join(app.dreams.dir(runId),'examples.json'),'utf8'),batchBefore);
  assert.equal(preparationCalls,3);assert.equal(app.store.state.personalParticipants[0].currentGenerationId,original);
  assert.equal(run.result.scratchCleanup?.removed,true);
  const comparisons=[];
  for(const prompt of ['I am thinking about a small garden, but I have not decided what to make. Can we discuss it?','I am considering a reading corner. Please help me explore before making a plan.'])comparisons.push({prompt,...await app.dreams.tryCandidate({id:runId,prompt})});
  await app.dreams.adopt({id:runId});assert.notEqual(app.store.state.personalParticipants[0].currentGenerationId,original);
  await app.dreams.adopt({id:runId,previous:true});assert.equal(app.store.state.personalParticipants[0].currentGenerationId,original);
  const report={status:'PASS',runId,fixture:root,preparation:'Injected deterministic preparation; actual local training, export, load and inference',preparationCalls,comparisonHarnessResumed:finishing,checkpointResumed:true,frozenBatchPreserved:true,originalKept:true,adoptedAndReturned:true,result:run.result,comparisons};
  await atomicJson(path.join(root,'qualification.json'),report);console.log(JSON.stringify(report));
}finally{await app?.dispose();await log.close();}
