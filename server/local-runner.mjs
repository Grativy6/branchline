import fs from 'node:fs/promises';
import path from 'node:path';
import {BundledRunner,hashFile} from './bundled-runner.mjs';
import {assertLocalFileProfile,fileAlias,localFileFor} from './local-model-state.mjs';
const fingerprint=s=>[s.dev,s.ino,s.size,s.mtimeMs].join(':');

class FileRunner extends BundledRunner {
  constructor(root,file,options={}){
    super(root,{...options,contextTokens:file.contextTokens,validateContext:n=>Number.isInteger(n)&&n>=512&&n<=32768});this.file=file;this.label=file.metadata.name||path.basename(file.path);this.alias=fileAlias(file.sha256);this.modelPath=file.path;this.projectorPath=null;this.extraArgs=file.metadata.inputFormat==='chat'?['--jinja']:[];this.fileChecks=options.fileChecks??new Map();
  }
  assertModel(model){assertLocalFileProfile(model);if(model.model!==this.alias||model.inputFormat!==this.file.metadata.inputFormat)throw new Error('The selected model does not match this loaded file.');}
  async open(){await super.open();if(this.state.available)this.state={...this.state,phase:'idle',message:`${this.label} loads when used.`,modelName:this.label,modelId:this.file.modelId};return this;}
  async verify(signal,onStatus){
    const stat=await fs.stat(this.modelPath).catch(()=>null);
    if(!stat?.isFile()||stat.size!==this.file.bytes||stat.mtimeMs!==this.file.mtimeMs)throw new Error('The saved model file moved or changed. Find and add the correct file again in Models.');
    if(this.verified)return;
    for(const row of this.manifest.files.filter(r=>/^(cpu|vulkan)\//.test(r.path))){
      signal.throwIfAborted();const file=path.join(this.root,row.path),current=await fs.lstat(file);
      if(!current.isFile()||current.isSymbolicLink()||current.size!==row.bytes||await hashFile(file,signal)!==row.sha256)throw new Error('The included local runtime needs repair through Setup.');
    }
    this.update('checking',`Checking ${this.label}…`,onStatus);
    const key=this.modelPath+'\n'+this.file.sha256;
    if(this.fileChecks.get(key)!==fingerprint(stat)){
      if(await hashFile(this.modelPath,signal)!==this.file.sha256)throw new Error('The model file no longer matches the one you added. Find and add the intended file again.');
      if(fingerprint(await fs.stat(this.modelPath))!==fingerprint(stat))throw new Error('The model file changed during its check.');
      this.fileChecks.set(key,fingerprint(stat));
    }
    this.verified=true;
  }
  async ensure(signal,onStatus){
    const stat=await fs.stat(this.modelPath).catch(()=>null);
    if(!stat?.isFile()||stat.size!==this.file.bytes||stat.mtimeMs!==this.file.mtimeMs)throw new Error('The saved model file moved or changed. Find and add it again in Models.');
    return super.ensure(signal,onStatus);
  }
  async imageCapability(){throw new Error('This saved local-file connection is text-only.');}
}

// One owned local slot, shared by included Qwen and the added model files.
export class LocalRunner {
  constructor(root,{getState,runnerFactory=(...args)=>new FileRunner(...args),bundled=null,...options}={}){this.root=root;this.getState=getState;this.options={...options,fileChecks:new Map()};this.runnerFactory=runnerFactory;this.bundled=bundled??new BundledRunner(root,options);this.files=new Map();this.current=null;this.switching=false;this.closed=false;}
  rememberVerifiedFile(file,hash,stat){this.options.fileChecks.set(file+'\n'+hash,fingerprint(stat));}
  async open(){await this.bundled.open();return this;}
  restoreContext(tokens){return this.bundled.restoreContext(tokens);}
  status(model=null){
    if(model?.runtime==='bundled')return this.bundled.status();
    if(model?.runtime==='gguf'){
      const file=localFileFor(this.getState(),model),runner=file&&this.files.get(file.id);
      return runner?.status()??{available:this.bundled.status().available,phase:'idle',message:'Loads when used.',contextTokens:file?.contextTokens??8192,loadedContextTokens:null,busy:false,backend:null,modelId:model.id,modelName:model.name};
    }
    const runner=this.current??this.bundled;return {...runner.status(),busy:runner.status().busy||this.switching};
  }
  bundledStatus(){return {...this.bundled.status(),busy:this.status().busy};}
  async fetch(model,url,options,onStatus){
    if(this.closed)throw new Error('Branchline is closing.');
    let runner=this.bundled;
    if(model.runtime==='gguf'){
      assertLocalFileProfile(model);const file=localFileFor(this.getState(),model);if(!file)throw new Error('This local model has no saved file.');
      runner=this.files.get(file.id);if(!runner){runner=this.runnerFactory(this.root,file,this.options);await runner.open();this.files.set(file.id,runner);}
    }
    if(this.switching)throw new Error('Waiting for the local runtime slot.');
    if(this.current&&this.current!==runner){this.switching=true;try{await this.current.beforeOtherLocal();}finally{this.switching=false;}}
    this.current=runner;return runner.fetch(model,url,options,onStatus);
  }
  imageCapability(model){return this.bundled.imageCapability(model);}
  async beforeOtherLocal(){if(this.switching)throw new Error('Waiting for the local runtime slot.');await (this.current??this.bundled).beforeOtherLocal();this.current=null;}
  async unload(){await (this.current??this.bundled).unload();this.current=null;}
  async unloadBundled(){await this.bundled.unload();if(this.current===this.bundled)this.current=null;}
  async setPreference(p){await this.bundled.setPreference(p);return this.bundledStatus();}
  setContextTokens(...args){if(this.status().busy)throw new Error('Finish the local reply before changing its window.');return this.bundled.setContextTokens(...args);}
  async close(){this.closed=true;await Promise.all([this.bundled.close(),...[...this.files.values()].map(r=>r.close())]);}
}
