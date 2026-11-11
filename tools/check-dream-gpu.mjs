import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {DreamWorker,atomicJson} from '../server/dream-worker.mjs';
const directory=process.argv[2];if(!directory)throw new Error('Supply an isolated synthetic Dream job directory.');
const file=path.join(directory,'job.json'),job=JSON.parse(await fs.readFile(file,'utf8'));let requested=false;
const log=await fs.open(path.join(directory,'control-check.jsonl'),'a');
const record=async event=>{await log.appendFile(JSON.stringify({at:new Date().toISOString(),...event})+'\n');if(['phase','progress','finished','thermal_pause'].includes(event.kind))console.log(JSON.stringify(event));};
const first=new DreamWorker(job.engine,file,{onEvent:async event=>{await record(event);if(event.kind==='progress'&&event.step===1&&!requested){requested=true;await first.control('suspend');}}});
try{
  const paused=await first.run();assert.equal(paused.status,'suspended');await atomicJson(path.join(directory,'suspend-result.json'),paused);
  await atomicJson(path.join(directory,'control.json'),{intent:'run'});
  const second=new DreamWorker(job.engine,file,{onEvent:record}),complete=await second.run();assert.equal(complete.status,'ready');assert.ok(complete.step>1);
  const windows=JSON.parse(await fs.readFile(path.join(directory,'training-windows.json'),'utf8'));assert.ok(windows.some(w=>w.tokenEnd-w.tokenStart===1024));
  const result={status:'PASS',suspended:true,resumed:true,fullWindow:1024,steps:complete.step,temperatureC:complete.peakTemperatureC,usedMiB:complete.peakUsedMiB,modelFile:complete.modelFile};await atomicJson(path.join(directory,'qualification.json'),result);console.log(JSON.stringify(result));
}finally{await log.close();}
