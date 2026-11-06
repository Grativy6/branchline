import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {HomeReader} from './home-reader.mjs';
import {readRuntime} from './runtime-paths.mjs';
import {homeSettings,homeAllowed,homeSnapshot,homeDestination,homeRecord,HOME_TOOL_NAMES} from './home-state.mjs';
import {digest} from './integrity.mjs';
import {assertInferenceIdle} from './table.mjs';
const fail=(ok,why)=>{if(!ok)throw new Error('Home: '+why);};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export class Home {
 constructor(store,{runtime=null,runtimePath=process.env.BRANCHLINE_HOME_RUNTIME??null,readerFactory=opts=>new HomeReader(opts)}={}){
  this.store=store;this.runtime=runtime;this.runtimePath=runtimePath;this.readerFactory=readerFactory;this.reader=null;this.readerId=null;this.lastProblem=null;
 }
 async getRuntime(){if(!this.runtime)this.runtime=await readRuntime('home-runtime.json',this.runtimePath);return this.runtime;}
 async readerFor(settings){
  if(this.readerId===settings.id&&this.reader)return this.reader;
  await this.reader?.close();
  const configPath=path.join(this.store.dataDir,'home-reader-'+settings.id+'.json'),bytes=JSON.stringify(settings.config);
  try{await fs.writeFile(configPath,bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST'||await fs.readFile(configPath,'utf8')!==bytes)throw error;}
  this.reader=this.readerFactory({runtime:await this.getRuntime(),configPath,configSha256:crypto.createHash('sha256').update(bytes).digest('hex')});this.readerId=settings.id;return this.reader;
 }
 async status(){let available=true;try{await this.getRuntime();}catch{available=false;}return {available,settings:homeSettings(this.store.state),problem:this.lastProblem,profile:'hearthline.shelf-read/1'};}
 async configure(input){
  fail(exact(input,['baseRevision','enabled','roots','orientation','guidance','modelIds','modelSnapshots']),'use the supported source and sharing choices.');
  assertInferenceIdle(this.store.state);
  fail(typeof input.enabled==='boolean'&&Array.isArray(input.roots)&&input.roots.length>0&&input.roots.length<=8&&Array.isArray(input.orientation)&&input.orientation.length<=8&&Array.isArray(input.modelIds),'choose bounded source locations and recipients.');
  fail(input.guidance===null||exact(input.guidance,['root','path','start_line','line_count']),'choose one explicit guidance passage or none.');
  for(const r of input.roots)fail(r&&Object.keys(r).every(k=>['id','label','path','files'].includes(k))&&typeof r.path==='string'&&path.isAbsolute(r.path),'choose explicit local source folders.');
  const before=homeSettings(this.store.state);fail((before?.id??null)===input.baseRevision,'the source selection changed. Reopen Home before saving.');
  const destinations=input.modelIds.map(id=>{const model=this.store.state.models.find(m=>m.id===id);fail(model,'choose an existing model connection.');return homeDestination(model);});
  fail(digest(destinations)===digest(input.modelSnapshots),'a reviewed connection changed. Reopen Home sharing.');
  const draft={id:'home_'+crypto.randomUUID(),enabled:input.enabled,workspaceId:this.store.workspaceId,workspacePath:this.store.dataDir,config:{profile:'hearthline.shelf-read/1',roots:structuredClone(input.roots),orientation:structuredClone(input.orientation)},guidance:structuredClone(input.guidance),destinations};
  const reader=await this.readerFor(draft);const status=await reader.call('shelf_status');
  fail(status.roots.every(r=>r.available),'one of the selected sources is unavailable. Review the folders shown in Home.');
  draft.id='home_'+crypto.randomUUID();
  draft.config.roots=draft.config.roots.map(r=>({...r,identity:status.roots.find(v=>v.id===r.id).identity}));
  const pinnedReader=await this.readerFor(draft);
  // Freeze the chosen guidance's actual bytes at this deliberate local selection.
  let guidance=null;
  if(input.guidance){guidance=await pinnedReader.call('read_source',{...input.guidance,offset:0,expected_sha256:''});fail(typeof guidance.text==='string'&&!guidance.nextOffset,'choose a guidance passage of at most 12,000 characters.');}
  await this.store.transact(s=>{assertInferenceIdle(s);fail((homeSettings(s)?.id??null)===input.baseRevision,'Home changed before saving.');for(let i=0;i<input.modelIds.length;i++)fail(digest(homeDestination(s.models.find(m=>m.id===input.modelIds[i])))===digest(destinations[i]),'a connection changed.');homeRecord(s,'settings',{...draft,guidanceSnapshot:guidance});return s;});
  return this.status();
 }
 async prepare(chatId,model,signal){
  const h=homeSettings(this.store.state);if(!h?.enabled||!homeSnapshot(this.store.state,model,this.store.workspaceId,this.store.dataDir))return;
  if(this.store.state.home.arrivals.some(a=>a.chatId===chatId&&a.settingsId===h.id))return;
  let home;
  try{home=await (await this.readerFor(h)).call('come_home',{},signal);this.lastProblem=null;}catch(error){this.lastProblem=error.message;return;}
  await this.store.transact(s=>{signal?.throwIfAborted();fail(homeSettings(s)?.id===h.id&&homeAllowed(s,model),'Home selection or sharing changed.');if(!s.home.arrivals.some(a=>a.chatId===chatId&&a.settingsId===h.id)){const chat=s.chats.find(c=>c.id===chatId);homeRecord(s,'arrivals',{chatId,rootId:chat.rootId,settingsId:h.id,home,homeHash:digest(home),guidance:h.guidanceSnapshot});}return s;});
 }
 async invoke(name,args,{contract,model,handoff,signal,guard}){
  fail(HOME_TOOL_NAMES.includes(name)&&contract.work?.home&&handoff.kind==='reply','Home tools need the selected foreground connection.');
  const current=()=>{signal?.throwIfAborted();guard?.();fail(digest(homeSnapshot(this.store.state,model,this.store.workspaceId,this.store.dataDir))===digest(contract.work.home),'Home scope or connection changed.');};
  current();const h=homeSettings(this.store.state);const result=await (await this.readerFor(h)).call(name,args,signal);current();
  await this.store.transact(s=>{current();const chat=s.chats.find(c=>c.id===handoff.scope.chatId);if(!s.home.exposures.some(e=>e.taskId===handoff.taskId&&e.settingsId===h.id))homeRecord(s,'exposures',{chatId:chat.id,rootId:chat.rootId,taskId:handoff.taskId,settingsId:h.id});return s;});return result;
 }
 async close(){await this.reader?.close();this.reader=null;this.readerId=null;}
}
