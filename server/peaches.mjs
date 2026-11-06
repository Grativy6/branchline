import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {PeachesBridge} from './peaches-bridge.mjs';
const MAX=1024*1024;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=(ok,why)=>{if(!ok)throw new Error(why);};
const text=(v,n=200)=>typeof v==='string'&&v.trim().length>0&&v.length<=n;
const op=v=>{fail(typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v),'Invalid Book operation.');return v;};
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const empty=()=>({version:1,objects:{},previews:[],entries:[],associations:[],imports:[],intents:[]});
const book=s=>s.peachesBook??empty();
const writable=s=>s.peachesBook??=empty();
const bytes=value=>Buffer.from(value,'utf8');
const encode=b=>Buffer.from(b).toString('base64');
const decode=s=>{fail(typeof s==='string'&&s.length<=Math.ceil(MAX/3)*4,'Copy exceeds 1 MiB.');const b=Buffer.from(s,'base64');fail(b.length<=MAX&&encode(b)===s,'Invalid encoded copy.');return b;};
const readme='Book of PEACHES — Branchline continuity copy\n\nReadable personal material. A signature does not encrypt it.\ncontinuity.json retains the reviewed account, sources and attribution. manifest.json declares exact payload digests and lineage. The optional stamp signs those manifest bytes. origin.floor.json is a separate historical record.\nA signature checks bytes and the presented key; it gives no provider/tool permissions or guarantee of truth. Import creates a separate local profile. This guide is supporting text, not the signed declaration.\n';

export function validatePeaches(state){
  const b=state.peachesBook;if(!b)return;
  fail(b.version===1&&b.objects&&typeof b.objects==='object'&&['previews','entries','associations','imports','intents'].every(k=>Array.isArray(b[k])),'Invalid Book state.');
  for(const [id,data] of Object.entries(b.objects))fail(hex(id)&&sha(decode(data))===id,'Changed Book object.');
  for(const kind of ['previews','entries','associations','imports','intents']){
    const ids=new Set();for(const item of b[kind]){fail(text(item.id)&&!ids.has(item.id),'Duplicate Book record.');ids.add(item.id);}
  }
  for(const item of [...b.previews,...b.entries])fail(Object.hasOwn(b.objects,item.object)&&hex(item.snapshot),'Missing Book object.');
  for(const a of b.associations){fail(text(a.thread?.id)&&text(a.profileId)&&state.personalContext?.profiles.some(p=>p.id===a.profileId),'Missing continuity profile.');fail(a.personalId===null||state.personalParticipants?.some(p=>p.id===a.personalId),'Missing Personal participant.');}
}
export function preservePeaches(before,after){
  const a=book(before),b=book(after);
  for(const [id,data] of Object.entries(a.objects))fail(b.objects[id]===data,'Saved Book objects are immutable.');
  for(const key of ['previews','entries','associations','imports','intents'])fail(same(a[key],b[key].slice(0,a[key].length)),'Book history is append-only.');
}

function generation(state,participant){
  if(!participant)return null;
  const g=participant.generations.find(g=>g.id===participant.currentGenerationId);
  // Recorded identity and available digests only; no local paths or connection settings.
  return Object.fromEntries(['id','createdAt','baseIdentity','baseRevision','manifestHash','modelIdentifier','sourceStanding','adapter'].map(k=>[k,g[k]??null]).filter(([k])=>k!=='adapter'));
}
export class PeachesBook {
  constructor(store,contexts,options={}){this.store=store;this.contexts=contexts;this.bridge=options.bridge??new PeachesBridge(options);this.running=new Map();}
  serial(id,task){if(this.running.has(id))return this.running.get(id);const p=task().finally(()=>this.running.delete(id));this.running.set(id,p);return p;}
  association(personalId,profileId){return book(this.store.state).associations.findLast(a=>a.personalId===personalId&&a.profileId===profileId);}
  async connection(personalId){
    const s=this.store.state,p=s.personalParticipants?.find(p=>p.id===personalId);fail(p,'Personal participant not found.');
    const a=book(s).associations.findLast(a=>a.personalId===personalId);if(!a)return {personalId,name:p.nickname??p.name,generation:generation(s,p),association:null};
    const detail=await this.contexts.inspect(a.profileId);
    return {personalId,name:p.nickname??p.name,generation:generation(s,p),association:a,profileName:detail.current.content.name,revision:detail.current.operation,reviewedAt:detail.current.at};
  }
  async origin(choice,envelope=null){
    if(!choice||choice==='none')return null;
    fail(['h1','custom'].includes(choice),'Choose a Floor origin or start without an origin.');
    const raw=choice==='h1'?await fs.readFile(new URL('./peaches_runtime/vendor/h1.floor.json',import.meta.url)):decode(envelope);
    if(choice==='h1')fail(sha(raw)==='9c9aa214e73c94a33ccefc8ba85c0fc0155b1ce44b393edfda38380825921b41','H1 source bytes have changed.');
    const report=await this.bridge.call('origin',{envelope:encode(raw)});
    return {ref:{label:choice==='h1'?'H1':'Selected origin',stampId:report.stamp_id,envelopeSha256:sha(raw),issuerId:report.issuer_id},raw};
  }
  async checked(object){const data=book(this.store.state).objects[object];fail(data,'Saved copy not found.');return this.bridge.call('check',{archive:data});}
  async list(){
    const b=book(this.store.state);let signer;
    try{signer=await this.bridge.call('status');}catch(e){signer={error:e.message,configured:false,unlocked:false};}
    // Summaries only; source snapshots are opened deliberately.
    const summaries=new Map();for(const e of b.entries)summaries.set(e.snapshot,e);
    return {entries:[...summaries.values()].reverse(),associations:b.associations,signer,
      previews:b.previews.filter(p=>!b.entries.some(e=>e.previewId===p.id)).slice(-5).reverse(),
      profiles:this.store.state.personalContext?.profiles??[],participants:(this.store.state.personalParticipants??[]).map(p=>({id:p.id,name:p.nickname??p.name,generation:generation(this.store.state,p)}))};
  }
  async view(id){
    const b=book(this.store.state),record=b.entries.find(e=>e.id===id)??b.previews.find(e=>e.id===id);fail(record,'Book entry not found.');
    const result=await this.checked(record.object);const parent=result.manifest.parent;
    return {...result,files:undefined,exactManifest:Buffer.from(result.files['manifest.json'],'base64').toString('utf8'),exactContinuity:Buffer.from(result.files['continuity.json'],'base64').toString('utf8'),originEnvelope:result.files['origin.floor.json']?Buffer.from(result.files['origin.floor.json'],'base64').toString('utf8'):null,record,parentPresent:!parent||b.entries.some(e=>e.snapshot===parent),
      associations:b.associations.filter(a=>a.thread.id===result.manifest.thread.id)};
  }
  async prepare(input){
    const {operation,profileId,personalId=null,title,origin='none',originEnvelope=null,adoptedBy='Local user',predecessorIds=[],relation='checkpoint',parent=null}=input;op(operation);
    fail(Object.keys(input).every(k=>['operation','profileId','personalId','title','origin','originEnvelope','adoptedBy','predecessorIds','relation','parent'].includes(k)),'Unexpected snapshot fields.');
    const inputHash=sha(JSON.stringify(input));
    return this.serial('prepare:'+operation,async()=>{
      const previous=book(this.store.state).previews.find(p=>p.id===operation);
      if(previous){fail(previous.inputHash===inputHash,'This operation already prepared a different version.');return this.view(previous.id);}
      fail(text(title)&&text(adoptedBy)&&['checkpoint','correction'].includes(relation),'Name this version and its adopter.');
      fail(Array.isArray(predecessorIds)&&predecessorIds.length<=64,'Too many predecessor links.');
      const state=this.store.state,person=(state.personalParticipants??[]).find(p=>p.id===personalId);
      fail(personalId===null||person,'Choose an existing Personal participant.');this.contexts.known(profileId);
      // One exporter result supplies the exact reviewed account AND its matching revision.
      const bundle=await this.contexts.export(profileId),continuity=bytes(JSON.stringify(bundle));
      const revision=bundle.history.findLast(e=>['create','accept','import','revise'].includes(e.event))?.operation;
      fail(text(revision),'The selected profile has no reviewed revision.');
      const assoc=this.association(personalId,profileId);
      let originData=null;
      if(assoc?.originObject){const prior=await this.checked(assoc.originObject);originData={ref:assoc.thread.origin,raw:Buffer.from(prior.files['origin.floor.json'],'base64')};}
      else if(assoc){fail(origin==='none'||origin==='h1'&&assoc.thread.origin?.label==='H1','The selected continuity already has its own origin.');}
      else originData=await this.origin(origin,originEnvelope);
      const thread=assoc?.thread??{id:'thread_'+crypto.randomUUID(),origin:originData?.ref??null,predecessors:predecessorIds.map(id=>{const p=(state.personalParticipants??[]).find(p=>p.id===id);fail(p&&p.id!==personalId,'Choose a different existing predecessor.');return {workspace:this.store.workspaceId,participant:p.id,name:p.name,generation:generation(state,p),relationship:'declared_predecessor'};})};
      const currentBook=book(this.store.state);
      // A later signature on an old checkpoint, or opening an older import,
      // does not turn that account back into the newest local revision.
      const latest=currentBook.previews.findLast(p=>p.threadId===thread.id&&currentBook.entries.some(e=>e.snapshot===p.snapshot&&e.source==='local'));
      const parentId=parent??latest?.snapshot??assoc?.fromSnapshot??null;
      if(parent)fail(book(this.store.state).entries.some(e=>e.snapshot===parent&&e.threadId===thread.id),'Choose a parent in this continuing thread.');
      fail(relation!=='correction'||parentId,'A correction needs an earlier version.');
      const manifest={schema:'branchline.peach/1',title,createdAt:new Date().toISOString(),thread,
        source:{workspace:this.store.workspaceId,participant:person?{id:person.id,name:person.name}:null,profile:profileId,revision,generation:generation(state,person),adoptedBy},
        payloads:{'continuity.json':{bytes:continuity.length,sha256:sha(continuity)}},parent:parentId,relation:assoc?.relationship==='branch'&&!latest?'branch':relation};
      const files={'continuity.json':encode(continuity),'README.txt':encode(readme)};
      if(originData){files['origin.floor.json']=encode(originData.raw);manifest.payloads['origin.floor.json']={bytes:originData.raw.length,sha256:sha(originData.raw)};}
      const exact=bytes(JSON.stringify(manifest));files['manifest.json']=encode(exact);
      const {archive}=await this.bridge.call('pack',{files}),object=sha(decode(archive));
      const preview={id:operation,inputHash,object,snapshot:sha(exact),title,at:manifest.createdAt,threadId:thread.id,profileId,personalId,associationId:assoc?.id??null};
      await this.store.transact(s=>{const b=writable(s);b.objects[object]??=archive;b.previews.push(preview);return s;});
      return this.view(operation);
    });
  }
  async save({operation,previewId,stamp=false}){
    op(operation);op(previewId);fail(typeof stamp==='boolean','Invalid signing choice.');
    return this.serial('save:'+operation,async()=>{
      const b=book(this.store.state),prior=b.entries.find(e=>e.operation===operation);
      if(prior){fail(prior.previewId===previewId&&prior.requestedStamp===stamp,'Save operation already used.');return this.view(prior.id);}
      const preview=b.previews.find(p=>p.id===previewId)??b.entries.find(e=>e.id===previewId);fail(preview,'The frozen version is unavailable.');
      let intent=b.intents.find(i=>i.id===operation);
      if(intent)fail(intent.previewId===previewId&&intent.stamp===stamp,'This operation already names another save.');
      else{intent={id:operation,previewId,stamp,nonce:crypto.randomBytes(32).toString('hex'),claimedAt:new Date().toISOString().replace(/\.\d{3}Z$/,'Z')};await this.store.transact(s=>{writable(s).intents.push(intent);return s;});}
      let report=await this.checked(preview.object),files=report.files,archive=b.objects[preview.object];
      if(stamp&&!report.signature){const signed=await this.bridge.call('sign',{files,nonce:intent.nonce,claimedAt:intent.claimedAt});files={...files,'stamp.floor.json':signed.stamp};({archive}=await this.bridge.call('pack',{files}));report=await this.bridge.call('check',{archive});}
      const object=sha(decode(archive));let entry;
      await this.store.transact(s=>{
        const x=writable(s);const found=x.entries.find(e=>e.operation===operation);if(found){entry=found;return s;}
        const src=report.manifest.source;
        const active=x.associations.findLast(a=>a.personalId===(src.participant?.id??null)&&a.profileId===src.profile);
        fail(!active||active.thread.id===report.manifest.thread.id,'This profile gained a continuing-thread connection after the preview. Prepare a new preview to carry that connection.');
        x.objects[object]??=archive;
        entry={id:'peach_'+object,operation,previewId,requestedStamp:stamp,object,snapshot:report.snapshotSha256,title:report.manifest.title,at:report.manifest.createdAt,threadId:report.manifest.thread.id,status:report.status,signatureId:report.signature?.stamp_id??null,envelopeSha256:report.signature?.envelopeSha256??null,parent:report.manifest.parent,relation:report.manifest.relation,source:'local'};
        // Saving identical frozen bytes is idempotent even under a different UI retry.
        const existing=x.entries.find(e=>e.id===entry.id);if(existing)entry=existing;else x.entries.push(entry);
        if(src.workspace===this.store.workspaceId&&!x.associations.some(a=>a.personalId===(src.participant?.id??null)&&a.profileId===src.profile&&a.thread.id===report.manifest.thread.id)){
          x.associations.push({id:'association_'+crypto.randomUUID(),personalId:src.participant?.id??null,profileId:src.profile,thread:report.manifest.thread,originObject:report.origin?object:null,adoptedBy:src.adoptedBy,fromSnapshot:null,relationship:'local',at:new Date().toISOString()});
        }return s;
      });return this.view(entry.id);
    });
  }
  async open({archive}){const report=await this.bridge.call('check',{archive});return {...report,files:undefined,archiveSha256:sha(decode(archive))};}
  async keep({operation,archive}){
    op(operation);const object=sha(decode(archive));
    return this.serial('keep:'+operation,async()=>{
      const b=book(this.store.state),previous=b.entries.find(e=>e.operation===operation);if(previous){fail(previous.object===object,'Import operation already used.');return this.view(previous.id);}
      const r=await this.bridge.call('check',{archive});const existing=b.entries.find(e=>e.object===object);if(existing)return this.view(existing.id);
      const entry={id:'peach_'+object,operation,previewId:null,requestedStamp:false,object,snapshot:r.snapshotSha256,title:r.manifest.title,at:r.manifest.createdAt,threadId:r.manifest.thread.id,status:r.status,signatureId:r.signature?.stamp_id??null,envelopeSha256:r.signature?.envelopeSha256??null,parent:r.manifest.parent,relation:r.manifest.relation,source:'imported'};
      await this.store.transact(s=>{const x=writable(s);x.objects[object]??=archive;if(!x.entries.some(e=>e.id===entry.id))x.entries.push(entry);return s;});return this.view(entry.id);
    });
  }
  async continueHere({operation,id,personalId=null,relationship='continuation',adoptedBy='Local user'}){
    op(operation);fail(['continuation','branch'].includes(relationship)&&text(adoptedBy),'Choose continuation or branch.');
    return this.serial('continue:'+operation,async()=>{
      const b=book(this.store.state),prior=b.imports.find(i=>i.id===operation);
      if(prior){fail(prior.entryId===id&&prior.personalId===personalId&&prior.relationship===relationship,'Continue operation already used.');return prior;}
      const entry=b.entries.find(e=>e.id===id);fail(entry,'Keep this copy in your Book first.');
      fail(personalId===null||this.store.state.personalParticipants?.some(p=>p.id===personalId),'Choose an existing Personal participant.');
      const r=await this.checked(entry.object);
      const {profile}=await this.contexts.create({operation:'peach_'+sha(this.store.workspaceId+operation).slice(0,48),content:null,bundle:r.bundle});
      const thread=structuredClone(r.manifest.thread);
      if(relationship==='branch'){thread.predecessors.push({thread:thread.id,snapshot:r.snapshotSha256,relationship:'branched_from'});thread.id='thread_'+crypto.randomUUID();}
      const record={id:operation,entryId:id,profileId:profile,personalId,relationship,threadId:thread.id,at:new Date().toISOString()};
      await this.store.transact(s=>{const x=writable(s);x.associations.push({id:'association_'+crypto.randomUUID(),personalId,profileId:profile,thread,originObject:r.origin?entry.object:null,adoptedBy,fromSnapshot:r.snapshotSha256,relationship,at:record.at});x.imports.push(record);return s;});
      return record;
    });
  }
  async export(id){const b=book(this.store.state),e=b.entries.find(e=>e.id===id)??b.previews.find(e=>e.id===id);fail(e,'Saved version not found.');await this.checked(e.object);return decode(b.objects[e.object]);}
  signer(action){fail(['status','setup','unlock','lock','backup'].includes(action),'Unknown signing action.');return this.bridge.call(action);}
  close(){return this.bridge.close();}
}
