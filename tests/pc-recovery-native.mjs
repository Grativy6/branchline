// Windows service/native integration, using NEW synthetic directories only.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {PcFiles} from '../server/pc-files.mjs';
import {pcDestination,pcSnapshot} from '../server/pc-permissions.mjs';
import {initialState,applyCommand,validateState} from '../server/domain.mjs';

assert.equal(process.platform,'win32');
const [executable,workspace,notes,output]=process.argv.slice(2);
assert(executable&&workspace&&notes&&output,'Supply native executable, fresh workspace, fresh notes folder and receipt.');
await fs.mkdir(workspace);await fs.mkdir(notes);
const store={dataDir:path.resolve(workspace),workspaceId:crypto.randomBytes(16).toString('hex'),state:initialState(),
  async transact(fn){const next=fn(structuredClone(this.state));validateState(next);this.state=next;}};
await store.transact(s=>applyCommand(s,{type:'root.create',payload:{name:'Recovery qualification',mode:'personal'}}));
await store.transact(s=>applyCommand(s,{type:'model.save',payload:{name:'Fixture',model:'fixture',runtime:'compatible',baseUrl:'http://127.0.0.1:1/v1',thinking:false}}));
const model=store.state.models[0],chatId=store.state.chats[0].id,pc=new PcFiles(store,{executable});
await pc.configure({baseRevision:null,read:true,write:true,roots:[{id:null,path:notes,label:'Synthetic notes',write:true,modelIds:[model.id],modelSnapshots:[pcDestination(model)]}],denied:[],removeDenied:[]});
await fs.mkdir(pc.recovery);
const physicalRecovery=await fs.realpath(pc.recovery),remapped=physicalRecovery.toLowerCase()!==pc.recovery.toLowerCase();
let logicalError=null;
try{await pc.native({mode:'inspect',path:pc.recovery,directory:true});}catch(error){logicalError=error.message;}
if(remapped)assert.match(logicalError,/alias or remapped/);
const root=store.state.pcAccess.settings.at(-1).roots[0].id;
const context={model,contract:{pc:pcSnapshot(store.state,model,store.workspaceId,true,store.dataDir)},
  handoff:{kind:'reply',taskId:'synthetic-recovery-check',scope:{chatId}},signal:new AbortController().signal,
  guard(){},async prepared(){},onWait(){waited++;}};
let waited=0;
const originals=['one','two','three'].map(name=>({name:name+'.md',text:`Synthetic ${name} recovery check.\n`}));
for(const file of originals)await fs.writeFile(path.join(notes,file.name),file.text,{flag:'wx'});
const reads=await Promise.all(originals.map(file=>pc.invoke('read_pc_text',{root,path:file.name,offset:0},context)));
const edits=await Promise.all(reads.map((read,i)=>pc.invoke('edit_pc_text',{root,path:originals[i].name,identity:read.identity,sha256:read.sha256,old_text:originals[i].text,text:originals[i].text+'I was here - fixture\n'},context)));
for(let i=0;i<edits.length;i++){
  assert(edits[i].edited);assert.equal(await fs.readFile(path.join(notes,originals[i].name),'utf8'),originals[i].text+'I was here - fixture\n');
  assert.equal(await fs.readFile(path.join(physicalRecovery,edits[i].recoveryId+'.original'),'utf8'),originals[i].text);
}
await assert.rejects(pc.invoke('edit_pc_text',{root,path:originals[0].name,identity:reads[0].identity,sha256:reads[0].sha256,old_text:originals[0].text,text:'Stale overwrite'},context));
assert.equal(await fs.readFile(path.join(notes,originals[0].name),'utf8'),originals[0].text+'I was here - fixture\n');
const result={status:'PASS',workspace,notes,recovery:pc.recovery,physicalRecovery,remapped,originalLogicalInspectionError:logicalError,
  edits:edits.length,originalBytesRecovered:true,staleEditRejected:true,queuedOperations:waited,modelCalls:0,originalUserHuntChanged:false};
await fs.writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
