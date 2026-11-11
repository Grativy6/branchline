import {conversationMessages} from '../public/conversation-records.js';
import crypto from 'node:crypto';
import {digest} from './integrity.mjs';
import {dreamTraining,DREAM_ACTIVE,DREAM_FINISHED} from '../public/dream-training-state.js';
import {validateSchedule} from '../public/plan-schedule.js';
export const dreamId=prefix=>prefix+'_'+crypto.randomUUID();
export const dreamNow=()=>new Date().toISOString();
export const ensureDreamTraining=s=>s.dreamTraining??=structuredClone(dreamTraining(s));
const ref=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(x);
const str=(x,n)=>typeof x==='string'&&x.length<=n&&!x.includes('\0');
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const fail=(ok,message)=>{if(!ok)throw new Error('Dreams: '+message);};
const person=(s,id)=>s.personalParticipants?.find(p=>p.id===id);

export function validateDreamTraining(s) {
  const d=s.dreamTraining;if(!d)return;
  fail(d.version===1&&d.settings&&['notes','choices','runs','schedules','portraits','adoptions'].every(k=>Array.isArray(d[k])),'Invalid saved Dream data.');
  fail(d.settings.preparerModelId===null||ref(d.settings.preparerModelId),'Invalid preparation model.');
  const ids=new Set();
  for(const n of d.notes){
    fail(ref(n.id)&&!ids.has(n.id)&&ref(n.noteId)&&str(n.name,200)&&['conversation','workflow'].includes(n.focus)&&typeof n.removed==='boolean'&&hash(n.sha256)&&Number.isSafeInteger(n.characters)&&n.characters>=0,'Invalid note.');ids.add(n.id);
    fail(n.personalId===null||!!person(s,n.personalId),'The note owner is missing.');
    fail(str(n.preview,800)&&str(n.origin,200)&&str(n.at,40),'Invalid note details.');
  }
  for(const c of d.choices)fail(ref(c.id)&&!!person(s,c.personalId)&&d.notes.some(n=>n.noteId===c.noteId)&&typeof c.included==='boolean','Invalid batch selection.');
  for(const r of d.runs){
    fail(ref(r.id)&&!ids.has(r.id)&&!!person(s,r.personalId)&&[...DREAM_ACTIVE,...DREAM_FINISHED,'suspended','interrupted'].includes(r.status)&&Array.isArray(r.items)&&Array.isArray(r.events),'Invalid Dream run.');ids.add(r.id);
    fail(r.items.every(i=>d.notes.some(n=>n.id===i.revisionId&&n.noteId===i.noteId&&n.sha256===i.sha256)),'A frozen source revision is missing.');
    fail(r.preparer?.id&&r.baseGeneration?.id&&r.targetModel?.id&&str(r.at,40)&&str(r.message??'',4000),'The run starting point is missing.');
    if(r.rehearsalHash!==undefined)fail(hash(r.rehearsalHash),'Invalid frozen rehearsal identity.');
    if(r.frozenBatchHash!==undefined)fail(hash(r.frozenBatchHash),'Invalid frozen batch identity.');
    if(r.candidate)fail(ref(r.candidate.modelId)&&ref(r.candidate.generationId)&&hash(r.candidate.sha256)&&str(r.candidate.file,4096),'Invalid candidate.');
  }
  for(const p of d.portraits)fail(ref(p.id)&&!!person(s,p.personalId)&&(p.sha256===null||hash(p.sha256)),'Invalid model picture.');
  for(const q of d.schedules){fail(ref(q.id)&&!!person(s,q.personalId)&&typeof q.enabled==='boolean'&&['skip','latest'].includes(q.missed),'Invalid Dream schedule.');validateSchedule(q.schedule);}
  for(const a of d.adoptions){
    const p=person(s,a.personalId),r=d.runs.find(r=>r.id===a.runId);
    const target=a.kind==='previous'?r?.baseGeneration.id:r?.candidate?.generationId,modelId=a.kind==='previous'?r?.targetModel.id:r?.candidate?.modelId;
    fail(ref(a.id)&&p&&r?.candidate&&a.toGenerationId===target&&a.modelSnapshot?.id===modelId&&hash(a.checkedSha256)&&(a.kind==='previous'||a.checkedSha256===r.candidate.sha256),'Invalid generation selection.');
    fail(p.connections.some(c=>c.id===a.toConnectionId&&c.modelId===a.modelSnapshot.id)&&p.generations.some(g=>g.id===a.toGenerationId),'Candidate selection lost its model binding.');
  }
}

export function preserveDreamTraining(before,after) {
  const a=dreamTraining(before),b=dreamTraining(after);
  for(const key of ['notes','choices','portraits','adoptions'])fail(b[key].length>=a[key].length&&a[key].every((r,i)=>digest(r)===digest(b[key][i])),'Earlier '+key+' were changed.');
  for(const r of a.runs){
    const next=b.runs.find(x=>x.id===r.id);fail(next,'A Dream run was removed.');
    for(const key of ['id','personalId','at','items','targetModel','baseGeneration','preparer','recipe','scheduleId','engineSnapshot','rehearsalHash'])fail(digest(r[key]??null)===digest(next[key]??null),'The frozen '+key+' changed.');
    fail(next.events.length>=r.events.length&&r.events.every((e,i)=>digest(e)===digest(next.events[i])),'Earlier run events were changed.');
    if(r.frozenBatchHash)fail(next.frozenBatchHash===r.frozenBatchHash,'The frozen batch changed.');
    if(DREAM_FINISHED.has(r.status))fail(digest(r)===digest(next),'A finished run was rewritten.');
  }
}

export function trainedGeneration(s,p,g) {
  const r=s.dreamTraining?.runs.find(r=>r.personalId===p.id&&r.candidate?.generationId===g.id);
  return !!r&&g.sourceStanding==='trained_local'&&g.dreamRunId===r.id&&g.modelIdentifier===r.candidate.modelIdentifier&&g.adapter?.sha256===r.candidate.adapterSha256;
}
export function permitsTrainedSelection(before,after,p) {
  const a=dreamTraining(before),b=dreamTraining(after),added=b.adoptions.slice(a.adoptions.length);
  const n=after.personalParticipants.find(n=>n.id===p.id),x=added.find(x=>x.personalId===p.id);
  return added.length===1&&!!x&&x.fromGenerationId===p.currentGenerationId&&x.toGenerationId===n?.currentGenerationId&&x.fromConnectionId===p.connections.at(-1)?.id&&x.toConnectionId===n.connections.at(-1)?.id&&digest(x.modelSnapshot)===digest(after.models.find(m=>m.id===x.modelSnapshot.id));
}

export function captureDreamSource(s,input,{ponyRead=null}={}) {
  const validText=v=>str(v,16*1024*1024)&&v.trim();
  if(input.kind==='manual'){
    fail(validText(input.text),'Enter some text or choose a text file.');
    return {kind:'manual',text:input.text,messages:null,fileName:str(input.fileName??'',255)?input.fileName??'':'',at:dreamNow()};
  }
  const ids=input.kind==='desk'?s.chats.filter(c=>c.rootId===input.rootId).map(c=>c.id):[input.chatId];
  fail(ids.length&&ids.every(id=>s.chats.some(c=>c.id===id)),'Choose a saved desk or conversation.');
  let messages=ids.flatMap(id=>conversationMessages(s,id)).sort((a,b)=>(a.createdAt??'').localeCompare(b.createdAt??''));
  if(input.messageIds){fail(Array.isArray(input.messageIds)&&input.messageIds.length&&input.messageIds.every(id=>messages.some(m=>m.id===id)),'Choose saved messages.');const selected=new Set(input.messageIds);const last=Math.max(...messages.map((m,i)=>selected.has(m.id)?i:-1));messages=messages.slice(0,last+1);}
  // A highlight comes from rendered Markdown and can cross several messages.
  // Retain that visible selection alongside its original message records.
  if(input.kind==='passage')fail(validText(input.text)&&input.messageIds?.length,'Choose highlighted text from saved messages.');
  fail(messages.length,'This conversation has no recorded messages yet.');
  const selectedIds=input.messageIds??messages.map(m=>m.id);
  const rows=messages.map(m=>({id:m.id,chatId:m.chatId,role:m.role,content:m.kind==='pony'?(ponyRead?ponyRead(s,m.ponyParcelId):(()=>{throw new Error('Pony Post reader is unavailable.');})()):m.content??'',...(m.ponyParcelId?{ponyParcelId:m.ponyParcelId}:{}),speaker:m.role==='user'?(m.originChair?m.originChair+' · Task request':'You'):m.speaker?.displayName??m.modelLabel??'Assistant',at:m.createdAt,selected:selectedIds.includes(m.id),...(m.deskBatch?{deskBatchId:m.id}:{})}));
  const text=rows.map(m=>`${m.speaker}: ${m.content}`).join('\n\n');
  fail(text.length<=16*1024*1024,'This selection is very large; choose a conversation or a smaller range.');
  return {kind:input.kind,chatIds:ids,selectedIds,selectedText:input.kind==='passage'?input.text:null,messages:rows,text,at:dreamNow()};
}
