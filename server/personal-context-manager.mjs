import crypto from 'node:crypto';
import {chairView} from '../public/chair-roster.js';
import {spawn} from 'node:child_process';
import {digest} from './integrity.mjs';
import {assertInferenceIdle,resolveSpeaker} from './table.mjs';
import {sourceAt} from './context-carry.mjs';
import {PersonalContextBridge} from './personal-context-bridge.mjs';
import {contextLibrary,contextRecord,boundContext,contextAllowed,contextBinding,selectedContext,bindPersonalContext,assertContextDisclosure,memoryPolicy,contextDestination} from './personal-context.mjs';
import {MemoryFiles,portableMemoryContent} from './memory-files.mjs';
import {assertPcDisclosure} from './pc-permissions.mjs';
import {assertSketchDisclosure} from './sketches.mjs';
import {assertAgentDisclosure} from './agent-profiles.mjs';
import {assertHomeDisclosure} from './home-state.mjs';
import {assertWorkDisclosure} from './work-access.mjs';
const user={kind:'local_ui',source:'paired_local_review'};
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join()!==[...keys].sort().join())throw new Error('Unexpected personal continuity fields.');};
export class PersonalContexts{
  constructor(store,options={}){this.store=store;this.bridge=new PersonalContextBridge({dataDir:store.dataDir,workspaceId:store.workspaceId,...options});this.memory=new MemoryFiles(this);}
  known(id){if(!contextLibrary(this.store.state).profiles.some(p=>p.id===id))throw new Error('Unknown personal profile.');}
  host(profile,name,args={}){return this.bridge.call({profile,mode:'host',author:user,guard:()=>this.known(profile)},name,args);}
  async list(){return {available:await this.bridge.available(),...contextLibrary(this.store.state)};}
  async inspect(profile){return this.memory.sync(profile);}
  policy(profile){return memoryPolicy(this.store.state,profile);}
  async openMemory(input){
    exact(input,['profile']);const detail=await this.inspect(input.profile);
    if(process.platform!=='win32')throw new Error('Open the displayed MEMORY.md path with your text editor on this host.');
    await new Promise((resolve,reject)=>{const child=spawn('notepad.exe',[detail.memory.path],{stdio:'ignore',windowsHide:false});child.once('error',reject);child.once('spawn',resolve);child.unref();});
    return {opened:true,path:detail.memory.path};
  }
  async memoryPolicy(input){
    exact(input,['profile','mode']);this.known(input.profile);
    if(!['manual','suggest','automatic'].includes(input.mode))throw new Error('Choose a memory mode.');
    await this.store.transact(s=>{contextRecord(s,'memoryPolicies',{profileId:input.profile,mode:input.mode});return s;});
    return this.policy(input.profile);
  }
  checkChatSource(chatId,model){
    const s=this.store.state,w=this.store.workspaceId,p=this.store.dataDir;
    assertContextDisclosure(s,chatId,model);assertPcDisclosure(s,chatId,model,w,p);assertSketchDisclosure(s,chatId,model,w);
    assertAgentDisclosure(s,chatId,model,null,'memory');assertHomeDisclosure(s,chatId,model,w,p);assertWorkDisclosure(s,chatId,model,w,p);
  }
  checkSources(profile,model,seen=new Set()){
    if(seen.has(profile))return;seen.add(profile);
    for(const origin of contextLibrary(this.store.state).memoryOrigins??[])if(origin.profileId===profile){
      this.checkChatSource(origin.chatId,model);
      const root=this.store.state.chats.find(c=>c.id===origin.chatId)?.rootId;
      for(const r of this.store.state.handoffs?.records??[])if(r.scope?.rootId===root&&r.detail?.contextView?.personalContext)this.checkSources(r.detail.contextView.personalContext.profileId,model,seen);
    }
  }
  async retainOrigin(profile,chatId,messageId=null){
    const grant=contextLibrary(this.store.state).sharing.findLast(g=>g.profileId===profile);
    for(const destination of grant?.destinations??[])for(const model of this.store.state.models.filter(m=>digest(contextDestination(m))===digest(destination)))this.checkChatSource(chatId,model);
    await this.store.transact(s=>{if(!(contextLibrary(s).memoryOrigins??[]).some(o=>o.profileId===profile&&o.chatId===chatId&&o.messageId===messageId))contextRecord(s,'memoryOrigins',{profileId:profile,chatId,messageId});return s;});
  }
  async remember(input){
    exact(input,['profile','operation','baseRevision','expectedHead','note','chatId','messageId']);this.known(input.profile);
    const message=this.store.state.messages.find(m=>m.id===input.messageId&&m.chatId===input.chatId);
    if(!message||typeof input.note!=='string'||!input.note.trim()||input.note.length>8000)throw new Error('Choose a saved message and a concise memory.');
    await this.retainOrigin(input.profile,input.chatId,input.messageId);
    const exchange=this.store.state.exchanges.find(e=>e.id===message.exchangeId);
    const author={...user,source:'save_as_memory',noteSha256:digest(input.note.trim()),selectedSource:{chatId:input.chatId,messageId:message.id,role:message.role,model:message.modelIdentifier??exchange?.modelIdentifier??null,createdAt:message.createdAt,sha256:digest(message.content)}};
    return this.memory.write(input.profile,d=>{
      const prior=d.revisions.find(r=>r.operation===input.operation);
      if(prior){if(digest(prior.author)!==digest(author)||prior.previous!==input.baseRevision)throw new Error('Memory operation identity was reused.');return {already:prior};}
      return {action:'revise',operation:input.operation,baseRevision:input.baseRevision,expectedHead:input.expectedHead,content:{...portableMemoryContent(d.current.content),account:[d.current.content.account,input.note.trim()].filter(Boolean).join('\n\n')}};
    },author);
  }
  async undo(input){
    exact(input,['profile','revision','operation']);
    return this.memory.write(input.profile,d=>{
      if(d.current.operation!==input.revision)throw new Error('A newer memory exists. Open History to compare before restoring.');
      const prior=d.revisions.find(r=>r.operation===d.current.previous);
      if(!prior)throw new Error('No earlier account to restore.');
      return {action:'revise',operation:input.operation,expectedHead:d.head,baseRevision:d.current.operation,content:{...portableMemoryContent(d.current.content),account:prior.content.account}};
    },{...user,source:'undo_memory'});
  }
  async create(input){
    exact(input,['operation','content','bundle']);
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(input.operation))throw new Error('Invalid operation identity.');
    const profile='p_'+digest({workspace:this.store.workspaceId,operation:input.operation}).slice(0,40);
    const result=await this.bridge.call({profile,mode:'host',author:user,guard:()=>assertInferenceIdle(this.store.state)},'change_personal_context',
      {request:input.bundle?{action:'import',operation:input.operation,bundle:input.bundle}:{action:'create',operation:input.operation,content:input.content}});
    await this.store.transact(s=>{if(!contextLibrary(s).profiles.some(p=>p.id===profile)){contextRecord(s,'profiles',{id:profile,name:result.content.name});contextRecord(s,'memoryPolicies',{profileId:profile,mode:'manual'});}return s;});
    await this.memory.sync(profile);
    return {profile,record:result};
  }
  async bind(input){
    exact(input,['chatId','profileId','seats','modelIds','sourceIds']);
    if(input.profileId){const data=await this.inspect(input.profileId);if(!data.current||input.sourceIds.some(id=>!data.current.content.sources.some(s=>s.id===id)))throw new Error('Select existing source snapshots.');for(const modelId of input.modelIds){const model=this.store.state.models.find(m=>m.id===modelId);if(model)this.checkSources(input.profileId,model);}}
    await this.store.transact(s=>{assertInferenceIdle(s);bindPersonalContext(s,input);return s;});
    if(input.profileId)await this.prepare(input.chatId,input.seats);
    return this.store.state;
  }
  async propose(input){
    exact(input,['profile','operation','baseRevision','account','sourceIds']);
    const {profile,...request}=input;
    return this.host(profile,'propose_personal_note',{request});
  }
  async decide(input){
    exact(input,['profile','action','operation','proposal','expectedHead','account']);
    if(!['accept','reject'].includes(input.action))throw new Error('Choose Keep or Reject.');
    const {profile,...request}=input;
    if(request.action==='reject'){await this.memory.sync(profile);return this.host(profile,'change_personal_context',{request});}
    return this.memory.write(profile,()=>request,user);
  }
  async revise(input){
    exact(input,['profile','operation','expectedHead','baseRevision','content']);
    const {profile,...fields}=input;
    return this.memory.write(profile,()=>({action:'revise',...fields}),user);
  }
  async export(profile){await this.memory.sync(profile);return this.host(profile,'export_personal_context');}
  chatSource(chatId,sourceId){
    const s=this.store.state,chat=s.chats.find(c=>c.id===chatId);
    if(!chat)throw new Error('Choose a source conversation.');
    if((s.pcAccess?.exposures??[]).some(e=>e.rootId===chat.rootId)||(s.handoffs?.records??[]).some(r=>r.scope.rootId===chat.rootId&&(r.detail?.contextView?.personalContext||r.detail?.contextView?.agentExposureIds?.length||r.detail?.tool==='read_sketch_book'||r.detail?.tool==='write_sketch')))
      throw new Error('This conversation carries separately restricted continuity, PC, agent or Sketch Book material. Its permissions cannot be removed by importing it as a note.');
    const source=sourceAt(s,chatId,sourceId);
    return {title:`${chat.title} · ${sourceId}`,origin:JSON.stringify({workspace:this.store.workspaceId,chat:chatId,message:source.messageId,author:source.author,model:source.modelIdentifier,at:source.createdAt,hash:source.hash}),kind:'conversation',text:source.content};
  }
  async prepare(chatId,seats,guard=()=>{},chairId=null){
    for(const seat of seats){
      const state=chairView(this.store.state,chatId,chairId),b=boundContext(state,chatId,seat);if(!b)continue;
      const {model,selection}=resolveSpeaker(state,chatId,seat);
      this.checkSources(b.profileId,model);await this.memory.sync(b.profileId);
      const check=()=>{guard();const view=chairView(this.store.state,chatId,chairId),current=boundContext(view,chatId,seat);
        if(!current||current.id!==b.id||digest(resolveSpeaker(view,chatId,seat).model)!==digest(model))throw new Error('Continuity chair or binding changed during preparation.');
        assertContextDisclosure(this.store.state,chatId,model);this.checkSources(b.profileId,model);};
      const capability={profile:b.profileId,mode:'model',author:{kind:'model',chair:seat,model:model.model,modelId:model.id,generation:selection.generationId??null,chatId},guard:check};
      const view=await this.bridge.call(capability,'read_personal_context');
      const passages=[];
      for(const source_id of b.sourceIds)passages.push(await this.bridge.call({...capability,revision:view.revision},'read_personal_source',{source_id,offset:0}));
      await this.store.transact(s=>{check();const prior=selectedContext(chairView(s,chatId,chairId),chatId,seat);
        if(!prior||digest(prior.view)!==digest(view)||digest(prior.passages)!==digest(passages))contextRecord(s,'snapshots',{profileId:b.profileId,bindingId:b.id,view,viewHash:digest(view),passages});return s;});
    }
  }
  async invoke(name,args,{contract,handoff,guard,callId}){
    const snapshot=contextLibrary(this.store.state).snapshots.find(v=>v.id===contract.personalContext?.snapshotId);
    if(!snapshot)throw new Error('No captured personal continuity scope for this reply.');
    const check=()=>{guard();const model=this.store.state.models.find(m=>digest(m)===contract.modelHash);
      if(!model||!contextAllowed(this.store.state,snapshot.profileId,model))throw new Error('Continuity destination is no longer permitted.');this.checkSources(snapshot.profileId,model);};
    const view=this.store.state.handoffs.records.find(r=>r.id===handoff.requestId)?.detail.task.view;
    if(!view?.speaker)throw new Error('Actual model attribution is missing.');
    const author={kind:'model',chair:contract.coat.seat,modelId:view.speaker.modelId,
      model:view.speaker.modelSnapshot.model,generation:view.speaker.generationId??null,
      chatId:handoff.scope.chatId,exchangeId:handoff.taskId};
    const input=name==='propose_personal_note'?{request:{operation:'model_'+digest({exchange:handoff.taskId,callId}).slice(0,48),baseRevision:snapshot.view.revision,account:args.account,sourceIds:args.source_ids}}:args;
    const policy=this.policy(snapshot.profileId);
    const policyCheck=()=>{check();if(this.policy(snapshot.profileId).id!==(contract.personalContext.memoryPolicy??'legacy-suggest'))throw new Error('Memory mode changed during this reply.');};
    if(name==='propose_personal_note'){
      policyCheck();if(policy.mode==='manual')throw new Error('Memory is set to Manual. Only the person can save it.');
      if(args.account===snapshot.view.account)return {unchanged:true,saved:false,reason:'Already current.'};
    }
    const result=await this.bridge.call({profile:snapshot.profileId,mode:'model',author,revision:snapshot.view.revision,guard:name==='propose_personal_note'?policyCheck:check},name,input);
    if(name!=='propose_personal_note'||policy.mode!=='automatic')return result;
    await this.retainOrigin(snapshot.profileId,handoff.scope.chatId);
    const saved=await this.memory.write(snapshot.profileId,d=>({action:'accept',operation:'auto_'+result.operation.slice(0,90),proposal:result.operation,expectedHead:d.head,account:result.account}),{kind:'automatic_policy',policyId:policy.id,model:author.model,proposedBy:author,reviewedByHuman:false},policyCheck);
    return {...result,saved:true,revision:saved.operation,profile:snapshot.profileId,reviewedByHuman:false};
  }
}
