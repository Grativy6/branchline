import crypto from 'node:crypto';
import {digest} from './integrity.mjs';
import {sketchDestination} from './sketches.mjs';
export const WORK_ACCESS_PROFILE='branchline.work-access/1';
export const workSettings=s=>s.workAccess?.settings.at(-1)??null;
export const workAllowed=(s,model)=>workSettings(s)?.destinations.some(d=>digest(d)===digest(sketchDestination(model)))===true;
const fail=(ok,why)=>{if(!ok)throw new Error('Work tools: '+why);};
export function hostSnapshot(s,model,workspaceId,workspacePath){
 const w=workSettings(s);if(!w||w.workspaceId!==workspaceId||w.workspacePath!==workspacePath||!workAllowed(s,model))return null;
 const commands=w.commands.filter(c=>c.approved).map(c=>({id:c.id,name:c.name,seconds:c.seconds}));
 const window=w.window?{target:w.window.target,control:w.window.control}:null;
 const browser=w.browser?.enabled?{origins:w.browser.origins,control:w.browser.control}:null;
 const pictures=w.pictures?.enabled?{...w.pictures}:null;
 return {profile:WORK_ACCESS_PROFILE,revision:w.id,workspaceId,commands,window,browser,pictures};
}
export function assertWorkDisclosure(s,chatId,model,workspaceId=null,workspacePath=null){
 const rootId=s.chats.find(c=>c.id===chatId)?.rootId,exposures=s.workAccess?.exposures??[];const sharedSketch=exposures.length&&(s.sketchBook?.records??[]).some(r=>r.revisions.some(v=>v.at>=exposures[0].at));if(!exposures.some(e=>sharedSketch||e.rootId===rootId))return;
 const w=workSettings(s);fail(w&&workAllowed(s,model)&&(!workspaceId||w.workspaceId===workspaceId)&&(!workspacePath||w.workspacePath===workspacePath),'this conversation carries work output. Review sharing for the receiving connection.');
}
export function workRecord(s,key,value){const w=s.workAccess??={profile:WORK_ACCESS_PROFILE,settings:[],exposures:[],artifacts:[]};const record={id:'work_'+crypto.randomUUID(),at:new Date().toISOString(),...structuredClone(value)};(w[key]??=[]).push(record);return record;}
export function workExposure(s,{chatId,taskId,settingsId,kind}){const rootId=s.chats.find(c=>c.id===chatId)?.rootId;fail(rootId,'the source conversation is unavailable.');if(!s.workAccess?.exposures.some(e=>e.taskId===taskId&&e.settingsId===settingsId&&e.kind===kind))workRecord(s,'exposures',{chatId,rootId,taskId,settingsId,kind});}
export function validateWorkAccess(s){
 const w=s.workAccess;if(!w)return;fail(w.profile===WORK_ACCESS_PROFILE&&['settings','exposures','artifacts'].every(k=>Array.isArray(w[k])),'invalid saved work data.');
 for(const r of w.settings){fail(typeof r.id==='string'&&typeof r.workspaceId==='string'&&typeof r.workspacePath==='string'&&Array.isArray(r.commands)&&r.commands.length<=16&&Array.isArray(r.destinations),'invalid work selection.');
  for(const c of r.commands)fail(typeof c.id==='string'&&typeof c.name==='string'&&typeof c.executable==='string'&&/^[a-f0-9]{64}$/.test(c.sha256)&&Array.isArray(c.args)&&typeof c.cwd==='string'&&typeof c.cwdIdentity==='string'&&Number.isInteger(c.seconds)&&c.seconds>=1&&c.seconds<=600&&typeof c.approved==='boolean','invalid saved command.');
  if(r.window)fail(typeof r.window.control==='boolean'&&typeof r.window.target?.handle==='string'&&Number.isInteger(r.window.target.processId)&&typeof r.window.target.started==='string'&&typeof r.window.target.executable==='string','invalid window selection.');
  if(r.browser)fail(typeof r.browser.enabled==='boolean'&&typeof r.browser.control==='boolean'&&Array.isArray(r.browser.origins)&&r.browser.origins.length<=12,'invalid browser selection.');
  if(r.pictures)fail(typeof r.pictures.enabled==='boolean'&&typeof r.pictures.model==='string','invalid picture provider.');
 }
 for(const e of w.exposures)fail(s.chats.some(c=>c.id===e.chatId&&c.rootId===e.rootId)&&w.settings.some(r=>r.id===e.settingsId)&&typeof e.taskId==='string','invalid work exposure.');
 for(const j of w.jobs??[])fail(typeof j.jobId==='string'&&typeof j.taskId==='string'&&s.chats.some(c=>c.id===j.chatId)&&['running','completed','failed','stopped','interrupted'].includes(j.status),'invalid picture job.');
 for(const a of w.artifacts)fail(typeof a.id==='string'&&s.chats.some(c=>c.id===a.chatId)&&(a.snapshot?.original?.sha256&&a.snapshot?.view?.sha256||typeof a.text==='string'&&digest(a.text)===a.textHash),'invalid work artifact.');
}
export function preserveWorkAccess(before,after){if(!before.workAccess)return;for(const key of ['settings','exposures','artifacts','jobs'])fail((after.workAccess?.[key]?.length??0)>=(before.workAccess[key]?.length??0)&&(before.workAccess[key]??[]).every((v,i)=>digest(v)===digest(after.workAccess[key][i])),'work settings or recorded output were rewritten.');}
