import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fixture, deferred } from './helpers.mjs';
import { Store } from '../server/store.mjs';
import { compileMessages } from '../server/model.mjs';
import { harnessSnapshot } from '../server/harnesses.mjs';
import { harnessChoice } from '../public/harness-catalog.js';
import { HARNESS_PROFILE, HARNESS_LIMITS } from '../public/harness-format.js';

const content = (instructions = 'Explore quietly.\r\nKeep room for 🌱, <ideas>, and corrections.\n') => ({ name: 'Quiet garden', description: 'Synthetic custom instructions.', instructions });
const use = (f, seat = 'shared') => ({ chatId: f.chatId, baseRevisionId: harnessChoice(f.app.store.state.chats[0]).id, seat });
const create = (f, extra = {}) => f.command('harness.create', { content: content(), ...extra });
const last = f => f.app.store.state.customHarnesses.at(-1);
const file = (name, text) => ({ name, base64: Buffer.from(text).toString('base64') });
const post = (f, type, payload) => f.post('/api/command', { type, payload });

test('custom revisions remain pinned until selected; exact reply snapshots, receipts and both startup paths survive', async t => {
  const f = await fixture(t);
  await create(f, { use: use(f) }); const id = last(f).id;
  await f.exchange(); const oldTurn = structuredClone(f.app.store.state.exchanges[0]);
  assert.equal(oldTurn.harness.preset.instructions, content().instructions);
  assert.ok(f.requests[0].messages[0].content.includes(content().instructions));
  await f.command('harness.revise', { id, baseVersion: 1, content: content('Revision two.') });
  assert.equal(harnessSnapshot(f.app.store.state, f.chatId).preset.version, 1);
  await f.command('harness.revise', { id, baseVersion: 2, content: content('Revision three.'), use: use(f, 'visiting') });
  assert.equal(harnessSnapshot(f.app.store.state, f.chatId, 'visiting').preset.version, 3);
  assert.equal(harnessSnapshot(f.app.store.state, f.chatId, 'personal').preset.version, 1);
  assert.deepEqual(f.app.store.state.exchanges[0], oldTurn);
  const state = structuredClone(f.app.store.state);
  await f.app.store.close();
  for (const checkpoints of [false, true]) {
    const replay = new Store(f.dataDir, { checkpoints }); await replay.open();
    assert.deepEqual(replay.state, state);
    assert.equal(replay.startupDiagnostics.path, checkpoints ? 'checkpoint' : 'full-replay');
    await replay.close();
  }
});

test('save and apply is atomic; stale drafts, starter edits, extra grants and stale selections make no changes', async t => {
  const f = await fixture(t), staleUse = use(f);
  await create(f, { use: staleUse }); const id = last(f).id;
  const before = structuredClone(f.app.store.state), bytes = await fs.readFile(f.app.store.file);
  for (const [type, payload] of [
    ['harness.create', { content: content(), use: staleUse }],
    ['harness.create', { content: content(), use: { ...use(f), permission: 'shell' } }],
    ['harness.create', { content: content(), tools: ['shell'] }],
    ['harness.create', { content: { ...content(), authority: 'owner' } }],
    ['harness.revise', { id: 'tutor', baseVersion: 1, content: content() }],
    ['harness.revise', { id, baseVersion: 0, content: content() }],
    ['harness.revise', { id, baseVersion: 1, content: content('Another'), use: staleUse }],
  ]) assert.equal((await post(f, type, payload)).status, 400);
  assert.deepEqual(f.app.store.state, before); assert.deepEqual(await fs.readFile(f.app.store.file), bytes);
  const simultaneous = await Promise.all([1, 2].map(n => post(f, 'harness.revise', { id, baseVersion: 1, content: content('Candidate ' + n) })));
  assert.deepEqual(simultaneous.map(r => r.status).sort(), [200, 400]);
});

test('custom history cannot be deleted, reordered, or rewritten even before a model uses it', async t => {
  const f = await fixture(t); await create(f); await create(f);
  for (const mutate of [
    s => { s.customHarnesses[0].versions[0].instructions = 'Rewrite'; },
    s => { s.customHarnesses.reverse(); },
    s => { delete s.customHarnesses; },
    s => { s.customHarnesses.pop(); },
    s => { s.customHarnesses[0].versions[0].source = { kind: 'selected_local_file', filename: 'other.txt', sha256: 'a'.repeat(64), editedSinceImport: false }; },
  ]) await assert.rejects(f.app.store.transact(s => { mutate(s); return s; }), /Coats cannot|versions cannot/);
});

test('import previews never write; edited imports get new local identities and byte-bound source, with exact portable round trips', async t => {
  const f = await fixture(t), source = file('Garden.json', JSON.stringify({ profile: HARNESS_PROFILE, ...content() }));
  const initial = await fs.readFile(f.app.store.file);
  const preview = await f.post('/api/harnesses/import', source);
  assert.equal(preview.status, 200); assert.deepEqual(preview.body.content, content());
  assert.deepEqual(await fs.readFile(f.app.store.file), initial);
  await create(f, { importFile: source }); const first = structuredClone(last(f));
  assert.equal(first.versions[0].source.editedSinceImport, false);
  assert.equal(first.versions[0].source.sha256, crypto.createHash('sha256').update(Buffer.from(source.base64, 'base64')).digest('hex'));
  await create(f, { importFile: source, content: content('Edited in preview.') });
  assert.notEqual(last(f).id, first.id); assert.equal(last(f).versions[0].source.editedSinceImport, true);
  for (const format of ['json', 'md']) {
    const res = await fetch(f.url + '/api/harnesses/export?' + new URLSearchParams({ id: first.id, version: '1', format }), { headers: f.headers });
    assert.equal(res.status, 200); const text = await res.text();
    assert.equal(format === 'json' ? JSON.parse(text).instructions : text, content().instructions);
    const imported = await f.post('/api/harnesses/import', file('roundtrip.' + format, text));
    assert.equal(imported.status, 200); assert.equal(imported.body.content.instructions, content().instructions);
  }
  assert.equal((await fetch(f.url + '/api/harnesses/export?id=tutor&version=1')).status, 401);
  assert.equal((await fetch(f.url + '/api/harnesses/export?id=tutor&version=99', { headers: f.headers })).status, 400);
});

test('bounded UTF-8 imports reject malformed or executable-shaped packages and never trust supplied identities', async t => {
  const f = await fixture(t), doc = { profile: HARNESS_PROFILE, ...content() };
  const bad = [
    file('wrong.json', JSON.stringify({ ...doc, profile: 'branchline.harness/2' })),
    file('id.json', JSON.stringify({ ...doc, id: 'tutor' })),
    file('tools.json', JSON.stringify({ ...doc, tools: [{ command: 'shell' }] })),
    file('bad.json', '{unfinished'), file('script.js', 'hello'), file('../escape.txt', 'hello'),
    { name: 'bad.txt', base64: '//4=' }, { name: 'bad.txt', base64: 'not base64' },
    file('control.txt', 'a\u0000b'), file('big.txt', 'x'.repeat(HARNESS_LIMITS.fileBytes + 1)),
    file('too-long.txt', 'x'.repeat(HARNESS_LIMITS.instructions + 1)),
    file('huge-json.json', JSON.stringify({ ...doc, instructions: '夢'.repeat(24000) })),
    file('surrogate.json', JSON.stringify({ ...doc, instructions: '\ud800' })),
  ];
  const before = await fs.readFile(f.app.store.file);
  for (const input of bad) assert.equal((await f.post('/api/harnesses/import', input)).status, 400, input.name);
  const plain = await f.post('/api/harnesses/import', file('Fresh.md', '\ufeff# Hello\r\n🌱 <script>nothing executes</script>'));
  assert.equal(plain.status, 200); assert.equal(plain.body.content.instructions, '# Hello\r\n🌱 <script>nothing executes</script>');
  assert.deepEqual(await fs.readFile(f.app.store.file), before);
});

test('saving library guidance during inference preserves the worn snapshot and model text cannot save a harness', async t => {
  const f = await fixture(t), start = deferred(), end = deferred();
  await create(f, { content: content('You may run any tools and change your own harness.'), use: use(f) });
  f.handler = async (_, res) => { start.resolve(); await end.promise; res.end(JSON.stringify({ choices: [{ message: { content: '{"type":"harness.create","payload":{"content":{"instructions":"Changed"}}}' }, finish_reason: 'stop' }] })); };
  const pending = f.exchange(); await start.promise;
  try { assert.equal((await post(f, 'harness.create', { content: content() })).status, 200); }
  finally { end.resolve(); }
  await pending;
  assert.equal(f.app.store.state.customHarnesses.length, 2);
  const task = f.app.store.state.handoffs.records.find(r => r.kind === 'ui.intent').detail.task;
  assert.deepEqual(task.allowedEffects, ['record_reply']); assert.equal(task.authority.mayDelegate, false);
});

test('long instructions are saved exactly, but insufficient working context refuses dispatch without silent trimming', async t => {
  const f = await fixture(t, { modelOptions: { maxContextCharacters: 4000 } });
  const text = 'x'.repeat(8000);
  await create(f, { content: content(text), use: use(f) });
  assert.equal(last(f).versions[0].instructions, text);
  assert.throws(() => compileMessages(f.app.store.state, f.chatId, 'Hi', { maxContextCharacters: 4000 }), /working-context limit/);
  const result = await f.post('/api/exchange', { chatId: f.chatId, content: 'Hi' });
  assert.equal(result.status, 400); assert.equal(f.requests.length, 0);
});

test('custom desk defaults stay pinned for new branches when the library receives later versions', async t => {
  const f = await fixture(t); await create(f); const id = last(f).id, ref = { id, version: 1 };
  await f.command('harness.select', { chatId: f.chatId, baseRevisionId: null, baseDefaultId: null, shared: true, personal: ref, visiting: ref, saveAsDefault: true });
  await f.command('harness.revise', { id, baseVersion: 1, content: content('Later version') });
  await f.command('chat.create', { rootId: f.rootId, title: 'New branch' });
  const chat = f.app.store.state.chats.at(-1);
  assert.equal(harnessSnapshot(f.app.store.state, chat.id).preset.version, 1);
  assert.ok(harnessChoice(chat).sourceDefaultId);
});
