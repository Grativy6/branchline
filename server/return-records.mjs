import {conversationMaterialScopes} from './material-scope.mjs';
import crypto from 'node:crypto';
import {digest} from './integrity.mjs';
import {chairRoster} from '../public/chair-roster.js';
import {hatHead,findHat,deskMemory,memoryHead,memoryChoice,threadHead,THREAD_STATES} from '../public/hats.js';

export const RETURN_PROFILE='branchline.return-records/1';
export const RETURN_TOOLS=['read_return_map','read_return_source','write_hat_note','update_hat_intro','write_desk_memory','propose_desk_memory','review_desk_memory_proposal','update_open_thread','record_source_correction'];
export const PRIVATE_RETURN_TOOLS=['write_hat_note','update_hat_intro','read_return_source','read_return_map'];
const id=p=>p+'_'+crypto.randomUUID(), now=()=>new Date().toISOString();
const copy=structuredClone;
const fail=(v,s)=>{if(!v)throw new Error(s);};
const text=(v,max=32000)=>typeof v==='string'&&v.length<=max&&!v.includes('\0');
const ref=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(v);
const exact=(p,keys)=>p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).every(k=>keys.includes(k));
const sources=v=>Array.isArray(v)&&v.every(s=>text(s,600)&&s.length>0);
const checkedRevisions=new WeakSet();
const blank=()=>({profile:RETURN_PROFILE,hats:[],memories:[],threads:[],events:[],supplies:[],corrections:[]});
export const returnRecords=s=>s.returnRecords??blank();
function ensure(s){s.schemaVersion=Math.max(8,s.schemaVersion);return s.returnRecords??=blank();}
export function returnActor(task=null,state=null){
  return task?{kind:'chair',chairId:task.chairId,chatId:task.chatId,taskId:task.id,exchangeId:task.exchangeId??null,name:task.selection.displayName,modelId:task.model.id,model:task.model.model,hatId:task.selection.chairSnapshot?.hatId??null,materialScopes:state?conversationMaterialScopes(state,task.chatId):[]}:{kind:'human',name:'You'};
}
function revision(content,author,refs=[],sourceBindingsRecorded=true,materialScopes=author.materialScopes??[]){fail(sources(refs),'Use source routes, or an empty source list.');return {id:id('returnrev'),at:now(),author:copy(author),sources:copy(refs),sourceBindingsRecorded,materialScopes:copy(materialScopes),...copy(content),hash:digest(content)};}
export function returnEvent(s,kind,detail,author,scope={}){
  const all=ensure(s),event={id:id('returnevent'),sequence:all.events.length+1,at:now(),kind,author:copy(author),...scope,detail:copy(detail)};
  all.events.push(event);return event;
}
function activeChat(s,chatId){const chat=s.chats.find(c=>c.id===chatId),root=s.roots.find(r=>r.id===chat?.rootId);fail(chat&&root&&!chat.archivedAt&&!root.archivedAt,'Choose an active conversation.');return {chat,root};}
function scopeOf(s,chatId){const c=s.chats.find(c=>c.id===chatId);return {chatId:chatId??null,rootId:c?.rootId??null};}
export function selectedHat(s,task){return findHat(s,task.selection?.chairSnapshot?.hatId??null);}
function conflict(s,target,submitted,current,author,scope){
  const event=returnEvent(s,'conflict',{target,submitted,currentRevision:current?.id??'',currentAuthor:current?.author??null},author,scope);
  return {saved:false,conflict:true,kind:'revision_conflict',currentRevision:current?.id??'',proposalId:event.id,message:'This record changed while the edit was being prepared. The current revision and your proposal are both retained.'};
}
function activeHat(s,hatId){const h=findHat(s,hatId);fail(h&&!hatHead(h).archived,'Choose an active Hat.');return h;}
export function saveHatNote(s,{hatId,noteId='',revision:base='',title,text:body,sources:refs=[]},author=returnActor()){
  const h=activeHat(s,hatId);fail(text(title,200)&&title.trim()&&text(body)&&sources(refs),'Give this Hat note a title, text and source routes.');
  let note=h.notes.find(n=>n.id===noteId);fail(note||!noteId,'Hat note not found.');
  const current=note?.revisions.at(-1);
  if((current?.id??'')!==base)return conflict(s,{kind:'hat_note',hatId,noteId}, {title,text:body,sources:refs,baseRevision:base},current,author,{hatId,...scopeOf(s,author.chatId)});
  if(current&&current.title===title.trim()&&current.text===body&&digest(current.sources)===digest(refs))return {saved:true,unchanged:true,hatId,noteId:note.id,revision:current.id,source:`hat_note:${hatId}:${note.id}:${current.id}`};
  if(!note){note={id:id('hatnote'),revisions:[]};h.notes.push(note);}
  const r=revision({title:title.trim(),text:body},author,refs,author.kind==='human'&&current&&digest(current.sources)===digest(refs)?current.sourceBindingsRecorded!==false:true,author.kind==='human'?current?.materialScopes??[]:author.materialScopes??[]);note.revisions.push(r);
  returnEvent(s,'hat.note',{hatId,noteId:note.id,revision:r.id,sources:refs},author,{hatId,...scopeOf(s,author.chatId)});
  return {saved:true,hatId,noteId:note.id,revision:r.id,source:`hat_note:${hatId}:${note.id}:${r.id}`};
}
export function saveHatIntro(s,{hatId,revision:base,intro,sources:refs=[]},author=returnActor()){
  const h=activeHat(s,hatId),old=hatHead(h);fail(text(intro,8000)&&sources(refs),'Use short Hat text and source routes.');
  if(author.kind==='chair')fail(old.allowChairIntro,'Chair edits to this Hat intro are off. The text can be kept as a Hat note or proposal.');
  if(old.id!==base)return conflict(s,{kind:'hat_intro',hatId},{intro,sources:refs,baseRevision:base},old,author,{hatId,...scopeOf(s,author.chatId)});
  if(old.intro===intro&&digest(old.sources)===digest(refs))return {saved:true,unchanged:true,hatId,revision:old.id,source:`hat:${hatId}:${old.id}`};
  const r=revision({name:old.name,intro,allowChairIntro:old.allowChairIntro,archived:old.archived},author,refs,author.kind==='human'&&digest(old.sources)===digest(refs)?old.sourceBindingsRecorded!==false:true,author.kind==='human'?old.materialScopes??[]:author.materialScopes??[]);h.revisions.push(r);
  returnEvent(s,'hat.intro',{hatId,revision:r.id,sources:refs},author,{hatId,...scopeOf(s,author.chatId)});
  return {saved:true,hatId,revision:r.id,source:`hat:${hatId}:${r.id}`};
}
export function configureDeskMemory(s,{rootId,chatId,enabled,authorChatId='',authorChairId='',automaticAfterHandoff=false}){
  const {chat,root}=activeChat(s,chatId);fail(root.id===rootId&&typeof enabled==='boolean'&&typeof automaticAfterHandoff==='boolean','Choose this desk and its memory setting.');
  let m=deskMemory(s,rootId);if(!m){m={id:id('deskmemory'),rootId,settings:[],revisions:[],proposals:[]};ensure(s).memories.push(m);}
  let author=null;
  if(enabled){const chosen=s.chats.find(c=>c.id===(authorChatId||chat.id));fail(chosen?.rootId===rootId&&!chosen.archivedAt,'The memory author must be in this desk.');const r=chairRoster(s,chosen),c=[r.desk,...r.visitors].find(c=>c.id===(authorChairId||r.desk.id));fail(c?.modelId,'Choose a connected chair to maintain desk MEMORY.');author={chatId:chosen.id,chairId:c.id};}
  const baseline=Object.fromEntries(Object.entries(s.contextCarry?.active??{}).filter(([id])=>s.chats.some(c=>c.id===id&&c.rootId===rootId)));
  const setting={id:id('memorychoice'),at:now(),enabled,author,automaticAfterHandoff,afterHandoffs:baseline};m.settings.push(setting);
  returnEvent(s,'memory.settings',{rootId,setting},returnActor(),{rootId,chatId});return m;
}
export function proposeDeskMemory(s,{rootId,text:body,sources:refs=[],targetRevision='',kind='proposal'},author=returnActor()){
  const m=deskMemory(s,rootId);fail(m&&memoryChoice(m).enabled,'Desk MEMORY is off.');fail(text(body)&&body.trim()&&sources(refs)&&['proposal','objection'].includes(kind),'Write a memory proposal or an attributed objection.');
  const p={id:id('memoryproposal'),at:now(),author:copy(author),kind,text:body,sources:copy(refs),materialScopes:copy(author.materialScopes??[]),targetRevision,decisions:[]};m.proposals.push(p);
  returnEvent(s,'memory.proposal',{rootId,proposalId:p.id,kind,targetRevision,sources:refs},author,{rootId,chatId:author.chatId??null});return {saved:true,proposalId:p.id,status:'pending'};
}
export function saveDeskMemory(s,{rootId,revision:base='',text:body,sources:refs=[],proposalIds=[]},author=returnActor()){
  const m=deskMemory(s,rootId);fail(m,'Enable desk MEMORY first.');fail(text(body)&&sources(refs)&&Array.isArray(proposalIds),'Use memory text, sources and proposal IDs.');
  const choice=memoryChoice(m);
  if(author.kind==='chair')fail(choice.enabled&&choice.author?.chairId===author.chairId&&choice.author?.chatId===author.chatId,'This chair is not the designated desk MEMORY author. It can submit a proposal.');
  const current=memoryHead(m);
  if((current?.id??'')!==base)return conflict(s,{kind:'desk_memory',rootId},{text:body,sources:refs,proposalIds,baseRevision:base},current,author,{rootId,chatId:author.chatId??null});
  if(current&&current.text===body&&!proposalIds.length&&digest(current.sources)===digest(refs))return {saved:true,unchanged:true,revision:current.id,source:`memory:${rootId}:${current.id}`};
  fail(proposalIds.every(p=>m.proposals.some(q=>q.id===p)),'A selected proposal was not found.');
  const r=revision({text:body},author,refs,author.kind==='human'&&current&&digest(current.sources)===digest(refs)?current.sourceBindingsRecorded!==false:true,author.kind==='human'?current?.materialScopes??[]:author.materialScopes??[]);m.revisions.push(r);
  for(const pid of proposalIds)m.proposals.find(p=>p.id===pid).decisions.push({at:now(),status:'incorporated',revision:r.id,author:copy(author)});
  returnEvent(s,'memory.write',{rootId,revision:r.id,proposalIds,sources:refs},author,{rootId,chatId:author.chatId??null});return {saved:true,revision:r.id,source:`memory:${rootId}:${r.id}`};
}
export function saveOpenThread(s,{chatId,id:threadId='',revision:base='',title,question,criterion,lookFor='',status='open',reason='',sources:refs=[],watch=[],evidence=[]},author=returnActor()){
  const {root}=activeChat(s,chatId);fail(text(title,200)&&title.trim()&&text(question,8000)&&text(criterion,8000)&&text(lookFor,4000)&&text(reason,4000)&&THREAD_STATES.includes(status)&&sources(refs)&&sources(watch)&&sources(evidence),'Use a named unresolved thread, a resolution criterion and recorded source routes.');
  let t=returnRecords(s).threads.find(t=>t.id===threadId&&t.chatId===chatId);fail(t||!threadId,'That thread belongs to another conversation or is missing.');
  const current=threadHead(t),content={title:title.trim(),question,criterion,lookFor,status,reason,watch:copy(watch),evidence:copy(evidence)};
  if((current?.id??'')!==base)return conflict(s,{kind:'thread',chatId,id:threadId},{...content,sources:refs,baseRevision:base},current,author,{rootId:root.id,chatId});
  if(current&&current.hash===digest(content)&&digest(current.sources)===digest(refs))return {saved:true,id:t.id,revision:current.id,unchanged:true};
  if(!t){t={id:id('openthread'),chatId,rootId:root.id,ownerChairId:author.chairId??null,revisions:[]};ensure(s).threads.push(t);}
  const r=revision(content,author,refs);t.revisions.push(r);returnEvent(s,'thread.write',{id:t.id,revision:r.id,status,watch,evidence,sources:refs},author,{rootId:root.id,chatId,threadId:t.id});
  return {saved:true,id:t.id,revision:r.id,source:`thread:${chatId}:${t.id}:${r.id}`};
}
export function saveSourceCorrection(s,{chatId,target,status,reason,replacement=''},author=returnActor()){
  const {root}=activeChat(s,chatId);fail(text(target,600)&&target&&['contested','superseded','withdrawn'].includes(status)&&text(reason,4000)&&reason.trim()&&text(replacement,600),'Name the exact source, its status and the reason.');
  const c={id:id('sourcecorrection'),at:now(),chatId,rootId:root.id,target,status,reason,replacement,author:copy(author)};ensure(s).corrections.push(c);
  returnEvent(s,'source.corrected',{id:c.id,target,status,replacement},author,{chatId,rootId:root.id});return {saved:true,id:c.id};
}
export function applyReturnCommand(s,type,p){
  const author=returnActor();
  if(type==='return.hat.create'){
    fail(exact(p,['name','intro','allowChairIntro'])&&text(p.name,200)&&p.name.trim()&&text(p.intro,8000)&&typeof p.allowChairIntro==='boolean','Give the Hat a name and short text.');
    const h={id:id('hat'),createdAt:now(),origin:null,revisions:[revision({name:p.name.trim(),intro:p.intro,allowChairIntro:p.allowChairIntro,archived:false},author)],notes:[]};ensure(s).hats.push(h);returnEvent(s,'hat.created',{hatId:h.id,revision:hatHead(h).id},author,{hatId:h.id});return h;
  }
  if(type==='return.hat.save'){
    fail(exact(p,['id','revision','name','intro','allowChairIntro','archived'])&&text(p.name,200)&&p.name.trim()&&text(p.intro,8000)&&typeof p.allowChairIntro==='boolean'&&typeof p.archived==='boolean','Use this Hat editor.');
    const h=findHat(s,p.id),old=hatHead(h);fail(h,'Hat not found.');
    if(old.id!==p.revision)return conflict(s,{kind:'hat_intro',hatId:h.id},p,old,author,{hatId:h.id});
    const r=revision({name:p.name.trim(),intro:p.intro,allowChairIntro:p.allowChairIntro,archived:p.archived},author,old.sources,old.sourceBindingsRecorded!==false,old.materialScopes??[]);h.revisions.push(r);delete h.displayName;returnEvent(s,'hat.edited',{hatId:h.id,revision:r.id},author,{hatId:h.id});return h;
  }
  if(type==='return.hat.duplicate'){
    fail(exact(p,['id','revision','name'])&&text(p.name,200)&&p.name.trim(),'Name the duplicated Hat.');
    const old=findHat(s,p.id);fail(old&&hatHead(old).id===p.revision,'The source Hat changed. Reopen its current revision before duplicating.');
    const h=copy(old);h.id=id('hat');h.createdAt=now();h.origin={hatId:old.id,revision:p.revision};
    // Copied text keeps its authors. The new name and fork are a separate human event.
    h.displayName=p.name.trim();ensure(s).hats.push(h);returnEvent(s,'hat.duplicated',{hatId:h.id,fromHatId:old.id,revision:p.revision,name:p.name.trim()},author,{hatId:h.id});return h;
  }
  if(type==='return.hat.import'){
    fail(exact(p,['name','bundle'])&&text(p.name,200)&&p.name.trim()&&p.bundle?.format==='branchline.hat-export/1','Choose a saved Hat JSON file and a name.');
    const imported=copy(p.bundle.hat);fail(imported&&Array.isArray(imported.revisions)&&imported.revisions.length&&Array.isArray(imported.notes),'The file has no Hat history.');
    const trial={...s,returnRecords:{...blank(),hats:[imported]}};validateReturnRecords(trial);
    const origin={imported:true,hatId:imported.id,revision:hatHead(imported).id};
    for(const v of [...imported.revisions,...imported.notes.flatMap(n=>n.revisions)]){v.sourceBindingsRecorded=false;v.importedMaterialScopes=v.materialScopes??[];v.materialScopes=[];if(v.author?.materialScopes)v.author={...v.author,materialScopes:[]};}
    const h={id:id('hat'),createdAt:now(),origin,revisions:imported.revisions,notes:imported.notes};
    const head=hatHead(h);h.revisions.push(revision({name:p.name.trim(),intro:head.intro,allowChairIntro:false,archived:false},author,head.sources,false));
    ensure(s).hats.push(h);returnEvent(s,'hat.imported',{hatId:h.id,origin,originalAttribution:'retained from the selected file; not independently authenticated'},author,{hatId:h.id});return h;
  }
  if(type==='return.hat.note'){fail(exact(p,['hatId','noteId','revision','title','text','sources']),'Unexpected Hat note fields.');return saveHatNote(s,p,author);}
  if(type==='return.memory.configure'){fail(exact(p,['rootId','chatId','enabled','authorChatId','authorChairId','automaticAfterHandoff']),'Unexpected desk-memory settings.');return configureDeskMemory(s,p);}
  if(type==='return.memory.save'){fail(exact(p,['rootId','revision','text','sources','proposalIds']),'Unexpected desk-memory fields.');return saveDeskMemory(s,p,author);}
  if(type==='return.memory.propose'){fail(exact(p,['rootId','text','sources','targetRevision','kind']),'Unexpected memory proposal fields.');return proposeDeskMemory(s,p,author);}
  if(type==='return.memory.decide'){
    fail(exact(p,['rootId','proposalId','status'])&&['accepted','declined','pending'].includes(p.status),'Choose a proposal disposition.');const m=deskMemory(s,p.rootId),proposal=m?.proposals.find(v=>v.id===p.proposalId);fail(proposal,'Proposal not found.');proposal.decisions.push({at:now(),status:p.status,author});returnEvent(s,'memory.decision',p,author,{rootId:p.rootId});return proposal;
  }
  if(type==='return.thread.save'){fail(exact(p,['chatId','id','revision','title','question','criterion','lookFor','status','reason','sources','watch','evidence']),'Unexpected unresolved-thread fields.');return saveOpenThread(s,p,author);}
  if(type==='return.thread.copy'){
    fail(exact(p,['id','chatId']),'Choose a thread and destination conversation.');const t=returnRecords(s).threads.find(t=>t.id===p.id);fail(t,'Thread not found.');const v=threadHead(t);return saveOpenThread(s,{...v,id:'',revision:'',chatId:p.chatId,sources:[`thread:${t.chatId}:${t.id}:${v.id}`]},author);
  }
  if(type==='return.correction'){fail(exact(p,['chatId','target','status','reason','replacement']),'Unexpected correction fields.');return saveSourceCorrection(s,p,author);}
  throw new Error('Unknown continuity command.');
}
export function executeReturnWrite(s,task,name,args){
  const author=returnActor(task,s),hatId=task.selection.chairSnapshot?.hatId,rootId=s.chats.find(c=>c.id===task.chatId)?.rootId;
  if(name==='write_hat_note'||name==='update_hat_intro'){
    fail(hatId,'This chair is not wearing a Hat.');fail(!args.hat_id||args.hat_id===hatId,'Hat scope conflict: this chair writes to its own selected Hat. Send an attributed proposal for another Hat.');
    if(name==='write_hat_note'){fail(task.selection.chairSnapshot.hatNotesAllowed!==false,'Hat-note writing is off for this chair.');return saveHatNote(s,{hatId,noteId:args.note_id,revision:args.revision,title:args.title,text:args.text,sources:args.sources},author);}
    return saveHatIntro(s,{hatId,revision:args.revision,intro:args.intro,sources:args.sources},author);
  }
  if(name==='write_desk_memory')return saveDeskMemory(s,{rootId,revision:args.revision,text:args.text,sources:args.sources,proposalIds:args.proposal_ids},author);
  if(name==='propose_desk_memory')return proposeDeskMemory(s,{rootId,text:args.text,sources:args.sources,targetRevision:args.target_revision,kind:args.kind},author);
  if(name==='review_desk_memory_proposal'){
    const m=deskMemory(s,rootId),choice=memoryChoice(m),proposal=m?.proposals.find(p=>p.id===args.proposal_id);
    fail(choice.enabled&&choice.author?.chatId===task.chatId&&choice.author?.chairId===task.chairId,'Only the designated memory author can record this disposition.');
    fail(proposal&&['accepted','declined','pending'].includes(args.status)&&text(args.reason,4000),'Choose a saved proposal, status and reason.');
    proposal.decisions.push({at:now(),status:args.status,reason:args.reason,author});returnEvent(s,'memory.decision',{rootId,proposalId:proposal.id,status:args.status,reason:args.reason},author,{rootId,chatId:task.chatId});return {saved:true,proposalId:proposal.id,status:args.status};
  }
  if(name==='update_open_thread')return saveOpenThread(s,{...args,chatId:task.chatId},author);
  if(name==='record_source_correction')return saveSourceCorrection(s,{...args,chatId:task.chatId},author);
  throw new Error('Unknown continuity write.');
}

export function applyCarryThreadReviews(s,record){
  if(!record.threadReviews?.length||record.author!=='model')return;
  const all=returnRecords(s);if(all.events.some(e=>e.kind==='handoff.threads.applied'&&e.detail.recordId===record.id))return;
  const author={kind:'handoff',name:record.modelLabel,chatId:record.chatId,jobId:record.jobId,recordId:record.id,materialScopes:record.returnAnchor?.materialScopes??[]};
  for(const review of record.threadReviews){
    const previous=record.returnAnchor?.threads.find(t=>t.id===review.id);
    const refs=review.sources??[];
    saveOpenThread(s,{chatId:record.chatId,id:review.id,revision:previous?.revision??'',title:previous?.title??review.title,question:previous?.question??review.question,criterion:previous?.criterion??review.criterion,lookFor:previous?.lookFor??review.lookFor,status:review.status,reason:review.reason,sources:[...new Set([...(previous?.sources??[]),...refs])],watch:previous?.watch??refs,evidence:review.evidence??[]},author);
  }
  returnEvent(s,'handoff.threads.applied',{recordId:record.id},author,scopeOf(s,record.chatId));
}

const immutablePrefix=(a,b)=>a.length<=b.length&&a.every((v,i)=>v===b[i]||digest(v)===digest(b[i]));
export function preserveReturnRecords(before,after){
  const old=before.returnRecords;if(!old)return;const next=after.returnRecords;fail(next,'Continuity history cannot be removed.');
  for(const key of ['events','supplies','corrections'])fail(immutablePrefix(old[key],next[key]),'Continuity receipts cannot be rewritten.');
  for(const key of ['hats','memories','threads']){
    const index=new Map(next[key].map(v=>[v.id,v]));
    for(const value of old[key]){
      const n=index.get(value.id);fail(n&&n.rootId===value.rootId&&n.chatId===value.chatId&&n.createdAt===value.createdAt,'Continuity ownership changed.');
      fail(immutablePrefix(value.revisions,n.revisions),'Continuity revisions cannot be rewritten.');
      if(key==='hats'){fail(digest(value.origin)===digest(n.origin),'Hat origin changed.');for(const note of value.notes){const nn=n.notes.find(r=>r.id===note.id);fail(nn&&immutablePrefix(note.revisions,nn.revisions),'Hat note history changed.');}}
      if(key==='memories'){
        fail(immutablePrefix(value.settings,n.settings),'Desk memory settings history changed.');
        for(const p of value.proposals){const q=n.proposals.find(v=>v.id===p.id);const body=({decisions,...v})=>v;fail(q&&digest(body(p))===digest(body(q))&&immutablePrefix(p.decisions,q.decisions),'A memory proposal was lost or rewritten.');}
      }
    }
  }
}
export function validateReturnRecords(s){
  const r=s.returnRecords;if(!r)return;fail(r.profile===RETURN_PROFILE,'Unknown return-record format.');
  const roots=new Set(s.roots.map(v=>v.id)),chats=new Map(s.chats.map(v=>[v.id,v])),exchanges=new Map(s.exchanges.map(v=>[v.id,v])),handoffs=new Map((s.handoffs?.records??[]).map(v=>[v.id,v]));
  for(const key of ['hats','memories','threads','events','supplies','corrections']){fail(Array.isArray(r[key]),'Missing continuity records.');const seen=new Set();for(const v of r[key]){fail(ref(v.id)&&!seen.has(v.id),'Invalid continuity record ID.');seen.add(v.id);}}
  const checkRevisions=(rows,keys)=>{fail(Array.isArray(rows),'Missing continuity revisions.');const ids=new Set();for(const v of rows){fail(ref(v.id)&&!ids.has(v.id),'Invalid or duplicate revision ID.');ids.add(v.id);if(Object.isFrozen(v)&&checkedRevisions.has(v))continue;fail(v.author&&['human','chair','handoff'].includes(v.author.kind)&&sources(v.sources)&&typeof v.at==='string'&&!Number.isNaN(Date.parse(v.at)),'Invalid continuity provenance.');const content=Object.fromEntries(keys.map(k=>[k,v[k]]));fail(v.sourceBindingsRecorded===undefined||typeof v.sourceBindingsRecorded==='boolean','Invalid source binding.');fail(v.hash===digest(content),'Continuity revision content differs from its saved hash.');if(Object.isFrozen(v))checkedRevisions.add(v);}};
  for(const h of r.hats){fail(h.revisions.length>0&&Array.isArray(h.notes),'Invalid Hat.');checkRevisions(h.revisions,['name','intro','allowChairIntro','archived']);for(const v of h.revisions)fail(text(v.name,200)&&v.name.trim()&&text(v.intro,8000)&&typeof v.allowChairIntro==='boolean'&&typeof v.archived==='boolean','Invalid Hat content.');for(const n of h.notes){fail(ref(n.id)&&n.revisions.length,'Invalid Hat note.');checkRevisions(n.revisions,['title','text']);}}
  const memoryRoots=new Set();for(const m of r.memories){fail(roots.has(m.rootId)&&!memoryRoots.has(m.rootId)&&Array.isArray(m.settings)&&Array.isArray(m.proposals),'Invalid desk memory.');memoryRoots.add(m.rootId);checkRevisions(m.revisions,['text']);for(const choice of m.settings)fail(typeof choice.enabled==='boolean'&&(choice.automaticAfterHandoff===undefined||typeof choice.automaticAfterHandoff==='boolean')&&(!choice.author||ref(choice.author.chatId)&&ref(choice.author.chairId)),'Invalid memory author choice.');for(const p of m.proposals)fail(ref(p.id)&&text(p.text)&&sources(p.sources)&&Array.isArray(p.decisions),'Invalid memory proposal.');}
  for(const t of r.threads){fail(chats.get(t.chatId)?.rootId===t.rootId&&t.revisions.length,'Invalid unresolved thread.');checkRevisions(t.revisions,['title','question','criterion','lookFor','status','reason','watch','evidence']);for(const v of t.revisions)fail(THREAD_STATES.includes(v.status)&&sources(v.watch)&&sources(v.evidence),'Invalid unresolved-thread state.');}
  for(const e of r.events)fail(typeof e.kind==='string'&&Number.isSafeInteger(e.sequence)&&e.author,'Invalid continuity event.');
  for(const p of r.supplies){const exchange=exchanges.get(p.exchangeId),input=handoffs.get(p.handoffRecordId);fail(exchange?.chatId===p.chatId&&exchange.speaker?.chairId===p.chairId&&input?.kind==='context.to_model'&&input.taskId===p.exchangeId&&input.scope.chatId===p.chatId&&Array.isArray(p.refs),'Invalid chair input receipt.');}
}

export function continuityDefinitions(){
  const str={type:'string'},short={type:'string',maxLength:600},refs={type:'array',items:short,maxItems:100};
  return {
    read_return_map:['Read your chair’s current return map or search its permitted source index. It includes exact routes, relevant changes and unresolved work.',{query:{type:'string',maxLength:200},offset:{type:'integer',minimum:0}}],
    read_return_source:['Open an exact route from your return map, Hat, desk MEMORY or thread. Start offset at 0 and use the returned revision/nextOffset.',{source:short,offset:{type:'integer',minimum:0}}],
    write_hat_note:['Write an attributed note to your selected Hat. New notes use empty note_id and revision. Edits require the returned revision; conflicts retain your proposal.',{hat_id:str,note_id:str,revision:str,title:{type:'string',maxLength:200},text:{type:'string',maxLength:32000},sources:refs}],
    update_hat_intro:['Explicitly revise the short text after the Hat’s fixed opening. Available only when the human enabled chair intro edits. This cannot change the fixed opening or settings.',{hat_id:str,revision:str,intro:{type:'string',maxLength:8000},sources:refs}],
    write_desk_memory:['Update this desk’s optional shared MEMORY. Only its designated author chair can write the account. Use current revision; other chairs submit proposals. Sources and incorporated proposals stay attributed.',{revision:str,text:{type:'string',maxLength:32000},sources:refs,proposal_ids:{type:'array',items:str}}],
    propose_desk_memory:['Submit a memory proposal or attach an objection to a memory revision. This does not start another model or require consensus.',{text:{type:'string',maxLength:32000},sources:refs,target_revision:str,kind:{type:'string',enum:['proposal','objection']}}],
    review_desk_memory_proposal:['The designated desk MEMORY author can accept, decline or leave a proposal pending, with an attributed reason. The original proposal or objection remains available.',{proposal_id:str,status:{type:'string',enum:['accepted','declined','pending']},reason:{type:'string',maxLength:4000}}],
    update_open_thread:['Save an unresolved question/task or update its recorded assessment, resolution criterion and evidence. Use empty id/revision for a new thread. Resolved means a recorded assessment with its basis, not a new execution permission.',{id:str,revision:str,title:{type:'string',maxLength:200},question:{type:'string',maxLength:8000},criterion:{type:'string',maxLength:8000},lookFor:{type:'string',maxLength:4000},status:{type:'string',enum:THREAD_STATES},reason:{type:'string',maxLength:4000},sources:refs,watch:refs,evidence:refs}],
    record_source_correction:['Record an attributed correction/objection about an exact source. Originals remain available; this does not declare all descendants false.',{target:short,status:{type:'string',enum:['contested','superseded','withdrawn']},reason:{type:'string',maxLength:4000},replacement:short}],
  };
}
