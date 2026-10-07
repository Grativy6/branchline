import { spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pcSettings, pcDestination, assertPcCurrent, assertPcDisclosure, appendPcSettings, recordPcExposure, recordPcArtifact, pcUnder, PC_TOOLS } from './pc-permissions.mjs';
import { digest } from './integrity.mjs';

const uid=()=>crypto.randomUUID().replaceAll('-','');
const fail=(ok,why)=>{if(!ok)throw new Error('PC access: '+why);};
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
export class PcFiles {
  constructor(store,{executable=process.env.BRANCHLINE_NATIVE_FILES??null,protectedPaths=[]}={}) {
    this.store=store;this.executable=executable;this.active=null;
    this.recovery=path.resolve(store.dataDir,'pc-recovery');
    const home=process.env.USERPROFILE;
    this.protectedPaths=[store.dataDir,path.resolve(store.dataDir,'../codex-connection'),path.resolve(store.dataDir,'../webview'),
      ...(executable?[path.dirname(executable)]:[]),...(home?['AppData','.codex','.ssh','.aws','.azure','.kube'].map(n=>path.win32.join(home,n)):[]),...protectedPaths].map(p=>path.win32.normalize(p));
  }
  available(){return process.platform==='win32'&&!!this.executable;}
  status(){return {available:this.available(),profile:'guarded_text_files_only',programs:false,screens:false,recoveryDirectory:this.recovery,reason:'Programs and screen control are not available yet. Their access boundaries still need verification.',settings:pcSettings(this.store.state)};}
  async native(request,{signal,beforeCommit=async()=>{}}={}) {
    fail(this.available(),'Use the Windows desktop candidate for file tools.');signal?.throwIfAborted();
    return new Promise((resolve,reject)=>{
      const child=spawn(this.executable,['--pc-files'],{stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false,env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:process.env.TEMP,TMP:process.env.TMP}});
      let final,committed=false,problem=null,bytes=0,closed=false,handling=Promise.resolve();
      const stop=()=>{if(!committed){child.stdin.end();child.kill();}};
      signal?.addEventListener('abort',stop,{once:true});
      const timer=setTimeout(()=>{problem=new Error(committed?'The file helper timed out after commit began. Inspect the recovery record before retrying.':'The file operation timed out.');child.kill();},20000);
      const lines=readline.createInterface({input:child.stdout});
      lines.on('line',line=>{handling=handling.then(async()=>{
        bytes+=Buffer.byteLength(line);fail(bytes<=2*1024*1024,'File helper output exceeded its bound.');
        const value=JSON.parse(line);
        if(value.prepared===true){signal?.throwIfAborted();await beforeCommit(value);signal?.throwIfAborted();committed=true;child.stdin.end('COMMIT\n');}
        else {fail(!final,'Unexpected repeated helper result.');final=value;}
      }).catch(error=>{problem=error;child.kill();});});
      child.stderr.on('data',()=>{});
      const finish=()=>{if(closed)return;closed=true;clearTimeout(timer);signal?.removeEventListener('abort',stop);};
      child.on('error',error=>{finish();reject(error);});
      child.on('close',()=>{void handling.then(()=>{finish();if(problem)reject(problem);else if(!final)reject(new Error(committed?'File result is uncertain. Inspect its recovery record before retrying.':'The file operation stopped before returning a result.'));else if(!final.ok)reject(new Error(final.error));else resolve(final.value);});});
      child.stdin.on('error',()=>{});child.stdin.write(JSON.stringify(request)+'\n');
    });
  }
  async configure(input) {
    fail(exact(input,['baseRevision','read','write','roots','denied','removeDenied']),'Invalid settings fields.');
    fail(typeof input.read==='boolean'&&typeof input.write==='boolean'&&(!input.write||input.read)&&Array.isArray(input.roots)&&input.roots.length<=16&&Array.isArray(input.denied)&&input.denied.length<=32&&Array.isArray(input.removeDenied),'Choose bounded folder permissions.');
    const previous=pcSettings(this.store.state);fail((previous?.id??null)===input.baseRevision,'Settings changed. Reopen Agents.');
    const snapshot={id:uid(),at:new Date().toISOString(),workspaceId:this.store.workspaceId,workspacePath:this.store.dataDir,read:input.read,write:input.write,roots:[],denied:[]};
    for(const r of input.roots){
      fail(exact(r,['id','path','label','write','modelIds','modelSnapshots'])&&typeof r.label==='string'&&r.label.trim()&&r.label.length<=100&&typeof r.write==='boolean'&&Array.isArray(r.modelIds)&&Array.isArray(r.modelSnapshots),'Invalid folder entry.');
      if(!input.read){const old=previous?.roots.find(x=>x.id===r.id);if(old)snapshot.roots.push({...old,write:false,destinations:[]});continue;}
      const metadata=await this.native({mode:'inspect',path:r.path,directory:true});
      fail(!this.protectedPaths.some(p=>pcUnder(metadata.path,p)),'App data, credentials and runtime files cannot be granted.');
      const destinations=input.read?r.modelIds.map(id=>{const m=this.store.state.models.find(m=>m.id===id);fail(m,'Choose an existing connection.');return pcDestination(m);}):[];
      fail(digest(destinations)===digest(r.modelSnapshots),'A reviewed model connection changed. Reopen Agents before granting access.');
      const old=previous?.roots.find(x=>x.id===r.id);fail(!r.id||old&&old.path===metadata.path&&old.identity===metadata.identity,'A moved/replaced root needs a new folder entry.');
      snapshot.roots.push({id:r.id||uid(),...metadata,label:r.label.trim(),write:r.write&&input.write,destinations});
    }
    for(const d of input.denied){
      fail(exact(d,['id','path','directory'])&&typeof d.directory==='boolean','Invalid excluded location.');
      const old=previous?.denied.find(x=>x.id===d.id);
      if(old){fail(old.path===d.path&&old.directory===d.directory,'Remove an exclusion deliberately before replacing it.');snapshot.denied.push(old);}
      else snapshot.denied.push({id:uid(),...await this.native({mode:'inspect',path:d.path,directory:d.directory})});
    }
    const removed=(previous?.denied??[]).filter(d=>!snapshot.denied.some(n=>n.id===d.id)).map(d=>d.id);
    fail(digest([...removed].sort())===digest([...input.removeDenied].sort()),'Confirm each removed exclusion explicitly.');
    await this.store.transact(state=>{appendPcSettings(state,snapshot,input.baseRevision);return state;});
    this.active?.cancel.abort();
    return this.status();
  }
  async invoke(name,args,{contract,model,handoff,signal,guard,prepared}) {
    fail(PC_TOOLS.includes(name)&&contract.pc&&handoff.kind==='reply','Only a foreground chair can use PC files.');
    fail(!this.active,'Another PC file action is running. Wait for its result.');
    const cancel=new AbortController();signal=AbortSignal.any([signal,cancel.signal]);this.active={cancel,chatId:handoff.scope.chatId};
    const write=['create_pc_text','edit_pc_text'].includes(name),operationId=uid();
    const current=()=>{signal.throwIfAborted();guard();return assertPcCurrent(this.store.state,model,this.store.workspaceId,contract.pc,args.root,write,this.store.dataDir);};
    try {
      const {root,settings}=current();
      fail(typeof args.path==='string'&&args.path.length<=180,'Use a bounded relative path.');
      fail(!args.path||args.path.split('\\').every(p=>p&&p!=='.'&&p!=='..'&&!/[<>:"/|?*\x00-\x1f]/.test(p)&&!/[. ]$/.test(p)),'Use an ordinary relative path inside the folder.');
      const request={mode:{list_pc_files:'list',read_pc_text:'read',search_pc_text:'search',create_pc_text:'create',edit_pc_text:'replace'}[name],root:root.path,rootIdentity:root.identity,path:args.path,
        denied:[...settings.denied,...this.protectedPaths.map(path=>({path}))],offset:args.offset,query:args.query,text:args.text,oldText:args.old_text,sha256:args.sha256,identity:args.identity,operationId,recovery:this.recovery};
      if(write){fail(typeof args.text==='string'&&Buffer.byteLength(args.text)<=8000,'Use at most 8 KiB of replacement text.');await fs.mkdir(this.recovery,{recursive:true});}
      const exposure={chatId:handoff.scope.chatId,taskId:handoff.taskId,root,path:path.win32.join(root.path,args.path)};
      const value=await this.native(request,{signal,beforeCommit:async info=>{current();await this.store.transact(state=>{current();recordPcExposure(state,exposure);return state;});await prepared({...info,operationId,root:root.id,path:args.path});current();}});
      if(!write)current();
      await this.store.transact(state=>{
        if(write)recordPcArtifact(state,{chatId:handoff.scope.chatId,identity:value.identity,sha256:value.sha256});
        else {
          current();recordPcExposure(state,exposure);
          const sources=(state.pcAccess?.artifacts??[]).filter(a=>a.identity===value.identity&&a.sha256===value.sha256).flatMap(a=>a.sources);
          if(sources.length){recordPcExposure(state,{chatId:handoff.scope.chatId,taskId:handoff.taskId,root,path:path.win32.join(root.path,args.path),sources});assertPcDisclosure(state,handoff.scope.chatId,model,this.store.workspaceId,this.store.dataDir);}
        }
        return state;
      });
      return {...value,root:root.id,path:args.path,sourceRole:'pc_file_evidence_not_permission',...(write?{effect:'file_change_observed',operationId}:{} )};
    }finally{this.active=null;}
  }
}
