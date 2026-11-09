import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {inspectGguf} from './gguf.mjs';
import {hashFile} from './bundled-runner.mjs';
import {applyCommand} from './domain.mjs';
import {recordUiCommand} from './handoff.mjs';
import {archivePreview,applyArchiveCommand} from './model-archives.mjs';
import {isModelArchived} from '../public/model-archives.js';
import {fileAlias,LOCAL_FILE_ADDRESS,localFileFor} from './local-model-state.mjs';
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const localPath=value=>{if(typeof value!=='string'||!path.isAbsolute(value)||value.startsWith('\\\\')||/[\0\r\n]/.test(value)||value.length>4096)throw new Error('Choose a folder on this computer.');return path.resolve(value);};
const library=s=>s.localModels??={profile:'branchline.local-models/1',folders:[],files:[]};

export class LocalModelLibrary {
  constructor(store,{runner=null,knownFolders=null}={}){this.store=store;this.runner=runner;this.search=null;this.adding=null;this.startChain=Promise.resolve();this.closed=false;this.knownFolders=knownFolders??[path.join(os.homedir(),'.lmstudio','models'),path.join(os.homedir(),'.cache','lm-studio','models'),path.join(os.homedir(),'Documents','Models'),path.join(os.homedir(),'Downloads'),path.join(path.parse(os.homedir()).root,'Local_AI_Models')];}
  async list(){
    const s=this.store.state,models=[];
    for(const m of s.models.filter(m=>m.runtime==='gguf'&&!isModelArchived(s,m.id))){const file=localFileFor(s,m),stat=await fs.stat(file.path).catch(()=>null);models.push({modelId:m.id,name:m.name,...file,available:Boolean(stat?.isFile()),changed:Boolean(stat&&(stat.size!==file.bytes||stat.mtimeMs!==file.mtimeMs)),runtime:this.runner?.status(m)??null});}
    const candidates=[...new Set([...(s.localModels?.folders??[]),...this.knownFolders])],folders=[];
    for(const p of candidates)if(await fs.stat(p).then(s=>s.isDirectory(),()=>false))folders.push(p);
    return {models,folders,search:this.searchView(),adding:this.adding?{name:this.adding.name}:null};
  }
  searchView(){if(!this.search)return null;const {controller,promise,...view}=this.search;return {...view,candidates:view.candidates.map(c=>({...c,addedModelId:this.store.state.models.find(m=>m.runtime==='gguf'&&!isModelArchived(this.store.state,m.id)&&samePath(localFileFor(this.store.state,m)?.path??'',c.path))?.id??null}))};}
  startSearch(input={}){const operation=this.startChain.then(()=>this.beginSearch(input));this.startChain=operation.catch(()=>{});return operation;}
  async beginSearch({folder=null}={}){
    if(this.closed)throw new Error('Branchline is closing.');
    this.search?.controller.abort();await this.search?.promise;
    let folders=folder?[localPath(folder)]:(await this.list()).folders;
    if(!folders.length)throw new Error('Choose a folder where your model files are saved.');
    if(folder){const real=await fs.realpath(folders[0]).catch(()=>{throw new Error('That folder could not be opened. Choose its current location.');});if(!(await fs.stat(real)).isDirectory())throw new Error('Choose a model folder.');folders=[real];await this.store.transact(s=>{const l=library(s);l.folders=[...l.folders.filter(p=>!samePath(p,real)),real].slice(-32);return s;});}
    const search={id:'modelsearch_'+crypto.randomUUID(),folders,candidates:[],errors:[],visited:0,skipped:0,phase:'searching',currentFolder:'',controller:new AbortController()};this.search=search;
    search.promise=this.scan(search).catch(error=>{search.phase=search.controller.signal.aborted?'cancelled':'failed';search.error=error.message;});
    return this.searchView();
  }
  async scan(search){
    const pending=[...search.folders],seen=new Set(),signal=search.controller.signal;
    while(pending.length){
      signal.throwIfAborted();const dir=pending.shift();let real,entries;
      try{real=await fs.realpath(dir);const key=process.platform==='win32'?real.toLowerCase():real;if(seen.has(key))continue;seen.add(key);entries=await fs.readdir(real,{withFileTypes:true});}
      catch(error){if(search.errors.length<30)search.errors.push({path:dir,message:'Could not read this folder.'});continue;}
      search.currentFolder=real;
      for(const e of entries){
        signal.throwIfAborted();search.visited++;
        if(e.isSymbolicLink()){search.skipped++;continue;}
        const file=path.join(real,e.name);
        if(e.isDirectory()){if(!['.git','node_modules','__pycache__'].includes(e.name))pending.push(file);continue;}
        if(!e.isFile()||!e.name.toLowerCase().endsWith('.gguf'))continue;
        try{search.candidates.push({candidateId:crypto.randomUUID(),...(await inspectGguf(file))});}
        catch(error){search.candidates.push({candidateId:crypto.randomUUID(),path:file,name:e.name,unsupportedReason:error.message,bytes:await fs.stat(file).then(s=>s.size,()=>null)});}
      }
      if(seen.size>=20000){search.phase='partial';search.error='Search reached 20,000 folders. Choose a more specific model folder to continue.';return;}
      await delay(0,undefined,{signal});
    }
    search.phase='complete';search.currentFolder='';
  }
  cancelSearch(id){if(this.search?.id===id)this.search.controller.abort();return this.searchView();}
  async add({searchId,candidateId,name},signal){
    if(this.adding)throw new Error('Another model is being added.');
    const found=this.search?.id===searchId&&this.search.candidates.find(c=>c.candidateId===candidateId);if(!found||found.unsupportedReason)throw new Error(found?.unsupportedReason??'Select a model from the current search.');
    if(typeof name!=='string'||!name.trim()||name.trim().length>200||/[\r\n\0]/.test(name))throw new Error('Give the model a short name.');
    const controller=new AbortController();signal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    let finish;this.addFinished=new Promise(resolve=>{finish=resolve;});this.adding={name:name.trim(),controller};
    try{
      const current=await inspectGguf(found.path);if(current.bytes!==found.bytes||current.mtimeMs!==found.mtimeMs)throw new Error('This file changed after the preview. Search for it again.');
      const sha256=await hashFile(current.path,signal);signal?.throwIfAborted();
      const stat=await fs.stat(current.path);if(stat.size!==current.bytes||stat.mtimeMs!==current.mtimeMs)throw new Error('The file changed while it was being added. Search for it again.');
      this.runner?.rememberVerifiedFile?.(current.path,sha256,stat);
      const priorModel=this.store.state.models.find(m=>m.runtime==='gguf'&&m.model===fileAlias(sha256));
      const priorFile=priorModel&&localFileFor(this.store.state,priorModel);
      const priorStat=priorFile&&await fs.stat(priorFile.path).catch(()=>null);
      const keepPriorLocation=priorFile&&!samePath(priorFile.path,current.path)&&priorStat?.size===priorFile.bytes&&priorStat?.mtimeMs===priorFile.mtimeMs;
      const fileRecord=modelId=>{const {path:file,bytes,mtimeMs,...metadata}=current;return {id:'localfile_'+crypto.randomUUID(),at:new Date().toISOString(),modelId,path:file,bytes,mtimeMs,sha256,metadata,contextTokens:priorFile?.contextTokens??Math.min(8192,metadata.contextLength??8192)};};
      let modelId,alreadyAdded=false;
      await this.store.transact(before=>{
        signal?.throwIfAborted();let s=before;const old=s.models.find(m=>m.runtime==='gguf'&&m.model===fileAlias(sha256));
        if(old){modelId=old.id;alreadyAdded=!isModelArchived(s,old.id);if(!alreadyAdded)s=applyArchiveCommand(s,'modelArchive.restore',{modelId:old.id,baseRevision:archivePreview(s,old.id).revision});const previous=localFileFor(s,old);if(!keepPriorLocation&&(previous.path!==current.path||previous.mtimeMs!==current.mtimeMs))library(s).files.push(fileRecord(modelId));return s;}
        const command={type:'model.save',payload:{name:name.trim(),model:fileAlias(sha256),baseUrl:LOCAL_FILE_ADDRESS,runtime:'gguf',thinking:false,inputFormat:current.inputFormat}};
        s=applyCommand(s,command);modelId=s.models.at(-1).id;
        library(s).files.push(fileRecord(modelId));
        recordUiCommand(before,s,command);return s;
      });return {modelId,alreadyAdded};
    }finally{this.adding=null;finish();}
  }
  async remove(modelId){
    const model=this.store.state.models.find(m=>m.id===modelId&&m.runtime==='gguf');if(!model)throw new Error('Choose a saved local model.');
    if(this.store.state.exchanges.some(e=>e.modelId===modelId&&e.status==='pending'))throw new Error('Finish or stop this model’s current reply before removing it.');
    await this.store.transact(s=>{const preview=archivePreview(s,modelId);if(preview.archived)return s;return applyArchiveCommand(s,'modelArchive.archive',{modelId,personalIds:preview.personalIds,baseRevision:preview.revision,files:'retained',copies:[]});});
    return {removed:true,fileRetained:true};
  }
  async close(){this.closed=true;this.search?.controller.abort();this.adding?.controller.abort();await Promise.all([this.startChain,this.search?.promise,this.addFinished]);}
}
