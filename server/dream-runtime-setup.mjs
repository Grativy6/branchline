import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {toWsl} from './dream-worker.mjs';
const script=path.join(path.dirname(fileURLToPath(import.meta.url)),'dream_runtime','setup.py');
export class DreamRuntimeSetup{
  constructor(root,runtimeFile=path.join(root,'runtime.json')){this.root=root;this.runtimeFile=runtimeFile;this.child=null;this.status={active:false,phase:'idle',message:''};}
  start(){if(this.status.active)return;this.status={active:true,phase:'preparing',message:'Preparing the local training environment…'};this.promise=this.run().catch(error=>{this.status={active:false,phase:'failed',message:error.message};});}
  async command(args){return new Promise((resolve,reject)=>{const child=spawn('wsl.exe',args,{windowsHide:true,stdio:['ignore','pipe','pipe']});this.child=child;let tail='',buffer='';const read=chunk=>{const text=chunk.toString();tail=(tail+text).slice(-3000);buffer+=text;let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(line.startsWith('BRANCHLINE_SETUP ')){try{const e=JSON.parse(line.slice(17));this.status={active:true,phase:e.phase,message:e.message};}catch{}}}};child.stdout.on('data',read);child.stderr.on('data',read);child.once('error',()=>reject(new Error('Ubuntu / WSL 2 is needed for this local training profile. Install Ubuntu-24.04, then try setup again.')));child.once('exit',code=>{this.child=null;code===0?resolve():reject(new Error('Training setup stopped. '+tail.slice(-1800)));});});}
  async run(){
    if(process.platform!=='win32')throw new Error('Use the included setup.py to configure this Linux training host.');
    const drive=await fs.stat('D:\\Local_AI_Models').then(()=> 'D:\\Local_AI_Models',()=>path.join(os.homedir(),'Local_AI_Models'));
    await this.command(['-d','Ubuntu-24.04','-u','root','--exec','apt-get','update','-qq']);
    await this.command(['-d','Ubuntu-24.04','-u','root','--exec','apt-get','install','-y','-qq','python3.12-venv','python3.12-dev','build-essential','cmake','git']);
    await this.command(['-d','Ubuntu-24.04','--exec','python3',toWsl(script),'--models',toWsl(path.join(drive,'Branchline-Dreams')),'--runtime',toWsl(this.runtimeFile)]);
    this.status={active:false,phase:'ready',message:'Local training engine is ready.'};
  }
  close(){this.child?.kill();}
}
