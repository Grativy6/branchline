import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {createApp} from '../server/index.mjs';
import {applyCommand} from '../server/domain.mjs';
import {appendPcSettings,recordPcExposure,pcDestination} from '../server/pc-permissions.mjs';
import {atomicJson} from '../server/dream-worker.mjs';

for(const mode of ['event','log'])test(`worker ${mode} failure reaches its caller instead of crashing Node`,()=>{
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('./dream-worker-failure.mjs',import.meta.url)),mode],{encoding:'utf8',timeout:5000,windowsHide:true});
  assert.equal(child.status,3,child.stderr);assert.match(child.stdout,/CAUGHT_BY_CALLER/);assert(!child.stderr.includes('unhandled'));
});

test('Dream preparation honors the actual PC-source destination and older edited-note lineage',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'branchline-dream-sharing-')),runtime=path.join(dir,'runtime.json');
  await atomicJson(runtime,{profile:'branchline.dream-runtime/1',backend:'native',python:'synthetic',basePath:dir,baseRevision:'synthetic'});
  const runner={async open(){return this;},async close(){},status(){return {available:true,busy:false,phase:'idle',contextTokens:8192};},bundledStatus(){return this.status();}};
  let calls=0;
  const app=await createApp({dataDir:path.join(dir,'workspace'),modelOptions:{localRunner:runner,codex:{close(){},async status(){return {connected:false,models:[]};}},dreamOptions:{runtimeFile:runtime,generate:async()=>{calls++;throw new Error('No real provider calls are made by this fixture');}}}});
  try{
    const chat=app.store.state.chats[0],person=app.store.state.personalParticipants[0],local=app.store.state.models[0];
    await app.store.command({type:'model.save',payload:{name:'Synthetic cloud preparer',model:'gpt-6-astra',baseUrl:'codex://chatgpt',runtime:'codex',thinking:false}});
    const cloud=app.store.state.models.at(-1);
    await app.store.command({type:'message.note',payload:{chatId:chat.id,content:'A synthetic restricted source passage.'}});
    const root={id:randomBytes(16).toString('hex'),path:path.join(dir,'restricted'),identity:'00000001:0000000000000001',directory:true,label:'Local-only fixture',write:false,destinations:[pcDestination(local)]};
    await app.store.transact(s=>{appendPcSettings(s,{id:randomBytes(16).toString('hex'),workspaceId:app.store.workspaceId,workspacePath:app.store.dataDir,read:true,write:false,roots:[root],denied:[]},null);recordPcExposure(s,{chatId:chat.id,taskId:'synthetic_read',root,path:path.join(root.path,'source.txt')});return s;});
    const note=await app.dreams.saveNote({kind:'conversation',chatId:chat.id,name:'Marked conversation',focus:'conversation'});
    await app.dreams.saveNote({kind:'manual',noteId:note.noteId,baseRevisionId:note.id,name:'Renamed conversation',focus:'conversation',text:'A synthetic restricted source passage.'});
    await app.dreams.settings({preparerModelId:cloud.id});const run=await app.dreams.start({personalId:person.id});
    for(let i=0;i<300&&app.dreams.active.has(run.id);i++)await delay(10);
    assert.equal(calls,0);assert.equal(app.dreams.run(run.id).status,'interrupted');assert.match(app.dreams.run(run.id).error,/permission|folder|source/i);
  }finally{await app.dispose();}
});
