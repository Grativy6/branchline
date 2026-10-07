import test, { mock } from 'node:test';
import os from 'node:os';
// Lifecycle fixtures must not depend on memory used by a concurrent real-model check.
mock.method(os, 'freemem', () => 8 * 1024 ** 3);
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { initialState, applyCommand } from '../server/domain.mjs';
import { BUNDLED_PROFILE } from '../server/bundled-profile.mjs';
import { configureBundledModel } from '../server/bundled-setup.mjs';
import { BundledRunner, hashFile } from '../server/bundled-runner.mjs';
import { Store } from '../server/store.mjs';
import { contextBudget } from '../server/context-budget.mjs';
import { fixture } from './helpers.mjs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import http from 'node:http';
import { connectionToolProtocol } from '../server/tool-contract.mjs';

const scratch = async () => { await fs.mkdir('.test-data', { recursive: true }); return fs.mkdtemp(path.resolve('.test-data/bundled-')); };
test('fresh default creates a stock personal model with visitor free; existing choices never refill', async () => {
  const before = initialState(), state = configureBundledModel(before, { fresh: true });
  assert.equal(before.models.length, 0); assert.equal(state.models[0].model, BUNDLED_PROFILE.model);
  const seats = state.chats[0].table.assignments[0];
  assert.equal(seats.personalId, state.personalParticipants[0].id); assert.equal(seats.visitorModelId, null);
  assert.equal(configureBundledModel(state, { fresh: true }), state);
  const empty = initialState(); assert.equal(configureBundledModel(empty), empty);
  const existing = applyCommand(empty, { type: 'root.create', payload: { name: 'An intentionally empty desk', mode: 'personal' } });
  assert.equal(configureBundledModel(existing, { fresh: true }), existing);
});
test('fresh-workspace detection survives empty reopen and distinguishes a legacy workspace', async () => {
  const dir = await scratch(), store = new Store(dir); await store.open(); assert.equal(store.freshWorkspace, true); await store.close();
  const reopened = new Store(dir); await reopened.open(); assert.equal(reopened.freshWorkspace, false); await reopened.close();
  const legacy = await scratch(); await fs.writeFile(path.join(legacy, 'events.jsonl'), '');
  const old = new Store(legacy); await old.open(); assert.equal(old.freshWorkspace, false); await old.close();
});
test('bundled registration cannot substitute a route, model, prompt format, or thinking setting', () => {
  for (const patch of [{baseUrl:'http://127.0.0.1:1234/v1'}, {model:'other'}, {inputFormat:'plain-dialogue-v1'}, {thinking:true}]) {
    assert.throws(() => applyCommand(initialState(), {type:'model.save', payload:{...BUNDLED_PROFILE,...patch}}), /fixed local connection/);
  }
  let state = applyCommand(initialState(), {type:'model.save',payload:BUNDLED_PROFILE});
  assert.throws(() => applyCommand(state, {type:'model.save',payload:{...state.models[0],runtime:'compatible'}}), /separate connection/);
});
test('bundled context reserves reply and overhead without a discovery call', async () => {
  const budget = await contextBudget(BUNDLED_PROFILE, {maxTokens:2048});
  assert.equal(budget.loadedTokens,8192); assert.equal(budget.characters,15360);
});
test('absent or malformed payload fails without starting a process or inventing image support', async () => {
  const dir = await scratch(); let spawned = false;
  const runner = new BundledRunner(dir,{spawnProcess:()=>{spawned=true;throw Error('unexpected');}});
  await runner.open(); assert.equal(runner.status().available,false);
  await assert.rejects(runner.ensure(new AbortController().signal),/not installed/);
  await assert.rejects(runner.imageCapability(BUNDLED_PROFILE),/not installed/);
  await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify({profile:'branchline.bundled-qwen/1',files:[{path:'../attack.exe',bytes:1,sha256:'0'.repeat(64)}]}));
  await assert.rejects(runner.open(),/reviewed model/); assert.equal(spawned,false); await runner.close();
});
test('model controls require the paired UI and reject unbounded actions', async t => {
  const f=await fixture(t);
  assert.equal((await fetch(f.url+'/api/local-model/status')).status,401);
  assert.equal((await f.post('/api/local-model/control',{action:'shell',command:'anything'})).status,400);
  assert.equal((await f.post('/api/local-model/control',{action:'cpu'})).body.preference,'cpu');
  assert.equal(f.app.store.state.handoffs.records.at(-1).kind,'operation.result');
});
test('file hashing is streamed and cancellation is honored', async () => {
  const dir=await scratch(), file=path.join(dir,'chunks.bin'), block=Buffer.alloc(1024*1024,17), expected=crypto.createHash('sha256');
  const handle=await fs.open(file,'wx');
  try {for(let i=0;i<33;i++){await handle.write(block);expected.update(block);}} finally {await handle.close();}
  assert.equal(await hashFile(file),expected.digest('hex'));
  const stop=new AbortController();stop.abort();await assert.rejects(hashFile(file,stop.signal),{name:'AbortError'});
});

test('included model exposes the existing structured tool protocol', () => {
  assert.equal(connectionToolProtocol(BUNDLED_PROFILE), 'openai-functions/1');
});

async function fakeRuntime(options = {}) {
  const dir = await scratch();
  for (const backend of ['cpu','vulkan']) { await fs.mkdir(path.join(dir,backend)); await fs.writeFile(path.join(dir,backend,'llama-server.exe'),'synthetic'); }
  const runner = new BundledRunner(dir, {platform:'win32',architecture:'x64',...options});
  // This fixture isolates lifecycle behavior; separate tests check real bytes.
  runner.verified = true; runner.state.available = true;
  return runner;
}
function fakeChild() {
  const child = new EventEmitter(); child.stderr = new PassThrough(); child.exitCode = null; child.signalCode = null;
  child.kill = () => { child.exitCode = 1; child.emit('exit',1); return true; };
  return child;
}
test('an occupied port receives no session key before the owned runtime binds', async () => {
  let calls = 0, killed = 0;
  const server = http.createServer((req,res) => {calls++;res.end('{}');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const runner = await fakeRuntime({allocatePort:async()=>server.address().port,spawnProcess:()=>{const child=fakeChild();setTimeout(()=>{killed++;child.kill();},25);return child;}});
  try { await assert.rejects(runner.ensure(new AbortController().signal),/could not load/); assert.equal(calls,0); assert.equal(killed,2); }
  finally { await runner.close(); await new Promise(r=>server.close(r)); }
});
test('cancel while loading kills only the owned child and allows a later retry', async () => {
  const children=[];
  const runner=await fakeRuntime({spawnProcess:()=>{const child=fakeChild();children.push(child);return child;}});
  const abort=new AbortController();const pending=runner.ensure(abort.signal);setTimeout(()=>abort.abort(),40);
  await assert.rejects(pending,{name:'AbortError'});assert.equal(children.length,1);assert.equal(children[0].exitCode,1);assert.equal(runner.status().phase,'idle');
  const second=new AbortController();const retry=runner.ensure(second.signal);setTimeout(()=>second.abort(),40);
  await assert.rejects(retry,{name:'AbortError'});assert.equal(children.length,2);await runner.close();
});
test('failed graphics backend falls back to CPU; crash can be restarted and foreign model switch unloads', async () => {
  let token, port, attempts=0;
  const server=http.createServer((req,res)=>{assert.equal(req.headers.authorization,'Bearer '+token);res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:BUNDLED_PROFILE.model}]}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));port=server.address().port;
  const runner=await fakeRuntime({allocatePort:async()=>port,spawnProcess:(exe,args,options)=>{
    attempts++; const child=fakeChild();token=options.env.LLAMA_API_KEY;
    assert.equal(options.shell,false);assert.equal(options.windowsHide,true);assert(!args.includes(token));
    if(attempts===1)setTimeout(()=>child.kill(),10);else setTimeout(()=>child.stderr.write('listening on http://127.0.0.1:'+port),10);return child;
  }});
  try {
    await runner.ensure(new AbortController().signal);assert.equal(runner.status().backend,'cpu');assert.equal(attempts,2);
    runner.child.kill();assert.equal(runner.status().phase,'error');await runner.ensure(new AbortController().signal);assert.equal(attempts,3);
    const child=runner.child;await runner.beforeOtherLocal();assert.equal(child.exitCode,1);assert.equal(runner.status().phase,'idle');assert.equal(runner.child,null);
  } finally {await runner.close();await new Promise(r=>server.close(r));}
});

test('low-memory refusal occurs before any runtime process starts', async t => {
  t.mock.method(os, 'freemem', () => 1024 ** 3);
  let spawned = false;
  const runner = await fakeRuntime({spawnProcess: () => { spawned = true; throw Error('unexpected spawn'); }});
  try { await assert.rejects(runner.ensure(new AbortController().signal), /more free memory/); assert.equal(spawned, false); }
  finally { await runner.close(); }
});
