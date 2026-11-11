import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store.mjs';
import { recoverJournalTail } from '../server/journal-recovery.mjs';
import { encodeJournalFrame } from '../server/journal-codec.mjs';
import { replayJournal } from '../server/journal.mjs';
import { ReflectionManager } from '../server/reflection.mjs';

async function saved(packed=false){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'branchline-recovery-v1-'));
  const store=new Store(dir,{checkpoints:false,compressionThreshold:packed?0:Infinity});await store.open();
  await store.command({type:'root.create',payload:{name:'Preserved desk',mode:'personal'}});
  await store.command({type:'message.note',payload:{chatId:store.state.chats[0].id,content:'Keep my saved work.'}});
  const state=structuredClone(store.state),owner=structuredClone(store.owner);await store.close();
  return {dir,state,owner,file:path.join(dir,'events.jsonl')};
}
for(const packed of [false,true])test(`interrupted ${packed?'packed':'plain'} ending recovers with original bytes and a durable notice`,async()=>{
  const f=await saved(packed),before=await fs.readFile(f.file);
  const extra=packed?encodeJournalFrame(Buffer.from('{"not":"complete"}\n')).subarray(0,84):Buffer.from('{"type":"change","changes":[');
  await fs.appendFile(f.file,extra);
  const store=new Store(f.dir,{checkpoints:false});await store.open();
  try{assert.deepEqual(store.state,f.state);assert(store.journalRecovery);assert.deepEqual(await fs.readFile(path.join(store.journalRecovery.directory,'original.journal')),Buffer.concat([before,extra]));}
  finally{await store.close();}
  const again=new Store(f.dir,{checkpoints:false});await again.open();assert.deepEqual(again.state,f.state);assert.equal(again.journalRecovery,null);await again.close();
});

for(const boundary of ['beforePublish','afterPublish'])test(`recovery resumes once after interruption ${boundary}`,async()=>{
  const f=await saved();await fs.appendFile(f.file,'{"unfinished":');
  await assert.rejects(recoverJournalTail(f.file,{[boundary]:()=>{throw new Error('Synthetic interruption');}}),/Synthetic interruption/);
  const repaired=await recoverJournalTail(f.file);assert(repaired);assert.deepEqual((await replayJournal(f.file)).state,f.state);
  assert.equal(await recoverJournalTail(f.file),null);
});

test('complete record without its newline is preserved; damaged complete frames are not discarded',async()=>{
  const f=await saved(),before=await fs.readFile(f.file);await fs.writeFile(f.file,before.subarray(0,-1));
  const repaired=await recoverJournalTail(f.file);assert.equal(repaired.mode,'missing-final-delimiter');assert.deepEqual(await fs.readFile(f.file),before);
  const g=await saved(true),bad=encodeJournalFrame(Buffer.from('{"type":"invalid"}\n'));bad[16]^=0xff;
  await fs.appendFile(g.file,Buffer.concat([bad,Buffer.from([1,2,3])]));const damaged=await fs.readFile(g.file);
  await assert.rejects(recoverJournalTail(g.file));assert.deepEqual(await fs.readFile(g.file),damaged);
});

test('the process-lifetime guard rejects a second writer and recovers a reused PID',async()=>{
  const f=await saved(),a=new Store(f.dir,{checkpoints:false});await a.open();
  const b=new Store(f.dir,{checkpoints:false});await assert.rejects(b.open(),/active writer/);
  const owner=structuredClone(a.owner);await a.close();
  // This PID is still alive: the released OS guard proves that its previous
  // Store instance is not the owner, independently of PID reuse.
  await fs.writeFile(path.join(f.dir,'.writer.lock'),JSON.stringify(owner));
  const c=new Store(f.dir,{checkpoints:false});await c.open();await c.close();
  await fs.writeFile(path.join(f.dir,'.writer.lock'),JSON.stringify({pid:process.pid,token:'old-backend'}));
  const held=await fs.open(path.join(f.dir,'.writer.lock'),'r');
  const legacy=new Store(f.dir,{checkpoints:false});try{await assert.rejects(legacy.open(),/earlier Branchline writer/);}finally{await held.close();}
  assert.equal(JSON.parse(await fs.readFile(path.join(f.dir,'.writer.lock'))).token,'old-backend');
  if(process.platform==='win32'){const recovered=new Store(f.dir,{checkpoints:false});await recovered.open();assert(recovered.writerRecovery);await recovered.close();}
});

test('a malformed reflection request rejects without creating a task',async()=>{
  const f=await saved(),store=new Store(f.dir,{checkpoints:false});await store.open();
  const reflections=new ReflectionManager(store,{});await assert.rejects(reflections.run(null),/conversation/);assert.equal(reflections.running.size,0);await store.close();
});
