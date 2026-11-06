import crypto from 'node:crypto';
import { digest, recordHandoff } from './handoff.mjs';

export const PONY_PROFILE = 'branchline.pony-post/1';
export const PONY_RUN_PROFILE = 'branchline.pony-approach/1';
export const DEFAULT_PONY = Object.freeze({ enabled: false, mode: 'limited', limit: 1 });
const uid = prefix => prefix + '_' + crypto.randomUUID();
const now = () => new Date().toISOString();
const fail = (ok, message) => { if (!ok) throw new Error('Pony Post: ' + message); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value,k));
const ref = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
const text = (value, max = 20000) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const taskGrant = t => ({id:t.id,requestId:t.requestId,rootId:t.rootId,chatId:t.chatId,purpose:t.purpose,sourceExchangeId:t.sourceExchangeId,settingsId:t.settingsId,policy:t.policy,unit:t.unit});
const reservation = t => Object.fromEntries(['id','requestId','clientHash','sendId','taskId','chatId','fingerprint','assignment','reason','modelId','modelHash','ponyTaskId','parentTripId','source','epoch','scopeRevision','mayRequestSubtasks'].map(k=>[k,t[k]]));
const stateOf = state => state.ponyPost ??= { profile: PONY_PROFILE, tasks: [], bindings: [], trips: [] };
export const ponySettings = state => state.parallel?.settings.at(-1)?.pony ?? DEFAULT_PONY;
export const isPonyRun = run => run?.profile === PONY_RUN_PROFILE;
export function validPonyPolicy(value) {
  return exact(value,['mode','limit']) && (value.mode === 'unlimited' && value.limit === null || value.mode === 'limited' && Number.isSafeInteger(value.limit) && value.limit >= 0);
}
export function validPonySetting(value) {
  return exact(value,['enabled','mode','limit']) && typeof value.enabled === 'boolean' && validPonyPolicy({mode:value.mode,limit:value.limit});
}
export const ponyPolicy = task => task.amendments.at(-1)?.policy ?? task.policy;
export const ponyTask = (state, id) => state.ponyPost?.tasks.find(t => t.id === id) ?? null;
export const activePonyTask = (state, chatId) => ponyTask(state, state.ponyPost?.bindings.filter(b => b.chatId === chatId).at(-1)?.taskId);
export function ponyUsage(state, task) {
  const trips = (state.ponyPost?.trips ?? []).filter(t => t.taskId === task.id);
  const started = trips.filter(t => t.send !== null).length;
  const reserved = trips.filter(t => t.status === 'reserved').length;
  const returned = trips.filter(t => t.return !== null).length;
  const policy = ponyPolicy(task);
  return { unit:'round_trip', mode:policy.mode, limit:policy.limit, started, reserved, returned,
    awaiting:trips.filter(t => t.send && !t.return && t.status === 'sent').length,
    unreturned:trips.filter(t => t.send && !t.return && ['unreturned','uncertain','cancelled'].includes(t.status)).length,
    available:policy.mode === 'unlimited' ? null : Math.max(0,policy.limit-started-reserved) };
}

function scope(state, chatId) {
  const chat = state.chats.find(c => c.id === chatId), root = state.roots.find(r => r.id === chat?.rootId);
  fail(chat && root && !chat.archivedAt && !root.archivedAt,'Choose an available conversation.');
  return {rootId:root.id,chatId};
}
function receipt(state, kind, task, payload, source = 'paired_local_ui') {
  return recordHandoff(state,{kind,taskId:task.id,scope:{rootId:task.rootId,chatId:task.chatId},from:source,to:'owning_task',payload,status:'RECORDED',detail:{pony:payload,authorityCreated:false}});
}
function bind(state, task, chatId, requestId, source, tripId = null) {
  const s = stateOf(state), prior = s.bindings.find(b => b.requestId === requestId);
  if (prior) { fail(prior.chatId===chatId && prior.taskId===task.id,'That association request already belongs to another task.'); return prior; }
  fail(scope(state,chatId).rootId === task.rootId,'A different branch needs its own explicit context admission.');
  const binding = {id:uid('pony_binding'),chatId,taskId:task.id,requestId,source,tripId,at:now()};
  s.bindings.push(binding); return binding;
}

export function createPonyTask(state, {chatId,purpose,requestId,sourceExchangeId=null}) {
  const s=stateOf(state), existing=s.tasks.find(t => t.requestId===requestId);
  if (existing) { fail(existing.chatId===chatId && existing.purpose===purpose,'That task request already has another purpose.'); return existing; }
  fail(ref(requestId) && text(purpose),'Write a bounded task purpose.');
  const settings=state.parallel?.settings.at(-1), chosen=ponySettings(state);
  fail(settings?.enabled && chosen.enabled,'Enable a default Pony Post allowance in Agents first.');
  const where=scope(state,chatId);
  if(sourceExchangeId) fail(state.exchanges.some(e=>e.id===sourceExchangeId && e.chatId===chatId),'The original human reply is missing.');
  const task={id:uid('pony_task'),requestId,...where,purpose,sourceExchangeId,settingsId:settings.id,
    policy:{mode:chosen.mode,limit:chosen.limit},unit:'round_trip',amendments:[],status:'open',epoch:0,createdAt:now()};
  const r=receipt(state,'pony.task.created',task,taskGrant(task),sourceExchangeId?'human_request_under_saved_default':'paired_local_ui');
  task.receiptId=r.id;s.tasks.push(task);bind(state,task,chatId,requestId,'human');
  if(!sourceExchangeId)state.messages.push({id:uid('message'),chatId,role:'user',content:purpose,createdAt:now(),kind:'note',exchangeId:null,modelId:null,modelLabel:null,modelIdentifier:null,modelBaseUrl:null,instructionRevisionId:null});
  return task;
}

export function reservePonyTrip(state, input) {
  fail(exact(input,['taskId','requestId','clientHash','chatId','assignment','reason','modelId','modelHash','mayRequestSubtasks','source','parentTripId','ponyTaskId'])&&hash(input.clientHash),'Unexpected assignment fields.');
  const s=stateOf(state), prior=s.trips.find(t=>t.requestId===input.requestId);
  const fingerprint=digest(input);
  if(prior){fail(prior.fingerprint===fingerprint,'That send request already belongs to different work.');return prior;}
  const task=ponyTask(state,input.taskId);
  fail(task?.status==='open','This task is stopped or complete.');
  fail(ref(input.requestId) && text(input.assignment,1000) && text(input.reason,1000),'Give the pony task a bounded assignment and reason.');
  fail(ref(input.modelId) && hash(input.modelHash) && typeof input.mayRequestSubtasks==='boolean','Choose an admitted participant and its permissions.');
  fail(state.models.some(m=>m.id===input.modelId && digest(m)===input.modelHash),'The recipient changed.');
  fail(exact(input.source,['kind','id','callId']) && ['human','exchange','pony'].includes(input.source.kind) && ref(input.source.id),'Missing send origin.');
  fail(input.source.kind==='human' ? input.source.id===input.requestId&&input.source.callId===null : text(input.source.callId,200),'The send lost its actual request source.');
  fail(scope(state,input.chatId).rootId===task.rootId,'The send escaped its task branch.');
  if(input.source.kind==='exchange') fail(state.exchanges.some(e=>e.id===input.source.id && e.chatId===input.chatId),'The human source exchange is missing.');
  if(input.source.kind==='pony'){
    const parent=s.trips.find(t=>t.id===input.parentTripId);
    fail(parent?.taskId===task.id && parent.mayRequestSubtasks && parent.send && parent.jobId===input.source.id,'Onward permission was not assigned.');
  } else fail(input.parentTripId===null,'Only an admitted pony episode can claim a parent trip.');
  const usage=ponyUsage(state,task);
  fail(usage.available===null || usage.available>0,'No round trips remain for this task. Steering does not refill its allowance.');
  const continuation=input.ponyTaskId && s.trips.find(t=>t.ponyTaskId===input.ponyTaskId && t.taskId===task.id);
  fail(!input.ponyTaskId || continuation,'The referenced pony task belongs to another undertaking.');
  const trip={id:uid('pony_trip'),...structuredClone(input),sendId:uid('pony_send'),ponyTaskId:input.ponyTaskId || uid('pony_assignment'),fingerprint,
    epoch:task.epoch,scopeRevision:task.amendments.length,status:'reserved',runId:null,jobId:null,send:null,return:null,
    createdAt:now(),error:null,endedAt:null};
  trip.reservationId=receipt(state,'pony.trip.reserved',task,reservation(trip),input.source.kind==='human'?'paired_local_ui':'admitted_task_request').id;
  s.trips.push(trip);return trip;
}

export function linkPonyRun(state, tripId, run, job) {
  const trip=state.ponyPost.trips.find(t=>t.id===tripId);
  fail(trip?.status==='reserved' && trip.runId===null && run.profile===PONY_RUN_PROFILE,'The pair already has an execution route.');
  fail(job.model.id===trip.modelId && job.modelHash===trip.modelHash && run.chatId===trip.chatId,'The route differs from the admitted send.');
  trip.runId=run.id;trip.jobId=job.id;
  run.pony={taskId:trip.taskId,ponyTaskId:trip.ponyTaskId,tripId:trip.id};
  return trip;
}
export function startPonySend(state, tripId) {
  const trip=state.ponyPost?.trips.find(t=>t.id===tripId),task=ponyTask(state,trip?.taskId);
  fail(trip?.status==='reserved' && task?.status==='open' && trip.epoch===task.epoch,'This send is no longer admitted.');
  const job=state.parallel?.jobs.find(j=>j.id===trip.jobId);
  fail(job?.status==='pending' && job.handoff,'The recipient episode was not prepared.');
  const send={id:trip.sendId,name:'pony task send',tripId:trip.id,taskId:task.id,jobId:job.id,modelId:job.model.id,
    modelHash:job.modelHash,contextHash:job.contextHash,handoffId:job.handoff.requestId,at:now()};
  trip.send=send;trip.status='sent';
  send.receiptId=receipt(state,'pony.task.send',task,{...send},'owning_task').id;
  return send;
}
export function receivePonyReturn(state, packet) {
  const trip=state.ponyPost?.trips.find(t=>t.id===packet.tripId), task=ponyTask(state,trip?.taskId);
  const job=state.parallel?.jobs.find(j=>j.id===trip?.jobId);
  const valid=trip?.send && packet.sendId===trip.send.id && packet.taskId===trip.taskId && packet.jobId===trip.jobId
    && packet.modelHash===trip.modelHash && job?.output?.trim() && packet.text===job.output && !['queued','pending'].includes(job.status);
  if(!valid){
    if(task)receipt(state,'pony.return.rejected',task,{tripId:trip.id,packetHash:digest(packet),reason:'Return does not match the admitted send and saved provider result.'},'unverified_return');
    return {accepted:false,reason:'The return does not match its send.'};
  }
  const fingerprint=digest(packet);
  if(trip.return){
    if(trip.return.fingerprint===fingerprint)return {accepted:true,duplicate:true,return:trip.return};
    receipt(state,'pony.return.rejected',task,{tripId:trip.id,packetHash:fingerprint,reason:'Conflicting second final return.'},'unverified_return');
    return {accepted:false,reason:'A different final return is already recorded.'};
  }
  const result={id:uid('pony_return'),name:'pony task return',tripId:trip.id,sendId:trip.send.id,taskId:trip.taskId,jobId:trip.jobId,
    modelHash:trip.modelHash,text:packet.text,fingerprint,outcome:job.status==='completed'?'returned':'partial',note:job.error??null,
    late:task.status!=='open'||task.epoch!==trip.epoch||trip.status!=='sent',at:now()};
  result.receiptId=receipt(state,'pony.task.return',task,{...result},'saved_provider_result').id;
  trip.return=result;trip.status='returned';trip.endedAt=now();return {accepted:true,duplicate:false,return:result};
}
export function settlePonyTrip(state, tripId, reason='No reply was received.') {
  const trip=state.ponyPost?.trips.find(t=>t.id===tripId);if(!trip || trip.return)return;
  const job=state.parallel?.jobs.find(j=>j.id===trip.jobId);
  if(trip.send && job?.output?.trim()){
    receivePonyReturn(state,{tripId:trip.id,taskId:trip.taskId,sendId:trip.send.id,jobId:trip.jobId,modelHash:trip.modelHash,text:job.output});return;
  }
  trip.status=trip.send?'unreturned':'cancelled';trip.error=reason;trip.endedAt=now();
}

export function applyPonyCommand(state,type,payload) {
  const s=stateOf(state),p=payload;
  if(type==='pony.task.new'){
    fail(exact(p,['chatId','purpose','requestId']),'Use a conversation and the new task purpose.');createPonyTask(state,p);return;
  }
  if(type==='pony.task.attach'){
    fail(exact(p,['chatId','taskId','requestId']),'Choose the task to continue.');
    const task=ponyTask(state,p.taskId);fail(task,'Task not found.');bind(state,task,p.chatId,p.requestId,'human');return;
  }
  if(type==='pony.task.amend'){
    fail(exact(p,['taskId','requestId','baseRevision','change','value','note']) && ref(p.requestId) && typeof p.note==='string' && p.note.length<=1000,'Choose an explicit allowance change.');
    const task=ponyTask(state,p.taskId);fail(task,'Task not found.');
    const fingerprint=digest(p), prior=task.amendments.find(a=>a.requestId===p.requestId);
    if(prior){fail(prior.fingerprint===fingerprint,'That allowance change already means something else.');return;}
    fail(p.baseRevision===task.amendments.length,'The task allowance changed; refresh it first.');
    const current=ponyPolicy(task);let policy;
    if(p.change==='unlimited'){fail(p.value===null,'No fixed limit has no numeric value.');policy={mode:'unlimited',limit:null};}
    else if(p.change==='set')policy={mode:'limited',limit:p.value};
    else if(p.change==='add'){
      fail(current.mode==='limited' && Number.isSafeInteger(p.value) && p.value>0,'Add whole round trips to a finite allowance.');policy={mode:'limited',limit:current.limit+p.value};
    } else fail(false,'Choose set, add, or no fixed limit.');
    fail(validPonyPolicy(policy),'Use a non-negative whole number or no fixed limit.');
    const a={id:uid('pony_amendment'),requestId:p.requestId,fingerprint,change:p.change,value:p.value,baseRevision:p.baseRevision,policy,note:p.note,at:now()};
    a.receiptId=receipt(state,'pony.allowance.changed',task,{...a},'paired_local_ui').id;task.amendments.push(a);
    if(policy.mode==='limited'){
      let room=Math.max(0,policy.limit-s.trips.filter(t=>t.taskId===task.id&&t.send).length);
      for(const trip of s.trips.filter(t=>t.taskId===task.id&&t.status==='reserved')){
        if(room>0){room--;continue;}trip.status='cancelled';trip.error='The allowance was reduced before sending.';trip.endedAt=now();
      }
    }
    return;
  }
  if(['pony.task.stop','pony.task.complete','pony.task.resume'].includes(type)){
    fail(exact(p,['taskId']),'Choose one task.');const task=ponyTask(state,p.taskId);fail(task,'Task not found.');
    const status=type==='pony.task.stop'?'stopped':type==='pony.task.complete'?'completed':'open';
    if(task.status===status)return;
    task.status=status;task.epoch++;
    receipt(state,'pony.task.status',task,{status,epoch:task.epoch},'paired_local_ui');
    if(status!=='open')for(const trip of s.trips.filter(t=>t.taskId===task.id&&!t.return)){
      trip.status='cancelled';trip.error='The task was '+status+'.';trip.endedAt=now();
    }
    return;
  }
  fail(false,'Unknown task control.');
}

export function validatePony(state) {
  const s=state.ponyPost;if(s===undefined)return;
  fail(exact(s,['profile','tasks','bindings','trips']) && s.profile===PONY_PROFILE && [s.tasks,s.bindings,s.trips].every(Array.isArray),'Invalid saved state.');
  const ids=new Set();
  for(const x of [...s.tasks,...s.bindings,...s.trips]){fail(ref(x.id)&&!ids.has(x.id),'Duplicate identity.');ids.add(x.id);}
  for(const task of s.tasks){
    fail(validPonyPolicy(task.policy)&&task.unit==='round_trip'&&text(task.purpose)&&ref(task.requestId)&&time(task.createdAt),'Invalid task or units.');
    fail(state.chats.some(c=>c.id===task.chatId&&c.rootId===task.rootId),'Task lost its branch.');
    const created=state.handoffs?.records.find(r=>r.id===task.receiptId);
    const settings=state.parallel?.settings.find(s=>s.id===task.settingsId);
    fail(created?.kind==='pony.task.created' && created.taskId===task.id && digest(created.detail.pony)===digest(taskGrant(task))
      && created.from===(task.sourceExchangeId?'human_request_under_saved_default':'paired_local_ui')
      && settings?.enabled&&settings.pony?.enabled&&digest(task.policy)===digest({mode:settings.pony.mode,limit:settings.pony.limit})
      && (!task.sourceExchangeId||state.exchanges.some(e=>e.id===task.sourceExchangeId&&e.chatId===task.chatId)),'Task lost its original grant.');
    fail(['open','stopped','completed'].includes(task.status)&&Number.isSafeInteger(task.epoch)&&task.epoch>=0&&Array.isArray(task.amendments),'Invalid task state.');
    const statusReceipt=state.handoffs.records.filter(r=>r.taskId===task.id&&r.kind==='pony.task.status').at(-1);
    fail(task.epoch===0?task.status==='open'&&!statusReceipt:statusReceipt?.from==='paired_local_ui'&&statusReceipt.detail.pony.epoch===task.epoch&&statusReceipt.detail.pony.status===task.status,'Task status lost its human control.');
    const requests=new Set();
    for(const [index,a] of task.amendments.entries()){
      fail(ref(a.id)&&ref(a.requestId)&&!requests.has(a.requestId)&&validPonyPolicy(a.policy)&&hash(a.fingerprint),'Invalid allowance amendment.');requests.add(a.requestId);
      const previous=task.amendments[index-1]?.policy??task.policy;
      fail(a.baseRevision===index&&['set','add','unlimited'].includes(a.change)
        && (a.change==='unlimited'?a.value===null&&a.policy.mode==='unlimited':a.policy.mode==='limited'&&a.policy.limit===(a.change==='add'?previous.limit+a.value:a.value))
        && (a.change!=='add'||previous.mode==='limited'&&Number.isSafeInteger(a.value)&&a.value>0),'Allowance change lost its stated meaning.');
      const proof=state.handoffs.records.find(r=>r.id===a.receiptId);const {receiptId,...entry}=a;
      fail(proof?.kind==='pony.allowance.changed'&&proof.from==='paired_local_ui'&&proof.taskId===task.id&&digest(proof.detail.pony)===digest(entry),'Allowance lost its human source.');
    }
  }
  for(const b of s.bindings){const task=ponyTask(state,b.taskId);fail(task&&ref(b.requestId)&&time(b.at)&&['human','pony'].includes(b.source)&&state.chats.some(c=>c.id===b.chatId&&c.rootId===task.rootId),'Invalid task association.');}
  const requests=new Set();
  for(const trip of s.trips){
    const task=ponyTask(state,trip.taskId);
    fail(task&&ref(trip.requestId)&&!requests.has(trip.requestId)&&hash(trip.fingerprint)&&hash(trip.clientHash)&&ref(trip.sendId)&&ref(trip.ponyTaskId)&&text(trip.assignment,1000)&&text(trip.reason,1000),'Invalid pony task.');requests.add(trip.requestId);
    fail(['reserved','sent','returned','cancelled','unreturned','uncertain'].includes(trip.status)&&time(trip.createdAt)&&typeof trip.mayRequestSubtasks==='boolean','Invalid trip state.');
    const proof=state.handoffs.records.find(r=>r.id===trip.reservationId);
    fail(proof?.kind==='pony.trip.reserved'&&proof.taskId===task.id&&digest(proof.detail.pony)===digest(reservation(trip)),'Pair has no matching reservation.');
    fail(state.chats.some(c=>c.id===trip.chatId&&c.rootId===task.rootId)&&exact(trip.source,['kind','id','callId']),'Trip lost its task branch or source.');
    if(trip.source.kind==='pony'){
      const parent=s.trips.find(t=>t.id===trip.parentTripId);
      fail(parent?.taskId===task.id&&parent.mayRequestSubtasks&&parent.send&&parent.jobId===trip.source.id,'Onward permission was not assigned.');
    }else fail(trip.parentTripId===null&&(trip.source.kind==='human'?trip.source.id===trip.requestId&&trip.source.callId===null:trip.source.kind==='exchange'&&state.exchanges.some(e=>e.id===trip.source.id&&e.chatId===trip.chatId)),'Trip lost its actual request source.');
    if(trip.runId){
      const run=state.parallel?.runs.find(r=>r.id===trip.runId), job=state.parallel?.jobs.find(j=>j.id===trip.jobId);
      fail(run?.profile===PONY_RUN_PROFILE&&run.pony?.tripId===trip.id&&run.pony.taskId===task.id&&job?.runId===run.id&&job.modelHash===trip.modelHash,'Pair escaped its admitted route.');
    } else fail(trip.jobId===null&&!trip.send&&!trip.return,'Unrouted pair has work.');
    if(trip.send){
      const send=trip.send,record=state.handoffs.records.find(r=>r.id===send.receiptId),{receiptId,...entry}=send;
      const job=state.parallel.jobs.find(j=>j.id===trip.jobId);
      fail(send.id===trip.sendId&&send.name==='pony task send'&&send.tripId===trip.id&&send.taskId===task.id&&send.jobId===trip.jobId
        &&send.modelId===trip.modelId&&send.modelHash===trip.modelHash&&send.contextHash===job.contextHash&&send.handoffId===job.handoff?.requestId
        &&record?.kind==='pony.task.send'&&digest(record.detail.pony)===digest(entry),'Send identity changed.');
    } else fail(!['sent','returned','unreturned','uncertain'].includes(trip.status),'Trip claims a missing send.');
    if(trip.return){
      const result=trip.return,job=state.parallel.jobs.find(j=>j.id===trip.jobId),record=state.handoffs.records.find(r=>r.id===result.receiptId),{receiptId,...entry}=result;
      fail(result.name==='pony task return'&&result.tripId===trip.id&&result.sendId===trip.send?.id&&result.taskId===task.id&&result.jobId===trip.jobId&&result.modelHash===trip.modelHash&&result.text===job.output&&result.note===(job.error??null)&&record?.kind==='pony.task.return'&&digest(record.detail.pony)===digest(entry),'Return lost its matching send or actual result.');
      fail(trip.status==='returned','A returned trip lost its state.');
    } else fail(trip.status!=='returned','A trip cannot return without a response.');
  }
}

export function preservePony(before,after) {
  const a=before.ponyPost??{tasks:[],bindings:[],trips:[]};const b=after.ponyPost;if(!b){fail(!before.ponyPost,'Saved task history was removed.');return;}
  for(const task of b.tasks){
    const added=b.trips.slice(a.trips.length).filter(t=>t.taskId===task.id);
    if(!added.length)continue;
    fail(added.every(t=>t.status==='reserved'&&!t.send&&!t.return),'New pairs must reserve before sending.');
    const policy=ponyPolicy(task),usage=ponyUsage(after,task);
    fail(policy.mode==='unlimited'||usage.started+usage.reserved<=policy.limit,'New pairs exceeded the shared allowance.');
  }
  for(const key of ['tasks','bindings','trips']){
    fail(b[key].length>=a[key].length,'Saved task history was removed.');
    a[key].forEach((old,i)=>{
      const next=b[key][i];
      const mutable=key==='tasks'?['amendments','status','epoch']:key==='trips'?['status','runId','jobId','send','return','error','endedAt']:[];
      const stable=x=>Object.fromEntries(Object.entries(x).filter(([k])=>!mutable.includes(k)));
      fail(digest(stable(old))===digest(stable(next)),'An original task, pair or binding was rewritten.');
      if(key==='tasks')fail(next.epoch>=old.epoch&&next.amendments.length>=old.amendments.length&&old.amendments.every((v,j)=>digest(v)===digest(next.amendments[j])),'Allowance history was rewritten.');
      if(key==='trips'){
        for(const field of ['runId','jobId','send','return'])if(old[field]!==null)fail(digest(old[field])===digest(next[field]),'A dispatched pair or return was rewritten.');
        fail(!(old.status!=='reserved'&&next.status==='reserved'),'A spent or cancelled pair was refilled.');
      }
    });
  }
}
