import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=path.join(path.dirname(fileURLToPath(import.meta.url)),'dream_runtime','train.py');
export const toWsl=p=>/^[a-z]:[\\/]/i.test(p)?'/mnt/'+p[0].toLowerCase()+p.slice(2).replaceAll('\\','/'):p;
export async function atomicJson(file,value){await fs.mkdir(path.dirname(file),{recursive:true});const tmp=file+'.tmp';await fs.writeFile(tmp,JSON.stringify(value,null,2));await fs.rename(tmp,file);}
export async function findDreamEngine({runtimeFile=null}={}) {
  const candidates=[runtimeFile??process.env.BRANCHLINE_DREAM_RUNTIME??path.join(os.homedir(),'Local_AI_Models','Branchline-Dreams','runtime.json')];
  for(const file of candidates){
    try{const r=JSON.parse(await fs.readFile(file,'utf8'));if(r.profile==='branchline.dream-runtime/1'&&['native','wsl'].includes(r.backend)&&typeof r.python==='string'&&typeof r.basePath==='string')return {...r,configFile:file};}catch{}
  }
  return null;
}
export function workerCommand(engine,jobFile,{probe=false}={}) {
  if(engine.backend==='wsl')return {command:'wsl.exe',args:['-d',engine.distro||'Ubuntu-24.04','--exec',engine.python,'-B','-u',toWsl(script),...(probe?['--probe']:['--job',toWsl(jobFile),'--parent-watch'])]};
  return {command:engine.python,args:['-B','-u',script,...(probe?['--probe']:['--job',jobFile,'--parent-watch'])]};
}
export class DreamWorker {
  constructor(engine,jobFile,{onEvent=()=>{},spawnProcess=spawn}={}){this.engine=engine;this.jobFile=jobFile;this.onEvent=onEvent;this.spawn=spawnProcess;this.child=null;this.lastLines=[];}
  async run(){
    const launch=workerCommand(this.engine,this.jobFile);
    const root=path.resolve(path.dirname(this.jobFile));
    await fs.rename(path.join(root,'result.json'),path.join(root,'result-before-'+randomUUID()+'.json')).catch(error=>{if(error.code!=='ENOENT')throw error;});
    const log=createWriteStream(path.join(path.dirname(this.jobFile),'worker.log'),{flags:'a'});
    let failure=null,stopTask=null,killTimer=null,eventChain=Promise.resolve();
    const stop=error=>{
      failure??=error;
      if(!stopTask)stopTask=this.control('stop').catch(()=>{});
      this.child?.stdin?.end('stop\n');
      if(this.engine.backend!=='wsl'&&!killTimer){killTimer=setTimeout(()=>this.child?.kill?.('SIGTERM'),20000);killTimer.unref?.();}
    };
    // Attach rejection handling at creation, while the child is still alive.
    const logClosed=new Promise(resolve=>{log.once('finish',resolve);log.once('error',error=>{stop(error);resolve();});});
    const output=chunk=>{if(!failure)log.write(chunk);};
    let code=null;
    try{
      log.write('\n--- Worker started '+new Date().toISOString()+' ---\n');
      this.child=this.spawn(launch.command,launch.args,{cwd:path.dirname(this.jobFile),windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,HF_HUB_DISABLE_TELEMETRY:'1',WANDB_DISABLED:'true',TOKENIZERS_PARALLELISM:'false',PYTHONUNBUFFERED:'1'}});
      this.child.stdin?.on('error',()=>{});
      if(failure)this.child.stdin?.end('stop\n');
      this.child.stdout.on('data',output);this.child.stderr.on('data',output);
      let pending='';
      this.child.stdout.on('data',chunk=>{
        pending+=chunk.toString();let cut;
        while((cut=pending.indexOf('\n'))>=0){
          const line=pending.slice(0,cut).trim();pending=pending.slice(cut+1);if(!line)continue;
          this.lastLines.push(line);if(this.lastLines.length>30)this.lastLines.shift();
          if(line.startsWith('BRANCHLINE_DREAM ')){
            try{const event=JSON.parse(line.slice(17));eventChain=eventChain.then(()=>failure?undefined:this.onEvent(event)).catch(stop);}catch(error){stop(error);}
          }
        }
      });
      this.child.stderr.on('data',chunk=>{this.lastLines.push(chunk.toString().slice(-3000));if(this.lastLines.length>30)this.lastLines.shift();});
      code=await new Promise((resolve,reject)=>{this.child.once('error',reject);this.child.once('close',resolve);});
    }catch(error){stop(error);}
    finally{log.end();await logClosed;await eventChain;await stopTask;clearTimeout(killTimer);}
    if(failure)throw failure;
    const result=await fs.readFile(path.join(path.dirname(this.jobFile),'result.json'),'utf8').then(JSON.parse).catch(()=>null);
    if(code!==0||!result)throw new Error(result?.error||('Training worker stopped'+(code===null?'':` (${code})`)+'. '+this.lastLines.slice(-4).join('\n').slice(-2500)));
    return result;
  }
  async control(intent){await atomicJson(path.join(path.dirname(this.jobFile),'control.json'),{intent,at:new Date().toISOString()});}
}
