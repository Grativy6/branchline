import sharp from 'sharp';
import {digest} from './integrity.mjs';
import {easelState,easelProject,easelHead,easelId,addRevision,validateEasel,easelProjectImages} from './easel-state.mjs';
import {EASEL_PROFILE,EASEL_LIMITS,validateEaselDoc} from '../public/easel-format.js';
import {renderGuidance,makeViewingFrame,compositeProposal} from './easel-render.mjs';
import {CodexPictureProvider} from './codex-picture-provider.mjs';
import {recordImageSelection,activeImageIds} from './images.mjs';
import {assertInferenceIdle} from './table.mjs';
const fail=(ok,why)=>{if(!ok)throw new Error('Easel: '+why);};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.slice().sort().join();
const requestId=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(v);
const now=()=>new Date().toISOString();

export class Easel {
 constructor(store,imageStore,{backends,accountDir,scratchDir}={}){
  this.store=store;this.images=imageStore;this.running=new Map();
  this.backends=backends??{subscription:new CodexPictureProvider({accountDir,scratchDir})};
 }
 project(id){const p=easelProject(this.store.state,id);fail(p,'choose a saved project.');return p;}
 view(p){return {...structuredClone(p),doc:structuredClone(easelHead(p).doc),canUndo:easelHead(p).parentId!==null};}
 list(){return {projects:(this.store.state.easel?.projects??[]).map(p=>({id:p.id,name:p.name,width:p.width,height:p.height,updatedAt:p.updatedAt})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),jobs:structuredClone(this.store.state.easel?.jobs??[]),backends:Object.entries(this.backends).map(([id,b])=>({id,label:b.description?.label??id,billing:b.description?.billing??'unknown',connection:b.description?.connection??null}))};}
 async recover(){if(this.store.state.easel?.jobs.some(j=>j.status==='running'))await this.store.transact(s=>{for(const j of s.easel.jobs)if(j.status==='running'){j.status='interrupted';j.problem='Branchline closed before this result was confirmed. It was not retried.';j.endedAt=now();}return s;});}
 async putImage(bytes,width,height){return this.images.put(bytes,'png',{width,height});}
 async create(input){
  fail(exact(input,['name','image','requestId'])&&requestId(input.requestId)&&typeof input.name==='string'&&input.name.trim()&&input.name.length<=120,'choose a project name and an image or a blank canvas.');
  const existing=this.store.state.easel?.projects.find(p=>p.createRequestId===input.requestId);if(existing)return this.view(existing);
  let bytes,source=null;
  if(input.image){const selected=await this.images.ingest(input.image);source=selected.original;bytes=await this.images.read(source);}
  else bytes=await sharp({create:{width:1024,height:1024,channels:4,background:'#fffdf7'}}).png().toBuffer();
  const canonical=await sharp(bytes,{limitInputPixels:20000000}).autoOrient().resize({width:EASEL_LIMITS.side,height:EASEL_LIMITS.side,fit:'inside',withoutEnlargement:true}).toColourspace('srgb').ensureAlpha().png().toBuffer({resolveWithObject:true});
  const {width,height}=canonical.info,ref=await this.putImage(canonical.data,width,height),assetId=easelId('asset');let id;
  await this.store.transact(s=>{
   const prior=s.easel?.projects.find(p=>p.createRequestId===input.requestId);if(prior){id=prior.id;return s;}
   const p={id:easelId('easel'),createRequestId:input.requestId,name:input.name.trim(),width,height,version:0,createdAt:now(),updatedAt:now(),source,originalAssetId:assetId,assets:[{id:assetId,ref}],history:[],headId:null};
   addRevision(p,{assetId,marks:[],boundary:null},{requestId:input.requestId,label:'Original'});easelState(s).projects.push(p);id=p.id;return s;
  });return this.view(this.project(id));
 }
 async save(input){
  fail(exact(input,['id','version','doc','requestId','name'])&&requestId(input.requestId)&&typeof input.name==='string'&&input.name.trim()&&input.name.length<=120,'invalid save request.');
  await this.store.transact(s=>{
   const p=easelProject(s,input.id);fail(p,'project unavailable.');
   const prior=p.history.find(h=>h.requestId===input.requestId);
   if(prior){fail(digest(prior.doc)===digest(input.doc),'an earlier save identity was reused.');return s;}
   fail(p.version===input.version,'this project changed in another view. Reopen the saved version; your unsaved drawing is still on screen.');
   validateEaselDoc(input.doc,p.width,p.height,p.assets.map(a=>a.id));
   addRevision(p,input.doc,{requestId:input.requestId,label:'Drawing'});p.name=input.name.trim();p.updatedAt=now();return s;
  });return this.view(this.project(input.id));
 }
 async restore(input){
  fail(exact(input,['id','version','revisionId']),'choose a saved revision.');
  await this.store.transact(s=>{const p=easelProject(s,input.id);fail(p&&p.version===input.version,'project changed; reopen before restoring.');fail(p.history.some(h=>h.id===input.revisionId),'revision unavailable.');p.headId=input.revisionId;p.version++;p.updatedAt=now();return s;});return this.view(this.project(input.id));
 }
 async image(id,assetId){const p=this.project(id),a=p.assets.find(a=>a.id===assetId);fail(a,'picture is not part of this project.');return this.images.read(a.ref);}
 async exportPicture(id,marks=false){const p=this.project(id),doc=easelHead(p).doc,base=await this.image(id,doc.assetId);return marks?renderGuidance(base,doc,p.width,p.height):base;}
 async exportProject(id){
  const p=this.project(id),refs=new Map(easelProjectImages(p).map(r=>[r.sha256,r])),images={};let size=0;
  for(const ref of refs.values()){const bytes=await this.images.read(ref);size+=bytes.length;fail(size<=48*1024*1024,'project export exceeds 48 MiB of image data. Save individual pictures instead.');images[ref.sha256]={ref,base64:bytes.toString('base64')};}
  return {profile:'branchline.easel-export/1',project:structuredClone(p),images};
 }
 async importProject(input){
  fail(exact(input,['bundle','requestId'])&&requestId(input.requestId),'invalid project import.');const b=input.bundle;
  fail(exact(b,['profile','project','images'])&&b.profile==='branchline.easel-export/1'&&b.images&&typeof b.images==='object'&&!Array.isArray(b.images),'choose an Easel project file.');
  const old=this.store.state.easel?.projects.find(p=>p.createRequestId===input.requestId);if(old)return this.view(old);
  const p=structuredClone(b.project);validateEasel({easel:{profile:EASEL_PROFILE,projects:[p],jobs:[]}});
  const refs=new Map(easelProjectImages(p).map(r=>[r.sha256,r]));fail(Object.keys(b.images).length===refs.size,'project picture collection does not match.');let total=0;
  for(const [hash,ref] of refs){const item=b.images[hash];fail(exact(item,['ref','base64'])&&digest(item.ref)===digest(ref)&&typeof item.base64==='string','project picture reference mismatch.');const bytes=Buffer.from(item.base64,'base64');total+=bytes.length;
   fail(total<=48*1024*1024&&bytes.length===ref.byteLength&&bytes.toString('base64')===item.base64,'project image data is invalid or too large.');
   const format={'image/png':'png','image/jpeg':'jpeg','image/webp':'webp'}[ref.mimeType];const selected=await this.images.ingest({name:'import.'+format,origin:'pick',base64:item.base64});fail(selected.original.sha256===hash,'project picture failed its hash check.');
   // Validate actual dimensions as well as declared metadata.
   const meta=await sharp(bytes,{limitInputPixels:20000000}).metadata();fail(meta.width===ref.width&&meta.height===ref.height,'project image dimensions changed.');
  }
  p.id=easelId('easel');p.createRequestId=input.requestId;p.name=(p.name+' (copy)').slice(0,120);p.updatedAt=now();
  await this.store.transact(s=>{const prior=s.easel?.projects.find(v=>v.createRequestId===input.requestId);if(!prior)easelState(s).projects.push(p);return s;});return this.view(this.store.state.easel.projects.find(v=>v.createRequestId===input.requestId));
 }
 async capability(backend){fail(this.backends[backend],'choose an available image connection.');return this.backends[backend].status();}
 async start(input){
  fail(exact(input,['id','version','backend','prompt','requestId'])&&requestId(input.requestId)&&typeof input.prompt==='string'&&input.prompt.trim()&&input.prompt.length<=EASEL_LIMITS.prompt,'write a short image request.');
  const prior=this.store.state.easel?.jobs.find(j=>j.requestId===input.requestId);if(prior){fail(prior.projectId===input.id&&prior.prompt===input.prompt&&prior.backend===input.backend,'an image request identity was reused.');return structuredClone(prior);}
  fail(!this.running.size,'an Easel image is already running. Finish or stop it first.');
  const backend=this.backends[input.backend];fail(backend,'choose an available image connection.');const project=this.project(input.id);fail(project.version===input.version,'save/reopen the current project before asking for an edit.');
  const head=easelHead(project),job={id:easelId('picture'),requestId:input.requestId,projectId:project.id,baseId:head.id,baseVersion:project.version,backend:input.backend,prompt:input.prompt,startedAt:now(),status:'running',result:null};
  const controller=new AbortController(),run={controller,promise:null};this.running.set(job.id,run);
  try{await this.store.transact(s=>{fail(easelProject(s,project.id)?.version===input.version,'project changed before the image request.');fail(!s.easel?.jobs.some(j=>j.status==='running'),'another image request started.');easelState(s).jobs.push(job);return s;});}
  catch(error){this.running.delete(job.id);throw error;}
  run.promise=this.run(job,structuredClone(project),structuredClone(head.doc),backend,controller.signal).finally(()=>this.running.delete(job.id));run.promise.catch(()=>{});
  return structuredClone(job);
 }
 async run(job,project,doc,backend,signal){
  try{
   const base=await this.image(project.id,doc.assetId),marked=await renderGuidance(base,doc,project.width,project.height,{boundary:true});
   const context=await makeViewingFrame(base,project.width,project.height),guidance=await makeViewingFrame(marked,project.width,project.height);
   const prompt=`Edit the supplied clean full-scene image according to this request: ${job.prompt}\nThe second image shows guidance marks${doc.boundary?' and a dashed pink work boundary':''}. Use the entire scene for lighting, perspective and composition. Marks explain the requested change; do not draw the pink boundary or incidental guide lettering into the final art. Preserve the scene framing and the white padding. Return one square image matching the supplied framing. ${doc.boundary?'Focus the change inside the pink boundary; the editor will preserve outside pixels.':'The whole canvas is the work area.'}`;
   const result=await backend.make({prompt,source:context.bytes,guidance:guidance.bytes},signal);signal.throwIfAborted();
   const composed=await compositeProposal(base,result.bytes,doc.boundary,context.transform);const ref=await this.putImage(composed.bytes,project.width,project.height);
   const rawMeta=await sharp(result.bytes,{limitInputPixels:20000000}).metadata();fail(['png','jpeg','webp'].includes(rawMeta.format),'the provider returned an unsupported image type.');const providerResult=await this.images.put(result.bytes,rawMeta.format,{width:rawMeta.width,height:rawMeta.height});
   const report={provider:result.provider??job.backend,billing:result.billing??'test',model:result.model??null,operationId:result.operationId??null,view:'whole_scene',viewSize:1024,transform:context.transform,sourceHash:project.assets.find(a=>a.id===doc.assetId).ref.sha256,guidanceHash:digest({marks:doc.marks,boundary:doc.boundary}),outsidePixelsPreserved:true,edgeBlendInsidePixels:composed.blendPixels,changedPixels:composed.changedPixels,allowedPixels:composed.allowedPixels,estimatedUSD:result.estimatedUSD??null};
   await this.store.transact(s=>{signal.throwIfAborted();const j=s.easel.jobs.find(v=>v.id===job.id);fail(j.status==='running','the image request is no longer active.');j.status='ready';j.result=ref;j.providerResult=providerResult;j.report=report;j.endedAt=now();return s;});
  }catch(error){await this.store.transact(s=>{const j=s.easel.jobs.find(v=>v.id===job.id);if(j?.status==='running'){j.status=signal.aborted?'cancelled':'failed';j.problem=String(error.message).slice(0,600);j.endedAt=now();}return s;});}
 }
 cancel(id){const run=this.running.get(id);fail(run,'this image is no longer running.');run.controller.abort();return {stopping:true};}
 async proposal(id){const j=this.store.state.easel?.jobs.find(j=>j.id===id);fail(j?.result,'this proposal has no saved picture.');return this.images.read(j.result);}
 async decide(input){
  fail(exact(input,['id','version','jobId','accept'])&&typeof input.accept==='boolean','choose Accept or Reject.');
  await this.store.transact(s=>{const p=easelProject(s,input.id),j=s.easel?.jobs.find(j=>j.id===input.jobId);fail(p&&j?.projectId===p.id,'proposal belongs to another project.');
   if(j.status===(input.accept?'accepted':'rejected'))return s;
   fail(j.status==='ready'&&p.version===input.version,'the proposal or current project changed.');
   if(input.accept){fail(p.headId===j.baseId,'you changed the picture while this proposal was made. Undo/restore to that base or make a new request.');const assetId=easelId('asset');p.assets.push({id:assetId,ref:j.result});const doc=easelHead(p).doc;addRevision(p,{assetId,marks:[],boundary:structuredClone(doc.boundary)},{requestId:j.id,label:'AI edit',jobId:j.id,provenance:{...j.report,request:j.prompt,generatedAt:j.endedAt,providerResult:j.providerResult}});p.updatedAt=now();}
   j.status=input.accept?'accepted':'rejected';j.decidedAt=now();return s;
  });return this.view(this.project(input.id));
 }
 async send(input){
  fail(exact(input,['id','chatId','marks'])&&typeof input.marks==='boolean','choose a project and conversation.');assertInferenceIdle(this.store.state);const chat=this.store.state.chats.find(c=>c.id===input.chatId);
  fail(chat&&!chat.archivedAt&&!this.store.state.roots.find(r=>r.id===chat.rootId)?.archivedAt,'choose an active conversation.');fail(activeImageIds(this.store.state,chat.id).length<4,'remove an attached picture before adding this one.');
  const selectedProject=this.project(input.id),sourceHead=selectedProject.headId;
  const bytes=await this.exportPicture(input.id,input.marks),snapshot=await this.images.ingest({name:'Easel.png',base64:bytes.toString('base64'),origin:'pick'});let image;
  await this.store.transact(s=>{assertInferenceIdle(s);fail(easelProject(s,input.id)?.headId===sourceHead,'the picture changed before it could be attached.');image=recordImageSelection(s,chat.id,snapshot);(easelState(s).transfers??=[]).push({id:easelId('transfer'),projectId:input.id,revisionId:sourceHead,chatId:chat.id,imageId:image.id,includeMarks:input.marks,at:now()});return s;});return {image};
 }
 async close(){for(const run of this.running.values())run.controller.abort();await Promise.allSettled([...this.running.values()].map(r=>r.promise));for(const b of Object.values(this.backends))b.close?.();}
}
