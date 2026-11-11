import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {Store} from '../server/store.mjs';
import {configureBundledModel} from '../server/bundled-setup.mjs';
import {Plans} from '../server/plans.mjs';
import {ContinuingHearthTasks} from '../server/continuing-hearth.mjs';
import {publicAddress} from '../server/public-page.mjs';
import {ImageStore} from '../server/image-store.mjs';

test('editing a Plan keeps an already attempted occurrence spent and preserves deliberate future work',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'branchline-plan-repair-')),store=new Store(dir,{checkpoints:false});await store.open();
  await store.transact(s=>configureBundledModel(s,{fresh:true}));let clock=Date.parse('2026-11-10T15:00:00Z'),calls=0;
  const plans=new Plans(store,{clock:()=>clock,isBusy:()=>false,stop:async()=>{},dispatch:async()=>{calls++;}});
  try{
    const input={id:null,name:'Daily fixture',task:'Synthetic task',rootId:null,workRootId:null,modelId:store.state.models[0].id,coat:null,schedule:{date:'2026-11-09',time:'09:00',zone:'UTC',repeat:'daily',weekdays:[],intervalMinutes:60},seconds:60,toolCalls:4,missed:'latest',enabled:true};
    const p=await plans.save(input);await plans.tick();await plans.promise;assert.equal(calls,1);
    clock+=600000;await plans.save({...input,id:p.id,name:'Renamed fixture'});await plans.tick();await plans.promise;assert.equal(calls,1);
    const next=store.state.plans.items[0].nextAt;assert(next>clock);
    clock=next;await plans.tick();await plans.promise;assert.equal(calls,2);
  }finally{await plans.close();await store.close();}
});

test('the inherited hearth finish retains a clarification that arrived after its last count',async()=>{
  const run={id:'run',profile:'branchline.hearth-loop/1',chatId:'chat',rootId:'desk',status:'running',mail:[{},{}],usage:{}},state={parallel:{runs:[run],jobs:[]}};
  const store={state,async transact(fn){this.state=fn(this.state);}};
  const tasks=new ContinuingHearthTasks(store,{},{});
  await tasks.finish('run','completed',null,1);assert.equal(run.status,'running');assert.equal(state.handoffs,undefined);
  await tasks.finish('run','completed',null,2);assert.equal(run.status,'completed');
});

test('ordinary IPv6 web addresses pass without admitting the excluded protocol or documentation ranges',()=>{
  for(const value of ['2001:4860:4860::8888','2606:4700:4700::1111','2001:200::1','3fff:1000::1'])assert(publicAddress(value),value);
  for(const value of ['2001::1','2001:1ff:ffff::1','2001:0db8::1','2002:7f00:1::1','3fff:fff::1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','64:ff9b::7f00:1'])assert(!publicAddress(value),value);
});

test('a generated picture queues behind intake and both original images remain readable',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'branchline-image-queue-')),store=new ImageStore(dir);
  const green=await sharp({create:{width:40,height:30,channels:3,background:'green'}}).png().toBuffer(),blue=await sharp({create:{width:40,height:30,channels:3,background:'blue'}}).png().toBuffer();
  const a=store.ingest({name:'picked.png',base64:green.toString('base64'),origin:'pick'}),b=store.ingestFromHost('generated.png',blue,'generated_image');
  assert(store.busy);const [first,second]=await Promise.all([a,b]);assert(!store.busy);assert.notEqual(first.original.sha256,second.original.sha256);
  assert.deepEqual(await store.read(first.original),green);assert.deepEqual(await store.read(second.original),blue);
});
