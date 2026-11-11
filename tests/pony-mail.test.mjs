import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, finish, until, input } from './desk-helpers.mjs';
import { mailEvent } from '../server/pony-mail-state.mjs';
import { PonyMail } from '../server/pony-mail.mjs';
import { Store } from '../server/store.mjs';
import { validateState } from '../server/domain.mjs';
import { dependencyEvent } from '../server/desk-goals.mjs';
import { makeToolContract, validToolContract, toolDefinitions } from '../server/tool-contract.mjs';
import { createApp } from '../server/index.mjs';
import { captureDreamSource } from '../server/dream-training-state.mjs';
import { ImageStore } from '../server/image-store.mjs';
import { recordImageSelection } from '../server/images.mjs';
import sharp from 'sharp';

async function postalFixture(options = {}) {
  const f = await fixture(options), store = f.app.store;
  await f.command('root.create',{name:'Other desk',mode:'personal'});
  const other = store.state.chats.find(c => c.id !== f.chatId);
  await f.command('table.roster.start',{chatId:other.id});
  let r = store.state.chats.find(c => c.id === other.id).seating;
  await f.command('table.roster.chair',{chatId:other.id,baseRevisionId:r.revisionId,chairId:r.desk.id,name:'Receiver',modelId:store.state.models[1].id,personalId:null,coat:null});
  const a = store.state.chats.find(c=>c.id===f.chatId), b = store.state.chats.find(c=>c.id===other.id), mail=f.app.ponyMail;
  for (const c of [a,b]) await mail.configure({rootId:c.rootId,chatId:c.id,chairId:c.seating.desk.id,enabled:true});
  return {...f,mail,a,b,send:(text='Parcel body',kind='notice',requestId='mail_test')=>mail.send({chatId:a.id,destinationRootId:b.rootId,kind,text,requestId}),toggle:(c,enabled)=>mail.configure({rootId:c.rootId,chatId:c.id,chairId:c.seating.desk.id,enabled})};
}
const delivered=(f,id)=>mailEvent(f.app.store.state,id,'delivered');
const outcome=f=>JSON.stringify({mail:f.mail.view().parcels.map(p=>({id:p.id,status:p.status})),tasks:f.app.deskTasks.status().map(t=>({id:t.id,status:t.status,error:t.error})),error:f.app.deskTasks.lastError});

test('different desks deliver a notice once, with no model call, and backup retains its external body',async()=>{
  const f=await postalFixture();try{
    assert.notEqual(f.a.rootId,f.b.rootId);
    const first=await f.send('Only this parcel should travel.');
    const again=await f.send('Only this parcel should travel.');assert.equal(first.parcelId,again.parcelId);
    await until(()=>delivered(f,first.parcelId),()=>outcome(f));
    assert.equal(f.requests.length,0);
    const s=f.app.store.state;assert.equal(s.messages.filter(m=>m.ponyParcelId===first.parcelId).length,1);
    assert(!JSON.stringify(s.ponyMail).includes('Only this parcel'));assert(f.mail.readText(s,first.parcelId).includes('Only this parcel'));
    assert.equal(s.messages.find(m=>m.ponyParcelId===first.parcelId).chatId,f.b.id);
    await assert.rejects(f.send('changed'),/identity/);
    const backup=await f.app.storage.backup();const restored=await f.app.storage.restoreCopy(backup.id);
    const copy=new Store(restored.restoredPath,{checkpoints:false});await copy.open();
    const mail=new PonyMail(copy,{interval:0});assert.equal(mail.readText(copy.state,first.parcelId),f.mail.readText(s,first.parcelId));await mail.close();await copy.close();
    validateState(s);
  }finally{await f.close();}
});

test('request waits behind a busy chair; return waits at home while sender is off, then arrives once',async()=>{
  const f=await postalFixture();try{
    await f.app.deskTasks.admit({...input(f,'Finish this first.','busy'),chatId:f.b.id,baseRevisionId:f.b.seating.revisionId});
    await until(()=>f.requests.length===1,()=>outcome(f));
    const p=await f.send('Please check the blue box.','request');
    await until(()=>f.app.store.state.deskWork.tasks.some(t=>t.ponyParcelId===p.parcelId),()=>outcome(f));
    assert.equal(f.requests.length,1);assert(!f.app.store.state.deskWork.tasks.find(t=>t.ponyParcelId===p.parcelId).goalId);
    finish(f.requests[0]);await until(()=>f.requests.length===2,()=>outcome(f));
    assert(f.requests[1].body.messages.some(m=>typeof m.content==='string'&&m.content.includes('Please check the blue box.')));
    await f.toggle(f.a,false);finish(f.requests[1],'The blue box is checked.');
    await until(()=>mailEvent(f.app.store.state,p.parcelId,'returned'),()=>outcome(f));
    const ret=f.app.store.state.ponyMail.parcels.find(r=>r.replyTo===p.parcelId);
    await delay(700);assert(!delivered(f,ret.id));assert(f.mail.readText(f.app.store.state,ret.id).includes('blue box is checked'));
    await f.toggle(f.a,true);await until(()=>delivered(f,ret.id),()=>outcome(f));
    await f.mail.pumping;await delay(650);assert.equal(f.requests.length,2);assert.equal(f.app.store.state.messages.filter(m=>m.ponyParcelId===ret.id).length,1);
  }finally{await f.close();}
});

test('off gates sends; accepted mail holds and cancellation survives reopening without blocking another desk',async()=>{
  const f=await postalFixture();try{
    await f.toggle(f.b,false);await assert.rejects(f.send(),/off/);
    await f.toggle(f.b,true);clearInterval(f.mail.timer);f.mail.tasks=null;
    const p=await f.send('saved before closure','request');await f.toggle(f.b,false);
    f.mail.tasks=f.app.deskTasks;await f.mail.pump();assert(!delivered(f,p.parcelId));
    await f.mail.cancel(p.parcelId);await f.toggle(f.b,true);await f.mail.pump();assert(!delivered(f,p.parcelId));assert.equal(f.requests.length,0);
    const second=await f.send('ordinary notice','notice','second');await f.mail.pump();assert(delivered(f,second.parcelId));
    const file=path.join(f.app.store.dataDir,'pony-mail','objects',f.app.store.state.ponyMail.parcels[0].payloadHash+'.json');assert((await fs.stat(file)).size>0);
  }finally{await f.close();}
});

test('changed receiving address holds until explicit correction; UI selection never redirects a parcel',async()=>{
  const f=await postalFixture();try{
    clearInterval(f.mail.timer);f.mail.tasks=null;
    const p=await f.send();
    await f.command('chat.create',{rootId:f.b.rootId,name:'Another conversation'});
    const c=f.app.store.state.chats.findLast(c=>c.rootId===f.b.rootId);await f.command('table.roster.start',{chatId:c.id});
    let r=f.app.store.state.chats.find(c2=>c2.id===c.id).seating;
    await f.command('table.roster.chair',{chatId:c.id,baseRevisionId:r.revisionId,chairId:r.desk.id,name:'New address',modelId:f.app.store.state.models[1].id,personalId:null,coat:null});
    r=f.app.store.state.chats.find(c2=>c2.id===c.id).seating;
    await f.mail.configure({rootId:f.b.rootId,chatId:c.id,chairId:r.desk.id,enabled:true});
    f.mail.tasks=f.app.deskTasks;await f.mail.pump();assert(!delivered(f,p.parcelId));
    await f.mail.correct(p.parcelId);await until(()=>delivered(f,p.parcelId),()=>outcome(f));assert.equal(delivered(f,p.parcelId).chatId,c.id);
  }finally{await f.close();}
});

test('postal tools have valid captured contracts and an explicit goal wait sees one linked return',async()=>{
  const f=await postalFixture();try{
    const result=await f.app.deskTasks.admit({...input(f,'Wait for my next instruction.','author'),toolsEnabled:true});
    await until(()=>f.requests.length===1,()=>outcome(f));
    const task=f.app.store.state.deskWork.tasks.find(t=>t.id===result.taskIds[0]);
    const contract=makeToolContract(f.app.store.state,{chatId:f.a.id,model:task.model,enabled:true,seat:task.selection.seat,chairId:task.chairId,deskTaskId:task.id});
    assert(validToolContract(contract,task.model));assert(toolDefinitions(contract).some(t=>t.name==='send_pony'));
    const parcel=await f.app.deskTasks.call(task.id,'send_pony',{desk_id:f.b.rootId,text:'Please report once.',request_reply:true},'call_one');
    await until(()=>f.requests.length===2,()=>outcome(f));finish(f.requests[1],'Returned once.');
    await until(()=>f.app.store.state.ponyMail.parcels.some(p=>p.replyTo===parcel.parcelId&&delivered(f,p.id)),()=>outcome(f));
    const report={detail:{after:'',wait_for:'pony',wait_id:parcel.parcelId}};
    assert(dependencyEvent(f.app.store.state,task,report));
    const third={...task,rootId:'another_root'};await assert.rejects(f.mail.call(third,'read_pony',{parcel_id:parcel.parcelId,offset:0}),/not in your desk/);
    finish(f.requests[0]);
  }finally{await f.close();}
});

test('a queued postal request survives restart; started work is not automatically retried',async()=>{
  const f=await postalFixture();let reopened;
  try{
    f.app.deskTasks.busy=()=> 'Synthetic busy chair';
    const p=await f.send('Retained queue request','request');
    await until(()=>f.app.store.state.deskWork.tasks.some(t=>t.ponyParcelId===p.parcelId),()=>outcome(f));
    assert.equal(f.requests.length,0);await f.app.dispose();
    reopened=await createApp({dataDir:path.join(f.dir,'workspace'),bundledDir:path.join(f.dir,'no-model'),modelOptions:{codex:{close(){},async status(){return {connected:false,models:[]};}}}});
    await until(()=>f.requests.length===1,()=>JSON.stringify(reopened.deskTasks.status()));
    await reopened.dispose();reopened=null;
    const again=await createApp({dataDir:path.join(f.dir,'workspace'),bundledDir:path.join(f.dir,'no-model'),modelOptions:{codex:{close(){},async status(){return {connected:false,models:[]};}}}});reopened=again;
    await delay(900);assert.equal(f.requests.length,1);
    assert(again.store.state.deskWork.tasks.filter(t=>t.ponyParcelId===p.parcelId).every(t=>!['queued','running','preparing'].includes(t.status)));
  }finally{await reopened?.dispose();await f.close();}
});

test('marked postal notes resolve the actual text; derived relays retain source sharing after model changes',async()=>{
  const f=await postalFixture();try{
    const p=await f.send('A source passage retained for later.');await until(()=>delivered(f,p.parcelId),()=>outcome(f));
    const row=f.app.store.state.messages.find(m=>m.ponyParcelId===p.parcelId);
    const note=captureDreamSource(f.app.store.state,{kind:'message',chatId:f.b.id,messageIds:[row.id]},{ponyRead:(s,id)=>f.mail.readText(s,id)});
    assert(note.text.includes('source passage retained'));assert.equal(note.messages[0].ponyParcelId,p.parcelId);
    const saved=await f.app.dreams.saveNote({name:'Postal source note',focus:'conversation',kind:'message',chatId:f.b.id,messageIds:[row.id]});
    const edited=await f.app.dreams.saveNote({name:'Postal source note',focus:'conversation',kind:'manual',text:'Edited wording keeps its source.',noteId:saved.noteId,baseRevisionId:saved.id});
    const retained=(await f.app.dreams.note(edited.id)).source;assert(retained.chatIds.includes(f.b.id));assert(retained.ponyParcelIds.includes(p.parcelId));
    // The existing Home guard is exercised with a captured source disclosure.
    const s=f.app.store.state;
    const packet=f.mail.payload(s,p.parcelId);packet.sources=[{chatId:f.a.id,homeArrivals:1,homeExposures:0,pc:0,work:0,sketch:0,profiles:[]}];
    // A synthetic scoped view lets the real disclosure checker reject the relay.
    const restricted=structuredClone(s),parcel=restricted.ponyMail.parcels.find(r=>r.id===p.parcelId);
    parcel.payloadHash=await f.mail.savePayload(packet);restricted.home={settings:[],arrivals:[{rootId:f.a.rootId,at:new Date().toISOString()}],exposures:[]};
    assert.throws(()=>f.mail.assertDisclosure(restricted,f.b.id,restricted.models[1]),/Home/);
    const unrelated={...restricted,chats:[...restricted.chats,{id:'unrelated',rootId:'elsewhere'}]};
    assert.doesNotThrow(()=>f.mail.assertDisclosure(unrelated,'unrelated',restricted.models[1]));
  }finally{await f.close();}
});

test('persistence failure cannot report a delivered parcel, and Stop all prevents pending dispatch',async()=>{
  const f=await postalFixture();try{
    clearInterval(f.mail.timer);f.mail.tasks=null;
    const p=await f.send('Do not lose this.','request');
    const transact=f.app.store.transact.bind(f.app.store);f.app.store.transact=async()=>{throw new Error('Synthetic disk failure');};
    await assert.rejects(f.mail.deliver(f.app.store.state.ponyMail.parcels[0]),/disk failure/);
    assert(!delivered(f,p.parcelId));f.app.store.transact=transact;f.mail.tasks=f.app.deskTasks;
    await f.mail.stopAll();await f.mail.pump();assert(!delivered(f,p.parcelId));assert.equal(f.requests.length,0);
  }finally{await f.close();}
});

test('an explicit picture travels by saved reference without replacing the receiver’s composer pictures',async()=>{
  const f=await postalFixture({modelOptions:{imageCapability:async()=>({profile:'branchline.direct-image-input/1',route:'lmstudio-chat-image-data-url',imageTokensEach:4096,remote:false,destination:'synthetic vision fixture'})}});
  try{
    const images=new ImageStore(f.app.store.dataDir),png=await sharp({create:{width:20,height:20,channels:3,background:'#98d5aa'}}).png().toBuffer();
    const snapshot=await images.ingest({name:'parcel.png',base64:png.toString('base64'),origin:'pick'});
    let source,composer;
    await f.app.store.transact(s=>{source=recordImageSelection(s,f.a.id,snapshot);composer=recordImageSelection(s,f.b.id,snapshot);return s;});
    await f.command('message.note',{chatId:f.a.id,content:'A picture for the other desk.'});
    // A normal group prompt owns its saved attachment selection.
    await f.app.store.transact(s=>{s.deskWork.batches.push({id:'batch_image',chatId:f.a.id,requestId:'picture_batch',fingerprint:'synthetic',createdAt:new Date().toISOString(),original:'Please describe this picture.',sharedContext:'',routed:false,assignments:[],originTaskId:null,selectedImages:[source.id]});return s;});
    const p=await f.mail.send({chatId:f.a.id,destinationRootId:f.b.rootId,kind:'request',messageId:'batch_image',requestId:'postal_picture',attachPictures:true});
    await until(()=>f.requests.length===1,()=>outcome(f));
    const pixels=f.requests[0].body.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(x=>x.type==='image_url');assert.equal(pixels.length,1);
    assert.deepEqual(f.app.store.state.images.active[f.b.id],[composer.id]);
    assert(f.mail.payload(f.app.store.state,p.parcelId).images[0].view.sha256===source.view.sha256);
    finish(f.requests[0]);await until(()=>mailEvent(f.app.store.state,p.parcelId,'returned'),()=>outcome(f));
    assert.deepEqual(f.app.store.state.images.active[f.b.id],[composer.id]);
    validateState(f.app.store.state);
  }finally{await f.close();}
});
