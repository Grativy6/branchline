import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {Store} from '../server/store.mjs';
import {hashFile} from '../scripts/public-release.mjs';
const packageDir=path.resolve('releases',process.argv[2]);
assert.equal(path.dirname(packageDir),path.resolve('releases'));
const base=path.resolve(process.env.BRANCHLINE_TEST_ROOT);await fs.mkdir(base,{recursive:true});
const dir=await fs.mkdtemp(path.join(base,'native-close-')),workspace=path.join(dir,'workspace');
const store=new Store(workspace);await store.open();
await store.command({type:'root.create',payload:{name:'Synthetic packet branch',mode:'personal'}});
const chatId=store.state.chats[0].id;
await store.command({type:'model.save',payload:{name:'Synthetic never-contacted model',model:'synthetic',baseUrl:'http://127.0.0.1:9/v1'}});
await store.command({type:'root.model',payload:{id:store.state.roots[0].id,modelId:store.state.models[0].id}});
await store.command({type:'ui.update',payload:{welcomeTour:{version:1,completedAt:new Date().toISOString(),skipped:true}}});
const text='Synthetic words typed immediately before native close.';
await fs.writeFile(path.join(dir,'native-expected.json'),JSON.stringify({roots:1,stateSha256:createHash('sha256').update(JSON.stringify(store.state)).digest('hex'),closeDraft:text}));
await store.close();
const child=spawn(path.join(packageDir,'Branchline.Preview.exe'),['--smoke-test','--smoke-history','--data-dir',dir],{cwd:packageDir,windowsHide:true,stdio:'ignore'});
const timer=setTimeout(()=>child.kill(),60000);
try {
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
  const result=JSON.parse(await fs.readFile(path.join(dir,'smoke-result.json'),'utf8'));
  assert.equal(code,0,JSON.stringify(result));assert.equal(result.backendExit,'graceful',JSON.stringify(result));
  await assert.rejects(fs.access(path.join(workspace,'.writer.lock')),{code:'ENOENT'});
  const reopened=new Store(workspace);await reopened.open();
  try {assert.equal(reopened.state.drafts[chatId],text);}finally{await reopened.close();}
  const report={...result,kind:'REAL_NATIVE_WEBVIEW2_WITH_SYNTHETIC_WORKSPACE',checks:['composer input immediately before native Close','native save acknowledgement before backend shutdown','graceful exit without forced termination','writer lock released','exact draft retained after journal reopen'],executableSha256:await hashFile(path.join(packageDir,'Branchline.Preview.exe'))};
  await fs.writeFile(path.join(process.env.BRANCHLINE_REPORT_ROOT,'native-close-draft.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}finally{clearTimeout(timer);}
