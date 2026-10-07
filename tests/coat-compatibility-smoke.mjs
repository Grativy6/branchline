// Verify against a preserved prior public package, with synthetic data only.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createApp} from '../server/index.mjs';
import {listen} from './helpers.mjs';
import {turnOptions} from '../public/table.js';
import {POCKET_PROFILE, BUILTIN_PROVIDER} from '../public/coat-pockets.js';
const previous=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);await fs.mkdir(out,{recursive:true});await fs.mkdir('.test-data',{recursive:true});
const {createApp:createOldApp}=await import(pathToFileURL(path.join(previous,'server/index.mjs')));
const {validateState:validateOld}=await import(pathToFileURL(path.join(previous,'server/domain.mjs')));
const dir=await fs.mkdtemp(path.resolve('.test-data/coats-upgrade-')),dataDir=path.join(dir,'workspace');let app;
const provider=http.createServer(async(req,res)=>{for await(const ignored of req){};res.setHeader('content-type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{delta:{content:'Synthetic recorded response.'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');});
const modelUrl=await listen(provider);let url,headers;
const call=async(route,body)=>{const res=await fetch(url+route,{method:'POST',headers,body:JSON.stringify(body)});const value=await res.json();assert(res.ok,value.error);return value;};
const command=(type,payload)=>call('/api/command',{type,payload});
try {
 app=await createOldApp({dataDir});url=await listen(app);headers={'x-branchline-session':app.sessionToken,'content-type':'application/json'};
 await command('root.create',{name:'Old synthetic workspace',mode:'personal'});const chatId=app.store.state.chats.at(-1).id,rootId=app.store.state.roots.at(-1).id;
 await command('model.save',{name:'Synthetic model',model:'synthetic',baseUrl:modelUrl+'/v1'});await command('root.model',{id:rootId,modelId:app.store.state.models.at(-1).id});
 await command('table.assign',{chatId,baseRevisionId:null,personalId:null,visitorModelId:app.store.state.models.at(-1).id});
 await command('harness.create',{content:{name:'Legacy coat',description:'',instructions:'Keep this original text exactly.'},use:{chatId,baseRevisionId:null,seat:'shared'}});
 await call('/api/exchange',{chatId,content:'Preserve this old exchange.',toolsEnabled:true,...turnOptions(app.store.state,app.store.state.chats.find(c=>c.id===chatId),'visiting')});
 const before=structuredClone(app.store.state),old=before.exchanges[0];
 assert.equal(before.handoffs.records.find(r=>r.id===old.handoff.requestId).detail.task.capability.tools.profile,'branchline.conversation-tools/2');
 await app.dispose();app=await createApp({dataDir});url=await listen(app);headers={'x-branchline-session':app.sessionToken,'content-type':'application/json'};
 assert.deepEqual(app.store.state.exchanges,before.exchanges);assert.deepEqual(app.store.state.handoffs,before.handoffs);assert.deepEqual(app.store.state.customHarnesses,before.customHarnesses);
 const id=app.store.state.customHarnesses[0].id;
 await command('harness.revise',{id,baseVersion:1,content:{name:'Clock coat',description:'',instructions:'',pockets:{profile:POCKET_PROFILE,selected:[{tool:'read_clock',provider:BUILTIN_PROVIDER}]}},use:{chatId,baseRevisionId:app.store.state.chats.find(c=>c.id===chatId).harnessSelections.at(-1).id,seat:'shared'}});
 await call('/api/exchange',{chatId,content:'A new exchange.',toolsEnabled:true,...turnOptions(app.store.state,app.store.state.chats.find(c=>c.id===chatId),'visiting')});
 assert.deepEqual(app.store.state.exchanges[0],old);assert.throws(()=>validateOld(structuredClone(app.store.state)),/harness|format|field|custom|invalid/i);
 const report={status:'PASS',syntheticOnly:true,workspace:dir,checks:['real 0.8.1 tools/2 receipt','legacy saved instructions preserved','exact prior reply and handoff evidence preserved','new pocket revision works','older validator rejects new records: pre-update backup needed for rollback']};await fs.writeFile(path.join(out,'compatibility.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally {await app?.dispose();provider.closeAllConnections();await new Promise(r=>provider.close(r));}
