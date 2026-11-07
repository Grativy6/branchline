import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CodexProvider} from '../server/codex-provider.mjs';
import {CODEX_CONFIG,CODEX_VERSION,CODEX_ADDRESS,codexArgs,verifyCodexConfig} from '../server/codex-policy.mjs';
import {syncCodexModels} from '../server/codex-models.mjs';
import {fixture} from './desk-helpers.mjs';

const configuration=()=>({config:{...structuredClone(CODEX_CONFIG),chatgpt_base_url:'https://chatgpt.com/backend-api/'},layers:[{name:{type:'sessionFlags'},config:structuredClone(CODEX_CONFIG)}]});
class Rpc extends EventEmitter {
  closed=false; calls=[]; account={type:'chatgpt',email:'fixture@example.test',planType:'plus'};
  pages=[{data:[{model:'gpt-fixture-one',displayName:'Fixture One',isDefault:true}]}]; error=false;
  async request(method,params){
    this.calls.push({method,params});
    if(method==='initialize')return {userAgent:'codex/'+CODEX_VERSION};
    if(method==='config/read')return configuration();
    if(method==='account/read')return {account:this.account};
    if(method==='account/rateLimits/read')return {};
    if(method==='model/list'){
      if(this.error)throw new Error('Unavailable');
      assert.equal(params.includeHidden,false);
      return this.pages[Number(params.cursor??0)];
    }
    throw new Error('Unexpected RPC: '+method);
  }
  notify(){}
  close(){this.closed=true;this.emit('disconnected');}
}
async function provider(){const rpc=new Rpc(),dir=await fs.mkdtemp(path.join(os.tmpdir(),'branchline-model-list-'));let now=1000;const instance=new CodexProvider({accountDir:dir,rpcFactory:()=>rpc,binaryResolver:async()=>'/fixture/codex',clock:()=>now});return {rpc,instance,advance(){now+=300001;}};}

test('subscription discovery uses provider models while retaining the existing capability floor',()=>{
  assert(!codexArgs().some(x=>x.startsWith('model_catalog_json=')));
  assert.equal(CODEX_CONFIG.cli_auth_credentials_store,'keyring');
  assert.equal(CODEX_CONFIG.features.shell_tool,false);
  assert.equal(CODEX_CONFIG.approval_policy,'never');
  verifyCodexConfig(configuration());
  const inherited=configuration();inherited.config.model_catalog_json='/inherited/catalog.json';
  assert.throws(()=>verifyCodexConfig(inherited),/held/);
});
test('all visible provider pages are refreshed and duplicate or hidden models are omitted',async()=>{
  const p=await provider();try{
    p.rpc.pages=[{data:[{model:'gpt-fixture-one',displayName:'One'},{model:'hidden',hidden:true}],nextCursor:'1'},
      {data:[{model:'gpt-fixture-two',displayName:'Two'},{model:'gpt-fixture-one',displayName:'Duplicate'}],nextCursor:null}];
    const first=await p.instance.status();assert(first.connected);assert.deepEqual(first.models.map(m=>m.id),['gpt-fixture-one','gpt-fixture-two']);
    p.rpc.pages=[{data:[{model:'gpt-newly-offered',displayName:'Newly Offered'}]}];
    assert.equal((await p.instance.status()).models.length,2);
    assert.deepEqual((await p.instance.status({refresh:true})).models.map(m=>m.id),['gpt-newly-offered']);
    p.rpc.pages=[{data:[{model:'gpt-next',displayName:'Next'}]}];p.advance();
    assert.equal((await p.instance.status()).models[0].id,'gpt-next');
  }finally{p.instance.close();}
});
test('catalog failure retains connected status and the last list; account changes invalidate it',async()=>{
  const p=await provider();try{
    await p.instance.status();p.rpc.error=true;
    const stale=await p.instance.status({refresh:true});assert(stale.connected);assert(stale.error);assert.equal(stale.models.length,1);
    p.rpc.account={type:'chatgpt',email:'other@example.test',planType:'pro'};
    const changed=await p.instance.status();assert(changed.connected);assert(changed.error);assert.deepEqual(changed.models,[]);
    p.rpc.account=null;
    const out=await p.instance.status();assert.equal(out.connected,false);assert.deepEqual(out.models,[]);
  }finally{p.instance.close();}
});
test('an account update cannot publish a late list for the previous account',async()=>{
  const p=await provider();try{
    await p.instance.account();let resolve;
    const original=p.rpc.request.bind(p.rpc);
    p.rpc.request=(method,params)=>method==='model/list'?new Promise(r=>{resolve=r;}):original(method,params);
    const pending=p.instance.catalogue();
    while(!resolve)await new Promise(r=>setImmediate(r));
    p.rpc.emit('notification',{method:'account/updated',params:{}});
    resolve({data:[{model:'old-account-model',displayName:'Old account'}]});
    await assert.rejects(pending,/account changed/);assert.deepEqual(p.instance.models,[]);
  }finally{p.instance.close();}
});
test('automatic registration is idempotent and preserves saved identities, chairs and history',async()=>{
  const f=await fixture();try{
    await f.command('model.save',{name:'My named Astra',model:'gpt-fixture-one',baseUrl:CODEX_ADDRESS,runtime:'codex',thinking:false});
    const prior=structuredClone(f.app.store.state),saved=prior.models.find(m=>m.runtime==='codex');
    const status={connected:true,models:[{id:'gpt-fixture-one',name:'Renamed upstream'},{id:'gpt-fixture-two',name:'Two'},{id:'gpt-fixture-two',name:'Duplicate'},{id:'hidden',hidden:true,name:'Hidden'}]};
    const results=await Promise.all([syncCodexModels(f.app.store,status),syncCodexModels(f.app.store,status)]);
    assert.equal(results.reduce((n,r)=>n+r.added,0),1);
    assert.deepEqual(f.app.store.state.models.find(m=>m.id===saved.id),saved);
    assert.equal(f.app.store.state.models.filter(m=>m.runtime==='codex').length,2);
    for(const key of ['roots','chats','messages','personalParticipants','modelArchives'])assert.deepEqual(f.app.store.state[key],prior[key]);
    assert.equal((await syncCodexModels(f.app.store,status)).added,0);
    assert.equal((await syncCodexModels(f.app.store,{...status,error:'List unavailable',models:[{id:'not-current',name:'Held'}]})).added,0);
    assert.equal((await syncCodexModels(f.app.store,{connected:false,models:[{id:'not-signed-in',name:'Held'}]})).added,0);
  }finally{await f.close();}
});
test('model sync uses only the server connection catalog and requires the private app session',async()=>{
  const codex={close(){},async status(){return {connected:true,account:{plan:'plus'},models:[{id:'gpt-from-connection',name:'From connection'}]};}};
  const f=await fixture({codex});try{
    await new Promise(r=>f.app.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${f.app.address().port}/api/codex/models/sync`;
    assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,401);
    const headers={'content-type':'application/json','x-branchline-session':f.app.sessionToken};
    assert.notEqual((await fetch(url,{method:'POST',headers,body:JSON.stringify({models:[{id:'injected'}]})})).status,200);
    const result=await (await fetch(url,{method:'POST',headers,body:'{}'})).json();
    assert.equal(result.synchronized.added,1);
    assert.equal(f.app.store.state.models.filter(m=>m.runtime==='codex').length,1);
    assert.equal(f.app.store.state.models.at(-1).model,'gpt-from-connection');
  }finally{await f.close();}
});
