import crypto from 'node:crypto';
import {digest} from './integrity.mjs';
import {EASEL_PROFILE,EASEL_LIMITS,validateEaselDoc,validEaselId} from '../public/easel-format.js';
export const easelId=prefix=>prefix+'_'+crypto.randomUUID();
export const easelState=s=>{s.schemaVersion=Math.max(2,s.schemaVersion);return s.easel??={profile:EASEL_PROFILE,projects:[],jobs:[]};};
export const easelProject=(s,id)=>s.easel?.projects.find(p=>p.id===id)??null;
export const easelHead=p=>p.history.find(h=>h.id===p.headId);
const fail=(ok,why)=>{if(!ok)throw new Error('Easel: '+why);};
export function imageRef(ref){return ref&&/^[a-f0-9]{64}$/.test(ref.sha256)&&Number.isSafeInteger(ref.byteLength)&&ref.byteLength>0&&ref.byteLength<=10*1024*1024&&['image/png','image/jpeg','image/webp'].includes(ref.mimeType)&&Number.isSafeInteger(ref.width)&&Number.isSafeInteger(ref.height)&&ref.width>0&&ref.height>0;}
export function validateEasel(s){
 const e=s?.easel;if(!e)return;fail(e.profile===EASEL_PROFILE&&Array.isArray(e.projects)&&Array.isArray(e.jobs),'invalid project collection.');const ids=new Set();
 for(const p of e.projects){
  fail(validEaselId(p.id)&&!ids.has(p.id)&&typeof p.name==='string'&&p.name.trim()&&p.name.length<=120,'invalid project identity.');ids.add(p.id);
  fail(Number.isSafeInteger(p.version)&&p.version>=1&&Number.isSafeInteger(p.width)&&p.width>=16&&p.width<=EASEL_LIMITS.side&&Number.isSafeInteger(p.height)&&p.height>=16&&p.height<=EASEL_LIMITS.side,'invalid canvas size/version.');
  fail(Array.isArray(p.assets)&&p.assets.length>0&&Array.isArray(p.history)&&p.history.length>0&&p.history.length<=EASEL_LIMITS.revisions,'invalid saved revisions.');
  const assets=new Set();for(const a of p.assets){fail(validEaselId(a.id)&&!assets.has(a.id)&&imageRef(a.ref)&&a.ref.mimeType==='image/png'&&a.ref.width===p.width&&a.ref.height===p.height,'invalid saved picture.');assets.add(a.id);}
  const history=new Set();for(const h of p.history){fail(validEaselId(h.id)&&!history.has(h.id)&&(h.parentId===null||history.has(h.parentId))&&typeof h.requestId==='string'&&typeof h.at==='string','invalid revision chain.');validateEaselDoc(h.doc,p.width,p.height,[...assets]);if(h.provenance?.providerResult)fail(imageRef(h.provenance.providerResult),'invalid retained provider picture.');history.add(h.id);}
  fail(history.has(p.headId)&&assets.has(p.originalAssetId),'saved project head is missing.');
  if(p.source)fail(imageRef(p.source),'invalid retained original.');
 }
 const jobs=new Set();for(const j of e.jobs){const p=easelProject(s,j.projectId);fail(validEaselId(j.id)&&!jobs.has(j.id)&&p?.history.some(h=>h.id===j.baseId)&&['running','ready','accepted','rejected','failed','cancelled','interrupted'].includes(j.status)&&typeof j.prompt==='string'&&j.prompt.length<=EASEL_LIMITS.prompt,'invalid image job.');jobs.add(j.id);if(j.result)fail(imageRef(j.result),'invalid image result.');if(j.providerResult)fail(imageRef(j.providerResult),'invalid retained provider result.');}
}
export function preserveEasel(before,after){
 const transfers=before.easel?.transfers??[];fail(digest(transfers)===digest((after.easel?.transfers??[]).slice(0,transfers.length)),'earlier picture transfers changed.');
 for(const p of before.easel?.projects??[]){const n=easelProject(after,p.id);fail(n&&n.width===p.width&&n.height===p.height&&n.originalAssetId===p.originalAssetId&&digest(n.source??null)===digest(p.source??null),'the original project changed.');
  for(const field of ['assets','history'])fail(digest(p[field])===digest(n[field].slice(0,p[field].length)),'earlier artwork or revisions changed.');
 }
 for(const j of before.easel?.jobs??[]){const n=after.easel?.jobs.find(v=>v.id===j.id);fail(n&&['projectId','baseId','prompt','backend','requestId'].every(k=>n[k]===j[k]),'an earlier image request changed.');for(const k of ['result','providerResult','report'])if(j[k])fail(digest(n[k])===digest(j[k]),'an image proposal or its account changed.');}
}
export function addRevision(p,doc,{requestId,label='Edit',jobId=null,provenance=null}={}){
 fail(typeof requestId==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(requestId),'invalid operation identity.');
 validateEaselDoc(doc,p.width,p.height,p.assets.map(a=>a.id));
 const prior=p.history.find(h=>h.requestId===requestId);if(prior){fail(digest(prior.doc)===digest(doc),'an operation identity was reused for different artwork.');return prior;}
 fail(p.history.length<EASEL_LIMITS.revisions,'this project has reached its revision limit. Export it before starting a new one.');
 const h={id:easelId('revision'),parentId:p.headId??null,requestId,at:new Date().toISOString(),label,jobId,provenance:structuredClone(provenance),doc:structuredClone(doc)};p.history.push(h);p.headId=h.id;p.version++;return h;
}
export const easelProjectImages=p=>[p.source,...p.assets.map(a=>a.ref),...p.history.map(h=>h.provenance?.providerResult)].filter(Boolean);
export function easelImageObjects(s){return (s.easel?.projects??[]).flatMap(easelProjectImages).concat((s.easel?.jobs??[]).flatMap(j=>[j.result,j.providerResult]).filter(Boolean));}
