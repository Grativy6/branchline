import { MAIL_TOOLS } from './pony-mail-state.mjs';
import crypto from 'node:crypto';
import { noteSettings } from '../public/reasoning-notes-settings.js';
import {ThinkingNotes,thinkingChoice} from './thinking-notes.mjs';
import { ReasoningNotes } from './reasoning-notes.mjs';
import { EventEmitter } from 'node:events';
import { chairRoster } from '../public/chair-roster.js';
import { routeChairPrompt } from '../public/chair-mentions.js';
import { resolveSpeaker, lastMessageId } from './table.mjs';
import { digest } from './integrity.mjs';
import { deskWork, drawerFor, deskEvent, liveDeskTask, inspectChairLog, readDrawer, writeDrawer, writeDeskArtifact, deskUpdates, readDeskRecord } from './desk-work.mjs';
import { currentGoal, goalRevision, goalState, goalEvents, goalEvent, setGoalState, assignGoal, goalAssignment, latestGoalReport, goalReportsComplete, reportGoalWork, goalUsage, goalLimitReason, dependencyEvent, GOAL_TOOL } from './desk-goals.mjs';
import { taskInput, inputDelivery, isDeliveredInput } from '../public/desk-input.js';

const now = () => new Date().toISOString();
const uid = p => p + '_' + crypto.randomUUID();
const fail = (ok, message) => { if (!ok) throw new Error(message); };
const resource = model => ['bundled','gguf'].includes(model.runtime) ? 'included-local' : model.runtime === 'lmstudio' ? `local:${model.baseUrl}` : null;
const waitingLabel = key => key === 'included-local' || key?.startsWith('local:') ? 'Waiting for local runtime slot' : 'Waiting for ChatGPT connection';
const humanInput = (state,task) => !task.ponyParcelId&&!task.originTaskId&&!task.automatic&&!task.scheduled&&!(state.chats.find(c=>c.id===task.chatId)?.planLimits&&task.requestId?.startsWith('plan_'));
const toolPhase=name=>({read_drawer:'Reading own drawer',write_drawer:'Writing in own drawer',inspect_chair_log:'Inspecting a work log',read_desk_updates:'Reading desk updates',read_desk_record:'Reading a shared record',write_desk_artifact:'Sharing work on the desk',send_chair_message:'Messaging another chair'}[name]??String(name??'tool').replaceAll('_',' '));
function retainUnsentInput(state,task){
  const prior=inputDelivery(state,task.id),uncertain=['requested','uncertain'].includes(prior?.state);
  const deliveryState=uncertain?'uncertain':'held',phase=uncertain?'Steering delivery uncertain':'Queued · resume to send';
  task.status='waiting';task.phase=phase;
  if(prior?.state!==deliveryState)deskEvent(state,task,'input.delivery',{state:deliveryState,source:'app_recovery',reason:uncertain?'Branchline closed without confirming delivery. Inspect the recorded reply before repeating it.':'This unsent message is saved. Choose Send queued or resume its goal.'},'drawer');
}

// A reply survives UI navigation. The ordinary reply engine writes its existing
// handoff/exchange records; this sink only delivers those events to task views.
class TaskResponse extends EventEmitter {
  constructor(onEvent) { super(); this.onEvent = onEvent; this.writableEnded = false; this.destroyed = false; this.statusCode = 200; this.pending = ''; this.error = null; }
  writeHead(code) { this.statusCode = code; }
  write(chunk) {
    if (this.destroyed) return false;
    this.pending += String(chunk);
    for (;;) {
      const end = this.pending.indexOf('\n\n'); if (end < 0) break;
      const frame = this.pending.slice(0,end); this.pending = this.pending.slice(end+2);
      const data = frame.split('\n').filter(l=>l.startsWith('data: ')).map(l=>l.slice(6)).join('\n');
      if (data) { const value=JSON.parse(data); const type=frame.split('\n').find(l=>l.startsWith('event: '))?.slice(7); this.onEvent({type,...value}); }
    }
    return true;
  }
  end(body) { if(body){try{const value=JSON.parse(String(body));if(value.error)this.error=value.error;}catch{}} this.writableEnded=true;this.emit('finish');this.emit('close'); }
  destroy() { if(!this.writableEnded){this.destroyed=true;this.emit('close');} }
}

export class DeskTasks {
  constructor(store, { execute, validate = () => {}, busy = () => null, contextChanged = () => {}, captureImages = () => [] }) {
    this.store=store;this.execute=execute;this.validate=validate;this.busy=busy;this.contextChanged=contextChanged;
    this.captureImages=captureImages;
    this.entries=new Map();this.closed=false;this.pumping=null;this.epoch=0;this.chatEpochs=new Map();
    this.timer=setInterval(()=>{ this.kick(); for(const entry of this.entries.values()) if(entry.notes&&!entry.noteTick) entry.noteTick=entry.notes.tick().catch(error=>{entry.notes.error??=error;}).finally(()=>{entry.noteTick=null;}); },400);this.timer.unref?.();
  }
  async recover() {
    if(!this.store.state.deskWork?.tasks.some(liveDeskTask)&&!this.store.state.deskWork?.goals?.some(g=>goalState(this.store.state,g.id)==='running'))return;
    this.recovering=true;
    try {
    await this.store.transact(s=>{
      for(const goal of s.deskWork.goals??[])if(goalState(s,goal.id)==='running')setGoalState(s,goal,'paused','Branchline reopened; resume from the saved return points.','recovery');
      for(const t of s.deskWork.tasks.filter(liveDeskTask)){
        if(!t.startedAt&&['queued','waiting'].includes(t.status)){
          if(t.ponyParcelId){t.status='waiting';t.phase='Waiting for Pony Post';continue;}
          if(t.automatic||t.trigger?.kind==='goal_start'){t.status='waiting';t.phase='Goal paused';continue;}
          if(humanInput(s,t)){retainUnsentInput(s,t);continue;}
        }
        t.status='interrupted';t.phase='Interrupted when Branchline closed';t.endedAt=now();t.error='Inspect saved work before starting again; unknown effects were not repeated.';
        const latest=new Map(s.deskWork.events.filter(e=>e.taskId===t.id&&e.kind==='reasoning.note').map(e=>[e.detail.noteId,e]));
        for(const event of latest.values()) if(event.detail.status==='streaming') deskEvent(s,t,'reasoning.note',{...event.detail,status:'interrupted',previousEventId:event.id},'drawer');
      }
      return s;
    });
    } finally { this.recovering=false; }
  }
  goals(chatId) {
    return (this.store.state.deskWork?.goals??[]).filter(g=>!chatId||g.chatId===chatId).map(g=>{
      const events=goalEvents(this.store.state,g.id), assignments=events.filter(e=>e.kind==='goal.assignment');
      return {...g,status:goalState(this.store.state,g.id),stateDetail:events.findLast(e=>e.kind==='goal.state')?.detail??null,usage:goalUsage(this.store.state,g),lanes:assignments.map(a=>{
        const laneTasks=this.store.state.deskWork.tasks.filter(t=>t.goalId===g.id&&t.chairId===a.chairId&&!isDeliveredInput(this.store.state,t.id));const task=laneTasks.findLast(t=>liveDeskTask(t)&&t.startedAt)??laneTasks.findLast(liveDeskTask)??laneTasks.at(-1),report=latestGoalReport(this.store.state,g.id,a.chairId);
        const paused=events.findLast(e=>e.kind==='goal.chair_state'&&e.detail.chairId===a.chairId)?.detail.paused??false;
        return {chairId:a.chairId,chair:a.author.chair,assignment:goalAssignment(this.store.state,g.id,a.chairId)?.detail.assignment??a.detail.assignment,status:paused?'paused':task&&liveDeskTask(task)?task.phase:report?.detail.status??'Needs a return point',report:report?.detail??null,taskId:task?.id};
      })};
    });
  }
  async goalAction({chatId,action,chairIds,baseRevisionId,requestId,chairId,toolsEnabled=false}) {
    const goal=currentGoal(this.store.state,chatId);fail(goal,'Save a goal in this conversation first.');
    fail(['start','resume','pause','stop','complete','resume-chair'].includes(action),'Choose a goal action.');
    if(action==='start'){
      fail(Array.isArray(chairIds)&&chairIds.length&&chairIds.length<=33,'Choose the chairs to start.');
      const prior=this.store.state.deskWork?.batches.find(b=>b.requestId===requestId);
      if(prior){const tasks=this.store.state.deskWork.tasks.filter(t=>t.batchId===prior.id);fail(tasks.every(t=>t.goalId===goal.id&&t.goalRevisionId===goalRevision(goal).id)&&digest(tasks.map(t=>t.chairId).sort())===digest([...new Set(chairIds)].sort()),'That start identity belongs to a different goal request.');return {batchId:prior.id,taskIds:tasks.map(t=>t.id),replayed:true};}
    }
    await this.store.transact(s=>{
      const g=currentGoal(s,chatId);fail(g?.id===goal.id,'The selected goal changed.');
      if(action==='resume-chair')goalEvent(s,g,'goal.chair_state',{chairId,paused:false});
      else {
        setGoalState(s,g,{start:'running',resume:'running',pause:'paused',stop:'stopped',complete:'completed'}[action]);
        if(action==='resume'){
          for(const e of goalEvents(s,g.id).filter(e=>e.kind==='goal.assignment'))goalEvent(s,g,'goal.chair_state',{chairId:e.chairId,paused:false});
          for(const task of s.deskWork.tasks)if(task.goalId===g.id&&inputDelivery(s,task.id)?.state==='held')deskEvent(s,task,'input.delivery',{state:'queued',source:'paired_UI',reason:'Released by Resume goal.'},'drawer');
        }
      }
      return s;
    });
    if(action==='stop'||action==='complete')for(const task of this.store.state.deskWork?.tasks??[])if(task.goalId===goal.id&&liveDeskTask(task))await this.cancel(task.id,{pauseChair:false});
    if(action==='start'){
      const chat=this.store.state.chats.find(c=>c.id===chatId);
      return this.admit({chatId,content:goalRevision(goal).text,kind:'send',requestId,baseRevisionId:baseRevisionId??chairRoster(this.store.state,chat).revisionId,lastMessageId:lastMessageId(this.store.state,chatId),toolsEnabled:toolsEnabled===true},null,{chairIds,goalId:goal.id,trigger:{kind:'goal_start'}});
    }
    this.kick();return {goalId:goal.id,status:goalState(this.store.state,goal.id)};
  }
  async advanceGoals() {
    for(const goal of this.store.state.deskWork?.goals??[]){
      const phase=goalState(this.store.state,goal.id);
      if(phase==='paused'&&goalEvents(this.store.state,goal.id).findLast(e=>e.kind==='goal.state')?.detail.basis==='chosen_limit'&&goalReportsComplete(this.store.state,goal))await this.store.transact(s=>{setGoalState(s,goal,'completed','All participating chairs reported their assignments complete. Inspect the linked evidence.','chair_reports');return s;});
      if(goalState(this.store.state,goal.id)!=='running'||currentGoal(this.store.state,goal.chatId)?.id!==goal.id)continue;
      const reason=goalLimitReason(this.store.state,goal);
      if(reason){await this.store.transact(s=>{setGoalState(s,goal,'paused',reason,'chosen_limit');return s;});continue;}
      const events=goalEvents(this.store.state,goal.id),assignments=events.filter(e=>e.kind==='goal.assignment');
      for(const assignment of assignments){
        const chairId=assignment.chairId;
        if(events.findLast(e=>e.kind==='goal.chair_state'&&e.detail.chairId===chairId)?.detail.paused)continue;
        if(this.store.state.deskWork.tasks.some(t=>t.chatId===goal.chatId&&t.chairId===chairId&&liveDeskTask(t)))continue;
        const task=this.store.state.deskWork.tasks.findLast(t=>t.goalId===goal.id&&t.chairId===chairId&&!isDeliveredInput(this.store.state,t.id));
        if(!task)continue;
        const report=latestGoalReport(this.store.state,goal.id,chairId);
        let trigger=null,content='';
        const resumed=events.findLast(e=>e.kind==='goal.chair_state'&&e.detail.chairId===chairId&&!e.detail.paused);
        if(resumed&&!events.some(e=>e.kind==='goal.dispatched'&&e.detail.triggerId===resumed.id)){
          trigger={kind:'human_resume',id:resumed.id};content='Resume the goal from your saved return point. Inspect recorded outcomes before repeating an uncertain action.';
        } else if((this.store.state.exchanges.find(e=>e.id===task.exchangeId)?.goal?.revisionId??task.goalRevisionId)!==goalRevision(goal).id){
          trigger={kind:'goal_revision',id:goalRevision(goal).id};content='The human revised the conversation goal. Read the current objective and continue your assignment under that revision.';
        } else if(report&&this.store.state.deskWork.tasks.find(t=>t.id===report.taskId)?.status==='completed'){
          if(report.detail.status==='continue'){trigger={kind:'declared_next_step',id:report.id};content=report.detail.next_step;}
          if(report.detail.status==='waiting'){
            const arrived=dependencyEvent(this.store.state,task,report);
            if(arrived){trigger={kind:'dependency',id:report.id+'_'+arrived.id,eventId:arrived.id};content='Your declared dependency has a new record '+arrived.id+'. Inspect it and continue your assignment; its arrival alone does not establish success.';}
          }
        }
        if(!trigger||events.some(e=>e.kind==='goal.dispatched'&&e.detail.triggerId===trigger.id&&e.detail.chairId===chairId))continue;
        const chat=this.store.state.chats.find(c=>c.id===goal.chatId),roster=chairRoster(this.store.state,chat);
        if(![roster.desk,...roster.visitors].some(c=>c.id===chairId&&c.modelId))continue;
        const requestId='goalstep_'+digest([goal.id,chairId,trigger.id]).slice(0,40);
        try {
          const result=await this.admit({chatId:goal.chatId,chairId,content,requestId,baseRevisionId:roster.revisionId,lastMessageId:lastMessageId(this.store.state,goal.chatId),toolsEnabled:task.input.toolsEnabled},null,{literal:true,automatic:true,goalId:goal.id,trigger});
          await this.store.transact(s=>{goalEvent(s,goal,'goal.dispatched',{triggerId:trigger.id,eventId:trigger.eventId??null,chairId,taskId:result.taskIds[0]},task);return s;});
        } catch(error) {
          await this.store.transact(s=>{goalEvent(s,goal,'goal.chair_state',{chairId,paused:true,reason:error.message},task);return s;});
        }
      }
      const s=this.store.state;
      if(goalReportsComplete(s,goal))
        await this.store.transact(next=>{setGoalState(next,goal,'completed','All participating chairs reported their assignments complete. Inspect the linked evidence.','chair_reports');return next;});
    }
  }
  async admit(input, origin = null, { literal = false, chairIds = null, goalId = null, automatic = false, trigger = null, scheduled = false, postal = null } = {}) {
    fail(!this.closed,'Branchline is closing.');
    fail(input && typeof input.chatId==='string' && typeof input.content==='string' && input.content.length<=200000 && typeof input.requestId==='string' && /^[A-Za-z0-9_-]{1,120}$/.test(input.requestId),'Choose a desk, message and request identity.');
    const epoch=this.epoch,chatEpoch=this.chatEpochs.get(input.chatId)??0;
    const fingerprint=digest(input),existing=this.store.state.deskWork?.batches.find(b=>b.requestId===input.requestId);
    if(existing){fail(existing.fingerprint===fingerprint,'That request identity belongs to another message.');return {batchId:existing.id,taskIds:this.store.state.deskWork.tasks.filter(t=>t.batchId===existing.id).map(t=>t.id),replayed:true};}
    const snapshot=this.store.state,chat=snapshot.chats.find(c=>c.id===input.chatId),root=snapshot.roots.find(r=>r.id===chat?.rootId);
    fail(chat && root && !chat.archivedAt && !root.archivedAt,'Choose an active desk.');
    const roster=chairRoster(snapshot,chat),chairs=[roster.desk,...roster.visitors];
    fail(input.baseRevisionId===roster.revisionId,'The chairs changed. Review the routing preview and send again.');
    if(!origin)fail(input.lastMessageId===lastMessageId(snapshot,chat.id),'The desk changed. Review the latest messages and send again.');
    const selected=input.chairId??(input.speaker==='visiting'?roster.selectedVisitorId:roster.desk.id);
    const parsed=chairIds?{routed:true,sharedContext:'',sections:[...new Set(chairIds)].map(chairId=>({chairId,content:input.content})),errors:[]} : origin||literal?{routed:Boolean(origin),sharedContext:'',sections:[{chairId:input.chairId??selected,content:input.content}],errors:[]} : routeChairPrompt(input.content,chairs,selected,roster.mode);
    if(input.kind==='ask'&&!parsed.sections.length)parsed.sections=[{chairId:selected,content:''}];
    fail(!parsed.errors.length,parsed.errors.join(' ')); fail(parsed.sections.length>0,'Write a task first.');
    const batchId=uid('deskbatch'), chainId=origin?.chainId??batchId;
    const goal=goalId?snapshot.deskWork?.goals?.find(g=>g.id===goalId&&g.chatId===chat.id):origin?.goalId?snapshot.deskWork?.goals?.find(g=>g.id===origin.goalId):currentGoal(snapshot,chat.id);
    const goalForTurn=!postal&&!scheduled&&goal&&!['stopped','completed'].includes(goalState(snapshot,goal.id))?goal:null;
    if(origin&&!goalForTurn)fail((snapshot.deskWork?.tasks.filter(t=>t.chainId===chainId).length??0)<16,'This group reached its 16-task handoff allowance. Return the current results to the desk.');
    const tasks=parsed.sections.map((section,index)=>{
      const chair=chairs.find(c=>c.id===section.chairId);fail(chair,'Choose a chair at this desk.');
      const resolved=resolveSpeaker(snapshot,chat.id,chair.id===roster.desk.id?'personal':'visiting',chair.id);
      this.validate(snapshot,chat.id,resolved.model,resolved.selection,input);
      return {id:uid('desktask'),batchId,chainId,chatId:chat.id,rootId:root.id,chairId:chair.id,label:chair.name,index,
        model:structuredClone(resolved.model),selection:structuredClone(resolved.selection),content:section.content||parsed.sharedContext||input.content.trim(),
        kind:postal||origin||automatic?'ask':input.kind??'send',createdAt:now(),status:'queued',phase:'Queued',exchangeId:null,error:null,
        requestId:`${input.requestId}_${index}`,originTaskId:origin?.id??null,
        ...(scheduled?{scheduled:true}:{}),
        ...(postal?{ponyParcelId:postal.parcelId,ponyAttempt:postal.attempt}:{}),
        ...(goalForTurn?{goalId:goalForTurn.id,goalRevisionId:goalRevision(goalForTurn).id,automatic:automatic||Boolean(origin),trigger:trigger??{kind:origin?'peer_request':'human_message'},eventCursor:snapshot.deskWork?.events.at(-1)?.id??''}:{}),
        input:{thinkingCoat:thinkingChoice(snapshot,resolved.selection),busyMode:snapshot.ui.busyInputMode??'queue-first',noteSettings:noteSettings(chat),toolsEnabled:input.toolsEnabled===true,baseRevisionId:input.baseRevisionId,lastMessageId:input.lastMessageId,replyMode:parsed.broadcast?'all':parsed.routed?'single':input.replyMode??'single',
          ...(input.responseMode!==undefined?{responseMode:input.responseMode}:{}),...(input.harnessRevisionId!==undefined?{harnessRevisionId:input.harnessRevisionId}:{}),
          ...(input.selectedFile?{selectedFile:input.selectedFile}:{}),...(input.imagePlanId?{imagePlanId:input.imagePlanId}:{})}};
    });
    let duplicate=null;
    await this.store.transact(s=>{
      fail(!this.closed&&this.epoch===epoch&&(this.chatEpochs.get(input.chatId)??0)===chatEpoch,'Task admission was stopped.');
      const current=s.chats.find(c=>c.id===chat.id);fail(current&&chairRoster(s,current).revisionId===roster.revisionId,'The chairs changed during task admission.');
      const w=deskWork(s),prior=w.batches.find(b=>b.requestId===input.requestId);if(prior){fail(prior.fingerprint===fingerprint,'That request identity belongs to another message.');duplicate=prior;return s;}
      if(origin&&!goalForTurn)fail(w.tasks.filter(t=>t.chainId===chainId).length+tasks.length<=16,'The handoff allowance is exhausted.');
      if(goalForTurn&&automatic)fail(goalState(s,goalForTurn.id)==='running'&&!goalLimitReason(s,goalForTurn),'The goal paused before this continuation.');
      if(goalForTurn&&goalState(s,goalForTurn.id)==='draft')setGoalState(s,goalForTurn,'running','Started by a human Send.');
      for(const t of tasks){const live=resolveSpeaker(s,t.chatId,t.selection.seat,t.chairId);fail(digest(live.selection)===digest(t.selection),'The addressed chair changed.');this.validate(s,t.chatId,live.model,live.selection,input);}
      if(postal)this.postalValidate?.(s,postal,tasks);
      const pictures=!origin&&!literal?this.captureImages(s,input,tasks):[];
      w.batches.push({id:batchId,chatId:chat.id,requestId:input.requestId,fingerprint,createdAt:now(),original:postal?'':input.content,sharedContext:parsed.sharedContext,routed:parsed.routed,...(pictures.length?{selectedImages:pictures}:{}),
        assignments:tasks.map(t=>({taskId:t.id,chairId:t.chairId,chair:t.label,content:t.content})),originTaskId:origin?.id??null});
      for(const t of tasks){w.tasks.push(t);drawerFor(s,t.chatId,t.chairId,true);deskEvent(s,t,'task.assigned',{summary:t.content.slice(0,500),batchId});if(goalForTurn)assignGoal(s,goalForTurn,t);}
      if(s.drafts[chat.id]===input.content)delete s.drafts[chat.id];
      return s;
    });
    if(duplicate)return {batchId:duplicate.id,taskIds:this.store.state.deskWork.tasks.filter(t=>t.batchId===duplicate.id).map(t=>t.id),replayed:true};
    if(!postal&&!origin&&!automatic&&!scheduled){const deliveries=await Promise.allSettled(tasks.filter(t=>t.input.busyMode==='steer-directly'&&[...this.entries.values()].some(e=>e.task.chatId===t.chatId&&e.task.chairId===t.chairId)).map(t=>this.promoteInput(t.id,{automaticSend:true})));for(const result of deliveries)if(result.status==='rejected')this.lastError=result.reason.message;}
    this.contextChanged();this.kick();return {batchId,taskIds:tasks.map(t=>t.id),failedTaskIds:tasks.filter(t=>t.status==='failed').map(t=>t.id),replayed:false};
  }
  async editInput(id,content){
    fail(typeof content==='string'&&content.trim()&&content.length<=200000,'Write a message.');
    await this.store.transact(s=>{
      const task=s.deskWork?.tasks.find(t=>t.id===id),delivery=inputDelivery(s,id);
      fail(task&&humanInput(s,task)&&!this.entries.has(id)&&['queued','waiting'].includes(task.status),'Only an unsent human message can be edited.');
      fail(!delivery||['queued','held'].includes(delivery.state),'This message is being delivered; its recorded text stays fixed.');
      deskEvent(s,task,'input.revised',{text:content,source:'paired_UI'},'drawer');
      if(task.goalId&&goalAssignment(s,task.goalId,task.chairId)?.detail.taskId===task.id){const goal=s.deskWork.goals.find(g=>g.id===task.goalId);goalEvent(s,goal,'goal.assignment.corrected',{assignment:content,taskId:task.id,source:'paired_UI'},task);}
      return s;
    });
    return {saved:true};
  }
  async releaseInput(id){
    await this.store.transact(s=>{
      const task=s.deskWork?.tasks.find(t=>t.id===id);
      fail(task&&!task.startedAt&&task.status==='waiting'&&inputDelivery(s,id)?.state==='held','Choose a saved, unsent message to resume.');
      deskEvent(s,task,'input.delivery',{state:'queued',source:'paired_UI',reason:'Released by Send queued.'},'drawer');task.phase='Queued';return s;
    });this.kick();return {queued:true};
  }
  async deliveryEvent(task,detail){
    let event;
    await this.store.transact(s=>{event=deskEvent(s,task,'input.delivery',{source:'paired_UI',...detail},detail.state==='accepted'?'desk':'drawer');event.author={chair:'You → '+task.label,model:null};return s;});
    return event;
  }
  async promoteInput(id,{automaticSend=false}={}){
    const task=this.store.state.deskWork?.tasks.find(t=>t.id===id);
    fail(task&&humanInput(this.store.state,task),'Choose a queued human message.');
    fail(automaticSend&&task.input.busyMode==='steer-directly'||this.store.state.ui.busyInputMode!=='queue-only','Steering is disabled in Queue only mode.');
    const prior=inputDelivery(this.store.state,id);
    if(prior&&['requested','accepted','uncertain'].includes(prior.state))return prior;
    fail(!this.entries.has(id)&&['queued','waiting'].includes(task.status),'This message has already started its own turn.');
    const target=[...this.entries.values()].find(e=>e.task.chatId===task.chatId&&e.task.chairId===task.chairId&&e.task.id!==id);
    if(!target?.steer||task.input.selectedFile||digest(task.model)!==digest(target.task.model)||task.goalId!==target.task.goalId||task.input.toolsEnabled!==target.task.input.toolsEnabled){
      const reason=task.input.selectedFile?'The text attachment will be included in the next turn.':!target?'The chair is ready for the next turn.':task.input.toolsEnabled!==target.task.input.toolsEnabled?'Changed tool choices apply in the next turn.':!target.steer&&target.task.model.runtime==='codex'?'The current turn is still preparing. This message is queued; Steer now becomes available when the turn is ready.':'This message will be received in the next turn.';
      const detail={state:'queued',reason,targetTaskId:target?.task.id??null};await this.deliveryEvent(task,detail);this.kick();return detail;
    }
    const steer=target.steer;let text;
    const claimed=this.store.transact(s=>{
      const current=s.deskWork.tasks.find(t=>t.id===id),delivery=inputDelivery(s,id);
      fail(!this.entries.has(id)&&['queued','waiting'].includes(current.status)&&(!delivery||delivery.state==='queued'),'Message delivery already started.');
      text=taskInput(s,current);deskEvent(s,current,'input.delivery',{state:'requested',targetTaskId:target.task.id,text,source:'paired_UI'},'drawer');return s;
    });
    claimed.catch(()=>{});
    const execute=async()=>{
      await claimed;
      try {
        const result=await steer({...task,content:text});
        if(!result.accepted){const detail={state:'queued',targetTaskId:target.task.id,reason:result.reason??'The turn ended before accepting this message.'};await this.deliveryEvent(task,detail);return detail;}
        const detail={state:'accepted',targetTaskId:target.task.id,exchangeId:result.exchangeId,threadId:result.threadId,turnId:result.turnId,text,receiptId:result.receiptId};
        await this.deliveryEvent(task,detail);
        await this.update(id,{status:'completed',phase:'Accepted by connection as steering',endedAt:now(),lastText:''});
        return detail;
      } catch(error) {
        const detail={state:error.providerRejected||error.notSubmitted?'queued':'uncertain',targetTaskId:target.task.id,reason:error.message};
        await this.deliveryEvent(task,detail);if(detail.state==='uncertain')await this.update(id,{status:'waiting',phase:'Steering delivery uncertain',error:'Inspect the target reply before retrying; this input was not sent again.'});return detail;
      } finally {this.kick();}
    };
    const result=(target.steerChain??Promise.resolve()).then(execute);target.steerChain=result.catch(()=>{});return result;
  }
  kick(){if(this.closed||this.pumping||this.recovering)return;this.pumping=this.pump().catch(e=>{this.lastError=e.message;}).finally(()=>{this.pumping=null;});}
  async pump(){
    await this.advanceGoals();
    for(const task of [...(this.store.state.deskWork?.tasks??[])].sort((a,b)=>Number(a.automatic===true)-Number(b.automatic===true))){
      if(!['queued','waiting'].includes(task.status)||this.entries.has(task.id))continue;
      if(['requested','uncertain','held'].includes(inputDelivery(this.store.state,task.id)?.state))continue;
      const managed=task.automatic||task.trigger?.kind==='goal_start';
      if(managed&&currentGoal(this.store.state,task.chatId)?.id!==task.goalId){await this.update(task.id,{status:'cancelled',phase:'Retired by a new conversation goal',endedAt:now()});continue;}
      if(managed&&goalState(this.store.state,task.goalId)!=='running'){if(task.phase!=='Goal paused')await this.update(task.id,{status:'waiting',phase:'Goal paused'});continue;}
      if(task.automatic&&task.trigger?.kind==='declared_next_step'&&latestGoalReport(this.store.state,task.goalId,task.chairId)?.id!==task.trigger.id){await this.update(task.id,{status:'cancelled',phase:'Superseded by a newer return point',endedAt:now()});continue;}
      if(task.goalId&&managed){const g=this.store.state.deskWork.goals.find(g=>g.id===task.goalId),limit=goalRevision(g).limits.turns,reserved=[...this.entries.values()].filter(e=>e.task.goalId===g.id&&!this.store.state.deskWork.tasks.find(t=>t.id===e.task.id)?.startedAt).length;const reason=goalLimitReason(this.store.state,g)||(limit&&goalUsage(this.store.state,g).turns+reserved>=limit?'The chosen chair-turn limit was reached.':null);if(reason){await this.store.transact(s=>{setGoalState(s,g,'paused',reason,'chosen_limit');return s;});continue;}}
      const sameChair=[...this.entries.values()].some(e=>e.task.chatId===task.chatId&&e.task.chairId===task.chairId);
      const key=resource(task.model),sameResource=key&&[...this.entries.values()].some(e=>resource(e.task.model)===key);
      const external=this.busy(task,key);
      const reason=sameChair?'Waiting for this chair to finish its current task':sameResource?waitingLabel(key):external;
      if(reason){if(task.status!=='waiting'||task.phase!==reason)await this.update(task.id,{status:'waiting',phase:reason});continue;}
      const entry={task:structuredClone(task),sink:null,text:'',events:Promise.resolve(),stopped:false,promise:null};
      this.entries.set(task.id,entry);
      entry.promise=this.run(entry).catch(e=>{this.lastError=e.message;}).finally(()=>{this.entries.delete(task.id);this.kick();});
    }
  }
  async update(id,fields){await this.store.transact(s=>{const t=s.deskWork?.tasks.find(t=>t.id===id);if(t&&liveDeskTask(t)){if(t.status==='stopping'&&['queued','waiting','preparing','running'].includes(fields.status))fields={...fields,status:'stopping',phase:'Stop requested'};Object.assign(t,fields);}return s;});}
  async run(entry){
    const task=entry.task;
    const sink=new TaskResponse(event=>{
      if(event.type==='delta')entry.text+=(event.text??'');
      if(event.type==='error')sink.error=event.error;
      if(['started','model_status','tool','tool_question'].includes(event.type))entry.events=entry.events.then(async()=>{
        if(event.type==='started')await this.update(task.id,{exchangeId:event.exchangeId,status:'running',phase:'Working'});
        if(event.type==='model_status')await this.update(task.id,{phase:event.message,status:event.phase==='loading'||event.phase==='checking'?'preparing':'running'});
        if(event.type==='tool'||event.type==='tool_question'){
          if(event.status==='held')entry.toolIssue=true;
          await this.update(task.id,{status:event.type==='tool_question'||event.status==='waiting'?'waiting':'running',phase:event.type==='tool_question'?'Waiting for your answer':event.message??toolPhase(event.name)});
          if(event.status!=='running'&&!['read_drawer','write_drawer'].includes(event.name))await this.store.transact(s=>{deskEvent(s,task,'outside.action',{tool:event.name,status:event.status,callId:event.callId});return s;});
        }
      });
    });
    entry.sink=sink;
    try{
      await this.update(task.id,{status:'preparing',phase:'Preparing this chair’s context',startedAt:now()});
      if(entry.stopped||this.closed){sink.destroy();throw new Error('Task stopped before dispatch.');}
      const {media,busyMode,noteSettings:startingNotes,thinkingCoat,...request}=task.input;
      const body={...request,chatId:task.chatId,content:task.kind==='ask'?'':taskInput(this.store.state,task),kind:task.kind,speaker:task.selection.seat,requestId:task.requestId,stream:true};
      await this.execute(body,{headers:{'x-branchline-stream':'events-v2'}},sink,{taskId:task.id,selection:task.selection,model:task.model,
        setSteerer:fn=>{entry.steer=fn;},waitInputs:()=>entry.steerChain,setUsage:value=>{entry.usage=value;},
        startNotes:(exchangeId,settings)=>{const periodic=settings.enabled?new ReasoningNotes({store:this.store,task,exchangeId,settings}):null;return entry.notes=task.input.thinkingCoat?.enabled?new ThinkingNotes({store:this.store,task,exchangeId,periodic}):periodic;}});
      await entry.events;
      const saved=this.store.state.deskWork.tasks.find(t=>t.id===task.id),exchange=this.store.state.exchanges.find(e=>e.id===saved.exchangeId);
      const status=exchange?.status==='completed'?'completed':entry.stopped||exchange?.status==='cancelled'?'cancelled':'failed';
      await this.update(task.id,{status,phase:status==='completed'?(entry.toolIssue?'Reply finished · review tool results':'Reply finished'):status==='cancelled'?'Stopped':'Needs attention',endedAt:now(),lastText:entry.text.slice(0,200000),error:exchange?.error??sink.error??(status==='failed'?'No completed reply was recorded.':null)});
      if(task.goalId)await this.store.transact(s=>{deskEvent(s,task,'task.finished',{goalId:task.goalId,status,exchangeId:saved.exchangeId});return s;});
    }catch(error){await entry.events.catch(()=>{});await this.update(task.id,{status:entry.stopped?'cancelled':'failed',phase:entry.stopped?'Stopped':'Needs attention',error:error.message,endedAt:now(),lastText:entry.text.slice(0,200000)});}
    finally{sink.destroy();await entry.steerChain;await entry.notes?.close(entry.stopped||sink.error?'interrupted':'complete');this.contextChanged();}
  }
  async cancel(id,{pauseChair=true}={}){
    const task=this.store.state.deskWork?.tasks.find(t=>t.id===id);fail(task,'Task not found.');if(!liveDeskTask(task))return;
    if(task.goalId&&pauseChair)await this.store.transact(s=>{const goal=s.deskWork.goals.find(g=>g.id===task.goalId);goalEvent(s,goal,'goal.chair_state',{chairId:task.chairId,paused:true,reason:'Stopped by the human.'},task);return s;});
    const entry=this.entries.get(id);
    if(entry){entry.stopped=true;if(entry.notes)entry.notes.stopRequested=true;entry.sink?.destroy();await this.update(id,{status:'stopping',phase:'Stop requested'});}
    else await this.update(id,{status:'cancelled',phase:'Stopped before starting',endedAt:now()});
  }
  async stopAll(chatId=null){
    if(chatId)this.chatEpochs.set(chatId,(this.chatEpochs.get(chatId)??0)+1);else this.epoch++;
    if(this.store.state.deskWork?.goals?.some(g=>(!chatId||g.chatId===chatId)&&goalState(this.store.state,g.id)==='running'))await this.store.transact(s=>{
      for(const g of s.deskWork.goals)if((!chatId||g.chatId===chatId)&&goalState(s,g.id)==='running')setGoalState(s,g,this.closed?'paused':'stopped',this.closed?'Branchline closed. Resume from saved records.':'Stop all requested.');return s;
    });
    for(const t of this.store.state.deskWork?.tasks??[])if(liveDeskTask(t)&&(!chatId||t.chatId===chatId)){
      if(this.closed&&!t.startedAt&&['queued','waiting'].includes(t.status)){
        if(t.ponyParcelId){await this.update(t.id,{status:'waiting',phase:'Waiting for Pony Post'});continue;}
        if(t.automatic||t.trigger?.kind==='goal_start'){await this.update(t.id,{status:'waiting',phase:'Goal paused'});continue;}
        if(humanInput(this.store.state,t)){await this.store.transact(s=>{const current=s.deskWork.tasks.find(task=>task.id===t.id);if(liveDeskTask(current)&&!current.startedAt)retainUnsentInput(s,current);return s;});continue;}
      }
      await this.cancel(t.id,{pauseChair:!this.closed});
    }
  }
  async waitForTask(id){for(;;){const t=this.store.state.deskWork?.tasks.find(t=>t.id===id);fail(t,'Task not found.');if(!liveDeskTask(t))return t;await new Promise(resolve=>setTimeout(resolve,50));}}
  status(){return (this.store.state.deskWork?.tasks??[]).map(t=>({...t,content:taskInput(this.store.state,t),usage:this.entries.get(t.id)?.usage??null,delivery:inputDelivery(this.store.state,t.id),canSteer:!this.entries.has(t.id)&&['queued','waiting'].includes(t.status)&&[...this.entries.values()].some(e=>e.task.chatId===t.chatId&&e.task.chairId===t.chairId&&e.steer),input:undefined,selection:undefined,model:{id:t.model.id,name:t.model.name,model:t.model.model,runtime:t.model.runtime},liveText:this.entries.get(t.id)?.text??t.lastText??'',notesStatus:this.entries.get(t.id)?.notes?.status()??null}));}
  async observeTool(taskId,name,args,callId){
    if(['read_drawer','write_drawer'].includes(name))return;
    const task=this.store.state.deskWork?.tasks.find(t=>t.id===taskId);fail(task&&liveDeskTask(task),'The task stopped before this outside action.');
    const target=Object.fromEntries(['root','path','id','title','chair_id','url','window_id','command'].filter(k=>typeof args[k]==='string').map(k=>[k,args[k].slice(0,300)]));
    await this.store.transact(s=>{const current=s.deskWork.tasks.find(t=>t.id===taskId);fail(current&&liveDeskTask(current)&&current.status!=='stopping','The task stopped before this outside action.');deskEvent(s,task,'outside.action',{tool:name,status:'starting',callId,target,scope:name==='run_program'?'Wider command effects may occur outside the drawer':undefined});return s;});
  }
  async call(taskId,name,args,callId=null){
    const task=this.store.state.deskWork?.tasks.find(t=>t.id===taskId);fail(task&&this.entries.has(taskId)&&liveDeskTask(task),'This chair task is no longer active.');
    if(MAIL_TOOLS.includes(name)){fail(this.ponyMail,'Pony Post is unavailable.');return this.ponyMail.call(task,name,args,callId);}
    if(name===GOAL_TOOL){let result;await this.store.transact(s=>{result=reportGoalWork(s,task,args,callId);return s;});return result;}
    if(name==='read_drawer')return readDrawer(this.store.state,task,args);
    if(name==='read_desk_updates')return deskUpdates(this.store.state,task.chatId,args.since??'');
    if(name==='read_desk_record')return readDeskRecord(this.store.state,task.chatId,args);
    if(name==='inspect_chair_log'){
      const entry=this.entries.get(taskId);entry.inspections??=new Map();const key=JSON.stringify([args.chair_id,args.query??'']);
      if(args.offset>0)fail(entry.inspections.has(key),'Reopen this log from offset 0 before continuing its snapshot.');
      const result=inspectChairLog(this.store.state,task,args,args.offset>0?entry.inspections.get(key):null);entry.inspections.set(key,result.snapshot);
      await this.store.transact(s=>{deskEvent(s,task,'log.inspected',{sourceChairId:args.chair_id,filtered:Boolean(args.query),hash:result.hash,offset:args.offset??0},'inspection');return s;});return result;
    }
    if(name==='send_chair_message'){
      fail(typeof args.message==='string'&&args.message.trim()&&args.message.length<=8000&&typeof args.request_reply==='boolean','Write a bounded message and choose whether it requests work.');
      const chat=this.store.state.chats.find(c=>c.id===task.chatId),roster=chairRoster(this.store.state,chat);
      fail(!args.request_reply||!chat.planLimits,'This scheduled occurrence is limited to its selected model task. Leave follow-up work on the desk.');
      fail([roster.desk,...roster.visitors].some(c=>c.id===args.chair_id),'Choose a chair at this desk.');
      await this.store.transact(s=>{deskEvent(s,task,'chair.message',{recipientChairId:args.chair_id,message:args.message,requestsWork:args.request_reply});return s;});
      if(args.request_reply)return this.admit({chatId:task.chatId,chairId:args.chair_id,content:args.message,requestId:uid('chairmessage'),baseRevisionId:roster.revisionId,lastMessageId:lastMessageId(this.store.state,chat.id),toolsEnabled:true},task);
      return {delivered:true,recipientChairId:args.chair_id,startsTask:false};
    }
    let result;await this.store.transact(s=>{const current=s.deskWork.tasks.find(t=>t.id===task.id);fail(liveDeskTask(current),'Task stopped before its write.');result=name==='write_drawer'?writeDrawer(s,task,args):name==='write_desk_artifact'?writeDeskArtifact(s,task,args):null;fail(result,'Unknown desk tool.');return s;});this.contextChanged();return result;
  }
  async close(){this.closed=true;clearInterval(this.timer);await this.stopAll();await this.pumping;await Promise.allSettled([...this.entries.values()].map(e=>e.promise));}
}
