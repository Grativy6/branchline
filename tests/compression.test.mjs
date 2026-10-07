import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Store } from '../server/store.mjs';
import { StorageManager } from '../server/storage.mjs';
import { journalChunks, journalInfo, packJournal, journalFingerprint, encodeJournalFrame, JOURNAL_MAGIC } from '../server/journal-codec.mjs';
import { replayJournal } from '../server/journal.mjs';
import { decodeCheckpoint, encodeCheckpoint, CHECKPOINT_FILES, PACKED_CHECKPOINT_PROFILE } from '../server/startup-checkpoint.mjs';
import { initialState, applyCommand } from '../server/domain.mjs';
import { digest } from '../server/integrity.mjs';
import { recordHandoff } from '../server/handoff.mjs';
import { storagePanel } from '../public/storage.js';
import { fixture } from './helpers.mjs';
import { createApp } from '../server/index.mjs';
import { appendExchange } from '../server/domain.mjs';
import { prepareModelHandoff } from '../server/handoff.mjs';
import { compileMessages } from '../server/model.mjs';

const sha = data => crypto.createHash('sha256').update(data).digest('hex');
async function directory() { await fs.mkdir('.test-data', { recursive: true }); return fs.mkdtemp(path.resolve('.test-data/compression-')); }
async function expanded(file, options) { const buffers = []; for await (const chunk of journalChunks(file, options)) buffers.push(chunk); return Buffer.concat(buffers); }
async function synthetic() {
  const dir = await directory(), file = path.join(dir, 'events.jsonl');
  const state = applyCommand(initialState(), { type: 'root.create', payload: { name: 'Synthetic 🌱', mode: 'personal' } });
  recordHandoff(state, { kind:'synthetic.receipt', from:'fixture', to:'fixture', payload:{purpose:'Compression test'}, detail:{context:'A retained distinction: é 🌱. '.repeat(3000)} });
  let raw = '';
  for (let i=1;i<=12;i++) raw += JSON.stringify({ type:'snapshot', sequence:i, at:'synthetic', state }) + '\r\n';
  const bytes = Buffer.from(raw); await fs.writeFile(file, bytes);
  return { dir, file, state, bytes };
}
const packing = (f, extra={}) => packJournal(f.file, { expectedBytes:f.bytes.length, expectedSha256:sha(f.bytes), threshold:1, ...extra });

test('packing retains all original bytes and ranges, then small writes append and replay', async t => {
  const f = await synthetic(); const full = await replayJournal(f.file);
  const packed = await packing(f); assert.equal(packed.status,'packed');
  assert(packed.storedBytes < f.bytes.length / 20);
  assert.deepEqual(await expanded(f.file),f.bytes);
  for(const start of [0,3,700,f.bytes.length-15,f.bytes.length]) assert.deepEqual(await expanded(f.file,{start}),f.bytes.subarray(start));
  assert.deepEqual(await expanded(f.file,{start:11,end:80}),f.bytes.subarray(11,81));
  const before = await fs.readFile(f.file);
  const store = new Store(f.dir); await store.open();
  t.after(()=>store.close());
  assert.deepEqual(store.state,full.state); assert.equal(store.sequence,12);
  await store.command({type:'draft.save',payload:{chatId:store.state.chats[0].id,text:'Next chapter 💛'}});
  const after = await fs.readFile(f.file); assert.deepEqual(after.subarray(0,before.length),before);
  const replayed = await replayJournal(f.file); assert.deepEqual(replayed.state,store.state);
  assert.equal(replayed.hasher.copy().digest('hex'),store.journalHasher.copy().digest('hex'));
  assert.equal((await journalInfo(f.file)).frames.length,2);
  assert(after.length-before.length < 1000);
});

test('normal open and close compress at threshold; checkpoints and tail replay remain exact',async t=>{
  const f=await synthetic();
  const store=new Store(f.dir,{compressionThreshold:1}); await store.open();
  assert.equal(store.compressedJournal,true); await store.requestCheckpoint();
  const saved=decodeCheckpoint(await fs.readFile(path.join(f.dir,store.checkpointSlot)));
  assert.equal(saved.prefixSha256,sha(f.bytes)); assert.equal(saved.stateHash,digest(f.state));
  assert.equal(saved.profile,PACKED_CHECKPOINT_PROFILE);
  assert.equal(saved.storage.prefixSha256,sha(await fs.readFile(f.file)));
  assert.equal((await journalInfo(f.file)).frames.length,2);
  store.checkpoints=false;
  store.compressionThreshold=Infinity;
  await store.command({type:'draft.save',payload:{chatId:store.state.chats[0].id,text:'Tail'}});
  await store.close(); const next=new Store(f.dir); await next.open();t.after(()=>next.close());
  assert.equal(next.startupDiagnostics.path,'checkpoint');assert.equal(next.startupDiagnostics.tailRecords,1);
  assert.deepEqual(next.state,store.state); assert.equal((await journalInfo(f.file)).frames.length,3);
  assert.equal(next.startupDiagnostics.checkpointBinding,'stored-bytes');
  assert.equal(next.startupDiagnostics.boundaryDecodedBytes,saved.boundary.length);
  assert(next.startupDiagnostics.boundaryDecodedBytes<f.bytes.length/10);
  assert.equal(next.journalHasher,null);
  assert.equal(next.journalBytes,(await expanded(f.file)).length);
  await next.command({type:'draft.save',payload:{chatId:next.state.chats[0].id,text:'After compressed checkpoint'}});
  await next.requestCheckpoint();
  const updated=decodeCheckpoint(await fs.readFile(path.join(f.dir,next.checkpointSlot)));
  assert.equal(updated.prefixSha256,null);assert.equal(updated.storage.prefixSha256,sha(await fs.readFile(f.file)));
  assert.deepEqual((await replayJournal(f.file)).state,next.state);
});

test('corrupt, truncated and length-mismatched packed data cannot become an empty workspace',async()=>{
  const f=await synthetic(); await packing(f);const good=await fs.readFile(f.file);
  const variants=[good.subarray(0,7),good.subarray(0,8),good.subarray(0,20),good.subarray(0,good.length-1),Buffer.concat([good,Buffer.from('trailing')])];
  const badHash=Buffer.from(good);badHash[24]^=1;variants.push(badHash);
  const badPayload=Buffer.from(good);badPayload[good.length-2]^=1;variants.push(badPayload);
  const tooShort=Buffer.from(good);tooShort.writeBigUInt64LE(10n,8);variants.push(tooShort);
  for(const bytes of variants){
    const dir=await directory(),file=path.join(dir,'events.jsonl');await fs.writeFile(file,bytes);
    const store=new Store(dir);await assert.rejects(store.open(),/No history was reset/);
    assert.deepEqual(await fs.readFile(file),bytes); await assert.rejects(fs.access(store.lockFile),{code:'ENOENT'});
  }
});

test('source binding failures and pre-publication failures retain original history',async()=>{
  const f=await synthetic();
  await assert.rejects(packing(f,{expectedSha256:'0'.repeat(64)}),/source did not match/);
  assert.deepEqual(await fs.readFile(f.file),f.bytes);
  await assert.rejects(packing(f,{onStage(){throw new Error('Synthetic replacement failure');}}),/Synthetic/);
  assert.deepEqual(await fs.readFile(f.file),f.bytes);
  assert((await fs.readdir(f.dir)).some(name=>name.includes('.tmp-compress-')));
  const replayed=await replayJournal(f.file);assert.deepEqual(replayed.state,f.state);
  await assert.rejects(packing(f,{onStage:async()=>fs.appendFile(f.file,'external-write')}),/source changed/);
  assert.deepEqual(await fs.readFile(f.file),Buffer.concat([f.bytes,Buffer.from('external-write')]));
});

test('legacy cache generations compress without changing their decoded content',async t=>{
  const f=await synthetic();const store=new Store(f.dir);await store.open();await store.requestCheckpoint();
  await store.command({type:'draft.save',payload:{chatId:store.state.chats[0].id,text:'Second'}});await store.requestCheckpoint();await store.close();
  const saved=[];
  for(const slot of CHECKPOINT_FILES){const file=path.join(f.dir,slot);const value=decodeCheckpoint(await fs.readFile(file));saved.push(value);await fs.writeFile(file,JSON.stringify(value,null,2)+'\r\n');}
  const next=new Store(f.dir);await next.open();t.after(()=>next.close());
  for(let i=0;i<CHECKPOINT_FILES.length;i++){const bytes=await fs.readFile(path.join(f.dir,CHECKPOINT_FILES[i]));assert.equal(JSON.parse(bytes).codec,'brotli');assert.deepEqual(decodeCheckpoint(bytes),saved[i]);}
});

test('packed pending work becomes interruption evidence without restarting inference or sessions',async t=>{
  const f=await fixture(t);f.app.store.compressionThreshold=1;
  await f.app.store.transact(state=>{
    const taskId='exchange_packed_interrupted';
    prepareModelHandoff(state,{taskId,chatId:f.chatId,kind:'reply',messages:compileMessages(state,f.chatId,'Synthetic interruption'),purpose:'Synthetic interruption'});
    return appendExchange(state,f.chatId,{id:taskId,content:'Synthetic interruption',modelId:state.models[0].id});
  });
  const oldToken=f.app.sessionToken;await f.app.dispose();assert((await journalInfo(f.app.store.file)).compressed);
  f.app=await createApp({dataDir:f.dataDir,backupDir:f.backupDir});
  assert.equal(f.app.store.state.exchanges.at(-1).status,'failed');assert.equal(f.requests.length,0);assert.notEqual(f.app.sessionToken,oldToken);
  assert(f.app.store.state.handoffs.records.some(r=>r.kind==='episode.interrupted'));
});

test('compressed checkpoints reject tampering and fall back to the exact packed journal',async t=>{
  const f=await synthetic();const store=new Store(f.dir,{compressionThreshold:1});await store.open();await store.requestCheckpoint();
  store.checkpoints=false;await store.close();
  const file=path.join(f.dir,store.checkpointSlot);const encoded=JSON.parse(await fs.readFile(file,'utf8'));
  assert.equal(encoded.codec,'brotli');assert((await fs.stat(file)).size < JSON.stringify(store.state).length / 10);
  encoded.sha256='0'.repeat(64);await fs.writeFile(file,JSON.stringify(encoded));
  const next=new Store(f.dir);await next.open();t.after(()=>next.close());
  assert.equal(next.startupDiagnostics.path,'full-replay');assert.deepEqual(next.state,store.state);
});

test('a stored-byte checkpoint still checks actual final state, sequence and frame boundaries',async t=>{
  const f=await synthetic();const store=new Store(f.dir,{compressionThreshold:1});await store.open();
  const saved=decodeCheckpoint(await fs.readFile(path.join(f.dir,store.checkpointSlot)));
  store.checkpoints=false;store.compressionThreshold=Infinity;await store.close();
  const variants=[
    c=>{c.state.chats[0].name='Forged state';c.stateHash=digest(c.state);},
    c=>{c.storage.prefixSha256='0'.repeat(64);},
    c=>{c.storage.throughByte--;},
    c=>{c.throughSequence--;},
    c=>{c.boundary.start++;c.boundary.length--;},
    c=>{c.throughByte--;c.boundary.length--;},
  ];
  for(const mutate of variants){
    const dir=await directory();
    for(const name of ['events.jsonl','workspace.json'])await fs.copyFile(path.join(f.dir,name),path.join(dir,name));
    const value=structuredClone(saved);mutate(value);await fs.writeFile(path.join(dir,CHECKPOINT_FILES[0]),encodeCheckpoint(value));
    const next=new Store(dir);await next.open();t.after(()=>next.close());
    assert.equal(next.startupDiagnostics.path,'full-replay');assert.deepEqual(next.state,f.state);
  }
});

test('modified compressed history or a damaged new tail cannot hide behind a valid checkpoint',async()=>{
  const f=await synthetic();const store=new Store(f.dir,{compressionThreshold:1});await store.open();
  store.checkpoints=false;store.compressionThreshold=Infinity;await store.close();
  const original=await fs.readFile(f.file);
  const changed=Buffer.from(original);changed[24]^=1;
  const badTail=encodeJournalFrame(Buffer.from('not a journal record\n'));
  for(const bytes of [changed,Buffer.concat([original,badTail])]){
    const dir=await directory();
    for(const name of ['workspace.json',store.checkpointSlot])await fs.copyFile(path.join(f.dir,name),path.join(dir,name));
    await fs.writeFile(path.join(dir,'events.jsonl'),bytes);
    const next=new Store(dir);await assert.rejects(next.open(),/No history was reset/);
    assert.deepEqual(await fs.readFile(next.file),bytes);await assert.rejects(fs.access(next.lockFile),{code:'ENOENT'});
  }
});

test('repacking after a fast start preserves exact bytes and refreshes the physical binding',async t=>{
  const f=await synthetic();const original=new Store(f.dir,{compressionThreshold:1});await original.open();
  original.compressionThreshold=Infinity;await original.close();
  const next=new Store(f.dir);await next.open();assert.equal(next.journalHasher,null);
  await next.command({type:'draft.save',payload:{chatId:next.state.chats[0].id,text:'New packed tail'}});
  const expected=await expanded(f.file);next.compressionThreshold=1;await next.close();
  assert.deepEqual(await expanded(f.file),expected);assert.equal((await journalInfo(f.file)).frames.length,2);
  const again=new Store(f.dir);await again.open();t.after(()=>again.close());
  assert.equal(again.startupDiagnostics.path,'checkpoint');assert.equal(again.startupDiagnostics.checkpointBinding,'stored-bytes');
  assert.equal(again.startupDiagnostics.tailRecords,0);assert.deepEqual(again.state,next.state);
});

test('older logical-byte checkpoints on packed history upgrade after verification',async t=>{
  const f=await synthetic();const first=new Store(f.dir,{compressionThreshold:1});await first.open();
  const file=path.join(f.dir,first.checkpointSlot),saved=decodeCheckpoint(await fs.readFile(file));
  first.checkpoints=false;first.compressionThreshold=Infinity;await first.close();
  saved.profile='branchline.startup-checkpoint/1';delete saved.storage;await fs.writeFile(file,encodeCheckpoint(saved));
  const upgraded=new Store(f.dir);await upgraded.open();assert.equal(upgraded.startupDiagnostics.checkpointBinding,'logical-bytes');
  assert.equal(decodeCheckpoint(await fs.readFile(path.join(f.dir,upgraded.checkpointSlot))).profile,PACKED_CHECKPOINT_PROFILE);
  await upgraded.close();const next=new Store(f.dir);await next.open();t.after(()=>next.close());
  // Both generations cover the same sequence; prefer the newer packed binding.
  assert.equal(next.startupDiagnostics.checkpointBinding,'stored-bytes');assert.deepEqual(next.state,f.state);
});

test('packed backups are physically small, fully replayable and restore to a separate workspace',async t=>{
  const f=await synthetic();const store=new Store(f.dir,{compressionThreshold:1});await store.open();t.after(()=>store.close());
  const storage=new StorageManager(store,path.join(f.dir,'backups'));
  const backup=await storage.backup();assert(backup.bytes<f.bytes.length/20);assert.equal((await storage.verify(backup.id)).valid,true);
  const recovered=await storage.restoreCopy(backup.id);const copy=new Store(recovered.restoredPath);await copy.open();t.after(()=>copy.close());
  assert.deepEqual(copy.state,store.state);assert.equal(copy.workspaceId,store.workspaceId);
  assert.deepEqual(await expanded(copy.file),await expanded(store.file));
  const manifestFile=path.join(storage.backupDir,backup.id,'manifest.json');
  const manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));manifest.unpackedJournalBytes--;
  await fs.writeFile(manifestFile,JSON.stringify(manifest));await assert.rejects(storage.verify(backup.id),/counts/);
  const info=await storage.info();assert.equal(info.expandedJournalBytes,f.bytes.length);assert(info.compressed);
  assert.match(storagePanel(info),/Losslessly compressed/);assert.match(storagePanel(info),/Startup save points/);
});

test('plain version-one backups remain verifiable and restorable',async t=>{
  const f=await synthetic();const store=new Store(f.dir,{compressionThreshold:Infinity});await store.open();t.after(()=>store.close());
  const storage=new StorageManager(store,path.join(f.dir,'backups'));const backup=await storage.backup();
  const file=path.join(storage.backupDir,backup.id,'manifest.json');const value=JSON.parse(await fs.readFile(file,'utf8'));
  value.version=1;delete value.unpackedJournalBytes;await fs.writeFile(file,JSON.stringify(value));
  assert.equal((await storage.verify(backup.id)).valid,true);await storage.restoreCopy(backup.id);
});

test('less-compressible data still round trips, and extra bytes inside a block are rejected',async()=>{
  const dir=await directory(),file=path.join(dir,'events.jsonl');const raw=crypto.randomBytes(128*1024);
  const frame=encodeJournalFrame(raw);await fs.writeFile(file,Buffer.concat([JOURNAL_MAGIC,frame]));
  assert.deepEqual(await expanded(file),raw);assert.equal((await journalFingerprint(file)).sha256,sha(raw));
  const altered=Buffer.concat([frame,Buffer.from('unexpected')]);const packed=altered.subarray(80);
  altered.writeBigUInt64LE(BigInt(packed.length),8);Buffer.from(sha(packed),'hex').copy(altered,48);
  await fs.writeFile(file,Buffer.concat([JOURNAL_MAGIC,altered]));await assert.rejects(expanded(file));
});

test('export unfolds exact bytes and refuses to overwrite any destination',async()=>{
  const f=await synthetic();await packing(f);const target=path.join(f.dir,'export.jsonl');
  const run=async()=>{const child=spawn(process.execPath,['scripts/Export-Journal.mjs',f.file,target],{windowsHide:true,stdio:'ignore'});return (await once(child,'exit'))[0];};
  assert.equal(await run(),0);assert.deepEqual(await fs.readFile(target),f.bytes);
  assert.notEqual(await run(),0);assert.deepEqual(await fs.readFile(target),f.bytes);
});

test('process interruption on either side of atomic replacement preserves exact source bytes',async()=>{
  for(const point of ['verified','published']){
    const f=await synthetic();
    const code=`import {packJournal} from './server/journal-codec.mjs'; await packJournal(process.argv[1],{threshold:1,expectedBytes:Number(process.argv[2]),expectedSha256:process.argv[3],onStage:async stage=>{if(stage===process.argv[4]){setInterval(()=>{},1000);process.stdout.write('paused');await new Promise(()=>{});}}});`;
    const child=spawn(process.execPath,['--input-type=module','-e',code,f.file,String(f.bytes.length),sha(f.bytes),point],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    const exited=once(child,'exit');let errors='';child.stderr.on('data',chunk=>errors+=chunk);
    try{
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Fixture timeout '+errors)),10000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('error',reject);});
      child.kill();await exited;
    }finally{if(child.exitCode===null&&child.signalCode===null){child.kill();await exited;}}
    assert.deepEqual(await expanded(f.file),f.bytes);assert.deepEqual((await replayJournal(f.file)).state,f.state);
  }
});
