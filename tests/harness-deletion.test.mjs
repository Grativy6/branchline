import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fixture, deferred } from './helpers.mjs';
import { Store } from '../server/store.mjs';
import { harnessSnapshot } from '../server/harnesses.mjs';
import { allHarnesses, harnessChoice } from '../public/harness-catalog.js';

const content = { name: 'Garden', description: 'Synthetic harness', instructions: 'Keep room for a little seed.' };
const latest = f => f.app.store.state.customHarnesses[0];
const status = f => ({ id: latest(f).id, baseVersion: latest(f).versions.at(-1).version, baseDeletedAt: latest(f).deletedAt ?? null });
const post = (f, type, payload) => f.post('/api/command', { type, payload });
const select = (f, chatId, ref, saveAsDefault = false) => {
  const chat = f.app.store.state.chats.find(c => c.id === chatId);
  return { chatId, baseRevisionId: harnessChoice(chat).id, baseDefaultId: f.app.store.state.roots[0].harnessDefaults?.at(-1)?.id ?? null, shared: true, personal: ref, visiting: ref, saveAsDefault };
};

test('library deletion preserves exact replies, ongoing choices and desk defaults; restore makes versions selectable again', async t => {
  const f = await fixture(t);
  await f.command('harness.create', { content });
  const ref = { id: latest(f).id, version: 1 };
  await f.command('harness.select', select(f, f.chatId, ref, true));
  await f.exchange();
  const reply = structuredClone(f.app.store.state.exchanges[0]), snapshot = harnessSnapshot(f.app.store.state, f.chatId);
  const versions = structuredClone(latest(f).versions), defaults = structuredClone(f.app.store.state.roots[0].harnessDefaults);
  await f.command('harness.delete', status(f));
  assert.ok(latest(f).deletedAt);
  assert.deepEqual(latest(f).versions, versions);
  assert.deepEqual(f.app.store.state.exchanges[0], reply);
  assert.deepEqual(f.app.store.state.roots[0].harnessDefaults, defaults);
  assert.deepEqual(harnessSnapshot(f.app.store.state, f.chatId), snapshot);
  assert.equal(allHarnesses(f.app.store.state).some(h => h.id === ref.id), false);
  await f.exchange('Keep this existing branch going.');
  assert.ok(f.requests.at(-1).messages[0].content.includes(content.instructions));
  await f.command('harness.select', select(f, f.chatId, ref)); // An unchanged selection is still valid.
  assert.equal((await post(f, 'harness.select', select(f, f.chatId, ref, true))).status, 400);
  await f.command('chat.create', { rootId: f.rootId, title: 'Inherited default' });
  const inherited = f.app.store.state.chats.at(-1);
  assert.deepEqual(harnessChoice(inherited).personal, ref);
  await f.command('root.create', { name: 'No saved default', mode: 'personal' });
  const freshId = f.app.store.state.chats.at(-1).id;
  assert.equal((await post(f, 'harness.select', select(f, freshId, ref))).status, 400);
  const exportResult = await fetch(f.url + '/api/harnesses/export?' + new URLSearchParams({ id: ref.id, version: '1', format: 'json' }), { headers: f.headers });
  assert.equal(exportResult.status, 200); assert.equal((await exportResult.json()).instructions, content.instructions);
  await f.command('harness.restore', status(f));
  assert.equal(latest(f).deletedAt, null);
  assert.ok(allHarnesses(f.app.store.state).some(h => h.id === ref.id));
  await f.command('harness.select', select(f, freshId, ref));
  assert.deepEqual(latest(f).versions, versions);
  assert.deepEqual(f.app.store.state.exchanges[0], reply);
});

test('delete and restore reject stale requests, starters and extra fields without writes; stale edits survive as uncommitted drafts', async t => {
  const f = await fixture(t);
  await f.command('harness.create', { content });
  const initial = status(f);
  await f.command('harness.revise', { id: initial.id, baseVersion: 1, content: { ...content, instructions: 'A later version.' } });
  const before = structuredClone(f.app.store.state), bytes = await fs.readFile(f.app.store.file);
  for (const [type, payload] of [
    ['harness.delete', initial],
    ['harness.delete', { id: 'tutor', baseVersion: 1, baseDeletedAt: null }],
    ['harness.delete', { ...status(f), tools: ['shell'] }],
    ['harness.restore', status(f)],
  ]) assert.equal((await post(f, type, payload)).status, 400);
  assert.deepEqual(f.app.store.state, before); assert.deepEqual(await fs.readFile(f.app.store.file), bytes);
  await f.command('harness.delete', status(f));
  const deleted = structuredClone(f.app.store.state), deletedBytes = await fs.readFile(f.app.store.file);
  for (const [type, payload] of [
    ['harness.delete', status(f)],
    ['harness.restore', { ...status(f), baseDeletedAt: null }],
    ['harness.revise', { id: initial.id, baseVersion: 2, content }],
  ]) assert.equal((await post(f, type, payload)).status, 400);
  assert.deepEqual(f.app.store.state, deleted); assert.deepEqual(await fs.readFile(f.app.store.file), deletedBytes);
  await assert.rejects(f.app.store.transact(s => { s.customHarnesses[0].deletedAt = 'not-a-date'; return s; }), /deletion marker/);
  await f.app.store.close();
  for (const checkpoints of [false, true]) {
    const replay = new Store(f.dataDir, { checkpoints }); await replay.open();
    assert.deepEqual(replay.state, deleted);
    assert.equal(replay.startupDiagnostics.path, checkpoints ? 'checkpoint' : 'full-replay');
    await replay.close();
  }
});

test('deletion cannot change an in-flight exchange', async t => {
  const f = await fixture(t), started = deferred(), finished = deferred();
  await f.command('harness.create', { content });
  f.handler = async (_, res) => { started.resolve(); await finished.promise; res.end(JSON.stringify({ choices: [{ message: { content: 'Done.' }, finish_reason: 'stop' }] })); };
  const pending = f.exchange(); await started.promise;
  try {
    const snapshot=structuredClone(f.app.store.state.exchanges.at(-1).harness);
    assert.equal((await post(f, 'harness.delete', status(f))).status, 200);
    assert.deepEqual(f.app.store.state.exchanges.at(-1).harness,snapshot);
    assert(latest(f).deletedAt);
  } finally { finished.resolve(); }
  await pending;
});
