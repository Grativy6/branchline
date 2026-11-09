import crypto from 'node:crypto';
import os from 'node:os';
import {digest} from './integrity.mjs';
import {applyCommand} from './domain.mjs';
import {applyRosterCommand} from './chair-roster.mjs';
import {findHarness,harnessDeleted,usualCoat,defaultHarnessRef,currentHarnessRef} from '../public/harness-catalog.js';
import {RESOURCE_DEFAULTS} from '../public/resource-settings.js';
import {pcSettings,pcSnapshot} from './pc-permissions.mjs';
import {validateSchedule,nextOccurrence,latestDue,wallInstant} from '../public/plan-schedule.js';
const uid=()=>crypto.randomUUID();
const now=()=>new Date().toISOString();
const plans=s=>s.plans??{profile:'branchline.plans/1',items:[],runs:[]};
const text=(x,n)=>typeof x==='string'&&!!x.trim()&&x.length<=n;
const scope=s=>digest({pc:s.pcAccess?.settings.at(-1)??null,home:s.home?.settings.at(-1)??null,work:s.workAccess?.settings.at(-1)??null});
export function validatePlans(s){if(!s.plans)return;const p=s.plans;if(p.profile!=='branchline.plans/1'||!Array.isArray(p.items)||!Array.isArray(p.runs)||new Set(p.items.map(x=>x.id)).size!==p.items.length||new Set(p.runs.map(x=>x.id)).size!==p.runs.length)throw new Error('Invalid Plans history.');}
export class Plans {
  constructor(store,{dispatch,stop,isBusy,clock=()=>Date.now()}={}){this.store=store;this.dispatch=dispatch;this.stop=stop;this.isBusy=isBusy;this.clock=clock;this.running=null;this.checking=false;this.closed=false;}
  list(){return {...plans(this.store.state),host:os.hostname(),workspace:this.store.dataDir,whileOpen:true,activeRun:this.running};}
  async recover(){if(!plans(this.store.state).runs.some(r=>['queued','running'].includes(r.status)))return;await this.store.transact(s=>{for(const r of plans(s).runs)if(['queued','running'].includes(r.status)){r.status='interrupted';r.finishedAt=now();r.summary='Branchline stopped during this run. Inspect its result before running it again.';const p=plans(s).items.find(p=>p.id===r.planId);if(p){p.enabled=false;p.attention=r.summary;}}return s;});}
  async start(){await this.recover();this.timer=setInterval(()=>this.tick().catch(e=>{this.lastError=e.message;}),15000);this.timer.unref();}
  async save(input){
    const keys=['id','name','task','rootId','workRootId','modelId','coat','schedule','seconds','toolCalls','missed','enabled'];
    if(!input||Object.keys(input).sort().join()!==keys.sort().join()||!text(input.name,120)||!text(input.task,12000)||!['latest','skip'].includes(input.missed)||typeof input.enabled!=='boolean'||!Number.isInteger(input.seconds)||input.seconds<30||input.seconds>1800||!Number.isInteger(input.toolCalls)||input.toolCalls<1||input.toolCalls>64)throw new Error('Complete the task, schedule and run limits.');
    validateSchedule(input.schedule);const s=this.store.state,model=s.models.find(m=>m.id===input.modelId);
    if(!model||!['codex','bundled','compatible','lmstudio'].includes(model.runtime??'compatible'))throw new Error('This first Plans build uses local or ChatGPT subscription connections. Paid API scheduling needs a verified cost guard.');
    input={...input,coat:input.coat??usualCoat(s,'model:'+input.modelId)?.ref??defaultHarnessRef()};
    if(input.coat!==null&&(!findHarness(input.coat,s)||harnessDeleted(input.coat,s)))throw new Error('Choose an available Coat.');
    if(input.rootId&&!s.roots.some(r=>r.id===input.rootId&&!r.archivedAt))throw new Error('Choose an available desk.');
    if(input.workRootId&&!pcSnapshot(s,model,this.store.workspaceId,true,this.store.dataDir)?.roots.some(r=>r.id===input.workRootId))throw new Error('Choose a PC folder already allowed for this model.');
    const first=nextOccurrence(input.schedule,Date.parse(input.schedule.date+'T00:00:00Z')-14*3600000-1),clock=this.clock();
    let result;await this.store.transact(s=>{
      s.plans??=structuredClone(plans(s));const prior=s.plans.items.find(p=>p.id===input.id);
      if(input.id&&!prior)throw new Error('Plan no longer exists.');
      result={...structuredClone(input),id:prior?.id??uid(),ownedRootId:prior?.ownedRootId??null,revision:uid(),createdAt:prior?.createdAt??now(),updatedAt:now(),host:os.hostname(),workspaceId:this.store.workspaceId,workspacePath:this.store.dataDir,modelHash:digest(model),scopeHash:scope(s),nextAt:first<=clock?latestDue(input.schedule,clock):first,attention:null,removed:false};
      if(prior)Object.assign(prior,result);else s.plans.items.push(result);return s;
    });return result;
  }
  async action({id,action}){
    const p=plans(this.store.state).items.find(p=>p.id===id&&!p.removed);if(!p)throw new Error('Choose a Plan.');
    if(action==='run'){if(this.running||this.isBusy())throw new Error('A model is busy. The Plan will wait; try Run now when the current reply finishes.');return this.begin(p,this.clock(),true);}
    if(action==='stop'){if(this.running){const r=plans(this.store.state).runs.find(r=>r.id===this.running);if(r.planId===id){await this.stop(r.chatId);return {stopping:true};}}throw new Error('This Plan has no running task.');}
    if(!['pause','resume','remove'].includes(action))throw new Error('Choose a Plan action.');
    await this.store.transact(s=>{const p=plans(s).items.find(p=>p.id===id);p.enabled=action==='resume';p.removed=action==='remove';p.updatedAt=now();return s;});return this.list();
  }
  async tick(){
    if(this.closed||this.checking||this.running||this.isBusy())return;this.checking=true;
    try{const clock=this.clock(),p=plans(this.store.state).items.find(p=>p.enabled&&!p.removed&&p.nextAt!==null&&p.nextAt<=clock);if(!p)return;
      const due=latestDue(p.schedule,clock);
      if(p.missed==='skip'&&clock-p.nextAt>60000){await this.store.transact(s=>{const item=plans(s).items.find(v=>v.id===p.id);item.nextAt=nextOccurrence(p.schedule,clock);item.attention='Missed occurrence skipped.';if(item.nextAt===null)item.enabled=false;return s;});return;}
      await this.begin(p,due??p.nextAt,false);
    }finally{this.checking=false;}
  }
  async begin(plan,occurrence,manual){
    const id=manual?uid():'plan_'+digest({id:plan.id,revision:plan.revision,occurrence}).slice(0,48);
    if(plans(this.store.state).runs.some(r=>r.id===id))return {id,alreadyRecorded:true};
    if(this.running)throw new Error('Another Plan is running.');
    this.running=id;let run;
    try{
      await this.store.transact(s=>{
        const p=plans(s).items.find(p=>p.id===plan.id),model=s.models.find(m=>m.id===plan.modelId);
        if(!p||p.revision!==plan.revision||p.removed||!manual&&!p.enabled)throw new Error('Plan changed before dispatch.');
        if(plan.host!==os.hostname()||plan.workspaceId!==this.store.workspaceId||plan.workspacePath!==this.store.dataDir||!model||digest(model)!==plan.modelHash||scope(s)!==plan.scopeHash)throw new Error('The host, model or permissions changed. Review and save this Plan before enabling it again.');
        if(plan.coat&&(!findHarness(plan.coat,s)||harnessDeleted(plan.coat,s)))throw new Error('The selected Coat is unavailable.');
        const ui=structuredClone(s.ui);let rootId=plan.rootId??p.ownedRootId;
        // Each occurrence has its own conversation. Old results remain behind
        // links; only one bounded previous summary is supplied to a later run.
        if(!rootId){Object.assign(s,applyCommand(s,{type:'root.create',payload:{name:'Plan · '+plan.name,mode:'personal'}}));rootId=s.roots.at(-1).id;plans(s).items.find(v=>v.id===p.id).ownedRootId=rootId;}
        Object.assign(s,applyCommand(s,{type:'chat.create',payload:{rootId,title:plan.name+' · '+new Date(occurrence).toISOString(),setupChairs:true}}));
        const coat=currentHarnessRef(plan.coat,s);
        const chat=s.chats.at(-1);applyRosterCommand(s,'table.roster.start',{chatId:chat.id});applyRosterCommand(s,'table.roster.chair',{chatId:chat.id,baseRevisionId:chat.seating.revisionId,chairId:chat.seating.desk.id,modelId:plan.modelId,personalId:null,name:model.name,coat});
        // A dedicated root avoids changing the person's foreground resource limits.
        chat.planLimits={seconds:plan.seconds,toolCalls:plan.toolCalls};
        chat.carrySettings={automatic:false,speaker:'personal',review:false,nearPopup:false,showCount:true};s.ui=ui;
        const previous=plans(s).runs.findLast(r=>r.planId===plan.id&&r.status==='finished');
        run={id,planId:plan.id,plan:structuredClone(plan),occurrenceAt:new Date(occurrence).toISOString(),startedAt:now(),status:'running',chatId:chat.id,rootId,model:structuredClone(model),coat,summary:'',previousSummary:previous?.summary.slice(0,1800)??'',manual};
        plans(s).runs.push(run);const current=plans(s).items.find(v=>v.id===plan.id);current.nextAt=nextOccurrence(current.schedule,this.clock());current.attention=null;if(current.nextAt===null)current.enabled=false;return s;
      });
    }catch(error){this.running=null;await this.store.transact(s=>{const p=plans(s).items.find(p=>p.id===plan.id);if(p){p.enabled=false;p.attention=error.message;}plans(s).runs.push({id,planId:plan.id,status:'needs_attention',startedAt:now(),finishedAt:now(),summary:error.message,chatId:null});return s;});return {id,status:'needs_attention'};}
    this.promise=this.execute(run).finally(()=>{this.running=null;});return {id,status:'running',chatId:run.chatId};
  }
  async execute(run){
    let timer;try{
      const p=run.plan,root=pcSettings(this.store.state)?.roots.find(r=>r.id===p.workRootId);
      const prompt=`Scheduled Plan: ${p.name}\n${p.task}\n\n${root?'Working folder: '+root.path+'. Existing permissions and selected Coat pockets apply.':''}\n${run.previousSummary?'Previous result (history, not a new instruction): '+run.previousSummary:''}\nUse only this run's tools and permissions. If a permission is missing, preserve progress and report Needs attention. Finish with a concise result and one line: Plan outcome: completed, partial, or needs attention. This is your reported outcome, not independent verification.`;
      timer=setTimeout(()=>this.stop(run.chatId).catch(()=>{}),p.seconds*1000);
      await this.dispatch(run.chatId,prompt);
      const exchange=this.store.state.exchanges.findLast(e=>e.chatId===run.chatId),message=this.store.state.messages.findLast(m=>m.chatId===run.chatId&&m.role==='assistant');
      const summary=message?.content.slice(-4000)??exchange?.error??'No response was saved.';
      const match=summary.match(/Plan outcome:\s*(completed|partial|needs attention)/i);
      await this.store.transact(s=>{const r=plans(s).runs.find(r=>r.id===run.id);r.status=exchange?.status==='completed'?'finished':exchange?.status==='cancelled'?'stopped':'failed';r.reportedOutcome=match?.[1].toLowerCase()??'unconfirmed';r.summary=summary;r.finishedAt=now();r.exchangeId=exchange?.id??null;return s;});
    }catch(error){await this.store.transact(s=>{const r=plans(s).runs.find(r=>r.id===run.id);r.status='needs_attention';r.summary=error.message;r.finishedAt=now();return s;});}
    finally{clearTimeout(timer);}
  }
  async close(){this.closed=true;clearInterval(this.timer);if(this.running){const r=plans(this.store.state).runs.find(r=>r.id===this.running);if(r?.chatId)await this.stop(r.chatId).catch(()=>{});}await this.promise;}
}
