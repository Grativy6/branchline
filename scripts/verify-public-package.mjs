// Exercise a built package with synthetic local data and a loopback model.
// Does not open the native UI, sign in, load a model, or touch a live workspace.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {hashFile} from './public-release.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const packageDir=path.resolve(process.argv[2]);
const previousDir=process.argv[3]?path.resolve(process.argv[3]):null;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(await fs.readFile(path.join(packageDir,'build-manifest.json'),'utf8'));
for(const row of manifest.files) {
  const file=path.join(packageDir,row.path);
  assert.equal((await fs.stat(file)).size,row.bytes,row.path); assert.equal(await hashFile(file),row.sha256,row.path);
}
const testRoot=process.env.BRANCHLINE_TEST_ROOT||path.join(root,'.test-data'); await fs.mkdir(testRoot,{recursive:true});
const data=await fs.mkdtemp(path.join(testRoot,'v08 café 🌱 '));
let stalled=false,requests=0, backend, model;
const listen=s=>new Promise(resolve=>s.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${s.address().port}`)));
model=http.createServer(async(req,res)=>{
  if(req.url==='/v1/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'preview-fixture'}]}));return;}
  let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);requests++;
  if(!input.stream){res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:'Synthetic reply from the downloaded app.'},finish_reason:'stop'}]}));return;}
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.write('data: '+JSON.stringify({choices:[{delta:{content:'A streamed synthetic reply.'}}]})+'\n\n');
  if(stalled)return;
  res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
});
const modelUrl=await listen(model);
async function start(workspace=path.join(data,'workspace'), app=packageDir) {
  const env={...process.env,BRANCHLINE_DATA_DIR:workspace,BRANCHLINE_PUBLIC_DIR:path.join(app,'public')};
  delete env.BRANCHLINE_SETUP_APERTUS;delete env.BRANCHLINE_SETUP_HEARTHLINE;delete env.NODE_OPTIONS;
  const child=spawn(path.join(app,'node.exe'),[path.join(app,'server/desktop.mjs')],{cwd:app,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  child.stderr.resume();
  const exited=once(child,'exit');
  const lines=createInterface({input:child.stdout});
  const ready=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new Error('Package startup timed out'));},30000);
    child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(new Error('Package exited before ready: '+code));});
    lines.on('line',line=>{const event=JSON.parse(line);if(event.type==='ready'){clearTimeout(timer);resolve(event);}});
  });
  const call=async(route,body)=>{const res=await fetch(ready.url+route,{method:body===undefined?'GET':'POST',headers:{'x-branchline-session':ready.sessionToken,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:res.status,body:await res.json()};};
  const stop=async()=>{child.stdin.end('shutdown\n');const code=await Promise.race([exited.then(r=>r[0]),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Shutdown timed out')),20000);timer.unref();})]);assert.equal(code,0);};
  return {child,ready,call,stop};
}
try {
  if(previousDir) {
    const legacyPath=path.join(data,'legacy-workspace');
    backend=await start(legacyPath,previousDir);
    const cmd=async(type,payload)=>{const r=await backend.call('/api/command',{type,payload});assert.equal(r.status,200);return r.body;};
    let old=await cmd('root.create',{name:'Legacy workspace kept',mode:'personal'});
    const legacyChat=old.chats.at(-1).id,legacyRoot=old.roots.at(-1).id;
    old=await cmd('model.save',{name:'Existing choice',model:'preview-fixture',baseUrl:modelUrl+'/v1'});
    await cmd('root.model',{id:legacyRoot,modelId:old.models.find(m=>m.model==='preview-fixture').id});
    assert.equal((await backend.call('/api/exchange',{chatId:legacyChat,content:'A conversation from the previous release.'})).status,200);
    const legacyState=(await backend.call('/api/state')).body;await backend.stop();backend=null;
    backend=await start(legacyPath);assert.deepEqual((await backend.call('/api/state')).body,legacyState,'Upgrade must retain the existing model and chat');await backend.stop();backend=null;
    backend=await start(legacyPath,previousDir);assert.deepEqual((await backend.call('/api/state')).body,legacyState);await backend.stop();backend=null;
  }
  backend=await start();const first=await backend.call('/api/state');
  const bundled=await fs.access(path.join(packageDir,'bundled-model/manifest.json')).then(()=>true,()=>false);
  assert.equal(first.status,200);assert.equal(first.body.models.length,bundled?1:0);assert.equal(first.body.roots.length,bundled?1:0);assert.equal(requests,previousDir?1:0);
  assert.equal((await fetch(backend.ready.url+'/api/state')).status,401);
  const index=await (await fetch(backend.ready.url+'/licenses/index.json')).json();
  assert.equal(index.version,manifest.version);
  for(const group of index.groups)for(const doc of group.documents){const res=await fetch(backend.ready.url+'/licenses/'+doc.file);assert(res.ok);assert.equal(sha(Buffer.from(await res.arrayBuffer())),doc.sha256);}
  const signedOut=await backend.call('/api/codex/status');assert.equal(signedOut.status,200);assert.equal(signedOut.body.connected,false);
  const command=async(type,payload)=>{const r=await backend.call('/api/command',{type,payload});assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
  let state=await command('root.create',{name:'Fresh preview desk',mode:'personal'});
  const chatId=state.chats.at(-1).id, rootId=state.roots.at(-1).id;
  state=await command('model.save',{name:'Loopback fixture',model:'preview-fixture',baseUrl:modelUrl+'/v1'});
  await command('root.model',{id:rootId,modelId:state.models.find(m=>m.model==='preview-fixture').id});
  assert.equal((await backend.call('/api/models/discover',{baseUrl:modelUrl+'/v1'})).status,200);
  const reply=await backend.call('/api/exchange',{chatId,content:'A synthetic first conversation.'});assert.equal(reply.status,200);assert.equal(reply.body.exchanges.at(-1).status,'completed');
  stalled=true;
  const streaming=await fetch(backend.ready.url+'/api/exchange',{method:'POST',headers:{'x-branchline-session':backend.ready.sessionToken,'content-type':'application/json'},body:JSON.stringify({chatId,content:'Stop this synthetic reply.',stream:true})});
  const reader=streaming.body.getReader();let wire='';
  while(!wire.includes('event: delta')){const next=await reader.read();assert(!next.done);wire+=new TextDecoder().decode(next.value);}
  assert.equal((await backend.call('/api/cancel',{chatId})).status,200);
  while(true){const next=await reader.read();if(next.done)break;wire+=new TextDecoder().decode(next.value);}
  assert(wire.includes('stopped')); stalled=false;
  // Use the packaged native decoder, then verify original bytes survive recovery.
  const sharp=createRequire(path.join(packageDir,'package.json'))('sharp');
  const png=await sharp({create:{width:1400,height:700,channels:3,background:'#347a58'}}).png().toBuffer();
  const picture=await backend.call('/api/images/select',{chatId,image:{name:'garden.png',origin:'pick',base64:png.toString('base64')}});
  assert.equal(picture.status,201,JSON.stringify(picture.body));assert.equal(picture.body.image.view.width,1024);
  assert.equal(picture.body.image.original.sha256,sha(png));
  assert.equal((await backend.call('/api/images/context',{chatId,ids:[]})).status,200);
  const after=(await backend.call('/api/state')).body;
  assert.notEqual(after.exchanges.at(-1).status,'completed');
  const exported=(await backend.call('/api/export')).body;assert.equal(exported.state.messages.length,after.messages.length);
  const backup=await backend.call('/api/storage/backup',{});assert.equal(backup.status,201);
  const restored=await backend.call('/api/storage/restore-copy',{id:backup.body.backup.id});assert.equal(restored.status,201);
  await backend.stop();backend=null;
  backend=await start();const reopened=(await backend.call('/api/state')).body;assert.deepEqual(reopened.messages,after.messages);
  await backend.stop();backend=null;
  backend=await start(restored.body.restoredPath);assert.deepEqual((await backend.call('/api/state')).body.messages,after.messages);
  const recoveredExport=(await backend.call('/api/export')).body;
  assert.deepEqual(recoveredExport.state.messages,exported.state.messages);
  assert.equal(sha(Buffer.from(JSON.stringify(recoveredExport.imageObjects))),sha(Buffer.from(JSON.stringify(exported.imageObjects))),'Recovered image objects changed');
  await backend.stop();backend=null;
  if(previousDir && !bundled) {
    backend=await start(path.join(data,'workspace'),previousDir);
    assert.deepEqual((await backend.call('/api/state')).body.messages,after.messages);
    await backend.stop();backend=null;
    backend=await start();assert.deepEqual((await backend.call('/api/state')).body.messages,after.messages);
    await backend.stop();backend=null;
  }
  // A missing local server must not strand Settings or erase the conversation.
  model.closeAllConnections();await new Promise(resolve=>model.close(resolve));model=null;
  backend=await start();const missing=await backend.call('/api/exchange',{chatId,content:'The local server is unavailable.'});assert.equal(missing.status,502);assert.equal((await backend.call('/api/state')).status,200);
  await backend.stop();backend=null;
  for(const row of manifest.files)assert.equal(await hashFile(path.join(packageDir,row.path)),row.sha256,'App files changed during use: '+row.path);
  const report={status:'PASS',version:manifest.version,filesVerified:manifest.files.length,notices:index.groups.reduce((n,g)=>n+g.documents.length,0),syntheticOnly:true,modelRequests:requests,previousVersionReopen:previousDir?(bundled?'PASS_FOR_EXISTING_LEGACY_WORKSPACE':'PASS'):'NOT_RUN',newBundledWorkspaceDowngrade:bundled?'UNSUPPORTED_BY_0.8.0_RESTORE_A_BACKUP':'NOT_APPLICABLE',
    checks:['fresh workspace defaults without model loading','unpaired request refused','offline licence bytes verified','isolated ChatGPT connection signed out','local model discovery','conversation saved','streaming and cancellation','native image decoding and resizing','image bytes survive export and recovery','restart preserves messages','backup and separately reopened recovery','unavailable local model leaves workspace readable','Unicode and spaces in data path','app files unchanged','owned backend shuts down'],
    limits:['Backend and packaged dependency checks on the development PC; not native-window or fresh-Windows qualification.','No live provider inference, authentication completion, or GPU benchmark.']};
  const reportFolder=path.resolve(process.env.BRANCHLINE_TEST_REPORT || path.join(process.env.BRANCHLINE_REPORT_ROOT||path.join(root,'test-results'),manifest.version));
  await fs.mkdir(reportFolder,{recursive:true});await fs.writeFile(path.join(reportFolder,'package-journey.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally {if(backend)await backend.stop();if(model){model.closeAllConnections();await new Promise(resolve=>model.close(resolve));}}
