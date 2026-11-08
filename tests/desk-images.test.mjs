import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {fixture,finish,until,input} from './desk-helpers.mjs';
import {replayJournal} from '../server/journal.mjs';
import {MEDIA_PROFILE} from '../server/model-media.mjs';

const vision=async()=>({profile:MEDIA_PROFILE,route:'lmstudio-chat-image-data-url',imageTokensEach:4096,loadedTokens:32768,remote:false,destination:'synthetic vision fixture'});
async function imageFixture(capability=vision){
 const f=await fixture({modelOptions:{imageCapability:capability}});
 let r=f.app.store.state.chats[0].seating;
 await f.command('table.roster.chair',{chatId:f.chatId,baseRevisionId:r.revisionId,chairId:null,name:'Luna',modelId:f.app.store.state.models[0].id,personalId:null,coat:null});
 await new Promise(resolve=>f.app.listen(0,'127.0.0.1',resolve));
 f.post=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${f.app.address().port}`+route,{method:'POST',headers:{'content-type':'application/json','x-branchline-session':f.app.sessionToken},body:JSON.stringify(body)});const value=await response.json();assert(response.ok,value.error);return value;};
 const png=await sharp({create:{width:40,height:30,channels:3,background:'#3a97db'}}).png().toBuffer();
 const selected=await f.post('/api/images/select',{chatId:f.chatId,image:{name:'shared.png',base64:png.toString('base64'),origin:'pick'}});f.image=selected.image;
 f.prepare=async(chairIds)=>{const roster=f.app.store.state.chats[0].seating;return f.post('/api/images/plan',{chatId:f.chatId,chairIds:chairIds??[roster.desk,...roster.visitors].map(c=>c.id),baseRevisionId:roster.revisionId});};
 return f;
}
const pixels=request=>request.body.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(p=>p.type==='image_url').map(p=>crypto.createHash('sha256').update(Buffer.from(p.image_url.url.split(',')[1],'base64')).digest('hex'));
const done=f=>f.app.store.state.deskWork.tasks.every(t=>['completed','failed','cancelled','interrupted'].includes(t.status));

test('All shares exact pixels with three chairs, including two on the same model, and duplicate Send does not repeat',async()=>{
 const f=await imageFixture();try{
  let r=f.app.store.state.chats[0].seating;await f.command('table.replySettings',{chatId:f.chatId,baseRevisionId:r.revisionId,mode:'all',speaker:'personal'});
  const plan=await f.prepare(),body={...input(f,'Describe this picture.','image_all'),imagePlanId:plan.id};
  const [a,b]=await Promise.all([f.app.deskTasks.admit(body),f.app.deskTasks.admit(body)]);assert.equal(a.batchId,b.batchId);
  await until(()=>f.requests.length===3,()=>JSON.stringify(f.app.store.state.deskWork.tasks.map(t=>({chair:t.label,status:t.status,error:t.error}))));
  for(const request of f.requests)assert.deepEqual(pixels(request),[f.image.view.sha256]);
  const tasks=f.app.store.state.deskWork.tasks;assert.equal(new Set(tasks.map(t=>t.chairId)).size,3);assert.equal(new Set(tasks.map(t=>t.model.id)).size,2);
  finish(f.requests[2]);await until(()=>f.app.store.state.exchanges.some(e=>e.status==='completed'),'first image reply');assert.deepEqual(f.app.store.state.images.active[f.chatId],[f.image.id]);
  finish(f.requests[0]);finish(f.requests[1]);await until(()=>done(f),'image batch completion');
  assert.deepEqual(f.app.store.state.images.active[f.chatId],[]);assert.deepEqual(f.app.store.state.deskWork.batches[0].selectedImages,[f.image.id]);
  assert(f.app.store.state.exchanges.every(e=>e.selectedImages[0]===f.image.id));
  const replay=(await replayJournal(f.app.store.file)).state;assert.deepEqual(replay.deskWork,f.app.store.state.deskWork);assert.deepEqual(replay.images,f.app.store.state.images);
 }finally{await f.close();}
});

test('queued image recipients keep their captured picture after another plan and a changed next selection',async()=>{
 const f=await imageFixture();try{
  let hold=true;f.app.deskTasks.busy=task=>hold&&task.label!=='Hearthline'?'Waiting for synthetic slot':null;
  const plan=await f.prepare();await f.app.deskTasks.admit({...input(f,'Look together. @Hearthline @Qwen @Luna','image_queued'),imagePlanId:plan.id});
  await until(()=>f.requests.length===1,'first chair only');finish(f.requests[0]);await until(()=>f.app.store.state.deskWork.tasks.some(t=>t.status==='completed'),'first done');
  assert.deepEqual(f.app.store.state.images.active[f.chatId],[f.image.id]);
  await f.prepare();await f.post('/api/images/context',{chatId:f.chatId,ids:[]});
  hold=false;f.app.deskTasks.kick();await until(()=>f.requests.length===3,'waiting chairs receive admitted image');
  for(const q of f.requests.slice(1)){assert.deepEqual(pixels(q),[f.image.view.sha256]);finish(q);}
  await until(()=>done(f),'queued batch done');assert.deepEqual(f.app.store.state.images.active[f.chatId],[]);
 }finally{await f.close();}
});

test('a chair without image support gets a named failure while capable chairs complete',async()=>{
 const f=await imageFixture(async model=>{if(model.name==='Qwen')throw new Error('No image input in this fixture');return vision();});try{
  const plan=await f.prepare();const batch=await f.app.deskTasks.admit({...input(f,'Same picture. @Hearthline @Qwen @Luna','image_mixed'),imagePlanId:plan.id});
  assert.equal(batch.failedTaskIds.length,1);await until(()=>f.requests.length===2,'capable chairs start');
  const failed=f.app.store.state.deskWork.tasks.find(t=>t.status==='failed');assert.equal(failed.label,'Qwen');assert.match(failed.error,/Qwen:.*No image input/);assert.equal(failed.exchangeId,null);
  for(const q of f.requests){assert.deepEqual(pixels(q),[f.image.view.sha256]);finish(q);}await until(()=>done(f),'mixed batch done');
  assert.deepEqual(f.app.store.state.images.active[f.chatId],[f.image.id]);
 }finally{await f.close();}
});

test('stopping one image recipient preserves the other deliveries and keeps the picture available',async()=>{
 const f=await imageFixture();try{
  const plan=await f.prepare(),batch=await f.app.deskTasks.admit({...input(f,'Check it. @Hearthline @Qwen @Luna','image_stop'),imagePlanId:plan.id});
  await until(()=>f.requests.length===3,'three active image requests');await f.app.deskTasks.cancel(batch.taskIds[0]);
  for(const q of f.requests)finish(q);await until(()=>done(f),'stop and peer completion');
  assert.equal(f.app.store.state.deskWork.tasks.filter(t=>t.status==='cancelled').length,1);assert.equal(f.app.store.state.deskWork.tasks.filter(t=>t.status==='completed').length,2);
  assert.deepEqual(f.app.store.state.images.active[f.chatId],[f.image.id]);
 }finally{await f.close();}
});

test('Select, Alternate and explicit subsets retain their exact image audience',async()=>{
 const f=await imageFixture();try{
  const roster=f.app.store.state.chats[0].seating,ids=[roster.desk.id,...roster.visitors.map(c=>c.id)];
  let plan=await f.prepare([ids[0]]);await f.app.deskTasks.admit({...input(f,'Single picture request.','image_single'),imagePlanId:plan.id});await until(()=>f.requests.length===1,'Select image');finish(f.requests[0]);await until(()=>done(f),'Select done');
  await f.post('/api/images/context',{chatId:f.chatId,ids:[f.image.id]});let r=f.app.store.state.chats[0].seating;await f.command('table.replySettings',{chatId:f.chatId,baseRevisionId:r.revisionId,mode:'alternate',speaker:'personal'});
  plan=await f.prepare([ids[0]]);await f.app.deskTasks.admit({...input(f,'Alternating picture request.','image_alternate'),replyMode:'alternate',imagePlanId:plan.id});await until(()=>f.requests.length===2,'Alternate image');finish(f.requests[1]);await until(()=>done(f),'Alternate done');assert.equal(f.app.store.state.chats[0].seating.selectedVisitorId,ids[1]);
  await f.post('/api/images/context',{chatId:f.chatId,ids:[f.image.id]});r=f.app.store.state.chats[0].seating;await f.command('table.replySettings',{chatId:f.chatId,baseRevisionId:r.revisionId,mode:'all',speaker:'visiting'});
  plan=await f.prepare([ids[1],ids[2]]);const batch=await f.app.deskTasks.admit({...input(f,'A subset. @Qwen @Luna @Qwen','image_subset'),imagePlanId:plan.id});assert.equal(batch.taskIds.length,2);await until(()=>f.requests.length===4,'subset only');for(const q of f.requests.slice(2))finish(q);await until(()=>done(f),'subset done');
  for(const q of f.requests)assert.deepEqual(pixels(q),[f.image.view.sha256]);
 }finally{await f.close();}
});
