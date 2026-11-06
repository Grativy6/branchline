import {PICTURE_MODELS,rectangle} from './picture-provider.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {WorkNative} from './work-native.mjs';
import {WorkBrowser,browserOrigin} from './work-browser.mjs';
import {workSettings,hostSnapshot,workRecord,workExposure} from './work-access.mjs';
import {sketchDestination} from './sketches.mjs';
import {digest} from './integrity.mjs';
import {imageCapability} from './model-media.mjs';
const fail=(ok,why)=>{if(!ok)throw new Error('Work tools: '+why);};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const privateLooking=text=>/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{24,}/.test(text)||(process.env.OPENAI_API_KEY&&text.includes(process.env.OPENAI_API_KEY));
export class WorkTools {
 constructor(store,{pcFiles,imageStore,native=null,browser=null,pictures=null}={}){this.store=store;this.pcFiles=pcFiles;this.imageStore=imageStore;this.native=native??new WorkNative(pcFiles?.executable);this.browser=browser??new WorkBrowser();this.pictures=pictures;this.active=new Map();this.jobs=new Map();}
 async status(){return {nativeAvailable:this.native.available(),browserAvailable:await this.browser.available(),settings:workSettings(this.store.state),pictures:this.pictures?.status()??{available:false},includedNode:process.execPath,programScope:'saved commands run with your Windows account; working folders are not filesystem sandboxes',windowScope:'selected native window; text fields, buttons and window capture'};}
 async configure(input){
  fail(exact(input,['baseRevision','commands','window','browser','pictures','modelIds','modelSnapshots']),'choose the supported work tools and connections.');
  const old=workSettings(this.store.state);fail((old?.id??null)===input.baseRevision,'work choices changed. Reopen them before saving.');
  fail(Array.isArray(input.commands)&&input.commands.length<=16&&Array.isArray(input.modelIds),'choose bounded saved commands.');
  const destinations=input.modelIds.map(id=>{const m=this.store.state.models.find(m=>m.id===id);fail(m,'choose an existing model connection.');return sketchDestination(m);});fail(digest(destinations)===digest(input.modelSnapshots),'a reviewed connection changed.');
  const commands=[];
  for(const c of input.commands){
   fail(exact(c,['id','name','executable','args','cwd','seconds','approved'])&&typeof c.name==='string'&&c.name.trim()&&c.name.length<=100&&Array.isArray(c.args)&&c.args.length<=32&&c.args.every(a=>typeof a==='string'&&a.length<=4000&&!a.includes('\0'))&&typeof c.approved==='boolean'&&Number.isInteger(c.seconds)&&c.seconds>=1&&c.seconds<=600,'invalid saved command.');
   fail(path.isAbsolute(c.executable)&&c.executable.toLowerCase().endsWith('.exe')&&path.isAbsolute(c.cwd),'choose exact executable and working-folder paths.');
   fail(!privateLooking(c.args.join('\n')),'do not put credentials into saved command arguments.');
   const executable=path.resolve(c.executable),cwd=await this.pcFiles.native({mode:'inspect',path:c.cwd,directory:true});
   const stat=await fs.stat(executable);fail(stat.isFile()&&stat.size<=512*1024*1024,'executable is unavailable or too large.');const sha256=crypto.createHash('sha256').update(await fs.readFile(executable)).digest('hex');
   fail(c.id===null||old?.commands.some(x=>x.id===c.id),'unknown command identity.');
   const command={...c,id:c.id??'command_'+crypto.randomUUID(),name:c.name.trim(),executable,sha256,cwd:cwd.path,cwdIdentity:cwd.identity};
   await this.native.call({operation:'inspect_command',mode:'approved_windows_command',...command});commands.push(command);
  }
  let window=null;
  if(input.window){fail(exact(input.window,['target','control'])&&typeof input.window.control==='boolean','choose one window and its control setting.');const view=await this.native.call({operation:'inspect_window',target:input.window.target});window={target:view.target,control:input.window.control};}
  let browser=null;
  if(input.browser){fail(exact(input.browser,['enabled','origins','control'])&&typeof input.browser.enabled==='boolean'&&typeof input.browser.control==='boolean'&&Array.isArray(input.browser.origins)&&input.browser.origins.length<=12,'invalid browser choices.');browser={...input.browser,origins:[...new Set(input.browser.origins.map(browserOrigin))]};}
  let pictures=null;
  if(input.pictures){const p=input.pictures;fail(exact(p,['enabled','model','contextSharing','edit'])&&typeof p.enabled==='boolean'&&typeof p.contextSharing==='boolean'&&PICTURE_MODELS.includes(p.model),'choose a supported picture provider.');fail(!p.enabled||p.contextSharing,'review sharing prompts and selected pictures with the picture provider.');
   if(p.edit){fail(exact(p.edit,['chatId','imageId','area']),'choose one edit source and rectangle.');const source=this.pictureSource(p.edit.chatId,p.edit.imageId);const swapped=source.transform?.orientation>=5&&source.transform.orientation<=8;rectangle(p.edit.area,swapped?source.original.height:source.original.width,swapped?source.original.width:source.original.height);}
   pictures=structuredClone(p);
  }
  await this.store.transact(s=>{fail((workSettings(s)?.id??null)===input.baseRevision,'work choices changed before saving.');for(let i=0;i<input.modelIds.length;i++)fail(digest(sketchDestination(s.models.find(m=>m.id===input.modelIds[i])))===digest(destinations[i]),'a connection changed before saving.');workRecord(s,'settings',{workspaceId:this.store.workspaceId,workspacePath:this.store.dataDir,commands,window,browser,pictures,destinations});return s;});
  for(const controller of this.active.values())controller.abort();this.cancel();await this.browser.close();return this.status();
 }
 async windows(){return this.native.call({operation:'windows'});}
 pictureSource(chatId,id){const state=this.store.state;const item=state.images?.selections.find(i=>i.id===id&&i.chatId===chatId)??state.workAccess?.artifacts.find(a=>a.id===id&&a.chatId===chatId)?.snapshot;fail(item?.original&&item?.view,'choose a picture attached or produced in this conversation.');return item;}
 async jobEvent(job,status,detail={}){await this.store.transact(s=>{workRecord(s,'jobs',{jobId:job.id,chatId:job.chatId,taskId:job.taskId,status,...detail});return s;});}
 async recover(){const latest=new Map((this.store.state.workAccess?.jobs??[]).map(j=>[j.jobId,j]));for(const j of latest.values())if(j.status==='running')await this.jobEvent({id:j.jobId,chatId:j.chatId,taskId:j.taskId},'interrupted',{problem:'App restarted without a confirmed result. Remote completion is unknown; no request was repeated.'});}
 async makePicture({chatId,taskId,action,prompt,settings,signal,guard=()=>{}}){
  fail(settings.pictures?.enabled&&settings.pictures.contextSharing&&this.pictures,'picture tools are not enabled.');
  fail(['generate','edit'].includes(action)&&typeof prompt==='string'&&prompt.trim()&&prompt.length<=4000&&!privateLooking(prompt),'supply a bounded picture request without credentials.');
  fail(!(this.store.state.workAccess?.jobs??[]).some(j=>j.taskId===taskId),'This reply already attempted a picture. Inspect it before asking for another.');
  const edit=action==='edit'?settings.pictures.edit:null;fail(action!=='edit'||edit?.chatId===chatId,'select this conversation’s edit source and rectangle in Work tools first.');
  const source=edit?this.pictureSource(chatId,edit.imageId):null;
  const job={id:'picture_'+crypto.randomUUID(),chatId,taskId};guard();signal.throwIfAborted();await this.jobEvent(job,'running',{action,prompt,model:settings.pictures.model,source:source?{hash:source.original.sha256,area:edit.area}:null});
  try{const result=await this.pictures.make({model:settings.pictures.model,prompt,source:source?await this.imageStore.read(source.original):null,area:edit?.area??null},signal);
   // A confirmed result is retained even if Stop or a permission change arrived
   // just after the provider finished. It is not automatically sent to a model.
   const {bytes,...metadata}=result;const artifact=await this.savePicture(bytes,{chatId,taskId,kind:source?'edited_image':'generated_image',provenance:{...metadata,prompt,source:source?.original.sha256??null,jobId:job.id}});
   await this.jobEvent(job,'completed',{artifactId:artifact.id,estimatedUSD:result.estimatedUSD});guard();signal.throwIfAborted();return artifact;
  }catch(error){const completed=(this.store.state.workAccess?.jobs??[]).some(j=>j.jobId===job.id&&j.status==='completed');if(!completed)await this.jobEvent(job,signal.aborted?'stopped':'failed',{problem:error.message,remoteCompletion:'unknown unless confirmed by the provider'});throw error;}
 }
 startPicture(input){fail(![...this.jobs.values()].some(j=>j.chatId===input.chatId),'a picture is already preparing in this conversation.');fail(exact(input,['chatId','action','prompt']),'choose a conversation and picture request.');fail(this.store.state.chats.some(c=>c.id===input.chatId),'choose an existing conversation.');const settings=workSettings(this.store.state);fail(settings?.workspaceId===this.store.workspaceId&&settings.workspacePath===this.store.dataDir,'review Work tools for this workspace.');const controller=new AbortController(),taskId='picture_ui_'+crypto.randomUUID();const entry={controller,chatId:input.chatId};this.jobs.set(taskId,entry);entry.promise=this.makePicture({...input,taskId,settings,signal:controller.signal,guard:()=>fail(workSettings(this.store.state)?.id===settings.id,'picture settings changed.')}).catch(()=>{}).finally(()=>this.jobs.delete(taskId));return {taskId};}
 cancel(chatId){for(const [id,j] of this.jobs)if(!chatId||j.chatId===chatId)j.controller.abort();}
 async savePicture(bytes,{chatId,taskId,kind,provenance,signal}){
  signal?.throwIfAborted();const snapshot=await this.imageStore.ingestFromHost('branchline-'+kind+'.png',bytes,kind);signal?.throwIfAborted();let artifact;
  await this.store.transact(s=>{signal?.throwIfAborted();artifact=workRecord(s,'artifacts',{chatId,taskId,kind,snapshot,provenance});return s;});return artifact;
 }
 async saveOutput(value,{chatId,taskId,settingsId,command}){
  const safe={...value};for(const key of ['stdout','stderr'])if(privateLooking(safe[key]??'')){safe[key+'Hash']=crypto.createHash('sha256').update(safe[key]).digest('hex');safe[key]='[Output withheld because it contains a credential-like value.]';safe.outputHeld=true;}
  let artifact;await this.store.transact(s=>{workExposure(s,{chatId,taskId,settingsId,kind:'approved_program_output'});const text=JSON.stringify(safe,null,2);artifact=workRecord(s,'artifacts',{chatId,taskId,kind:'program_output',text,textHash:digest(text),provenance:{commandId:command.id,name:command.name,executable:command.executable,executableHash:command.sha256,cwd:command.cwd}});return s;});
  return {...safe,stdout:(safe.stdout??'').slice(0,2500),stderr:(safe.stderr??'').slice(0,1000),outputTruncated:(safe.stdout?.length??0)>2500||(safe.stderr?.length??0)>1000,artifactId:artifact.id};
 }
 async invoke(name,args,{contract,model,handoff,signal,guard,prepared=async()=>{}}){
  fail(contract.work?.host&&handoff.kind==='reply','work tools need the selected foreground connection.');
  const controller=new AbortController();signal=AbortSignal.any([signal,controller.signal]);this.active.set(handoff.taskId,controller);
  const current=()=>{signal.throwIfAborted();guard();fail(digest(hostSnapshot(this.store.state,model,this.store.workspaceId,this.store.dataDir))===digest(contract.work.host),'work permissions or connection changed.');};
  const expose=async kind=>this.store.transact(s=>{current();workExposure(s,{chatId:handoff.scope.chatId,taskId:handoff.taskId,settingsId:workSettings(s).id,kind});return s;});
  try{
   current();const settings=workSettings(this.store.state);let value,imageBytes;
   if(name==='run_program'){
    fail(exact(args,['command_id']),'choose one saved command.');const command=settings.commands.find(c=>c.id===args.command_id&&c.approved);fail(command,'this command is not approved.');
    try{value=await this.native.call({operation:'run_command',mode:'approved_windows_command',...command},{signal,timeoutMs:command.seconds*1000+5000,beforeCommit:async detail=>{current();await prepared(detail);current();}});}catch(error){if(error.partial){const saved=await this.saveOutput({...error.partial,problem:error.message},{chatId:handoff.scope.chatId,taskId:handoff.taskId,settingsId:settings.id,command});error.message+=' Partial output: '+saved.artifactId;}throw error;}
    value=await this.saveOutput(value,{chatId:handoff.scope.chatId,taskId:handoff.taskId,settingsId:settings.id,command});
   }else if(name==='write_work_artifact'){
    fail(exact(args,['name','text'])&&typeof args.name==='string'&&args.name.length<=100&&!/[\\/:\x00-\x1f]/.test(args.name)&&/\.(txt|md|html|svg|csv)$/i.test(args.name)&&typeof args.text==='string'&&args.text.trim()&&args.text.length<=8000&&!privateLooking(args.text),'choose a plain supported filename and a bounded draft without credentials.');let artifact;
    await this.store.transact(s=>{current();workExposure(s,{chatId:handoff.scope.chatId,taskId:handoff.taskId,settingsId:settings.id,kind:'work_draft'});artifact=workRecord(s,'artifacts',{chatId:handoff.scope.chatId,taskId:handoff.taskId,kind:'text_artifact',name:args.name,text:args.text,textHash:digest(args.text),provenance:{author:sketchDestination(model),role:'model_draft',execution:'NONE'}});return s;});value={artifactId:artifact.id,name:artifact.name,hash:artifact.textHash,savedAs:'local draft in Outputs',executed:false};
   }else if(name==='make_picture'){
    fail(exact(args,['prompt','action']),'choose generation or the selected edit.');await expose('picture_provider');const artifact=await this.makePicture({chatId:handoff.scope.chatId,taskId:handoff.taskId,...args,settings,signal,guard:current});value={artifactId:artifact.id,kind:artifact.kind,image:artifact.snapshot.view,provenance:artifact.provenance};try{await imageCapability(model);imageBytes=await this.imageStore.read(artifact.snapshot.view);}catch{}
   }else if(name==='describe_picture'){
    fail(exact(args,['image_id','question'])&&settings.pictures?.enabled&&settings.pictures.contextSharing,'vision assistance is not selected.');const source=this.pictureSource(handoff.scope.chatId,args.image_id);await expose('vision_provider');value=await this.pictures.describe(await this.imageStore.read(source.view),args.question,signal);value.sourceHash=source.view.sha256;
   }else if(name==='read_work_output'){
    fail(exact(args,['artifact_id','offset'])&&Number.isInteger(args.offset)&&args.offset>=0,'choose a saved output and offset.');const items=this.store.state.workAccess?.artifacts.filter(a=>a.chatId===handoff.scope.chatId)??[];
    if(args.artifact_id==='')value={outputs:items.slice(-40).map(a=>({id:a.id,kind:a.kind,at:a.at,sha256:a.textHash??a.snapshot.original.sha256}))};
    else{const a=items.find(a=>a.id===args.artifact_id);fail(a,'this output is not in the current conversation.');if(a.text){value={artifactId:a.id,kind:a.kind,hash:a.textHash,text:a.text.slice(args.offset,args.offset+4000),offset:args.offset,nextOffset:args.offset+4000<a.text.length?args.offset+4000:null,sourceRole:'recorded_work_output'};}else{value={artifactId:a.id,kind:a.kind,image:a.snapshot.view,provenance:a.provenance};try{await imageCapability(model);imageBytes=await this.imageStore.read(a.snapshot.view);}catch{}}}
   }else if(name==='use_window'){
    fail(exact(args,['action','control_id','revision','text'])&&settings.window,'choose the selected window action.');
    const operations={inspect:'inspect_window',capture:'capture_window',fill:'set_window_text',click:'invoke_window_control'};fail(operations[args.action],'unsupported window action.');
    if(['fill','click'].includes(args.action))fail(settings.window.control,'window interaction is not enabled.');
    value=await this.native.call({operation:operations[args.action],target:settings.window.target,controlId:args.control_id,revision:args.revision,text:args.text},{signal,beforeCommit:async detail=>{current();await prepared(detail);current();}});
    current();await expose('selected_window');
    if(value.base64){const raw=Buffer.from(value.base64,'base64');const {base64,...source}=value;const artifact=await this.savePicture(raw,{chatId:handoff.scope.chatId,taskId:handoff.taskId,kind:'window_capture',provenance:source,signal});value={...source,artifactId:artifact.id,image:artifact.snapshot.view};try{await imageCapability(model);imageBytes=await this.imageStore.read(artifact.snapshot.view);}catch{value.pixelDelivery='This connection has no qualified direct-image route; the picture is retained for viewing.';}}
   }else if(name==='use_browser'){
    fail(settings.browser?.enabled,'the work browser is not enabled.');const result=await this.browser.call(handoff.scope.chatId,settings.browser,args,signal,async detail=>{current();await prepared(detail);current();});current();value=result.value;await expose('work_browser');
    if(result.imageBytes){const artifact=await this.savePicture(result.imageBytes,{chatId:handoff.scope.chatId,taskId:handoff.taskId,kind:'browser_capture',provenance:value,signal});value={...value,artifactId:artifact.id,image:artifact.snapshot.view};try{await imageCapability(model);imageBytes=await this.imageStore.read(artifact.snapshot.view);}catch{value.pixelDelivery='Picture retained for viewing; direct pixels are unavailable to this connection.';}}
   }else throw new Error('Unknown work operation.');
   current();return {value,imageBytes};
  }finally{if(this.active.get(handoff.taskId)===controller)this.active.delete(handoff.taskId);}
 }
 async close(){this.cancel();await Promise.allSettled([...this.jobs.values()].map(j=>j.promise));for(const c of this.active.values())c.abort();await this.browser.close();}
}
