import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {DreamWorker} from '../server/dream-worker.mjs';
const mode=process.argv[2],dir=await fs.mkdtemp(path.join(os.tmpdir(),'branchline-worker-failure-'));
await fs.writeFile(path.join(dir,'job.json'),'{}');
if(mode==='log')await fs.mkdir(path.join(dir,'worker.log'));
const spawnProcess=()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
  setTimeout(()=>child.stdout.emit('data',Buffer.from('BRANCHLINE_DREAM {"kind":"progress","step":1}\n')),30);setTimeout(()=>child.emit('close',0),160);return child;};
const worker=new DreamWorker({backend:'native',python:'unused'},path.join(dir,'job.json'),{spawnProcess,onEvent:async()=>{if(mode==='event')throw new Error('Synthetic journal persistence failure');}});
try{await worker.run();console.log('UNEXPECTED_SUCCESS');process.exitCode=9;}catch(error){console.log('CAUGHT_BY_CALLER '+error.message);process.exitCode=3;}
