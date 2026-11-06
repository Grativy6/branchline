import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {digest} from './integrity.mjs';
import {navCurrent,navEpisode,navOperation,recordNav,NAV_TOOLS,NAV_OUTCOMES} from './nav-state.mjs';
import {navRelative,navFileAllowed,navArchive,navFrozen} from '../public/nav-format.js';
import {recordPcExposure,recordPcArtifact,assertPcDisclosure} from './pc-permissions.mjs';

const uid=()=>crypto.randomUUID().replaceAll('-','');
const hash=text=>crypto.createHash('sha256').update(text,'utf8').digest('hex');
const fail=(ok,why)=>{if(!ok)throw new Error('Nav: '+why);};
const join=(...parts)=>parts.filter(Boolean).join('\\');
const bounded=(value,n,empty=false)=>typeof value==='string'&&Buffer.byteLength(value)<=n&&(empty||value.trim().length>0);
const tail=e=>`<!-- branchline-nav-tail:${e.id}:${e.sequence} -->`;
const summary=e=>({id:e.id,origin:e.origin.path,journal:e.journal,sequence:e.sequence,state:e.state,outcome:e.outcome,timeZone:e.timeZone,filenameDate:e.filenameDate,sha256:e.sha256,identity:e.fileIdentity});
function arrivalPage(page,byteLimit){
  if(!page||Buffer.byteLength(page.text)<=byteLimit)return page;
  let low=0,high=page.text.length;
  while(low<high){const mid=Math.ceil((low+high)/2);if(Buffer.byteLength(page.text.slice(0,mid))<=byteLimit)low=mid;else high=mid-1;}
  if(low>0&&/[\uD800-\uDBFF]/.test(page.text[low-1]))low--;
  return {...page,text:page.text.slice(0,low),nextOffset:page.offset+low};
}
function humanNotes(text){
  const heading=/^##\s+Human notes[^\r\n]*(?:\r?\n|$)/im.exec(text);
  if(!heading)return null;
  const following=text.slice(heading.index+heading[0].length),end=following.search(/^#{1,2}\s/m);
  return following.slice(0,end<0?following.length:end).trim();
}

// Nav reuses PcFiles' locked Windows handles, exclusion checks, two-phase commits,
// recovery copies, and disclosure lineage. It never grants ordinary file writes.
export class Nav {
  constructor(store,pcFiles,{clock=()=>new Date(),afterNative=null}={}){this.store=store;this.pc=pcFiles;this.clock=clock;this.afterNative=afterNative;}
  async invoke(name,args,context){
    fail(NAV_TOOLS.includes(name)&&context.contract.nav&&context.handoff.kind==='reply','Nav is unavailable in this episode.');
    fail(!this.pc.active,'Another file action is running. Wait for its result.');
    const cancel=new AbortController(),signal=AbortSignal.any([context.signal,cancel.signal]);
    this.pc.active={cancel,chatId:context.handoff.scope.chatId};
    const current=()=>{signal.throwIfAborted();context.guard();return navCurrent(this.store.state,context.model,this.store.workspaceId,this.store.dataDir,context.contract.nav,args.root);};
    const c={...context,signal,current,root:current().root};
    try{
      if(name==='nav_read')return await this.read(args,c);
      if(name==='nav_journal'&&args.action==='resume'){
        const episode=navEpisode(this.store.state,args.episode);fail(episode,'Choose a recorded episode.');
        await this.verifyEpisode(episode,c);
        const page=await this.readFile(episode.journal,0,c);
        fail(page.sha256===episode.sha256&&page.identity===episode.fileIdentity,'The journal changed outside this episode. Inspect recovery before continuing.');
        return {episode:summary(episode),text:page.text,nextOffset:page.nextOffset,sourceRole:'record_not_a_grant'};
      }
      fail(/^[A-Za-z0-9_-]{1,64}$/.test(args.request_id),'Supply a stable request_id for this operation; keep it when retrying an uncertain result.');
      const requestKey=c.handoff.scope.chatId+':'+args.request_id,fingerprint=digest({name,args});
      const previous=navOperation(this.store.state,requestKey);
      if(previous){fail(previous.fingerprint===fingerprint,'That request_id already names different work.');return await this.reconcile(previous,c);}
      if(name==='nav_update')return await this.update(args,c,{requestKey,fingerprint});
      return await this.journal(args,c,{requestKey,fingerprint});
    }finally{this.pc.active=null;}
  }
  request(mode,relative,c,extra={}){
    const {root,settings}=c.current();navRelative(relative);
    if(['create','replace','nav-archive'].includes(mode))fail(!navFrozen([...root.path.slice(3).split('\\').filter(Boolean),...navRelative(relative)]),'Frozen source and snapshot locations remain unchanged, including when selected directly.');
    return {mode,navScope:true,root:root.path,rootIdentity:root.identity,path:relative,
      denied:[...settings.denied,...this.pc.protectedPaths.map(path=>({path}))],...extra};
  }
  async directory(relative,c){
    const parts=navRelative(relative);fail(!c.root.frontDoor||parts.length===0||parts.length===1&&navArchive(parts[0]),'This front-door selection does not grant child shelves. Select a destination separately.');
    const value=await this.pc.native(this.request('nav-directory',relative,c),{signal:c.signal});c.current();return value;
  }
  async readFile(relative,offset,c){
    fail(navFileAllowed(relative,c.root.frontDoor),'Nav reads navigation files and selected journal/receipt text only. Other source files need their own permitted reader.');
    fail(Number.isSafeInteger(offset)&&offset>=0,'Use a nonnegative page offset.');
    const value=await this.pc.native(this.request('read',relative,c,{offset}),{signal:c.signal});
    c.current();
    await this.store.transact(state=>{
      c.current();
      const sources=(state.pcAccess?.artifacts??[]).filter(a=>a.identity===value.identity&&a.sha256===value.sha256).flatMap(a=>a.sources);
      recordPcExposure(state,{chatId:c.handoff.scope.chatId,taskId:c.handoff.taskId,root:c.root,path:path.win32.join(c.root.path,relative),sources,nav:true});
      assertPcDisclosure(state,c.handoff.scope.chatId,c.model,this.store.workspaceId,this.store.dataDir);
      return state;
    });
    return {...value,root:c.root.id,path:relative,sourceRole:'navigation_or_journal_not_permission'};
  }
  async readAll(relative,c){
    let text='',first=null,offset=0;
    do{const page=await this.readFile(relative,offset,c);first??=page;fail(first.sha256===page.sha256&&first.identity===page.identity,'The source changed between pages. Read it again.');text+=page.text;offset=page.nextOffset;}while(offset!==null);
    return {...first,text,nextOffset:null};
  }
  async optionalRead(relative,c){
    try{return await this.readFile(relative,0,c);}catch(error){if(/location is unavailable or busy/.test(error.message))return null;throw error;}
  }
  async read(args,c){
    fail(['arrive','read'].includes(args.action),'Choose arrive or read.');
    if(args.action==='read')return this.readFile(args.path,args.offset,c);
    fail(args.offset===0,'Arrival begins at offset zero.');
    await this.directory(args.path,c);
    const documents=[];
    for(const name of ['README.md','MAP.md','TEMP.md']){
      if(navRelative(args.path).some(navArchive)&&name==='TEMP.md')continue;
      const relative=join(args.path,name),page=arrivalPage(await this.optionalRead(relative,c),Math.floor((c.contract.limits.result-2500)/3));
      documents.push(page??{path:relative,available:false,reason:'Unavailable or busy; no content read.'});
    }
    return {root:c.root.id,shelf:args.path,documents,journalCreated:false,
      next:'Follow relevant MAP markers. Check the next location before its contents. A blocked route does not complete the task; use other independently permitted routes. An unchanged visit needs no journal entry.'};
  }
  async verifyEpisode(e,c){
    fail(e.origin.rootId===c.root.id&&e.origin.rootPath===c.root.path&&e.origin.rootIdentity===c.root.identity,'This episode belongs to another or replaced origin. Select its current original grant.');
    const directory=await this.directory(e.origin.relative,c);
    fail(directory.identity===e.origin.identity&&directory.path===e.origin.path,'The starting shelf changed identity. Resolve it before writing.');
  }
  async ensureArchive(shelf,chosen,c){
    const parts=[...c.root.path.slice(3).split('\\').filter(Boolean),...navRelative(shelf)];fail(!navFrozen(parts),'Frozen shelves remain unchanged.');fail(!parts.some(navArchive),'An archive is terminal and cannot own another archive.');
    fail(typeof chosen==='string'&&(!chosen||navArchive(chosen)&&navRelative(chosen).length===1),'Choose the existing receipt archive by its single folder name.');
    const names=chosen?[chosen]:['receipt-archives','receipt-archive','receipt archive','Receipts','archive'];
    const found=[];
    for(const name of names){try{await this.directory(join(shelf,name),c);found.push(name);}catch(error){if(!/location is unavailable or busy/.test(error.message))throw error;}}
    fail(found.length<=1,'Several archive folders exist. Choose the owning one explicitly; do not merge them automatically.');
    if(found.length)return join(shelf,found[0]);
    fail(!chosen||chosen==='receipt-archives','That existing archive is unavailable. Only a new receipt-archives folder is created automatically.');
    const relative=join(shelf,'receipt-archives');
    await this.pc.native(this.request('nav-archive',relative,c),{signal:c.signal,beforeCommit:async info=>{c.current();await c.prepared({...info,purpose:'create_nav_archive',root:c.root.id,path:relative});c.current();}});
    c.current();return relative;
  }
  async ensureArchiveFront(archive,c){
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:c.contract.nav.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(this.clock());
    const attribution=`Updated by: Branchline for ${c.model.name.replace(/[\r\n]/g,' ')} · Authorized by: the user’s saved Nav setting · ${date}`;
    const texts={
      'README.md':'# Receipt archives\n\nSupporting episode journals and records for the owning shelf. Read [MAP](MAP.md) and return through [the shelf](../README.md). This archive is terminal.\n',
      'MAP.md':`# MAP — Receipt archives\n\n## Human notes\n\n> Temporary notes; preserve their wording and unresolved meaning before cleanup.\n\n[README](README.md) · [Owning shelf](../MAP.md)\n\n${attribution}\n\nEpisode journals are dated. Select relevant records rather than reading the whole archive.\n\n## Unresolved\n\nThe owning shelf carries current open questions and links to their journals.\n`
    };
    for(const [name,text] of Object.entries(texts)){
      const relative=join(archive,name);if(await this.optionalRead(relative,c))continue;
      await this.pc.native(this.request('create',relative,c,{text}),{signal:c.signal,beforeCommit:async info=>{c.current();await c.prepared({...info,purpose:'create_archive_navigation',root:c.root.id,path:relative});c.current();}});c.current();
    }
  }
  async journal(args,c,key){
    fail(['begin','append','close'].includes(args.action),'Choose begin, append, resume or close.');
    fail(bounded(args.text,5000)&&NAV_OUTCOMES.includes(args.outcome),'Supply concise observable work and a supported task outcome.');
    let episode,request;
    if(args.action==='begin'){
      fail(!args.episode&&args.outcome==='unassessed'&&bounded(args.topic,80),'A new episode needs a topic, no prior id, and an unassessed outcome.');
      const origin=await this.directory(args.shelf,c),archive=await this.ensureArchive(args.shelf,args.archive,c);await this.ensureArchiveFront(archive,c);
      const now=this.clock(),timeZone=c.contract.nav.timeZone,format=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}),filenameDate=format.format(now);
      const offset=new Intl.DateTimeFormat('en',{timeZone,timeZoneName:'shortOffset'}).formatToParts(now).find(p=>p.type==='timeZoneName').value;
      const id=uid(),slug=args.topic.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase().slice(0,48)||'episode';
      episode={id,origin:{rootId:c.root.id,rootPath:c.root.path,rootIdentity:c.root.identity,relative:args.shelf,path:origin.path,identity:origin.identity},journal:join(archive,`${filenameDate}-${slug}-${id.slice(0,12)}.md`),timeZone,filenameDate,startedUtc:now.toISOString(),sequence:0,state:'active',outcome:'unassessed',predecessor:null};
      const template=await this.optionalRead(join(args.shelf,'TEMP.md'),c);
      const text=`# ${args.topic.replace(/[\r\n]/g,' ')}\n\nEpisode: ${id}\nOrigin shelf: ${origin.path}\nStarted in UTC: ${episode.startedUtc}\nFilename timezone: ${timeZone} (${offset}); workspace setting, resolved by host Intl\nClock source: host wall clock; physical location unknown. Timestamps alone do not establish causal order.\nAuthor: ${c.model.name} (${c.model.id})\nOpening state: active\nInitial task outcome: unassessed\nTemplate: ${template?`${template.path} · SHA256 ${template.sha256}`:'No available TEMP.md; standard opening used.'}\nSensitive material: point to permitted sources; omit credentials and copied private contents.\n\n## Working entries\n\n### Entry 0\n\n${args.text}\n\n${tail(episode)}\n`;
      request={mode:'create',text};
    }else{
      episode=navEpisode(this.store.state,args.episode);fail(episode,'Choose an existing episode.');await this.verifyEpisode(episode,c);
      fail(episode.state==='active','Closed journals are preserved. Begin a new episode linking the earlier record.');
      fail(!args.shelf&&!args.archive&&!args.topic,'An existing episode keeps its origin, archive and topic; leave these fields empty.');
      fail(args.action!=='close'||args.outcome!=='unassessed','Closing needs a task outcome and an account of the result or remaining need.');
      const current=await this.readFile(episode.journal,0,c);
      fail(current.sha256===episode.sha256&&current.identity===episode.fileIdentity,'The journal base changed. Inspect the competing edit or recover the earlier operation.');
      const old=tail(episode),predecessor=`${episode.id}:${episode.sequence}`;
      episode={...episode,sequence:episode.sequence+1,state:args.action==='close'?'closed':'active',outcome:args.outcome,predecessor};
      const text=`### Entry ${episode.sequence}\n\nObserved UTC: ${this.clock().toISOString()}\nPredecessor: ${predecessor}\nAuthor: ${c.model.name} (${c.model.id})\nEpisode state: ${episode.state}\nTask outcome: ${episode.outcome}\n\n${args.text}\n\n${tail(episode)}`;
      request={mode:'replace',oldText:old,text,sha256:current.sha256,identity:current.identity};
    }
    return this.write({ ...key,episode,target:episode.journal,request },c);
  }
  async update(args,c,key){
    fail(['create','edit'].includes(args.action)&&navFileAllowed(args.path,c.root.frontDoor,true),'Only current README.md, MAP.md and TEMP.md are Nav edit targets; frozen journals and other artifacts are excluded.');
    fail(bounded(args.text,8000,true)&&bounded(args.old_text,8000,true),'Use at most 8 KiB per exact passage edit.');
    if(args.action==='create')fail(!args.old_text&&!args.sha256&&!args.identity,'A new navigation file has no old passage or identity.');
    else fail(args.old_text&&/^[a-f0-9]{64}$/.test(args.sha256)&&/^[a-f0-9]{8}:[a-f0-9]{16}$/.test(args.identity),'Read the current file and supply its exact identity, hash and unique old passage.');
    if(args.action==='edit'){
      const checked=await this.readFile(args.path,0,c);
      fail(checked.sha256===args.sha256&&checked.identity===args.identity,'The file changed. Read it again before editing.');
      fail(!this.store.state.nav?.operations.some(r=>r.episode?.fileIdentity===checked.identity),'A recorded episode journal keeps its history even if renamed. Use journal operations at its original location.');
    }
    let notesPreserved=null;
    if(args.action==='edit'&&path.win32.basename(args.path).toLowerCase()==='map.md'){
      const source=await this.readAll(args.path,c);
      fail(source.sha256===args.sha256&&source.identity===args.identity,'The file changed. Read it again before editing.');
      fail(source.text.split(args.old_text).length===2,'The old passage must match exactly once.');
      const oldNotes=humanNotes(source.text),newNotes=humanNotes(source.text.replace(args.old_text,args.text));
      if(oldNotes&&oldNotes!==newNotes)notesPreserved=await this.preserveNotes(args,source,oldNotes,c,key);
    }
    const request=args.action==='create'?{mode:'create',text:args.text}:{mode:'replace',text:args.text,oldText:args.old_text,sha256:args.sha256,identity:args.identity};
    return this.write({...key,target:args.path,request,...(notesPreserved?{notesPreserved}:{})},c);
  }
  async preserveNotes(args,source,originalNotes,c,key){
    const parent=navRelative(args.path).slice(0,-1).join('\\');
    const archive=navRelative(parent).some(navArchive)?parent:await this.ensureArchive(parent,'',c);
    await this.ensureArchiveFront(archive,c);
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:c.contract.nav.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(this.clock());
    const relative=join(archive,`${date}-human-notes-${digest(key).slice(0,16)}.json`);
    const record={kind:'human_note_preservation',requestFingerprint:key.fingerprint,source:{path:args.path,sha256:source.sha256,identity:source.identity},recordedUtc:this.clock().toISOString(),timeZone:c.contract.nav.timeZone,author:c.model.name,originalNotes,disposition:{status:'proposed_edit_not_resolution',oldPassage:args.old_text,replacement:args.text},meaning:'Original wording preserved before the MAP edit. An unfinished tail must remain on the live MAP; this receipt alone never resolves it.'};
    const existing=await this.optionalRead(relative,c);
    if(existing){const saved=JSON.parse((await this.readAll(relative,c)).text);fail(saved.requestFingerprint===key.fingerprint&&saved.source.sha256===source.sha256&&saved.originalNotes===originalNotes,'The note-preservation record changed. Inspect it before editing.');return {path:relative,sha256:existing.sha256};}
    const text=JSON.stringify(record,null,2)+'\n';
    const value=await this.pc.native(this.request('create',relative,c,{text}),{signal:c.signal,beforeCommit:async info=>{
      c.current();await this.store.transact(state=>{c.current();recordPcExposure(state,{chatId:c.handoff.scope.chatId,taskId:c.handoff.taskId,root:c.root,path:path.win32.join(c.root.path,relative),nav:true});return state;});
      await c.prepared({...info,purpose:'preserve_human_notes_before_edit',root:c.root.id,path:relative});c.current();
    }});
    await this.store.transact(state=>{recordPcArtifact(state,{chatId:c.handoff.scope.chatId,identity:value.identity,sha256:value.sha256});return state;});
    c.current();return {path:relative,sha256:value.sha256};
  }
  async finish(op,value,c,recovered=false){
    const episode=op.episode?{...op.episode,sha256:value.sha256,fileIdentity:value.identity}:undefined;
    const result={root:c.root.id,path:op.target,sha256:value.sha256,identity:value.identity,operationId:op.operationId,effect:'nav_file_change_observed',recovered,...(op.notesPreserved?{notesPreserved:op.notesPreserved}:{}),...(episode?{episode:summary(episode)}:{})};
    await this.store.transact(state=>{
      recordPcArtifact(state,{chatId:c.handoff.scope.chatId,identity:value.identity,sha256:value.sha256});
      recordNav(state,{...op,phase:'complete',...(episode?{episode}:{}),result});return state;
    });
    return result;
  }
  async write(input,c){
    c.current();const op={...input,operationId:uid(),phase:'planned',scope:{rootId:c.root.id,rootPath:c.root.path,rootIdentity:c.root.identity},chatId:c.handoff.scope.chatId,taskId:c.handoff.taskId,beforeHash:input.request.sha256??null,expectedAfter:input.request.mode==='create'?hash(input.request.text):null};
    await fs.mkdir(this.pc.recovery,{recursive:true});
    await this.store.transact(state=>{c.current();recordNav(state,op);return state;});
    try{
      const value=await this.pc.native(this.request(op.request.mode,op.target,c,{...op.request,operationId:op.operationId,recovery:this.pc.recovery}),{signal:c.signal,beforeCommit:async info=>{
        c.current();op.expectedAfter=info.after;
        await this.store.transact(state=>{c.current();recordPcExposure(state,{chatId:c.handoff.scope.chatId,taskId:c.handoff.taskId,root:c.root,path:path.win32.join(c.root.path,op.target),nav:true});recordNav(state,{...op,phase:'prepared'});return state;});
        await c.prepared({...info,operationId:op.operationId,root:c.root.id,path:op.target});c.current();
      }});
      await this.afterNative?.(op,value);
      return await this.finish(op,value,c);
    }catch(error){await this.store.transact(state=>{recordNav(state,{...op,phase:'uncertain',problem:error.message});return state;});throw error;}
  }
  async reconcile(op,c){
    fail(op.scope.rootId===c.root.id&&op.scope.rootPath===c.root.path&&op.scope.rootIdentity===c.root.identity,'The original operation belongs to a different location identity.');
    if(op.episode)await this.verifyEpisode(op.episode,c);
    if(op.phase==='complete'){await this.readFile(op.target,0,c);return {...op.result,replayed:true};}
    const current=await this.optionalRead(op.target,c);
    if(op.expectedAfter&&current?.sha256===op.expectedAfter)return this.finish(op,current,c,true);
    if(current?.sha256===op.beforeHash||!current&&op.beforeHash===null){
      await this.store.transact(state=>{recordNav(state,{...op,phase:'not_committed'});return state;});
      throw new Error('Nav: the earlier change did not commit. Inspect its result and use a new request_id if the change is still wanted. It was not repeated.');
    }
    throw new Error('Nav: the interrupted result differs from both recorded states. Inspect the recovery copy and current file; no write was repeated.');
  }
}
