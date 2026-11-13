import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { canonical, digest } from './integrity.mjs';

const context=new AsyncLocalStorage(),heads=new Map(),readers=new Map();
const PROFILE='branchline.input-reference/1',MANIFEST='branchline.input-manifest/1';
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const fail=(ok,message)=>{if(!ok)throw new Error('Saved input: '+message);};
export const isInputRef=v=>v?.profile===PROFILE;
export function inputHash(value){
  if(!isInputRef(value))return digest(value);
  fail(Object.keys(value).sort().join(',')==='contentHash,count,profile,sha256'&&hex(value.sha256)&&hex(value.contentHash)&&Number.isSafeInteger(value.count)&&value.count>=0,'invalid input reference.');
  return value.contentHash;
}
function manifestFor(messages){return {profile:MANIFEST,contentHash:digest(messages),messages:messages.map(digest)};}
function remember(ref,messages){
  fail(Array.isArray(messages)&&messages.length===ref.count&&digest(messages)===inputHash(ref)&&digest(manifestFor(messages))===ref.sha256,'input contents differ from their saved reference.');
  if(heads.size>=20000)heads.delete(heads.keys().next().value);
  heads.set(ref.sha256,{contentHash:ref.contentHash,head:messages[0]??null});return messages;
}
export function readInput(value,reader=context.getStore()){
  if(!isInputRef(value))return value;
  reader??=readers.get(value.sha256)?.deref();fail(reader,'the input reader is unavailable.');return reader.read(value);
}
export function firstInput(value){
  if(!isInputRef(value))return value?.[0];
  const cached=heads.get(value.sha256);
  if(cached?.contentHash===inputHash(value))return cached.head;
  return readInput(value)?.[0];
}
export function saveInput(messages){return context.getStore()?.save?context.getStore().save(messages):messages;}
export function originalReceipt(record,reader=context.getStore()){
  if(record.storageEncoding!=='branchline.legacy-input-reference/1')return record;
  const {storageEncoding,...original}=record;
  return {...original,detail:{...record.detail,inputMessages:readInput(record.detail.inputMessages,reader)}};
}
export function receiptDigest(record){const original=originalReceipt(record),{hash,...body}=original;return digest(body);}
export function inputReferences(state){return (state.handoffs?.records??[]).map(r=>r.detail?.inputMessages).filter(isInputRef);}
export const validHistoryFile=name=>/^history\/objects\/[a-f0-9]{64}\.json$/.test(name);

export class HistoryInputs {
  constructor(directory){this.directory=directory;this.pending=new Map();this.cache=new Map();this.cacheBytes=0;this.verified=new Set();}
  run(operation){return context.run(this,operation);}
  put(value){const bytes=canonical(value),sha256=digest(value);if(!this.verified.has(sha256))this.pending.set(sha256,bytes);return sha256;}
  save(messages){
    fail(Array.isArray(messages),'messages must be an array.');
    const manifest=manifestFor(messages);for(const m of messages)this.put(m);
    const ref={profile:PROFILE,sha256:this.put(manifest),contentHash:manifest.contentHash,count:messages.length};remember(ref,messages);readers.set(ref.sha256,new WeakRef(this));return ref;
  }
  object(id){
    fail(hex(id),'invalid object name.');
    if(this.cache.has(id))return this.cache.get(id).value;
    const raw=this.pending.get(id)??readFileSync(path.join(this.directory,'history','objects',id+'.json'),'utf8');
    fail(raw.length<=128*1024*1024,'one input object is too large.');
    const value=JSON.parse(raw);fail(canonical(value)===raw&&digest(value)===id,'saved object changed or is incomplete.');
    while(this.cacheBytes+raw.length>8*1024*1024&&this.cache.size){const first=this.cache.keys().next().value;this.cacheBytes-=this.cache.get(first).size;this.cache.delete(first);}
    if(raw.length<=8*1024*1024){this.cache.set(id,{value,size:raw.length});this.cacheBytes+=raw.length;}
    this.verified.add(id);return value;
  }
  read(ref){readers.set(ref.sha256,new WeakRef(this));const manifest=this.object(ref.sha256);fail(manifest.profile===MANIFEST&&Array.isArray(manifest.messages),'invalid manifest.');return remember(ref,manifest.messages.map(id=>this.object(id)));}
  async flush(){
    if(!this.pending.size)return;const folder=path.join(this.directory,'history','objects');await fs.mkdir(folder,{recursive:true});
    for(const [id,text] of this.pending){
      const target=path.join(folder,id+'.json');let handle;
      try{handle=await fs.open(target,'wx',0o600);await handle.writeFile(text);await handle.sync();}
      catch(e){if(e.code!=='EEXIST')throw e;const saved=await fs.readFile(target,'utf8');fail(saved===text,'an existing input object differs.');}
      finally{await handle?.close();}
      this.verified.add(id);this.pending.delete(id);
    }
  }
  verifyState(state){for(const ref of new Map(inputReferences(state).map(r=>[r.sha256,r])).values())this.read(ref);}
  files(state){const ids=new Set();for(const ref of inputReferences(state)){ids.add(ref.sha256);for(const id of this.object(ref.sha256).messages)ids.add(id);}return [...ids].sort().map(id=>'history/objects/'+id+'.json');}
  migrate(state){
    let count=0;
    const records=state.handoffs?.records;if(!records)return 0;
    for(let i=0;i<records.length;i++){const r=records[i];if(r.kind!=='context.to_model'||!Array.isArray(r.detail.inputMessages))continue;
      records[i]={...r,detail:{...r.detail,inputMessages:this.save(r.detail.inputMessages)},storageEncoding:'branchline.legacy-input-reference/1'};count++;
    }if(count)state.schemaVersion=Math.max(4,state.schemaVersion);return count;
  }
  material(records){const values={};for(const r of records){const ref=r.detail?.inputMessages;if(isInputRef(ref))values[ref.sha256]=this.read(ref);}return values;}
}

export function withInputMaterial(material,operation){
  const reader={read(ref){fail(Object.hasOwn(material,ref.sha256),'packet omits its saved input.');return remember(ref,material[ref.sha256]);}};
  return context.run(reader,operation);
}
export function currentInputReader(){return context.getStore();}
