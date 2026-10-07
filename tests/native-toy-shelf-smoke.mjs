// Native WebView2, real close/reopen, synthetic data; no model or account calls.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { hashFile } from '../scripts/public-release.mjs';
const packageDir=path.resolve('releases',process.argv[2]);assert.equal(path.dirname(packageDir),path.resolve('releases'));
const base=path.resolve(process.env.BRANCHLINE_TEST_ROOT);await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,'native-shelf-')),workspace=path.join(dir,'workspace');
let store=new Store(workspace);await store.open();
await store.command({type:'root.create',payload:{name:'Synthetic packet branch',mode:'personal'}});const chatId=store.state.chats[0].id;
await store.command({type:'ui.update',payload:{welcomeTour:{version:1,completedAt:new Date().toISOString(),skipped:true},toyShelf:{height:360,order:['fs','desk','tend'],hidden:['tend']},settingsSize:{width:820,height:550},sketchSize:{width:880,height:600}}});
await store.command({type:'draft.save',payload:{chatId,text:'Native composer preserved 🌱'}});
await store.command({type:'sketch.save',payload:{id:null,baseRevisionId:null,originChatId:chatId,sourceMessageId:null,title:'Earlier source',text:'Exact native attachment',stage:'ideas',requestId:'native_shelf_seed'}});const sketch=store.state.sketchBook.records[0];
await store.command({type:'sketch.transfer',payload:{id:sketch.id,baseRevisionId:sketch.revisions[0].id,rootId:store.state.roots[0].id,chatId,requestId:'native_shelf_copy'}});
const pending=structuredClone(store.state.sketchBook.pending),runs=[];
for(let i=0;i<2;i++) {
  await fs.writeFile(path.join(dir,'native-expected.json'),JSON.stringify({roots:1,stateSha256:createHash('sha256').update(JSON.stringify(store.state)).digest('hex'),toyShelfHeight:i===0?360:384,closeShelf:i===0,...(i===1?{closeSketch:'Native sketch draft beside the shelf 🎇'}:{})}));await store.close();
  const child=spawn(path.join(packageDir,'Branchline.Preview.exe'),['--smoke-test','--smoke-history','--data-dir',dir],{cwd:packageDir,windowsHide:true,stdio:'ignore'}),timer=setTimeout(()=>child.kill(),60000);
  try {
    const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});const result=JSON.parse(await fs.readFile(path.join(dir,'smoke-result.json'),'utf8'));assert.equal(code,0,JSON.stringify(result));assert.equal(result.backendExit,'graceful');
    await assert.rejects(fs.access(path.join(workspace,'.writer.lock')),{code:'ENOENT'});runs.push(result);
  } finally { clearTimeout(timer); }
  store=new Store(workspace);await store.open();
  assert.deepEqual(store.state.ui.toyShelf,{height:384,order:['desk','peaches'],hidden:[]});
  assert.deepEqual(store.state.ui.settingsSize,{width:820,height:550});assert.deepEqual(store.state.ui.sketchSize,{width:880,height:600});
  assert.equal(store.state.drafts[chatId],'Native composer preserved 🌱');assert.deepEqual(store.state.sketchBook.pending,pending);
  if(i===1) {assert.equal(store.state.ui.sketchDraft.text,'Native sketch draft beside the shelf 🎇');assert.equal(store.state.ui.sketchDraft.originChatId,null);}
}
await store.close();
const report={kind:'REAL_NATIVE_WEBVIEW2_SYNTHETIC_WORKSPACE',status:'PASS',runs,checks:['native shelf artwork and saved order/visibility/height rendered','resize immediately before close flushed','same workspace reopened with exact shelf preference','Settings and Sketch Book dimensions independent','composer and pending sketch copy preserved','new manual sketch draft retained with no accidental origin','graceful shutdown and released writer lock'],executableSha256:await hashFile(path.join(packageDir,'Branchline.Preview.exe'))};
await fs.writeFile(path.join(process.env.BRANCHLINE_REPORT_ROOT,'native-toy-shelf.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
