import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { chairRoster } from '../public/chair-roster.js';
import { routeChairPrompt } from '../public/chair-mentions.js';
import { resolveSpeaker, lastMessageId } from './table.mjs';
import { digest } from './integrity.mjs';
import { deskWork, drawerFor, deskEvent, liveDeskTask, inspectChairLog, readDrawer, writeDrawer, writeDeskArtifact, deskUpdates, readDeskRecord } from './desk-work.mjs';

const now = () => new Date().toISOString();
const uid = p => p + '_' + crypto.randomUUID();
const fail = (ok, message) => { if (!ok) throw new Error(message); };
const resource = model => model.runtime === 'bundled' ? 'included-local' : model.runtime === 'lmstudio' ? `local:${model.baseUrl}` : null;
const waitingLabel = key => key === 'included-local' || key?.startsWith('local:') ? 'Waiting for local runtime slot' : 'Waiting for ChatGPT connection';
const toolPhase=name=>({read_drawer:'Reading own drawer',write_drawer:'Writing in own drawer',inspect_chair_log:'Inspecting a work log',read_desk_updates:'Reading desk updates',read_desk_record:'Reading a shared record',write_desk_artifact:'Sharing work on the desk',send_chair_message:'Messaging another chair'}[name]??String(name??'tool').replaceAll('_',' '));

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
    this.timer=setInterval(()=>this.kick(),400);this.timer.unref?.();
  }
  async recover() {
    if(!this.store.state.deskWork?.tasks.some(liveDeskTask))return;
    await this.store.transact(s=>{for(const t of s.deskWork.tasks.filter(liveDeskTask)){t.status='interrupted';t.phase='Interrupted when Branchline closed';t.endedAt=now();t.error='Inspect saved work before starting again; unknown effects were not repeated.';}return s;});
  }
  async admit(input, origin = null, { literal = false } = {}) {
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
    const parsed=origin||literal?{routed:Boolean(origin),sharedContext:'',sections:[{chairId:input.chairId??selected,content:input.content}],errors:[]} : routeChairPrompt(input.content,chairs,selected,roster.mode);
    if(input.kind==='ask'&&!parsed.sections.length)parsed.sections=[{chairId:selected,content:''}];
    fail(!parsed.errors.length,parsed.errors.join(' ')); fail(parsed.sections.length>0,'Write a task first.');
    const batchId=uid('deskbatch'), chainId=origin?.chainId??batchId;
    if(origin)fail((snapshot.deskWork?.tasks.filter(t=>t.chainId===chainId).length??0)<16,'This group reached its 16-task handoff allowance. Return the current results to the desk.');
    const tasks=parsed.sections.map((section,index)=>{
      const chair=chairs.find(c=>c.id===section.chairId);fail(chair,'Choose a chair at this desk.');
      const resolved=resolveSpeaker(snapshot,chat.id,chair.id===roster.desk.id?'personal':'visiting',chair.id);
      this.validate(snapshot,chat.id,resolved.model,resolved.selection,input);
      return {id:uid('desktask'),batchId,chainId,chatId:chat.id,rootId:root.id,chairId:chair.id,label:chair.name,index,
        model:structuredClone(resolved.model),selection:structuredClone(resolved.selection),content:section.content||parsed.sharedContext||input.content.trim(),
        kind:origin?'ask':input.kind??'send',createdAt:now(),status:'queued',phase:'Queued',exchangeId:null,error:null,
        requestId:`${input.requestId}_${index}`,originTaskId:origin?.id??null,
        input:{toolsEnabled:input.toolsEnabled===true,baseRevisionId:input.baseRevisionId,lastMessageId:input.lastMessageId,replyMode:parsed.broadcast?'all':parsed.routed?'single':input.replyMode??'single',
          ...(input.responseMode!==undefined?{responseMode:input.responseMode}:{}),...(input.harnessRevisionId!==undefined?{harnessRevisionId:input.harnessRevisionId}:{}),
          ...(input.selectedFile?{selectedFile:input.selectedFile}:{}),...(input.imagePlanId?{imagePlanId:input.imagePlanId}:{})}};
    });
    let duplicate=null;
    await this.store.transact(s=>{
      fail(!this.closed&&this.epoch===epoch&&(this.chatEpochs.get(input.chatId)??0)===chatEpoch,'Task admission was stopped.');
      const current=s.chats.find(c=>c.id===chat.id);fail(current&&chairRoster(s,current).revisionId===roster.revisionId,'The chairs changed during task admission.');
      const w=deskWork(s),prior=w.batches.find(b=>b.requestId===input.requestId);if(prior){fail(prior.fingerprint===fingerprint,'That request identity belongs to another message.');duplicate=prior;return s;}
      if(origin)fail(w.tasks.filter(t=>t.chainId===chainId).length+tasks.length<=16,'The handoff allowance is exhausted.');
      for(const t of tasks){const live=resolveSpeaker(s,t.chatId,t.selection.seat,t.chairId);fail(digest(live.selection)===digest(t.selection),'The addressed chair changed.');this.validate(s,t.chatId,live.model,live.selection,input);}
      const pictures=!origin&&!literal?this.captureImages(s,input,tasks):[];
      w.batches.push({id:batchId,chatId:chat.id,requestId:input.requestId,fingerprint,createdAt:now(),original:input.content,sharedContext:parsed.sharedContext,routed:parsed.routed,...(pictures.length?{selectedImages:pictures}:{}),
        assignments:tasks.map(t=>({taskId:t.id,chairId:t.chairId,chair:t.label,content:t.content})),originTaskId:origin?.id??null});
      for(const t of tasks){w.tasks.push(t);drawerFor(s,t.chatId,t.chairId,true);deskEvent(s,t,'task.assigned',{summary:t.content.slice(0,500),batchId});}
      if(s.drafts[chat.id]===input.content)delete s.drafts[chat.id];
      return s;
    });
    if(duplicate)return {batchId:duplicate.id,taskIds:this.store.state.deskWork.tasks.filter(t=>t.batchId===duplicate.id).map(t=>t.id),replayed:true};
    this.contextChanged();this.kick();return {batchId,taskIds:tasks.map(t=>t.id),failedTaskIds:tasks.filter(t=>t.status==='failed').map(t=>t.id),replayed:false};
  }
  kick(){if(this.closed||this.pumping)return;this.pumping=this.pump().catch(e=>{this.lastError=e.message;}).finally(()=>{this.pumping=null;});}
  async pump(){
    for(const task of this.store.state.deskWork?.tasks??[]){
      if(!['queued','waiting'].includes(task.status)||this.entries.has(task.id))continue;
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
      const {media,...request}=task.input;
      const body={...request,chatId:task.chatId,content:task.kind==='ask'?'':task.content,kind:task.kind,speaker:task.selection.seat,requestId:task.requestId,stream:true};
      await this.execute(body,{headers:{'x-branchline-stream':'events-v2'}},sink,{taskId:task.id,selection:task.selection,model:task.model});
      await entry.events;
      const saved=this.store.state.deskWork.tasks.find(t=>t.id===task.id),exchange=this.store.state.exchanges.find(e=>e.id===saved.exchangeId);
      const status=exchange?.status==='completed'?'completed':entry.stopped||exchange?.status==='cancelled'?'cancelled':'failed';
      await this.update(task.id,{status,phase:status==='completed'?(entry.toolIssue?'Reply finished · review tool results':'Reply finished'):status==='cancelled'?'Stopped':'Needs attention',endedAt:now(),lastText:entry.text.slice(0,200000),error:exchange?.error??sink.error??(status==='failed'?'No completed reply was recorded.':null)});
    }catch(error){await entry.events.catch(()=>{});await this.update(task.id,{status:entry.stopped?'cancelled':'failed',phase:entry.stopped?'Stopped':'Needs attention',error:error.message,endedAt:now(),lastText:entry.text.slice(0,200000)});}
    finally{this.contextChanged();}
  }
  async cancel(id){
    const task=this.store.state.deskWork?.tasks.find(t=>t.id===id);fail(task,'Task not found.');if(!liveDeskTask(task))return;
    const entry=this.entries.get(id);
    if(entry){entry.stopped=true;entry.sink?.destroy();await this.update(id,{status:'stopping',phase:'Stop requested'});}
    else await this.update(id,{status:'cancelled',phase:'Stopped before starting',endedAt:now()});
  }
  async stopAll(chatId=null){if(chatId)this.chatEpochs.set(chatId,(this.chatEpochs.get(chatId)??0)+1);else this.epoch++;for(const t of this.store.state.deskWork?.tasks??[])if(liveDeskTask(t)&&(!chatId||t.chatId===chatId))await this.cancel(t.id);}
  async waitForTask(id){for(;;){const t=this.store.state.deskWork?.tasks.find(t=>t.id===id);fail(t,'Task not found.');if(!liveDeskTask(t))return t;await new Promise(resolve=>setTimeout(resolve,50));}}
  status(){return (this.store.state.deskWork?.tasks??[]).map(t=>({...t,input:undefined,selection:undefined,model:{id:t.model.id,name:t.model.name,model:t.model.model,runtime:t.model.runtime},liveText:this.entries.get(t.id)?.text??t.lastText??''}));}
  async observeTool(taskId,name,args,callId){
    if(['read_drawer','write_drawer'].includes(name))return;
    const task=this.store.state.deskWork?.tasks.find(t=>t.id===taskId);fail(task&&liveDeskTask(task),'The task stopped before this outside action.');
    const target=Object.fromEntries(['root','path','id','title','chair_id','url','window_id','command'].filter(k=>typeof args[k]==='string').map(k=>[k,args[k].slice(0,300)]));
    await this.store.transact(s=>{const current=s.deskWork.tasks.find(t=>t.id===taskId);fail(current&&liveDeskTask(current)&&current.status!=='stopping','The task stopped before this outside action.');deskEvent(s,task,'outside.action',{tool:name,status:'starting',callId,target,scope:name==='run_program'?'Wider command effects may occur outside the drawer':undefined});return s;});
  }
  async call(taskId,name,args){
    const task=this.store.state.deskWork?.tasks.find(t=>t.id===taskId);fail(task&&this.entries.has(taskId)&&liveDeskTask(task),'This chair task is no longer active.');
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
