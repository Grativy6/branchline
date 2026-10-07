import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { Store } from '../server/store.mjs';
import { replayJournal } from '../server/journal.mjs';
import { CHECKPOINT_FILES, CHECKPOINT_LIMIT, publishStartupCheckpoint, decodeCheckpoint } from '../server/startup-checkpoint.mjs';
import { digest } from '../server/integrity.mjs';
import { initialState, applyCommand, appendExchange } from '../server/domain.mjs';
import { StorageManager } from '../server/storage.mjs';
import { createApp } from '../server/index.mjs';
import { recordHandoff, prepareModelHandoff, assertModelInvocation } from '../server/handoff.mjs';
import { compileMessages } from '../server/model.mjs';
import { fixture, listen, deferred } from './helpers.mjs';

async function fresh(t, options = {}) {
  await fs.mkdir('.test-data', { recursive: true });
  const dir = await fs.mkdtemp(path.resolve('.test-data/checkpoint-'));
  const store = new Store(dir, options); await store.open();
  t.after(() => store.close());
  await store.command({ type: 'root.create', payload: { name: 'Synthetic 🌱 é', mode: 'personal' } });
  await store.command({ type: 'message.note', payload: { chatId: store.state.chats[0].id, content: 'Preserved synthetic note.' } });
  return store;
}
async function reopen(t, store, options = {}) {
  store.checkpoints = false; await store.close();
  const next = new Store(store.dataDir, options); await next.open(); t.after(() => next.close()); return next;
}
const draft = (store, text) => store.command({ type: 'draft.save', payload: { chatId: store.state.chats[0].id, text } });
const checkpointFile = store => path.join(store.dataDir, store.checkpointSlot);

test('startup checkpoint and zero/small/large UTF-8 tails exactly equal full replay', async t => {
  for (const tail of [0, 1, 105]) {
    const store = await fresh(t); await store.requestCheckpoint();
    const covered = store.sequence, original = await fs.readFile(store.file);
    store.checkpoints = false;
    for (let i = 0; i < tail; i++) await draft(store, '尾部 🌱 ' + i);
    const expected = structuredClone(store.state), full = await replayJournal(store.file);
    const next = await reopen(t, store);
    assert.equal(next.startupDiagnostics.path, 'checkpoint');
    assert.equal(next.startupDiagnostics.coveredSequence, covered);
    assert.equal(next.startupDiagnostics.tailRecords, tail);
    assert.deepEqual(next.state, expected); assert.deepEqual(next.state, full.state);
    assert.equal(next.sequence, full.recordCount);
    assert.deepEqual((await fs.readFile(store.file)).subarray(0, original.length), original);
    assert.equal(next.journalHasher.copy().digest('hex'), full.hasher.copy().digest('hex'));
  }
});

test('legacy CRLF snapshots followed by new changes retain exact original bytes', async t => {
  const store = await fresh(t, { checkpoints: false }); await store.close();
  const raw = Buffer.from(JSON.stringify({ type: 'snapshot', sequence: 1, at: 'synthetic', state: store.state }) + '\r\n');
  await fs.writeFile(store.file, raw);
  const next = new Store(store.dataDir); await next.open(); t.after(() => next.close());
  await next.requestCheckpoint();
  const fromSnapshot = await reopen(t, next); assert.equal(fromSnapshot.startupDiagnostics.path, 'checkpoint');
  await draft(fromSnapshot, 'Following the original snapshot');
  await fromSnapshot.requestCheckpoint();
  const fromChange = await reopen(t, fromSnapshot);
  assert.equal(fromChange.startupDiagnostics.path, 'checkpoint');
  assert.equal(fromChange.sequence, 2);
  assert.deepEqual((await fs.readFile(store.file)).subarray(0, raw.length), raw);
});

test('invalid cache fields fall back without substituting state or changing the journal', async t => {
  const edits = [
    value => { value.profile = 'future'; },
    value => { value.replayRulesVersion++; },
    value => { value.workspaceId = '0'.repeat(32); },
    value => { value.throughByte--; },
    value => { value.boundary.start++; },
    value => { value.throughSequence = 1; },
    value => { value.prefixSha256 = '0'.repeat(64); },
    value => { value.state.roots[0].name = 'Substituted'; value.stateHash = digest(value.state); },
  ];
  for (const edit of edits) {
    const store = await fresh(t); await store.requestCheckpoint();
    const file = checkpointFile(store), value = decodeCheckpoint(await fs.readFile(file));
    const expected = structuredClone(store.state), bytes = await fs.readFile(store.file);
    edit(value); await fs.writeFile(file, JSON.stringify(value));
    const next = await reopen(t, store);
    assert.equal(next.startupDiagnostics.path, 'full-replay');
    assert(next.startupDiagnostics.rejections.length > 0);
    assert.deepEqual(next.state, expected); assert.deepEqual(await fs.readFile(store.file), bytes);
  }
});

test('missing, partial and oversized caches fall back; incomplete temp files are ignored', async t => {
  for (const kind of ['missing', 'partial', 'oversized']) {
    const store = await fresh(t);
    if (kind !== 'missing') {
      const file = path.join(store.dataDir, CHECKPOINT_FILES[0]);
      if (kind === 'partial') await fs.writeFile(file, '{');
      else { const handle = await fs.open(file, 'wx'); try { await handle.truncate(CHECKPOINT_LIMIT + 1); } finally { await handle.close(); } }
    }
    const temp = path.join(store.dataDir, CHECKPOINT_FILES[1] + '.tmp-retained'); await fs.writeFile(temp, 'incomplete');
    const next = await reopen(t, store);
    assert.equal(next.startupDiagnostics.path, 'full-replay'); assert.deepEqual(next.state, store.state);
    assert.equal(await fs.readFile(temp, 'utf8'), 'incomplete');
  }
});

test('older generation is usable with the full tail when the newer cache is damaged', async t => {
  const store = await fresh(t); await store.requestCheckpoint(); const covered = store.sequence;
  await draft(store, 'Second generation'); await store.requestCheckpoint();
  await fs.writeFile(checkpointFile(store), '{partial');
  const next = await reopen(t, store);
  assert.equal(next.startupDiagnostics.path, 'checkpoint');
  assert.equal(next.startupDiagnostics.coveredSequence, covered);
  assert.deepEqual(next.state, store.state);
});

test('changed prefix replays fully; invalid prefix or tail cannot hide behind a checkpoint', async t => {
  for (const kind of ['changed-valid-prefix', 'invalid-prefix', 'incomplete-tail', 'invalid-tail']) {
    const store = await fresh(t); await store.requestCheckpoint(); store.checkpoints = false; await store.close();
    if (kind === 'changed-valid-prefix') {
      const raw = await fs.readFile(store.file, 'utf8'); await fs.writeFile(store.file, raw.replace('"at":"', '"at":"changed-'));
      const next = new Store(store.dataDir); await next.open(); t.after(() => next.close());
      assert.equal(next.startupDiagnostics.path, 'full-replay'); assert.deepEqual(next.state, store.state);
    } else {
      if (kind === 'invalid-prefix') { const raw = await fs.readFile(store.file); raw[0] = 33; await fs.writeFile(store.file, raw); }
      else await fs.appendFile(store.file, kind === 'incomplete-tail' ? '{' : 'invalid\n');
      const bytes = await fs.readFile(store.file), next = new Store(store.dataDir);
      await assert.rejects(next.open(), /No history was reset/);
      assert.deepEqual(await fs.readFile(store.file), bytes);
      await assert.rejects(fs.access(next.lockFile), { code: 'ENOENT' });
    }
  }
});

test('a missing journal with a saved checkpoint does not create an empty replacement', async t => {
  const store = await fresh(t); await store.requestCheckpoint(); store.checkpoints = false; await store.close();
  await fs.rename(store.file, store.file + '.retained-for-test');
  const next = new Store(store.dataDir); await assert.rejects(next.open(), /journal is missing or empty/);
  await assert.rejects(fs.access(store.file), { code: 'ENOENT' });
});

test('writes continue during checkpoint publication and coalesce to a consistent later cutoff', async t => {
  const entered = deferred(), release = deferred(); let calls = 0;
  const store = await fresh(t, { checkpointWriter: async (...args) => {
    if (++calls === 1) { entered.resolve(); await release.promise; }
    return publishStartupCheckpoint(...args);
  } });
  const pending = store.requestCheckpoint(); await entered.promise;
  await draft(store, 'Saved while checkpoint writer waits');
  const same = store.requestCheckpoint(); assert.equal(same, pending);
  release.resolve(); await pending; assert.equal(calls, 2);
  const next = await reopen(t, store); assert.equal(next.startupDiagnostics.tailRecords, 0);
  assert.deepEqual(next.state, store.state);
});

test('disk/rename failure preserves normal journal writes and the prior cache generation', async t => {
  const store = await fresh(t); await store.requestCheckpoint();
  const priorFile = checkpointFile(store), prior = await fs.readFile(priorFile);
  // A directory at the target slot makes the actual Windows replacement fail.
  await fs.mkdir(path.join(store.dataDir, CHECKPOINT_FILES[1]));
  await draft(store, 'Still saved'); assert.equal((await store.requestCheckpoint()).status, 'unavailable');
  assert.equal(store.writeFault, null); await draft(store, 'Saved after cache failure');
  assert.deepEqual(await fs.readFile(priorFile), prior);
  assert((await fs.readdir(store.dataDir)).some(name => name.includes('.tmp-')));
  const next = await reopen(t, store);
  assert.equal(next.startupDiagnostics.path, 'checkpoint'); assert.deepEqual(next.state, store.state);
});

test('process loss before or after checkpoint replacement leaves committed history recoverable', async t => {
  for (const point of ['after-journal-sync', 'before-rename', 'after-rename']) {
    const dir = await fs.mkdtemp(path.resolve('.test-data/checkpoint-crash-'));
    const code = `
      import fs from 'node:fs/promises';
      import { Store } from './server/store.mjs';
      const hold = async () => { setInterval(() => {}, 1000); process.stdout.write('paused\\n'); await new Promise(() => {}); };
      const point = process.argv[1], dir = process.argv[2];
      if (point !== 'after-journal-sync') {
        const original = fs.rename;
        fs.rename = async (from, to) => {
          if (to.endsWith('startup-checkpoint-a.json') && point === 'before-rename') await hold();
          const result = await original(from, to);
          if (to.endsWith('startup-checkpoint-a.json') && point === 'after-rename') await hold();
          return result;
        };
      }
      const store = new Store(dir, point === 'after-journal-sync' ? { checkpointWriter: hold } : {});
      await store.open();
      await store.command({ type: 'root.create', payload: { name: 'Committed before interruption', mode: 'personal' } });
      await store.requestCheckpoint();
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, point, dir], {
      cwd: path.resolve('.'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let errors = ''; child.stderr.on('data', b => errors += b);
    const exited = new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    const lines = readline.createInterface({ input: child.stdout });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Crash fixture did not pause: ' + errors)), 10000);
        lines.on('line', line => { if (line === 'paused') { clearTimeout(timer); resolve(); } });
      });
      child.kill(); await exited;
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill(); lines.close(); }
    const journal = path.join(dir, 'events.jsonl'), original = await fs.readFile(journal);
    const store = new Store(dir); await store.open(); t.after(() => store.close());
    assert.equal(store.sequence, 1); assert.equal(store.state.roots[0].name, 'Committed before interruption');
    assert.equal(store.startupDiagnostics.path, point === 'after-rename' ? 'checkpoint' : 'full-replay');
    assert.deepEqual(await fs.readFile(journal), original);
    if (point === 'before-rename') assert((await fs.readdir(dir)).some(name => name.includes('.tmp-')));
  }
});

test('threshold, quiet refresh and clean close create committed checkpoints without model calls', async t => {
  const store = await fresh(t, { checkpointPolicy: { events: 2, quietMs: 25 } });
  await store.checkpointPromise; assert.equal(store.checkpointSequence, 2);
  await draft(store, 'Quiet save');
  await new Promise(resolve => setTimeout(resolve, 80)); await store.checkpointPromise;
  assert.equal(store.checkpointSequence, store.sequence);
  await draft(store, 'Close save'); await store.close();
  const next = new Store(store.dataDir); await next.open(); t.after(() => next.close());
  assert.equal(next.startupDiagnostics.tailRecords, 0); assert.deepEqual(next.state, store.state);
});

test('backup and restore still fully replay and exclude caches and diagnostics', async t => {
  const store = await fresh(t); await store.requestCheckpoint();
  const storage = new StorageManager(store, path.join(store.dataDir, 'backups'));
  const backup = await storage.backup(); assert.equal((await storage.verify(backup.id)).valid, true);
  assert.deepEqual((await fs.readdir(path.join(storage.backupDir, backup.id))).sort(), ['events.jsonl', 'manifest.json', 'workspace.json']);
  const restored = await storage.restoreCopy(backup.id), copy = new Store(restored.restoredPath);
  await copy.open(); t.after(() => copy.close());
  assert.equal(copy.startupDiagnostics.path, 'full-replay'); assert.deepEqual(copy.state, store.state);
});

test('pending reply and operation survive checkpoint startup as interruption receipts, with no inference', async t => {
  const f = await fixture(t); let handle;
  await f.app.store.transact(state => {
    const taskId = 'exchange_checkpoint_interrupted';
    const messages = compileMessages(state, f.chatId, 'Synthetic interrupted request');
    handle = prepareModelHandoff(state, { taskId, chatId: f.chatId, kind: 'reply', messages, purpose: 'Synthetic interrupted request' });
    assertModelInvocation(handle, messages, state.models[0]);
    recordHandoff(state, { kind: 'operation.request', from: 'local_ui', to: 'fixed_application_operation',
      payload: {}, status: 'REQUEST_RECORDED', detail: { operation: 'synthetic' } });
    return appendExchange(state, f.chatId, { id: taskId, content: 'Synthetic interrupted request', modelId: state.models[0].id });
  });
  const oldToken = f.app.sessionToken; await f.app.dispose();
  f.app = await createApp({ dataDir: f.dataDir, backupDir: f.backupDir }); f.url = await listen(f.app);
  assert.equal(f.app.store.startupDiagnostics.path, 'checkpoint');
  assert.equal(f.app.store.state.exchanges.at(-1).status, 'failed');
  assert(f.app.store.state.handoffs.records.some(r => r.kind === 'operation.interrupted'));
  assert.equal(f.requests.length, 0); assert.notEqual(f.app.sessionToken, oldToken);
  assert.equal((await fetch(f.url + '/api/state', { headers: { 'x-branchline-session': oldToken } })).status, 401);
});

test('empty workspace starts normally without creating a checkpoint', async t => {
  await fs.mkdir('.test-data', { recursive: true });
  const dir = await fs.mkdtemp(path.resolve('.test-data/checkpoint-empty-'));
  const store = new Store(dir); await store.open(); await store.close();
  assert.deepEqual(store.state, initialState());
  for (const name of CHECKPOINT_FILES) await assert.rejects(fs.access(path.join(dir, name)), { code: 'ENOENT' });
});
