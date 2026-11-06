import crypto from 'node:crypto';
import {digest} from './integrity.mjs';
import {pcSettings,pcDestination} from './pc-permissions.mjs';
export {NAV_TOOLS} from '../public/nav-format.js';
export const NAV_PROFILE='branchline.nav/1';
export const NAV_TOOL_PROFILE='branchline.conversation-tools/10';
export const NAV_OUTCOMES=['unassessed','completed','partial','blocked','abandoned','superseded'];
const fail=(ok,why)=>{if(!ok)throw new Error('Nav: '+why);};
const uid=()=>crypto.randomUUID().replaceAll('-','');
export function navSnapshot(state,model,workspaceId,workspacePath,available=true){
  const s=pcSettings(state);
  if(!available||!s?.nav?.enabled||s.workspaceId!==workspaceId||s.workspacePath!==workspacePath)return null;
  const roots=s.roots.filter(r=>r.destinations.some(d=>digest(d)===digest(pcDestination(model))));
  return roots.length?{profile:NAV_PROFILE,revision:s.id,workspaceId,timeZone:s.nav.timeZone,roots:roots.map(r=>({id:r.id,label:r.label,frontDoor:!!r.frontDoor}))}:null;
}
export function validNav(n){
  return n?.profile===NAV_PROFILE && ['revision','workspaceId'].every(k=>/^[a-f0-9]{32}$/.test(n[k]))&&typeof n.timeZone==='string'&&Array.isArray(n.roots)&&n.roots.length<=16&&n.roots.every(r=>/^[a-f0-9]{32}$/.test(r.id)&&typeof r.label==='string'&&typeof r.frontDoor==='boolean');
}
export function navCurrent(state,model,workspaceId,workspacePath,contract,rootId){
  const now=navSnapshot(state,model,workspaceId,workspacePath);
  fail(now&&digest(now)===digest(contract),'Nav is off or its reviewed locations/connection changed. Review Agents and begin a fresh reply. Do not bypass a disabled Nav request through another tool.');
  fail(now.roots.some(r=>r.id===rootId),'This location is not enabled for this connection.');
  return {settings:pcSettings(state),root:pcSettings(state).roots.find(r=>r.id===rootId)};
}
export const navEpisode=(s,id)=>s.nav?.operations.findLast(r=>r.phase==='complete'&&r.episode?.id===id)?.episode??null;
export const navOperation=(s,key)=>s.nav?.operations.findLast(r=>r.requestKey===key)??null;
export function recordNav(s,value){
  const n=s.nav??={profile:NAV_PROFILE,operations:[]};
  const record={...structuredClone(value),id:uid(),recordedUtc:new Date().toISOString(),hostOrder:n.operations.length+1};
  n.operations.push(record);return record;
}
export function validateNav(s){
  const n=s.nav;if(!n)return;
  fail(n.profile===NAV_PROFILE&&Array.isArray(n.operations),'Invalid saved journal records.');
  const ids=new Set(),origins=new Map();
  for(const [i,r] of n.operations.entries()){
    fail(/^[a-f0-9]{32}$/.test(r.id)&&!ids.has(r.id)&&r.hostOrder===i+1&&['planned','prepared','complete','uncertain','not_committed'].includes(r.phase)&&typeof r.requestKey==='string'&&/^[a-f0-9]{64}$/.test(r.fingerprint),'Invalid operation record.');ids.add(r.id);
    if(r.episode){const e=r.episode;fail(/^[a-f0-9]{32}$/.test(e.id)&&Number.isSafeInteger(e.sequence)&&e.sequence>=0&&['active','closed'].includes(e.state)&&NAV_OUTCOMES.includes(e.outcome)&&e.origin&&typeof e.origin.path==='string'&&typeof e.origin.identity==='string'&&typeof e.journal==='string'&&typeof e.timeZone==='string','Invalid episode.');
      const origin=digest([e.origin,e.journal,e.timeZone,e.startedUtc,e.filenameDate]);
      fail(!origins.has(e.id)||origins.get(e.id)===origin,'An episode cannot move its origin, date or timezone.');origins.set(e.id,origin);
    }
  }
}
export function preserveNav(before,after){if(!before.nav)return;fail(after.nav?.operations.length>=before.nav.operations.length&&before.nav.operations.every((r,i)=>digest(r)===digest(after.nav.operations[i])),'Saved journal operations must remain unchanged.');}
