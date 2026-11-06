import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const portable=c=>({...c,sources:c.sources.map(({title,origin,kind,text})=>({title,origin,kind,text}))});
const id=()=>crypto.randomUUID();
export class MemoryFiles {
  constructor(owner){this.owner=owner;this.queues=new Map();owner.store.memoryFiles=this;}
  all(work){const profiles=(this.owner.store.state.personalContext?.profiles??[]).map(p=>p.id).sort();const next=i=>i===profiles.length?work():this.run(profiles[i],()=>next(i+1));return next(0);}
  run(profile,work){
    this.owner.known(profile);
    const next=(this.queues.get(profile)??Promise.resolve()).then(()=>work());
    this.queues.set(profile,next.catch(()=>{}));return next;
  }
  paths(profile){
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(profile))throw new Error('Invalid memory profile.');
    const root=path.join(this.owner.store.dataDir,'personal-memory'),dir=path.join(root,profile);
    return {root,dir,file:path.join(dir,'MEMORY.md'),state:path.join(dir,'sync.json')};
  }
  async directories(p){
    for(const dir of [p.root,p.dir]){
      await fs.mkdir(dir,{recursive:true});
      const stat=await fs.lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Memory folders cannot be links.');
    }
  }
  async stable(file){
    const before=await fs.lstat(file);
    if(!before.isFile()||before.isSymbolicLink()||before.size>32000)throw new Error('MEMORY.md must be a regular UTF-8 file within the current memory limit.');
    const bytes=await fs.readFile(file),after=await fs.lstat(file);
    if(before.ino!==after.ino||before.mtimeMs!==after.mtimeMs||before.size!==after.size||sha(bytes)!==sha(await fs.readFile(file)))throw new Error('MEMORY.md is changing; wait for the editor to finish saving.');
    const account=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    if(account.includes('\0'))throw new Error('MEMORY.md contains invalid text.');
    return {account,hash:sha(bytes),modifiedAt:after.mtime.toISOString()};
  }
  async atomic(file,text){
    const tmp=file+'.'+id()+'.tmp',handle=await fs.open(tmp,'wx');
    try{await handle.writeFile(text,'utf8');await handle.sync();}finally{await handle.close();}
    await fs.rename(tmp,file);
  }
  async meta(p,state){await this.atomic(p.state,JSON.stringify(state,null,2)+'\n');}
  async raw(profile){return this.owner.host(profile,'inspect_personal_context');}
  async commit(profile,request,author,check=()=>{}){
    check();return this.owner.bridge.call({profile,mode:'host',author,guard:()=>{this.owner.known(profile);check();}},'change_personal_context',{request});
  }
  async recover(profile,p,state,detail,check=()=>{}){
    const pending=state.pending;if(!pending)return {state,detail};
    let row=detail.revisions.find(r=>r.operation===pending.request.operation);
    if(!row){
      if(pending.author.kind==='automatic_policy'&&(this.owner.policy(profile).id!==pending.author.policyId||this.owner.policy(profile).mode!=='automatic'))throw new Error('Automatic memory permission changed during an interrupted save. The pending record is retained for review.');
      // A failed validation is not retried automatically. Only a retained write
      // with an unchanged base can recover after a process interruption.
      if(detail.head!==pending.request.expectedHead)throw new Error('Memory recovery needs attention: the profile changed during an interrupted save. Both versions remain in sync.json.');
      row=await this.commit(profile,pending.request,pending.author,check);detail=await this.raw(profile);
    }
    const file=await this.stable(p.file),nextHash=sha(Buffer.from(row.content.account));
    if(file.hash===pending.before.hash&&detail.current.operation===row.operation){
      check();await this.atomic(p.file,row.content.account);
    }
    // If another editor won the race, its bytes stay intact. The next sync
    // imports them as a separate revision instead of overwriting them.
    state={revision:row.operation,hash:nextHash,observedAt:new Date().toISOString()};
    await this.meta(p,state);return {state,detail};
  }
  async syncUnlocked(profile){
    const p=this.paths(profile);await this.directories(p);let detail=await this.raw(profile),state;
    try{state=JSON.parse(await fs.readFile(p.state,'utf8'));}catch(error){
      if(error.code!=='ENOENT')throw error;
      const account=detail.current.content.account;
      // Only the initial materialization may create a missing file. Later
      // deletion is an error, not permission to recreate it.
      try{await fs.writeFile(p.file,account,{encoding:'utf8',flag:'wx'});}catch(e){
        if(e.code!=='EEXIST')throw e;
        if((await this.stable(p.file)).account!==account)throw new Error('Existing MEMORY.md has no synchronization record. Its bytes were preserved; compare it with the profile before reconnecting.');
      }
      state={revision:detail.current.operation,hash:sha(Buffer.from(account)),observedAt:new Date().toISOString()};await this.meta(p,state);
    }
    ({state,detail}=await this.recover(profile,p,state,detail));
    const file=await this.stable(p.file);
    if(file.hash!==state.hash){
      const content={...portable(detail.current.content),account:file.account};
      if([...content.orientation,...content.account].length>8000)throw new Error('Memory and orientation share 8,000 characters. The external file is preserved but has not been used.');
      const request={action:'revise',operation:'external_'+id(),expectedHead:detail.head,baseRevision:detail.current.operation,content};
      const author={kind:'external_file',source:'MEMORY.md',writer:'unknown',detectedAt:new Date().toISOString(),observedFileModifiedAt:file.modifiedAt};
      // Keep the exact external observation for crash recovery.
      state={...state,pending:{request,author,before:file}};await this.meta(p,state);
      await this.commit(profile,request,author);({state,detail}=await this.recover(profile,p,state,await this.raw(profile)));
    }else if(state.revision!==detail.current.operation){
      // A canonical revision changed outside this host. Preserve a changed
      // file above; otherwise project the new canonical account.
      await this.atomic(p.file,detail.current.content.account);
      state={revision:detail.current.operation,hash:sha(Buffer.from(detail.current.content.account)),observedAt:new Date().toISOString()};await this.meta(p,state);
    }
    return {...detail,memory:{path:p.file,observedAt:state.observedAt,hash:state.hash,policy:this.owner.policy(profile)}};
  }
  sync(profile){return this.run(profile,()=>this.syncUnlocked(profile));}
  write(profile,make,author,check=()=>{}){return this.run(profile,async()=>{
    const detail=await this.syncUnlocked(profile),request=await make(detail),p=this.paths(profile);
    if(!request)return {unchanged:true,current:detail.current};
    if(request.already)return request.already;
    if(detail.revisions.some(r=>r.operation===request.operation))return this.commit(profile,request,author,check);
    check();const before=await this.stable(p.file);
    if(before.hash!==detail.memory.hash)throw new Error('MEMORY.md changed during this save. Your draft is retained; reopen the profile to compare.');
    const state={revision:detail.current.operation,hash:before.hash,observedAt:detail.memory.observedAt,pending:{request,author,before}};
    // Validate stale editor/proposal requests before writing a recovery record.
    if(request.expectedHead!==detail.head||request.baseRevision&&request.baseRevision!==detail.current.operation)throw new Error('A newer memory revision exists. Your draft is retained; reopen to compare.');
    await this.meta(p,state);
    let row;
    try{row=await this.commit(profile,request,author,check);}catch(error){
      const after=await this.raw(profile);
      if(!after.revisions.some(r=>r.operation===request.operation))await this.meta(p,{revision:state.revision,hash:state.hash,observedAt:state.observedAt});
      throw error;
    }
    // This host serializes profile writes. The returned committed row is
    // sufficient to finish its file projection; reopening Python here would
    // repeat the same read. Startup recovery still inspects the actual store.
    await this.recover(profile,p,state,{...detail,current:row,revisions:[...detail.revisions,row]},check);
    const final=await this.stable(p.file);
    if(final.hash!==sha(Buffer.from(row.content.account)))throw new Error('Memory was recorded, but MEMORY.md changed during the save. Both versions are retained; reopen to compare.');
    return row;
  });}
}
export {portable as portableMemoryContent};
