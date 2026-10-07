import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {Store} from '../server/store.mjs';
import {dreamRevision} from '../server/dream-history.mjs';
import {hashFile} from '../scripts/public-release.mjs';
const pkg=path.resolve('releases',process.argv[2]);assert.equal(path.dirname(pkg),path.resolve('releases'));
const base=path.resolve(process.env.BRANCHLINE_TEST_ROOT);await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,'native-dream-')),workspace=path.join(dir,'workspace');
let store=new Store(workspace);await store.open();
await store.command({type:'root.create',payload:{name:'Synthetic packet branch',mode:'personal'}});const chatId=store.state.chats[0].id;
await store.command({type:'model.save',payload:{name:'Synthetic no-call model',model:'synthetic',baseUrl:'http://127.0.0.1:1/v1'}});
await store.command({type:'personal.create',payload:{name:'Aster',modelId:store.state.models[0].id,baseIdentity:'synthetic/base'}});const personalId=store.state.personalParticipants[0].id;
await store.command({type:'dream.record',payload:{personalId,baseRevision:dreamRevision(store.state),topic:'Native synthetic journal',occurredAt:null,summary:'A local interface check.',observations:'No training or model call.',outcome:'unrecorded',modelId:null,sources:[]}});const dreamId=store.state.dreamHistory.records[0].id;
await store.command({type:'ui.update',payload:{welcomeTour:{version:1,skipped:true,completedAt:new Date().toISOString()}}});
await store.command({type:'draft.save',payload:{chatId,text:'Unsent native composer 🌱'}});
const runs=[],text='My unfinished Dream note 🎇';
for(let i=0;i<2;i++){
  await fs.writeFile(path.join(dir,'native-expected.json'),JSON.stringify({roots:1,stateSha256:createHash('sha256').update(JSON.stringify(store.state)).digest('hex'),dreamPersonalId:personalId,dreamRecordId:dreamId,...(i===0?{closeDreamNote:text}:{expectedDreamDraft:text})}));await store.close();
  const child=spawn(path.join(pkg,'Branchline.Preview.exe'),['--smoke-test','--smoke-history','--data-dir',dir],{cwd:pkg,windowsHide:true,stdio:'ignore'}),timer=setTimeout(()=>child.kill(),60000);
  try {const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});const result=JSON.parse(await fs.readFile(path.join(dir,'smoke-result.json'),'utf8'));assert.equal(code,0,JSON.stringify(result));assert.equal(result.backendExit,'graceful');runs.push(result);}finally{clearTimeout(timer);}
  store=new Store(workspace);await store.open();assert.equal(store.state.ui.dreamDraft.text,text);assert.equal(store.state.ui.dreamSize.width,938);assert.equal(store.state.drafts[chatId],'Unsent native composer 🌱');assert.equal(store.state.dreamHistory.notes.length,0);
}
await store.close();const report={status:'PASS',kind:'REAL_NATIVE_WEBVIEW2_SYNTHETIC_WORKSPACE',runs,workspace,checks:['Dream journal rendered in native window','close flushes unfinished note and size','same workspace reopen restores exact note','composer draft and original account preserved','no model calls'],executableSha256:await hashFile(path.join(pkg,'Branchline.Preview.exe'))};
await fs.writeFile(path.join(process.env.BRANCHLINE_TEST_REPORT,'native-dream.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
