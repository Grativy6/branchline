import { liveDeskTask } from './desk-work.mjs';
import {dreamTraining,DREAM_ACTIVE} from '../public/dream-training-state.js';

export function activityRows(state, deskTasks, { preparations = new Map(), imageCheck = null, dreamRecovery = null } = {}) {
  const rows=[],tasks=state.deskWork?.tasks??[],managed=new Set(tasks.map(t=>t.exchangeId).filter(Boolean)),taskIds=new Set(tasks.map(t=>t.id));
  const place=chatId=>{const c=state.chats.find(c=>c.id===chatId),r=state.roots.find(r=>r.id===c?.rootId);return {chatId,rootId:r?.id??null,desk:r?.name??'Application',branch:c?.title??''};};
  const push=(type,id,chatId,fields)=>rows.push({id:`${type}:${id}`,sourceId:id,type,...place(chatId),...fields});
  for(const t of deskTasks.status())push('chair',t.id,t.chatId,{title:t.content.slice(0,100)||'Next reply',chair:t.label,chairId:t.chairId,model:t.model.name,status:t.status,phase:t.phase,content:t.content,canSteer:t.canSteer,delivery:t.delivery,automatic:t.automatic??false,goalId:t.goalId??null,usage:t.usage,createdAt:t.createdAt,startedAt:t.startedAt,originTaskId:t.originTaskId,scheduled:t.scheduled??false,endedAt:t.endedAt,liveText:t.liveText,notesStatus:t.notesStatus,error:t.error,active:liveDeskTask(t),batchId:t.batchId,exchangeId:t.exchangeId});
  for(const e of state.exchanges.filter(e=>!managed.has(e.id)&&!taskIds.has(e.request?.deskTaskId)).slice(-30)){
    const plan=state.plans?.runs.find(r=>r.chatId===e.chatId&&r.status==='running');
    push('exchange',e.id,e.chatId,{title:plan?'Plan: '+(plan.plan?.name??'Scheduled work'):'Reply',chair:e.speaker?.displayName??e.modelLabel,model:e.modelLabel,status:e.status,phase:e.status==='pending'?'Working':e.status,createdAt:e.createdAt,active:e.status==='pending'});
  }
  for(const [chatId] of preparations)if(state.chats.some(c=>c.id===chatId)&&!rows.some(r=>r.chatId===chatId&&r.active))push('preparing',chatId,chatId,{title:'Reply preparation',status:'preparing',phase:'Preparing context',active:true});
  for(const r of state.parallel?.runs??[])push('parallel',r.id,r.chatId,{title:state.ponyPost?.trips.some(t=>t.runId===r.id)?'Pony Post':'Additional approaches',status:r.status,phase:r.status,createdAt:r.createdAt,active:['queued','running'].includes(r.status)});
  for(const j of [...(state.contextCarry?.jobs??[]),...(state.mind?.jobs??[]),...state.roots.flatMap(r=>r.continuity?.jobs??[])])push('reflection',j.id,j.chatId,{title:j.target??'Context handoff',model:j.modelLabel,status:j.status,phase:j.status,createdAt:j.createdAt,active:j.status==='pending'});
  for(const j of state.easel?.jobs??[])push('easel',j.id,j.chatId??null,{title:'Easel image',status:j.status,phase:j.status,createdAt:j.createdAt,active:j.status==='running'});
  const work=[...new Map((state.workAccess?.jobs??[]).map(j=>[j.jobId,j])).values()];
  for(const j of work){const owner=rows.find(r=>r.exchangeId===j.taskId||r.sourceId===j.taskId);if(owner){(owner.operations??=[]).push({id:j.jobId,status:j.status,kind:j.action??'Tool operation'});continue;}push('work',j.jobId,j.chatId,{title:j.action??'Work tool',ownerTaskId:j.taskId,status:j.status,phase:j.status,createdAt:j.at,active:j.status==='running'});}
  for(const r of state.plans?.runs??[])if(['queued','running','needs_attention','interrupted'].includes(r.status)&&!rows.some(row=>row.chatId===r.chatId&&row.active))push('plan',r.id,r.chatId,{title:'Plan: '+(r.plan?.name??'Scheduled work'),status:r.status,phase:r.status,createdAt:r.startedAt,active:['queued','running'].includes(r.status)});
  if(imageCheck)push('image-check','current',null,{title:'Checking image connection',status:'running',phase:'Preparing connection',active:true});
  if(dreamRecovery)push('dream-recovery','current',null,{title:'Preparing Dream recovery',status:'preparing',phase:'Preparing saved state',active:true});
  for(const r of dreamTraining(state).runs.slice(-30))push('dream',r.id,null,{title:'Dream · '+(state.personalParticipants?.find(p=>p.id===r.personalId)?.nickname||state.personalParticipants?.find(p=>p.id===r.personalId)?.name||'Personal model'),model:r.targetModel.name,status:r.status,phase:r.message,createdAt:r.at,endedAt:r.finishedAt,active:DREAM_ACTIVE.has(r.status),resources:r.resources});
  return [...rows.filter(r=>r.active),...rows.filter(r=>!r.active).sort((a,b)=>(b.endedAt??b.createdAt??'').localeCompare(a.endedAt??a.createdAt??'')).slice(0,20)];
}
