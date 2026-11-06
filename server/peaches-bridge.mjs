import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readRuntime} from './runtime-paths.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');

// This pipe is held by fixed host routes only. No provider/model tool receives it.
export class PeachesBridge {
  constructor({manifest=null}={}) {
    this.manifest=manifest; this.child=null; this.pending=new Map(); this.next=0; this.starting=null; this.chain=Promise.resolve(); this.closed=false;
  }
  async start(){
    if(this.closed)throw new Error('The Book is closing. Reopen Branchline to continue.');
    if(this.child)return;
    if(this.starting)return this.starting;
    this.starting=(async()=>{
      let config;
      try{config=await readRuntime('peaches-runtime.json',this.manifest);}catch{throw new Error('The local Book helper is unavailable. Your saved versions remain here; repair the app to reopen them.');}
      if(config.format!=='branchline.peaches-runtime/1'||hash(await fs.readFile(config.python))!==config.pythonSha256)throw new Error('The local PEACHES runtime has changed.');
      for(const name of ['worker.py','package.py','signer.py','vendor/floor.py']){
        if(hash(await fs.readFile(path.join(here,'peaches_runtime',name)))!==config.sources[name])throw new Error('The installed PEACHES checker needs repair.');
      }
      if(this.closed)throw new Error('The Book is closing.');
      const child=spawn(config.python,['-I','-B',path.join(here,'peaches_runtime/worker.py')],{windowsHide:true,stdio:['pipe','pipe','pipe'],cwd:here});
      this.child=child;let output='';
      const failed=()=>{if(this.child===child)this.child=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('The local checker closed before completing this action. Retry the same saved version.'));}this.pending.clear();};
      child.on('error',failed);child.on('exit',failed);child.stderr.on('data',()=>{});
      child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
        output+=chunk;if(output.length>4*1024*1024){child.kill();return;}
        let end;while((end=output.indexOf('\n'))>=0){const line=output.slice(0,end);output=output.slice(end+1);let result;
          try{result=JSON.parse(line);}catch{child.kill();return;}
          const p=this.pending.get(result.id);if(!p)continue;this.pending.delete(result.id);clearTimeout(p.timer);
          if(result.error)p.reject(new Error(result.error));else p.resolve(result.result);
        }
      });
    })();
    try{await this.starting;}finally{this.starting=null;}
  }
  call(op,input={}){
    if(!['check','pack','origin','sign','status','unlock','setup','backup','lock'].includes(op))return Promise.reject(new Error('Unknown Book operation.'));
    const run=async()=>{await this.start();return new Promise((resolve,reject)=>{
      const id=++this.next;const timer=setTimeout(()=>{this.pending.delete(id);this.child?.kill();reject(new Error('The local signing window timed out. Your version is unchanged.'));},['sign','unlock','setup','backup'].includes(op)?180000:20000);timer.unref();
      this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,op,...input})+'\n',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(error);}});
    });};
    const task=this.chain.then(run,run);this.chain=task.catch(()=>{});return task;
  }
  async close(){
    this.closed=true;if(this.starting)await this.starting.catch(()=>{});const child=this.child;if(!child)return;
    await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill();resolve();},2000);timer.unref();child.once('exit',()=>{clearTimeout(timer);resolve();});child.stdin.end();});
  }
}
