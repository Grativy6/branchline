import { isCloudModel, mayFollowProvider } from '../public/provider-routes.js';
import { ContinuingHearthTasks } from './continuing-hearth.mjs';
import { approachCandidates } from './parallel-tasks.mjs';
import { agentSettings, parallelBasis, openRun, liveRun, ParallelBudget } from './parallel-state.mjs';
import { activeImageIds } from './images.mjs';
import { ordinaryInferencePending, assertInferenceIdle } from './table.mjs';
import { compileMessages } from './model.mjs';
import { digest } from './integrity.mjs';
import { makeToolContract, toolBindings } from './tool-contract.mjs';
import { PONY_PROFILE, ponySettings, activePonyTask, ponyTask, ponyUsage, createPonyTask, reservePonyTrip,
  settlePonyTrip, isPonyRun } from './pony-state.mjs';

const fail=(ok,message)=>{if(!ok)throw new Error('Pony Post: '+message);};
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const text=(v,n)=>typeof v==='string'&&v.trim()&&v.length<=n;

// The owning store is the single writer for reservations. Provider execution
// reuses the existing admitted queue; remote-chat transport is not implied.
export class PonyPostTasks extends ContinuingHearthTasks {
  constructor(...args){super(...args);this.ponyPlans=new Map();}
  requestProfile(state,chatId,model,replyMode){
    const base=super.requestProfile(state,chatId,model,replyMode),settings=agentSettings(state);
    if(!Object.hasOwn(settings,'pony'))return base;
    if(!base)return null;
    const task=activePonyTask(state,chatId),choice=ponySettings(state);
    if(!task&&!choice.enabled)return base;
    if(task&&(task.status!=='open'||ponyUsage(state,task).available===0))return null;
    return {grant:base.grant,settingsId:base.settingsId,models:base.models,
      pony:{profile:PONY_PROFILE,taskId:task?.id??null,parentTripId:null,mayRequestSubtasks:true}};
  }
  bindOrigin(exchangeId,args){
    const result=super.bindOrigin(exchangeId,args);
    if(!args.contract?.parallel?.pony)return result;
    const origin=this.origins.get(exchangeId);
    return {...result,ponyRequest:(input,callId)=>this.requestPony(origin,input,callId)};
  }
  async releaseOrigin(exchangeId){await super.releaseOrigin(exchangeId);this.kick();}
  ponyBasis(state,tripId,sourceExchangeId=null){
    const trip=state.ponyPost?.trips.find(t=>t.id===tripId);
    const peers=(state.parallel?.runs??[]).filter(r=>r.pony?.taskId===trip?.taskId).map(r=>r.id);
    return parallelBasis(state,trip.chatId,sourceExchangeId,peers);
  }
  status(chatId){
    const task=activePonyTask(this.store.state,chatId);
    return {...super.status(chatId),pony:this.ponyStatus(chatId),taskId:task?.id??null};
  }
  ponyStatus(chatId){
    const s=this.store.state,chat=s.chats.find(c=>c.id===chatId),task=activePonyTask(s,chatId);
    return {settings:ponySettings(s),unit:'round_trip',execution:'sequential_admitted_model_route',
      task:task?{...task,usage:ponyUsage(s,task)}:null,
      tasks:(s.ponyPost?.tasks??[]).filter(t=>t.rootId===chat?.rootId).map(t=>({id:t.id,purpose:t.purpose,status:t.status})),
      trips:(s.ponyPost?.trips??[]).filter(t=>t.taskId===task?.id)};
  }
  async startPony(input){
    fail(exact(input,['requestId','chatId','assignment','reason','modelId','allowSubtasks','ponyTaskId','toolsEnabled','cloudApproved','basisHash']),'Choose the assignment, recipient and permitted work.');
    const prior=this.store.state.ponyPost?.trips.find(t=>t.requestId===input.requestId);
    if(prior){fail(prior.clientHash===digest(input)&&prior.source.kind==='human','That send request already belongs to different work.');return this.ponyReceipt(prior);}
    assertInferenceIdle(this.store.state);
    fail(input.basisHash===parallelBasis(this.store.state,input.chatId),'The conversation changed; review the current task.');
    return this.enqueuePony(input,null,null);
  }
  async requestPony(origin,args,callId,parent=null){
    fail(origin?.contract?.parallel?.pony?.mayRequestSubtasks,'This episode has no assigned onward-request permission.');
    const s=this.store.state,settings=agentSettings(s);
    fail(settings.enabled&&settings.automaticRequests&&settings.explicitAutomaticOptIn,'Automatic agent requests are not enabled.');
    if(parent){
      const trip=s.ponyPost.trips.find(t=>t.id===parent.id),job=s.parallel.jobs.find(j=>j.id===parent.jobId);
      fail(trip?.status==='sent'&&trip.mayRequestSubtasks&&job?.status==='pending','The requesting pony episode is no longer active.');
    }else fail(this.origins.get(origin.exchangeId)===origin&&s.exchanges.find(e=>e.id===origin.exchangeId)?.status==='pending','The original episode is no longer active.');
    fail(exact(args,['assignment','reason','model_id','allow_subtasks','pony_task_id'])&&text(args.assignment,1000)&&text(args.reason,1000)&&typeof args.allow_subtasks==='boolean'&&typeof args.pony_task_id==='string','Use a bounded pony task send.');
    const admitted=origin.contract.parallel.models.find(m=>m.id===args.model_id);
    fail(admitted&&s.models.some(m=>m.id===admitted.id&&digest(m)===admitted.hash),'The selected recipient was not admitted.');
    const requestId='pony_request_'+digest({source:parent?.jobId??origin.exchangeId,callId}).slice(0,40);
    return this.enqueuePony({requestId,chatId:origin.handoff.scope.chatId,assignment:args.assignment,reason:args.reason,modelId:args.model_id,
      allowSubtasks:args.allow_subtasks,ponyTaskId:args.pony_task_id||null,toolsEnabled:origin.contract.conversationEnabled,
      cloudApproved:isCloudModel(origin.model),basisHash:parent?this.ponyBasis(s,parent.id,origin.exchangeId):origin.basisHash},origin,parent,callId);
  }
  async enqueuePony(input,origin,parent,callId=null){
    const clientHash=digest(input),existing=this.store.state.ponyPost?.trips.find(t=>t.requestId===input.requestId);
    if(existing){fail(existing.clientHash===clientHash,'That send request already belongs to different work.');return this.ponyReceipt(existing);}
    const before=this.store.state,settings=agentSettings(before);
    fail(!this.closed&&settings.enabled,'Enable agents before starting a pony task.');
    fail(!activeImageIds(before,input.chatId).length,'Pony tasks currently carry text; use an ordinary reply for selected pictures.');
    fail(text(input.assignment,1000)&&text(input.reason,1000)&&typeof input.allowSubtasks==='boolean'&&typeof input.toolsEnabled==='boolean'&&typeof input.cloudApproved==='boolean','Choose bounded work and its permissions.');
    const candidate=approachCandidates(before,input.chatId).find(c=>c.model.id===input.modelId);
    fail(candidate&&(!isCloudModel(candidate.model)||input.cloudApproved),'The recipient or context delivery is not admitted.');
    const capturedTask=parent?ponyTask(before,parent.taskId):activePonyTask(before,input.chatId);
    if(origin?.contract.parallel.pony.taskId)fail(capturedTask?.id===origin.contract.parallel.pony.taskId,'The owning task changed during this reply.');
    const source={kind:parent?'pony':origin?'exchange':'human',id:parent?.jobId??origin?.exchangeId??input.requestId,callId};
    let trip,prepared,basis;
    await this.store.transact(state=>{
      fail(agentSettings(state).id===settings.id,'Agent permissions changed while preparing the send.');
      let task=parent?ponyTask(state,parent.taskId):activePonyTask(state,input.chatId);
      fail((task?.id??null)===(capturedTask?.id??null),'The owning task changed while preparing the send.');
      if(!task){
        fail(!parent,'A pony task cannot create its own default allowance.');
        const purpose=origin?.content||input.assignment;
        task=createPonyTask(state,{chatId:input.chatId,purpose:purpose.length<=20000?purpose:purpose.slice(0,19940)+'… [full purpose in the source exchange]',
          requestId:'pony_found_'+digest({source:origin?.exchangeId??input.requestId}).slice(0,40),sourceExchangeId:origin?.exchangeId??null});
      }
      trip=reservePonyTrip(state,{taskId:task.id,requestId:input.requestId,clientHash,chatId:input.chatId,assignment:input.assignment,reason:input.reason,
        modelId:candidate.model.id,modelHash:digest(candidate.model),mayRequestSubtasks:input.allowSubtasks,
        source,parentTripId:parent?.id??null,ponyTaskId:input.ponyTaskId});
      if(trip.runId||this.ponyPlans.has(trip.id))return state;
      const profile=input.allowSubtasks?{grant:'explicit_user_agent_settings',settingsId:settings.id,
        models:(origin?.contract.parallel.models??[{id:candidate.model.id,name:candidate.model.name,hash:digest(candidate.model)}]).filter(m=>mayFollowProvider(state.models.find(x=>x.id===m.id),candidate.model)),
        pony:{profile:PONY_PROFILE,taskId:task.id,parentTripId:trip.id,mayRequestSubtasks:true}}:null;
      const messages=compileMessages(state,input.chatId,origin&&!parent?origin.content:'',{maxContextCharacters:Infinity,selection:candidate.selection,
        requestKind:origin?.kind??'ask',selectedFile:origin?.selectedFile??null});
      messages.push({role:'user',content:'[pony task send; a bounded assignment under the original task, not a new human grant]\n'+JSON.stringify({
        taskId:task.id,ponyTaskId:trip.ponyTaskId,tripId:trip.id,sendId:trip.sendId,purpose:task.purpose,assignment:trip.assignment,
        remainingRoundTrips:ponyUsage(state,task).available,mayRequestSubtasks:trip.mayRequestSubtasks,
        return:'Return findings, questions, partial work or rest. The host pairs your actual reply with this send. Do not invent a return, new grant, or another participant.'})});
      prepared={messages,sourceIds:state.messages.filter(m=>m.chatId===input.chatId&&!(origin?.exchangeId&&m.role==='assistant'&&m.exchangeId===origin.exchangeId)).map(m=>m.id),
        toolContract:makeToolContract(state,{chatId:input.chatId,model:candidate.model,enabled:input.toolsEnabled,seat:candidate.selection?.seat??'visiting',
          selectedFile:origin?.selectedFile??null,ceiling:origin?toolBindings(origin.contract):null,parallel:profile})};
      basis=this.ponyBasis(state,trip.id,origin?.exchangeId??null);return state;
    });
    if(prepared)this.ponyPlans.set(trip.id,{input,origin,prepared,basis,candidate});
    this.kick();
    return this.ponyReceipt(trip);
  }
  ponyReceipt(trip){
    return {taskId:trip.taskId,ponyTaskId:trip.ponyTaskId,tripId:trip.id,sendId:trip.sendId,status:trip.status,
      unit:'round_trip',remaining:ponyUsage(this.store.state,ponyTask(this.store.state,trip.taskId)).available,
      resultAvailable:trip.return!==null,return:trip.return,
      message:trip.return?'The matching return is recorded. Reading it starts no further work.':trip.status==='reserved'?'One round trip is reserved, including its matching return. Work is queued on the admitted model route; do not invent or wait for its result in this reply.':trip.status==='sent'?'This send is awaiting its matching return. Do not resend it.':'This trip has stopped without a matching return. Its delivery history is retained.'};
  }
  ponyRequestForJob(run,job,entry,handoff,contract){
    const trip=this.store.state.ponyPost?.trips.find(t=>t.id===run.pony.tripId);
    if(!trip?.mayRequestSubtasks||!contract?.parallel?.pony)return null;
    const task=ponyTask(this.store.state,trip.taskId);
    const origin={exchangeId:task.sourceExchangeId,handoff,contract,model:job.model,content:task.purpose,kind:'ask',selectedFile:null,budget:entry.budget};
    return (args,callId)=>this.requestPony(origin,args,callId,{...trip,jobId:job.id});
  }
  checkPony(run,entry){
    const s=this.store.state,trip=s.ponyPost?.trips.find(t=>t.id===run.pony.tripId),task=ponyTask(s,trip?.taskId),settings=agentSettings(s);
    fail(!this.closed&&!entry.stopped&&liveRun(run)&&task?.status==='open'&&trip.epoch===task.epoch&&['reserved','sent'].includes(trip.status),'This pony task is stopped or held. Its return can still be recorded.');
    fail(settings.enabled&&(run.origin==='user'||settings.automaticRequests&&settings.explicitAutomaticOptIn),'Agent permission was revoked.');
    fail(Date.now()<entry.budget.deadline,'This work window has expired; the round-trip history is retained.');
    fail(run.basisHash===this.ponyBasis(s,trip.id,run.sourceExchangeId),'The assigned context changed; retain this return under its earlier scope.');
  }
  async drain(){
    await super.drain();
    while(!this.closed&&!ordinaryInferencePending(this.store.state)&&!(this.store.state.parallel?.runs??[]).some(openRun)){
      const trip=(this.store.state.ponyPost?.trips??[]).find(t=>t.status==='reserved'&&this.ponyPlans.has(t.id));
      if(!trip)break;
      const plan=this.ponyPlans.get(trip.id),task=ponyTask(this.store.state,trip.taskId);
      try{
        if(plan.origin?.exchangeId){
          const exchange=this.store.state.exchanges.find(e=>e.id===plan.origin.exchangeId);
          if(exchange?.status==='pending')break;
          fail(exchange?.status==='completed'&&!exchange.truncated,'The initiating reply did not finish; no helper was sent.');
        }
        fail(task?.status==='open'&&task.epoch===trip.epoch,'This task stopped before sending.');
        const input={requestId:'pony_run_'+trip.id,fingerprint:trip.fingerprint,chatId:trip.chatId,content:task.purpose,
          approaches:[{seat:plan.candidate.seat,angle:trip.assignment,reason:trip.reason}],toolsEnabled:plan.input.toolsEnabled,
          cloudApproved:plan.input.cloudApproved,basisHash:plan.basis,ponyTripId:trip.id,ponyPrepared:plan.prepared};
        const run=await this.admit(input,plan.origin),entry=this.entries.get(run.id);
        try{await this.processRun(run,entry);}catch(error){await this.finish(run.id,entry.stopped?entry.stopStatus:'held',error.message);}
        finally{if(!openRun(this.store.state.parallel.runs.find(r=>r.id===run.id)))this.entries.delete(run.id);}
      }catch(error){await this.store.transact(s=>{settlePonyTrip(s,trip.id,error.message);return s;});}
      finally{this.ponyPlans.delete(trip.id);}
    }
  }
  async recheck(){
    await super.recheck();
    const settings=agentSettings(this.store.state);
    for(const [id,plan] of this.ponyPlans){
      const trip=this.store.state.ponyPost?.trips.find(t=>t.id===id),task=ponyTask(this.store.state,trip?.taskId);
      if(!trip||trip.status!=='reserved'||task?.status!=='open'||!settings.enabled||plan.origin&&!settings.automaticRequests){
        if(trip?.status==='reserved')await this.store.transact(s=>{settlePonyTrip(s,id,'The pending send was cancelled before departure.');return s;});
        this.ponyPlans.delete(id);
      }
    }
    this.kick();
  }
  async cancelChat(chatId){
    for(const trip of this.store.state.ponyPost?.trips??[])if(trip.chatId===chatId&&trip.status==='reserved'&&!trip.runId){
      await this.store.transact(s=>{settlePonyTrip(s,trip.id,'Stopped before sending.');return s;});this.ponyPlans.delete(trip.id);
    }
    await super.cancelChat(chatId);
  }
  async close(){
    for(const [id] of this.ponyPlans){const trip=this.store.state.ponyPost?.trips.find(t=>t.id===id);if(trip?.status==='reserved'&&!trip.runId)await this.store.transact(s=>{settlePonyTrip(s,id,'The application closed before sending.');return s;});}
    this.ponyPlans.clear();await super.close();
  }
}
