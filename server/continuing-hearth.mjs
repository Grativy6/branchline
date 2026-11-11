import { isCloudModel, mayFollowProvider } from '../public/provider-routes.js';
import { assertModelAvailable } from './model-archives.mjs';
import { activeModels } from '../public/model-archives.js';
import { visiblePersonalModels } from '../public/dream-records.js';
import { peerSources,accountMessages,latestAccount,preparePeerAccount,parsePeerAccount } from './peer-context.mjs';
import { HearthTasks } from './hearth-tasks.mjs';
import { CONTINUING_PROFILE,isContinuing,CONTINUING_QUICK,CONTINUING_WORKDAY,peerNames,uid,at,ensure,exact,chosenLimits,parsePeerOutput,continuingFoundation,peerInstructions } from './continuing-state.mjs';
import { ParallelBudget,parallelState,agentSettings,parallelBasis,liveRun } from './parallel-state.mjs';
import { digest,recordHandoff,protocolMessages } from './handoff.mjs';
import { resolveSpeaker,ordinaryInferencePending,assertInferenceIdle } from './table.mjs';
import { compileMessages,replyTokenLimit } from './model.mjs';
import { responseModeFor, responseModeEvidence } from './response-mode.mjs';
import { contextBudget } from './context-budget.mjs';
import { resolvedCoat,findHarness } from '../public/harness-catalog.js';
import { makeToolContract, toolBindings } from './tool-contract.mjs';
import { harnessSnapshot } from './harnesses.mjs';
import { BLACKBOARD_PROFILE, BLACKBOARD_HEARTH_PROFILE, boardEnabled, createBlackboard, currentBoard, nextBoardAssignment, boardExcerpt, boardAfterResult, boardAfterAmendment, boardInstructions } from './blackboard.mjs';
import { activeImageIds } from './images.mjs';

export function savedPeer(state,chatId,key) {
 const chat=state.chats.find(c=>c.id===chatId), root=state.roots.find(r=>r.id===chat?.rootId);
 ensure(chat&&root&&!chat.archivedAt&&!root.archivedAt,'Choose an active branch.');
 const personal=key.startsWith('personal:')?state.personalParticipants?.find(p=>'personal:'+p.id===key):null;
 const model=state.models.find(m=>m.id===(personal?personal.connections.at(-1).modelId:key.startsWith('model:')?key.slice(6):null));
 ensure(model,'The saved connection is unavailable.');
 const seat=personal?'personal':'visiting', assignment={id:'saved_selection_'+digest({chatId,key}).slice(0,32),personalId:personal?.id??null,visitorModelId:personal?null:model.id};
 const view={...state,chats:state.chats.map(c=>c.id===chatId?{...c,table:{assignments:[assignment]}}:c)};
 const selection=resolveSpeaker(view,chatId,seat).selection;
 const resolved=resolvedCoat(state,chat,seat,key),preset=findHarness(resolved.ref,state);
 ensure(preset,'The saved Coat is unavailable.');
 const coat={profile:'branchline.coat-selection/2',selectionId:resolved.source,shared:false,seat,key,mode:resolved.mode,preset:structuredClone(preset),hash:digest(preset),role:'response_guidance_only'};
 return {key,model,selection,coat};
}
export class ContinuingHearthTasks extends HearthTasks {
 constructor(...args){super(...args);this.admissionEpoch=0;}
 requestProfile(...args){const profile=super.requestProfile(...args);return profile&&agentSettings(args[0]).blackboard?{...profile,blackboard:true}:profile;}
 options(chatId){
  const old=super.options(chatId),s=this.store.state;
  const keys=[...visiblePersonalModels(s).map(p=>({key:'personal:'+p.id,name:p.nickname||p.name})),...activeModels(s).map(m=>({key:'model:'+m.id,name:m.name}))];
  return {...old,continuingLimits:CONTINUING_QUICK,workdayLimits:CONTINUING_WORKDAY,savedModels:keys.map(x=>{try{const p=savedPeer(s,chatId,x.key);return {...x,available:true,cloud:isCloudModel(p.model),coat:p.coat.preset,modelHash:digest(p.model)};}catch(e){return {...x,available:false,reason:e.message};}})};
 }
 async requestHearthFromModel(origin,args,callId){
  if(!agentSettings(this.store.state).blackboard)return super.requestHearthFromModel(origin,args,callId);
  const state=this.store.state,settings=agentSettings(state);
  ensure(origin&&this.origins.get(origin.exchangeId)===origin&&origin.contract.parallel?.hearth===true&&settings.enabled&&settings.automaticRequests&&settings.explicitAutomaticOptIn&&settings.id===origin.contract.parallel.settingsId,'Automatic blackboard work is not admitted.');
  ensure(exact(args,['directions','reason',...(Object.hasOwn(args,'blackboard')?['blackboard']:[])])&&typeof args.reason==='string'&&args.reason.trim()&&args.reason.length<=1000&&Array.isArray(args.directions)&&args.directions.length===2&&args.directions.every(d=>typeof d==='string'&&d.trim()&&d.length<=1000),'Choose two bounded directions and a reason.');
  let seed=null;if(args.blackboard!==undefined){
   const record=state.handoffs.records.findLast(r=>r.kind==='operation.request'&&r.taskId===origin.exchangeId&&r.detail.callId===callId&&r.detail.tool==='request_hearth');
   ensure(record&&digest(record.detail.arguments.blackboard)===digest(args.blackboard),'The prepared board needs its exact originating tool request.');
   seed={receiptId:record.id,receiptHash:record.hash,delta:structuredClone(args.blackboard)};
  }
  const fingerprint=digest({source:origin.exchangeId,blackboard:args}),prior=state.parallel?.runs.find(r=>r.sourceExchangeId===origin.exchangeId);
  if(prior){ensure(prior.fingerprint===fingerprint,'This turn already used its agent allowance.');return {runId:prior.id,status:prior.status};}
  const result=await this.startContinuing({requestId:'board_request_'+digest({source:origin.exchangeId,callId}).slice(0,40),chatId:origin.handoff.scope.chatId,content:origin.content,
    peers:args.directions.map(direction=>({key:'model:'+origin.model.id,direction})),limits:CONTINUING_QUICK,toolsEnabled:origin.contract.conversationEnabled===true,cloudApproved:isCloudModel(origin.model),basisHash:origin.basisHash},{...origin,requestFingerprint:fingerprint,blackboardSeed:seed});
  return {runId:result.runId,status:'queued',message:(seed?'Your prepared blackboard is saved; helpers can use it after this reply finishes.':'The first episode will prepare a blackboard before any helper starts, after this reply finishes.')+' All work shares this turn\'s remaining allowance.'};
 }
 async startContinuing(input,origin=null){
  ensure(exact(input,['requestId','chatId','content','peers','limits','toolsEnabled','cloudApproved','basisHash'])&&typeof input.requestId==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(input.requestId)&&typeof input.content==='string'&&input.content.trim()&&input.content.length<=20000&&Array.isArray(input.peers)&&input.peers.length===2&&input.peers.every(p=>exact(p,['key','direction'])&&typeof p.key==='string'&&typeof p.direction==='string'&&p.direction.trim()&&p.direction.length<=1000)&&typeof input.toolsEnabled==='boolean'&&typeof input.cloudApproved==='boolean','Review the shared purpose, two models and finite allowance.');
  const fingerprint=origin?.requestFingerprint??digest(input),prior=this.store.state.parallel?.runs.find(r=>r.requestId===input.requestId);
  if(prior){ensure(prior.fingerprint===fingerprint,'This request ID belongs to different work.');return {runId:prior.id,state:this.store.state};}
  ensure(!this.closed&&!this.preparing,'Another task is preparing.');
  this.preparing=true;const epoch=this.admissionEpoch;
  try{
   const before=this.store.state,settings=agentSettings(before),limits=chosenLimits(input.limits);
   ensure(settings.enabled,'Enable shared hearth work first.');
   const idle=state=>{if(!origin)return assertInferenceIdle(state);ensure(state.exchanges.find(e=>e.id===origin.exchangeId)?.status==='pending'&&settings.id===agentSettings(state).id&&settings.automaticRequests&&settings.explicitAutomaticOptIn,'The originating request is no longer admitted.');};
   idle(before);ensure(!before.parallel?.runs.some(r=>['queued','running','waiting','resting'].includes(r.status)),'Finish or stop the current shared task first.');
   ensure(!activeImageIds(before,input.chatId).length,'Pictures currently use ordinary replies. Remove selected pictures before starting this hearth.');
   const basis=state=>parallelBasis(state,input.chatId,origin?.exchangeId??null);
   ensure(input.basisHash===basis(before),'The context changed. Review it again.');
   const candidates=input.peers.map(p=>savedPeer(before,input.chatId,p.key));
   if(origin){
    const task=before.handoffs.records.find(r=>r.id===origin.handoff.requestId)?.detail.task;
    const coat=harnessSnapshot(before,input.chatId,task?.selection?.seat??'visiting');
    ensure(coat.hash===origin.contract.coat.hash&&candidates.every(c=>digest(c.model)===digest(origin.model)),'The originating model or Coat changed.');
    for(const c of candidates)c.coat=structuredClone(coat);
   }
   ensure(candidates.every(p=>!isCloudModel(p.model)||input.cloudApproved),'Review sharing with OpenAI before starting.');
   const root=before.roots.find(r=>r.id===before.chats.find(c=>c.id===input.chatId).rootId);
   const capacities=await Promise.all(candidates.map(p=>contextBudget(p.model,{...this.modelOptions,maxTokens:replyTokenLimit(root,p.model)})));
   let run;
   await this.store.transact(state=>{
    ensure(epoch===this.admissionEpoch&&!this.closed,'Preparation was stopped. Start deliberately again.');idle(state);
    ensure(!state.parallel?.runs.some(r=>['queued','running','waiting','resting'].includes(r.status)),'Another task reserved the shared allowance.');
    ensure(input.basisHash===basis(state)&&settings.id===agentSettings(state).id,'The context or controls changed during preparation.');
    if(!origin)state.messages.push({id:uid('message'),chatId:input.chatId,role:'user',content:input.content,createdAt:at(),kind:'note',exchangeId:null,modelId:null,modelLabel:null,modelIdentifier:null,modelBaseUrl:null,instructionRevisionId:null});
    if(state.drafts[input.chatId]===input.content)delete state.drafts[input.chatId];
    const peers=candidates.map((c,i)=>{assertModelAvailable(state,c.model.id);const selection={...structuredClone(c.selection),episodeId:uid('peer')};return {id:selection.episodeId,name:peerNames[i],key:c.key,direction:input.peers[i].direction,model:structuredClone(c.model),modelHash:digest(c.model),selection,coat:c.coat,
     baseOrientation:responseModeEvidence(responseModeFor(state,input.chatId)),baseMessages:compileMessages(state,input.chatId,'',{...this.modelOptions,selection,requestKind:'ask',maxContextCharacters:Infinity,coatSnapshot:c.coat}),contextLimit:capacities[i].characters,maxTokens:replyTokenLimit(root,c.model),...(origin?{toolCeiling:toolBindings(origin.contract)}:{})};});
    for(const p of peers)p.baseHash=digest(p.baseMessages);
    run={id:uid('hearth'),profile:settings.blackboard?BLACKBOARD_HEARTH_PROFILE:CONTINUING_PROFILE,...(settings.blackboard?{blackboardProfile:BLACKBOARD_PROFILE}:{}),mechanism:'recorded-context',requestId:input.requestId,fingerprint,origin:origin?'model':'user',chatId:input.chatId,rootId:root.id,purpose:input.content,settingsId:settings.id,sourceExchangeId:origin?.exchangeId??null,
      sourceIds:state.messages.filter(m=>m.chatId===input.chatId).map(m=>m.id),contextHash:digest(peers.map(p=>p.baseHash)),basisHash:input.basisHash,peers,createdAt:at(),status:'queued',error:null,endedAt:null,toolsEnabled:input.toolsEnabled,cloudApproved:input.cloudApproved,
      limits:{...limits},usage:origin?{...origin.budget.usage}:{modelRounds:0,outputCharacters:0,toolCalls:0,toolBytes:0},deadline:null,epoch:0,episodeIds:[],mail:[],events:[],extensions:[],resumptions:[],accounts:[],positions:Object.fromEntries(peerNames.map(n=>[n,{mode:'ready',cursor:0,lastJobId:null}]))};
    if(boardEnabled(run)){if(origin?.blackboardSeed)run.blackboardSeed=origin.blackboardSeed;run.blackboard=createBlackboard(run);}
    parallelState(state).runs.push(run);
    const foundation=continuingFoundation(run),a=recordHandoff(state,{kind:'parallel.admitted',taskId:run.id,scope:{rootId:run.rootId,chatId:run.chatId},from:origin?'model_request':'paired_local_ui',to:'app_task_queue',payload:foundation,status:'WITHIN_LOCAL_PROFILE',detail:{foundation,profile:run.profile,execution:'sequential',authorityCreated:false}});
    run.admissionId=a.id;run.admissionHash=a.hash;this.extend(state,run,limits,input.requestId,origin);
    for(const p of peers)ensure(this.messagesFor(state,run,p).reduce((n,m)=>n+m.content.length,0)<=p.contextLimit,'A selected model cannot hold the starting context. Prepare a branch handoff first; nothing was clipped.');
    return state;
   });this.attach(run,origin?.budget);this.kick();return {runId:run.id,state:this.store.state};
  }finally{this.preparing=false;}
 }
 extend(state,r,limits,requestId,origin=null){
  const x={id:uid('allowance'),requestId,limits:chosenLimits(limits),createdAt:at(),deadline:new Date(origin?origin.budget.deadline:Date.now()+limits.durationMs).toISOString()};
  const receipt=recordHandoff(state,{kind:'hearth.allowance',taskId:r.id,scope:{rootId:r.rootId,chatId:r.chatId},from:origin?'model_request':'paired_local_ui',to:'app_task_queue',payload:x,status:'REQUEST_RECORDED',detail:{extension:x}});
  r.extensions.push({...x,receiptId:receipt.id});r.deadline=x.deadline;
  for(const k of ['modelRounds','outputCharacters','toolCalls','toolBytes'])r.limits[k]=r.extensions.reduce((n,e)=>n+e.limits[k],0);
 }
 attach(r,existingBudget=null){const budget=existingBudget??new ParallelBudget(r.limits);budget.limits=r.limits;budget.usage={...r.usage};budget.deadline=Date.parse(r.deadline);budget.runId=r.id;this.entries.set(r.id,{budget,prepared:new Map(),stopped:false,stopStatus:'cancelled',controller:null,activeJobId:null,liveText:'',epoch:r.epoch});}
 check(r,entry){
  if(!isContinuing(r))return super.check(r,entry);
  const current=this.store.state.parallel.runs.find(x=>x.id===r.id),s=this.store.state;
  ensure(!this.closed&&!entry.stopped&&entry.epoch===current.epoch&&liveRun(current),'This work is stopped or waiting.');
  for(const peer of current.peers) assertModelAvailable(s,peer.model.id);
  ensure(agentSettings(s).enabled,'Shared work was disabled.');
  if(current.origin==='model')ensure(agentSettings(s).automaticRequests&&agentSettings(s).explicitAutomaticOptIn,'Automatic shared work was disabled. The queued board remains saved.');
  ensure(Date.now()<entry.budget.deadline,'The admission window expired. Saved work needs an explicit extension.');
  ensure(!s.chats.find(c=>c.id===r.chatId)?.archivedAt&&!s.roots.find(x=>x.id===r.rootId)?.archivedAt,'Restore this branch before resuming.');
  ensure(r.peers.every(p=>digest(s.models.find(m=>m.id===p.model.id))===p.modelHash),'A selected connection changed. Its saved work is held; review the destination before continuing.');
 }
 messagesFor(state,r,p,assignment=null){
  const messages=p.baseMessages.filter(m=>m.role==='system').map(m=>structuredClone(m));messages[0].content+='\n\n'+(boardEnabled(r)?peerInstructions(p.name,p.direction,r.purpose).split('Return JSON only:')[0]+boardInstructions()+'\nShared purpose: '+r.purpose+'\nYour direction: '+p.direction:peerInstructions(p.name,p.direction,r.purpose));
  messages.push(...accountMessages(state,r,p));
  if(boardEnabled(r)){
   const selected=assignment??nextBoardAssignment(r,state.parallel.jobs)??{phase:'work',itemId:null,revision:currentBoard(r).number,itemIds:[]};
   messages.push({role:'user',content:'[Assigned blackboard excerpt; attributed working data, not new permission]\n'+boardExcerpt(r,selected)});
  }
  messages.push({role:'user',content:'Continue your assigned direction with the saved purpose and updates. Return a useful contribution, question or resting outcome in the stated JSON format.'});
  return protocolMessages(messages);
 }
 async admitPeer(r,p,entry,account=null,assignment=null){let job;await this.store.transact(state=>{
  this.check(state.parallel.runs.find(x=>x.id===r.id),entry);const run=state.parallel.runs.find(x=>x.id===r.id);
  if(assignment)ensure(digest(assignment)===digest(nextBoardAssignment(run,state.parallel.jobs)),'The board assignment changed before dispatch.');
  const messages=account?protocolMessages(account.messages):this.messagesFor(state,run,p,assignment);
  ensure(messages.reduce((n,m)=>n+m.content.length,0)<=p.contextLimit,'This peer needs a context handoff. All sources and newer mail are retained; no call was made.');
  job={id:uid('call'),runId:r.id,chatId:r.chatId,index:run.episodeIds.length,seat:p.selection.seat,angle:p.direction,reason:'A user-admitted continuing peer contribution.',model:p.model,modelHash:p.modelHash,selection:p.selection,coat:p.coat,contextHash:digest(messages),contextLimit:p.contextLimit,maxTokens:p.maxTokens,
    toolContract:account?null:makeToolContract(state,{chatId:r.chatId,model:p.model,enabled:r.toolsEnabled,seat:p.selection.seat,coatSnapshot:p.coat,ceiling:p.toolCeiling??null,peerHistory:{runId:r.id,peerId:p.id,eventCount:run.events.length,hash:digest(peerSources(state,run,p)),...(assignment?{board:{revision:assignment.revision,itemIds:assignment.itemIds}}:{})}}),status:'queued',output:null,error:null,finishReason:null,handoff:null,endedAt:null,peerId:p.id,peerName:p.name,mailCursor:run.mail.length,epoch:run.epoch,eventCount:run.events.length,accountId:latestAccount(run,p)?.id??null,...(account?{recordKind:'account',accountPlan:account.plan}: {}),...(assignment?{boardAssignment:structuredClone(assignment)}:{})};
  const detail={runId:r.id,peerId:p.id,contextHash:job.contextHash,mailCursor:job.mailCursor,epoch:job.epoch,jobHash:digest(Object.fromEntries(Object.entries(job).filter(([k])=>!['status','output','error','finishReason','handoff','endedAt'].includes(k))))},a=recordHandoff(state,{kind:'hearth.peer.admitted',taskId:job.id,scope:{rootId:r.rootId,chatId:r.chatId},from:'app_task_queue',to:p.name,payload:detail,parents:[r.admissionId],status:'WITHIN_LOCAL_PROFILE',detail});
  job.admissionId=a.id;job.admissionHash=a.hash;run.episodeIds.push(job.id);state.parallel.jobs.push(job);entry.prepared.set(job.id,messages);return state;
 });return job;}
 async processRun(r,entry){
  if(!isContinuing(r))return super.processRun(r,entry);
  while(!this.closed&&!entry.stopped){
   r=this.store.state.parallel.runs.find(x=>x.id===r.id);this.check(r,entry);if(ordinaryInferencePending(this.store.state))return;
   const assignment=boardEnabled(r)?nextBoardAssignment(r,this.store.state.parallel.jobs):null;
   const p=r.peers.find(p=>boardEnabled(r)?p.name===assignment?.peer:r.positions[p.name].mode==='ready');
   if(!p){await this.store.transact(s=>{const r=s.parallel.runs.find(x=>x.id===entry.budget.runId);r.status=r.peers.every(p=>r.positions[p.name].mode==='rest')?'resting':'waiting';r.error=null;return s;});return;}
   if(boardEnabled(r))ensure(entry.budget.usage.modelRounds<r.limits.modelRounds,'The shared model request allowance is exhausted. The board is saved; continuing needs an explicit extension.');
   const currentSize=this.messagesFor(this.store.state,r,p,assignment).reduce((n,m)=>n+m.content.length,0);
   let account=null;if(currentSize>p.contextLimit*0.85){try{account=preparePeerAccount(this.store.state,r,p);}catch(error){if(currentSize>p.contextLimit)throw error;}}
   if(account){
    const helper=await this.admitPeer(r,p,entry,account);await this.runJob(r,helper,entry);
    await this.store.transact(s=>{const run=s.parallel.runs.find(x=>x.id===r.id),j=s.parallel.jobs.find(x=>x.id===helper.id);if(run.positions[p.name].mode==='stopped')return s;ensure(j.status==='completed','The context helper did not finish; its result and original sources are saved.');this.check(run,entry);ensure(run.positions[p.name].mode!=='stopped','This peer stopped during context preparation.');const parsed=parsePeerAccount(s,run,p,j.accountPlan,j.output);run.accounts.push({id:uid('peer_account'),jobId:j.id,peerId:p.id,peerName:p.name,author:p.model.name,through:j.accountPlan.through,previousId:j.accountPlan.priorId,...parsed,createdAt:at()});return s;});
    entry.prepared.delete(helper.id);continue;
   }
   const job=await this.admitPeer(r,p,entry,null,assignment);await this.runJob(r,job,entry);
   await this.store.transact(s=>{
    const run=s.parallel.runs.find(x=>x.id===r.id),j=s.parallel.jobs.find(x=>x.id===job.id),pos=run.positions[p.name];pos.lastJobId=j.id;if(j.output)run.events.push({kind:'call',id:j.id});
    if(entry.stopped||run.epoch!==job.epoch||pos.mode==='stopped')return s;
    if(j.status!=='completed'){pos.mode='held';run.error=j.error;if(boardEnabled(run))run.status='held';return s;}
    const result=parsePeerOutput(j.output,boardEnabled(run));pos.cursor=job.mailCursor;pos.mode=result.outcome==='contribute'?'wait-peer':result.outcome;
    if(boardEnabled(run)){
     if(j.boardAssignment.revision!==currentBoard(run).number){pos.mode='held';run.status='held';run.error='The board changed while this result was being prepared. Its text is saved; reconcile it before continuing.';return s;}
     try{const next=boardAfterResult(currentBoard(run),result.blackboard,j,peerSources(s,run,p,j.eventCount));run.blackboard.revisions.push(next);}
     catch(error){pos.mode='held';run.status='held';run.error=error.message;}
     return s;
    }
    for(const reply of result.replies){ensure(reply.peer!==p.name,'A peer cannot message itself to loop.');const m={id:uid('mail'),from:p.name,to:reply.peer,text:reply.text,jobId:j.id,requestId:null,createdAt:at()};run.mail.push(m);run.events.push({kind:'mail',id:m.id});const target=run.positions[reply.peer];if(['wait-peer','needs-human','partial','propose-complete'].includes(target.mode))target.mode='ready';}
    if(run.mail.slice(job.mailCursor).some(m=>m.to==='all'||m.to===p.name)&&pos.mode!=='rest')pos.mode='ready';
    return s;
   });entry.prepared.delete(job.id);
   if(!liveRun(this.store.state.parallel.runs.find(x=>x.id===r.id)))return;
  }
 }
 async messageContinuing(input){
  ensure(exact(input,['runId','requestId','message','target','scopeChange'])&&typeof input.message==='string'&&input.message.trim()&&input.message.length<=12000&&typeof input.requestId==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(input.requestId)&&['all',...peerNames].includes(input.target)&&typeof input.scopeChange==='boolean','Write a message and choose its recipients.');
  await this.store.transact(s=>{const r=s.parallel?.runs.find(r=>r.id===input.runId);ensure(isContinuing(r),'Choose a continuing hearth.');const prior=r.mail.find(m=>m.requestId===input.requestId);if(prior){ensure(prior.text===input.message&&prior.to===(input.scopeChange?'all':input.target),'That message ID already belongs to another amendment.');return s;}
    const m={id:uid('mail'),from:'user',to:input.scopeChange?'all':input.target,text:input.message,jobId:null,requestId:input.requestId,createdAt:at(),...(boardEnabled(r)?{scopeChange:input.scopeChange}:{})},receipt=recordHandoff(s,{kind:'hearth.user.message',taskId:r.id,scope:{rootId:r.rootId,chatId:r.chatId},from:'paired_local_ui',to:m.to,payload:m,parents:[r.admissionId],status:'REQUEST_RECORDED',detail:{mail:m}});r.mail.push({...m,receiptId:receipt.id});r.events.push({kind:'mail',id:m.id});
    if(boardEnabled(r))r.blackboard.revisions.push(boardAfterAmendment(currentBoard(r),m));
    const active=this.entries.get(r.id);if(active&&!active.stopped&&Date.now()<Date.parse(r.deadline)&&!s.chats.find(c=>c.id===r.chatId).archivedAt&&!s.roots.find(x=>x.id===r.rootId).archivedAt&&['queued','running','waiting'].includes(r.status)){for(const p of r.peers)if((m.to==='all'||m.to===p.name)&&!['rest','stopped'].includes(r.positions[p.name].mode))r.positions[p.name].mode='ready';if(Object.values(r.positions).some(p=>p.mode==='ready'))r.status='queued';}
    return s;});this.kick();return this.store.state;
 }
 async resumeContinuing(input){
  ensure(exact(input,['runId','requestId','target','extension','cloudApproved'])&&typeof input.requestId==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(input.requestId)&&['all',...peerNames].includes(input.target)&&typeof input.cloudApproved==='boolean','Choose the episodes to resume and review the allowance.');
  const prior=this.store.state.parallel?.runs.find(r=>r.id===input.runId)?.resumptions.find(x=>x.requestId===input.requestId);if(prior){ensure(prior.fingerprint===digest(input),'That resume ID belongs to different work.');return {runId:input.runId,state:this.store.state};}
  await this.store.transact(s=>{const r=s.parallel?.runs.find(r=>r.id===input.runId);ensure(isContinuing(r),'Choose a saved hearth.');ensure(agentSettings(s).enabled,'Enable shared hearth work first.');ensure(!liveRun(r),'Wait for active work before resuming.');assertInferenceIdle(s);ensure(!s.chats.find(c=>c.id===r.chatId).archivedAt&&!s.roots.find(x=>x.id===r.rootId).archivedAt,'Restore this branch first.');ensure(r.peers.every(p=>digest(s.models.find(m=>m.id===p.model.id))===p.modelHash),'A connection changed; keep this task held until its destination can be reviewed.');ensure(r.peers.every(p=>!isCloudModel(p.model)||input.cloudApproved),'Confirm sharing with OpenAI again.');
   if(input.extension){ensure(!r.extensions.some(x=>x.requestId===input.requestId),'This extension was already applied.');this.extend(s,r,input.extension,input.requestId);}
   ensure(Date.now()<Date.parse(r.deadline)&&r.usage.modelRounds<r.limits.modelRounds,'The allowance has expired or run out. Choose an explicit extension.');
   r.resumptions.push({requestId:input.requestId,fingerprint:digest(input),at:at()});r.epoch++;for(const p of r.peers)if(input.target==='all'||input.target===p.name)r.positions[p.name].mode='ready';r.status='queued';r.error=null;r.endedAt=null;return s;
  });const r=this.store.state.parallel.runs.find(r=>r.id===input.runId);this.attach(r);this.kick();return {runId:r.id,state:this.store.state};
 }
 async stopPeer(runId,name){const r=this.store.state.parallel?.runs.find(r=>r.id===runId);ensure(isContinuing(r)&&peerNames.includes(name),'Choose one episode.');const entry=this.entries.get(runId),job=this.store.state.parallel.jobs.find(j=>j.id===entry?.activeJobId);await this.store.transact(s=>{const r=s.parallel.runs.find(x=>x.id===runId);r.positions[name].mode='stopped';return s;});if(job?.peerName===name)entry.controller?.abort();}
 async cancel(runId,status='cancelled',reason='Stopped by you. Saved work remains; resume deliberately.'){
  const r=this.store.state.parallel?.runs.find(r=>r.id===runId);if(!isContinuing(r))return super.cancel(runId,status,reason);
  const entry=this.entries.get(runId);if(entry){entry.stopped=true;entry.stopStatus=status;entry.controller?.abort();}
  await this.store.transact(s=>{const r=s.parallel.runs.find(x=>x.id===runId);r.epoch++;r.status=status;r.error=reason;r.endedAt=at();for(const p of peerNames)r.positions[p].mode='stopped';for(const j of s.parallel.jobs.filter(j=>j.runId===runId&&j.status==='queued')){j.status='cancelled';j.error=reason;j.endedAt=at();}return s;});
 }
 async finish(runId,status,error,expectedMailCount=null){const r=this.store.state.parallel?.runs.find(r=>r.id===runId);if(!isContinuing(r))return super.finish(runId,status,error,expectedMailCount);await this.store.transact(s=>{const r=s.parallel.runs.find(x=>x.id===runId);if(r.status==='cancelled')return s;r.status=status==='completed'?'waiting':status;r.error=error;r.endedAt=at();for(const j of s.parallel.jobs.filter(j=>j.runId===runId&&j.status==='queued')){j.status='held';j.error=error||'The task is held.';j.endedAt=at();}for(const p of peerNames)if(r.positions[p].mode==='ready')r.positions[p].mode='held';return s;});}
 async recheck(){for(const [id,e] of this.entries){const r=this.store.state.parallel.runs.find(r=>r.id===id);if(isContinuing(r)&&!liveRun(r))continue;try{this.check(r,e);}catch(error){await this.cancel(id,'held',error.message);}}}
}
