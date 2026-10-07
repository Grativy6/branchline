import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { poolCheckpoint, unpoolCheckpoint, EXPANDED_CHECKPOINT_LIMIT } from '../server/checkpoint-pool.mjs';
import { encodeCheckpoint, decodeCheckpoint } from '../server/startup-checkpoint.mjs';
import { Store } from '../server/store.mjs';
import { fixture, deferred } from './helpers.mjs';
import { journalFingerprint, journalInfo } from '../server/journal-codec.mjs';
import { digest } from '../server/integrity.mjs';

test('pooled checkpoints preserve independent occurrences and reject false expansion budgets', () => {
  const text = 'Repeated quoted text 🌱 '.repeat(1000);
  const value = { strings: ['s', 1], literal: ['o', [['__proto__', null]]], nested: { a: text, b: text }, numbers: [-0, null, true, 42] };
  const encoded = poolCheckpoint(value);
  assert.equal(encoded.strings.length, 1);
  assert.deepEqual(unpoolCheckpoint(encoded), value);
  assert.equal(encoded.expandedBytes, Buffer.byteLength(JSON.stringify(value)));
  assert.throws(() => unpoolCheckpoint({ ...encoded, expandedBytes: encoded.expandedBytes - 1 }), /expanded-size/);
  assert.throws(() => unpoolCheckpoint({ ...encoded, expandedBytes: EXPANDED_CHECKPOINT_LIMIT + 1 }), /pool/);
  const duplicate = poolCheckpoint({ a: text }); duplicate.root[1].push(['a', ['s', 0]]);
  assert.throws(() => unpoolCheckpoint(duplicate), /pool/);
  const forged = { expandedBytes: 1, strings: [text], root: ['a', Array(7000).fill(['s', 0])] };
  assert.throws(() => unpoolCheckpoint(forged), /expanded-size/);
  assert.deepEqual(decodeCheckpoint(encodeCheckpoint(value)), { ...value, numbers: [0, null, true, 42] });
});

test('workspace over the old 32 MiB ceiling reopens through a bounded save point', async t => {
  await fs.mkdir('.test-data', { recursive: true });
  const dir = await fs.mkdtemp(path.resolve('.test-data/checkpoint-efficient-'));
  const store = new Store(dir, { checkpoints: false, compressionThreshold: Infinity }); await store.open();
  t.after(() => store.close());
  // The native smoke host recognizes this explicit synthetic navigation label.
  await store.command({ type: 'root.create', payload: { name: 'Synthetic packet branch · large checkpoint', mode: 'personal' } });
  const repeated = 'Synthetic retained draft. '.repeat(7600); // 190,000 bytes, below each draft limit.
  await store.transact(state => {
    const source = state.chats[0];
    for (let i = 0; i < 185; i++) { const id = `chat_synthetic_${i}`; state.chats.push({ ...source, id, title: `Synthetic ${i}` }); state.drafts[id] = repeated; }
    return state;
  }, { returnState: false });
  assert.ok(Buffer.byteLength(JSON.stringify(store.state)) > 32 * 1024 * 1024);
  const stateHash = digest(store.state);
  store.checkpoints = true;
  const pending = store.requestCheckpoint();
  let ticks = 0; const timer = setInterval(() => ticks++, 10);
  const result = await pending; clearInterval(timer);
  assert.equal(result.status, 'saved'); assert.ok(ticks > 0, 'Encoding allows the server event loop to run.');
  assert.ok((await fs.stat(path.join(dir, store.checkpointSlot))).size < 1024 * 1024);
  await store.close();
  const journal = await journalFingerprint(store.file);
  await fs.mkdir('test-results/0724', { recursive: true });
  await fs.writeFile('test-results/0724/large-fixture.json', JSON.stringify({ syntheticOnly: true, timingProfile: 'large-checkpoint', workspace: dir,
    stateHash, stateBytes: Buffer.byteLength(JSON.stringify(store.state)), journalBytes: journal.bytes, journalSha256: journal.sha256 }));
  const next = new Store(dir, { compressionThreshold: Infinity }); await next.open(); t.after(() => next.close());
  assert.equal(next.startupDiagnostics.path, 'checkpoint'); assert.equal(next.startupDiagnostics.tailRecords, 0);
  assert.equal(digest(next.state), stateHash);
});

test('failed replacement save point leaves the old packed binding usable', async t => {
  const f = await fixture(t), store = f.app.store;
  store.compressionThreshold = 1;
  await store.atQueueBoundary(() => store.compressHistory());
  await store.requestCheckpoint();
  await store.command({ type: 'draft.save', payload: { chatId: f.chatId, text: 'Tail after the old save point.' } });
  const before = await fs.readFile(store.file), hash = await journalFingerprint(store.file);
  store.checkpointWriter = async () => { throw new Error('checkpoint-expanded-size'); };
  await store.atQueueBoundary(() => store.compressHistory());
  assert.deepEqual(await fs.readFile(store.file), before);
  assert.equal(store.checkpointFailure.code, 'checkpoint-expanded-size');
  assert.equal((await store.requestCheckpoint()).status, 'unavailable');
  assert.deepEqual(await journalFingerprint(store.file), hash);
  assert.equal((await journalInfo(store.file)).compressed, true);
  store.checkpoints = false; await f.app.dispose();
  const next = new Store(f.dataDir, { compressionThreshold: Infinity }); await next.open(); t.after(() => next.close());
  assert.equal(next.startupDiagnostics.path, 'checkpoint'); assert.equal(next.state.drafts[f.chatId], 'Tail after the old save point.');
});

test('size failure is reported and not retried on every write or shutdown', async t => {
  const f = await fixture(t), store = f.app.store;
  let attempts = 0;
  store.checkpointWriter = async () => { attempts++; throw new Error('checkpoint-size'); };
  await store.requestCheckpoint();
  await store.command({ type: 'draft.save', payload: { chatId: f.chatId, text: 'Still durable.' } });
  await store.requestCheckpoint();
  assert.equal((await f.app.storage.info()).checkpointFailure.code, 'checkpoint-size');
  await f.app.dispose(); assert.equal(attempts, 1);
});

test('process loss between replacement save point and journal publication keeps a usable pair', async t => {
  for (const point of ['before-journal-rename', 'after-journal-rename']) {
    await fs.mkdir('.test-data', { recursive: true });
    const dir = await fs.mkdtemp(path.resolve('.test-data/checkpoint-pair-crash-'));
    const initial = new Store(dir, { compressionThreshold: Infinity }); await initial.open();
    await initial.command({ type: 'root.create', payload: { name: 'Synthetic repack crash', mode: 'personal' } });
    await initial.close();
    const code = `
      import fs from 'node:fs/promises';
      import path from 'node:path';
      import { Store } from './server/store.mjs';
      import { digest } from './server/integrity.mjs';
      import { journalFingerprint } from './server/journal-codec.mjs';
      const [point, dir] = process.argv.slice(1);
      const store = new Store(dir, { compressionThreshold: Infinity,
        checkpointPolicy: { events: Number.MAX_SAFE_INTEGER, bytes: Number.MAX_SAFE_INTEGER, quietMs: 60000 } });
      await store.open();
      await store.command({ type: 'draft.save', payload: { chatId: store.state.chats[0].id, text: 'Saved before repack.' } });
      await fs.writeFile(path.join(dir, 'expected.json'), JSON.stringify({ stateHash: digest(store.state), journal: await journalFingerprint(store.file) }));
      const hold = async () => { setInterval(() => {}, 1000); process.stdout.write('paused\\n'); await new Promise(() => {}); };
      const rename = fs.rename;
      fs.rename = async (from, to) => {
        if (to === store.file && point === 'before-journal-rename') await hold();
        const result = await rename(from, to);
        if (to === store.file && point === 'after-journal-rename') await hold();
        return result;
      };
      store.compressionThreshold = 1;
      await store.atQueueBoundary(() => store.compressHistory());
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, point, dir], {
      cwd: path.resolve('.'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let errors = ''; child.stderr.on('data', b => errors += b);
    const exited = new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    const lines = readline.createInterface({ input: child.stdout });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Repack fixture did not pause: ' + errors)), 10000);
        lines.on('line', line => { if (line === 'paused') { clearTimeout(timer); resolve(); } });
      });
      child.kill(); await exited;
    } finally {
      if (child.exitCode === null && child.signalCode === null) { child.kill(); await exited; }
      lines.close();
    }
    const expected = JSON.parse(await fs.readFile(path.join(dir, 'expected.json'), 'utf8'));
    const next = new Store(dir, { compressionThreshold: Infinity }); await next.open(); t.after(() => next.close());
    assert.equal(next.startupDiagnostics.path, 'checkpoint');
    assert.equal(next.startupDiagnostics.tailRecords, point === 'before-journal-rename' ? 1 : 0);
    assert.equal(digest(next.state), expected.stateHash);
    assert.deepEqual(await journalFingerprint(next.file), expected.journal);
  }
});

test('backup verification releases the writer queue and verifies only the captured history', async t => {
  const f = await fixture(t), storage = f.app.storage;
  const entered = deferred(), release = deferred(); t.after(() => release.resolve());
  const verify = storage.replayCopy.bind(storage); let replays = 0;
  storage.replayCopy = async file => { replays++; entered.resolve(); await release.promise; return verify(file); };
  const count = f.app.store.sequence;
  const backup = storage.backup(); await entered.promise;
  await f.command('draft.save', { chatId: f.chatId, text: 'Typing while a frozen backup is checked.' });
  release.resolve(); const saved = await backup;
  assert.equal(replays, 1); assert.equal(saved.recordCount, count);
  assert.equal(f.app.store.sequence, count + 1);
  assert.equal((await storage.verify(saved.id)).valid, true);
});
