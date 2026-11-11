import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture,input,until} from './desk-helpers.mjs';
import {Store} from '../server/store.mjs';
import {HistoryInputs,isInputRef,originalReceipt} from '../server/history-inputs.mjs';
import {packHandoffs,unpackHandoffs,INPUT_WIRE} from '../server/handoff-wire.mjs';
import {digest} from '../server/integrity.mjs';
import {validateState} from '../server/domain.mjs';
import {deskWork} from '../server/desk-work.mjs';

test('exact input snapshots stay outside state, reopen in wire packets, and survive backup relocation',async()=>{
  const f=await fixture({hold:false});try{
    for(let i=0;i<3;i++){await f.app.deskTasks.admit(input(f,'Remember this exact request '+i,'saved_input_'+i));await until(()=>f.app.store.state.exchanges.filter(e=>e.status==='completed').length===i+1,'saved reply');}
    const store=f.app.store,records=store.state.handoffs.records.filter(r=>r.kind==='context.to_model');
    assert(records.every(r=>isInputRef(r.detail.inputMessages)));assert.equal(store.state.schemaVersion,4);
    await store.transact(s=>{deskWork(s);return s;});assert.equal(store.state.schemaVersion,4,'desk activity cannot downgrade the saved-input format');
    assert.deepEqual(store.inputs.read(records[0].detail.inputMessages),f.requests[0].body.messages);
    const own=store.state.handoffs.records.filter(r=>r.taskId===records[0].taskId);
    const packet=packHandoffs(own,{inputReader:store.inputs});assert.equal(packet.v,INPUT_WIRE);assert(packet.inputMaterial);
    const decoded=unpackHandoffs(packet);assert(decoded);
    const corrupt=structuredClone(packet);Object.values(corrupt.inputMaterial)[0][0].content+=' changed';assert.throws(()=>unpackHandoffs(corrupt),/differ/);
    const backup=await f.app.storage.backup(),restored=await f.app.storage.restoreCopy(backup.id);
    const copy=new Store(restored.restoredPath,{checkpoints:false});await copy.open();
    try{assert.deepEqual(copy.inputs.read(records[0].detail.inputMessages),f.requests[0].body.messages);validateState(copy.state);}finally{await copy.close();}
    const ref=records[0].detail.inputMessages,manifest=store.inputs.object(ref.sha256),file=path.join(restored.restoredPath,'history','objects',manifest.messages[0]+'.json');
    await fs.writeFile(file,'{}');const reader=new HistoryInputs(restored.restoredPath);assert.throws(()=>reader.read(ref),/changed/);
  }finally{await f.close();}
});

test('legacy inline inputs migrate without changing receipt hashes or earlier journal bytes',async()=>{
  const f=await fixture({hold:false});let reopened;
  try{
    f.app.store.inputs.save=messages=>messages;
    await f.app.deskTasks.admit(input(f,'An original inline request.','legacy_input'));
    await until(()=>f.app.store.state.exchanges.some(e=>e.status==='completed'),'legacy reply');
    const before=structuredClone(f.app.store.state.handoffs.records),old=before.find(r=>r.kind==='context.to_model');assert(Array.isArray(old.detail.inputMessages));
    const dataDir=f.app.store.dataDir;await f.app.dispose();const prefix=await fs.readFile(path.join(dataDir,'events.jsonl'));
    reopened=new Store(dataDir,{checkpoints:false,compressionThreshold:Infinity});await reopened.open();
    const after=reopened.state.handoffs.records,now=after.find(r=>r.id===old.id);
    assert(isInputRef(now.detail.inputMessages));assert.equal(now.hash,old.hash);assert.equal(digest(originalReceipt(now,reopened.inputs)),digest(old));
    assert.deepEqual(after.map(r=>r.hash),before.map(r=>r.hash));assert.deepEqual((await fs.readFile(path.join(dataDir,'events.jsonl'))).subarray(0,prefix.length),prefix);
    assert.throws(()=>{reopened.state.handoffs.records[0].status='altered';},TypeError);
  }finally{await reopened?.close();await f.close();}
});
