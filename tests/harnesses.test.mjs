import { addLegacyDesk } from './legacy-desks-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred } from './helpers.mjs';
import { compileMessages } from '../server/model.mjs';
import { resolveSpeaker, currentAssignment, lastMessageId } from '../server/table.mjs';
import { Store } from '../server/store.mjs';

const ref = id => ({ id, version: 1 });
const selection = (f, personal = 'brainstorm', visiting = personal, extra = {}) => ({ chatId: f.chatId, baseRevisionId: f.app.store.state.chats.find(c => c.id === f.chatId).harnessSelections?.at(-1)?.id ?? null, baseDefaultId: f.app.store.state.roots[0].harnessDefaults?.at(-1)?.id ?? null, shared: personal === visiting, personal: ref(personal), visiting: ref(visiting), saveAsDefault: false, ...extra });
async function chairs(f) {
  const modelId = f.app.store.state.models[0].id;
  await f.command('personal.create', { name: 'Synthetic personal', modelId, baseIdentity: 'synthetic/base' });
  await f.command('table.assign', { chatId: f.chatId, baseRevisionId: null, personalId: f.app.store.state.personalParticipants[0].id, visitorModelId: modelId });
}
const turn = (f, seat = 'personal', kind = 'send') => ({ chatId: f.chatId, content: kind === 'send' ? 'Consider this idea.' : '', kind, speaker: seat, requestId: 'request_' + crypto.randomUUID(), baseRevisionId: currentAssignment(f.app.store.state, f.chatId).id, lastMessageId: lastMessageId(f.app.store.state, f.chatId), harnessRevisionId: f.app.store.state.chats[0].harnessSelections?.at(-1)?.id ?? null });

test('separate harnesses reach only their chair; shared choice and swapping preserve instructions', async t => {
  const f = await fixture(t); await chairs(f);
  await f.command('harness.select', selection(f, 'tutor', 'rival'));
  for (const [seat, included, excluded] of [['personal', '[Coat: Tutor]', '[Coat: Rival]'], ['visiting', '[Coat: Rival]', '[Coat: Tutor]']]) {
    const input = compileMessages(f.app.store.state, f.chatId, 'Hi', { selection: resolveSpeaker(f.app.store.state, f.chatId, seat).selection });
    assert.ok(input[0].content.includes(included)); assert.ok(!input[0].content.includes(excluded));
  }
  const harness = structuredClone(f.app.store.state.chats[0].harnessSelections);
  await f.command('model.save', { name: 'Other visitor', model: 'other', baseUrl: f.app.store.state.models[0].baseUrl });
  await f.command('table.assign', { chatId: f.chatId, baseRevisionId: currentAssignment(f.app.store.state, f.chatId).id, personalId: f.app.store.state.personalParticipants[0].id, visitorModelId: f.app.store.state.models.at(-1).id });
  assert.deepEqual(f.app.store.state.chats[0].harnessSelections, harness);
  await f.command('harness.select', selection(f));
  for (const seat of ['personal', 'visiting']) assert.match(compileMessages(f.app.store.state, f.chatId, 'Hi', { selection: resolveSpeaker(f.app.store.state, f.chatId, seat).selection })[0].content, /Coat: Brainstorm/);
});

test('exact harness snapshots survive future selection, store replay, and reject rewriting', async t => {
  const f = await fixture(t); await f.command('harness.select', selection(f, 'tutor'));
  await f.exchange();
  const before = structuredClone(f.app.store.state.exchanges[0]);
  assert.equal(before.harness.preset.id, 'tutor');
  assert.ok(f.requests[0].messages[0].content.includes(before.harness.preset.instructions));
  assert.ok(f.app.store.state.handoffs.records.some(r => r.kind === 'context.to_model' && r.detail.contextView.harness.hash === before.harness.hash));
  await f.command('harness.select', selection(f, 'brainstorm'));
  assert.deepEqual(f.app.store.state.exchanges[0], before);
  await assert.rejects(f.app.store.transact(s => { s.chats[0].harnessSelections[0].personal = ref('rival'); return s; }));
  await assert.rejects(f.app.store.transact(s => { delete s.exchanges[0].harness; return s; }), /original harness|completed turn was rewritten|exact output binding/);
  await f.app.store.close(); const replay = new Store(f.dataDir); await replay.open();
  assert.deepEqual(replay.state.exchanges[0], before); await replay.close();
});

test('desk defaults copy only into new branches and FS keeps independent conversations', async t => {
  const f = await fixture(t);
  await f.command('harness.select', selection(f, 'tutor', 'rival', { saveAsDefault: true }));
  await f.command('chat.create', { rootId: f.rootId, title: 'Second branch' });
  const second = structuredClone(f.app.store.state.chats[1].harnessSelections);
  assert.equal(second[0].personal.id, 'tutor'); assert.ok(second[0].sourceDefaultId);
  await f.command('harness.select', selection(f, 'brainstorm', 'brainstorm', { saveAsDefault: true }));
  assert.deepEqual(f.app.store.state.chats[1].harnessSelections, second);
  await addLegacyDesk(f, 'fs', 'FS desk');
  const root = f.app.store.state.roots.at(-1), first = f.app.store.state.chats.at(-1);
  await f.command('message.note', { chatId: first.id, content: 'Campaign A has a blue owl.' });
  await f.command('chat.create', { rootId: root.id, title: 'Campaign B' });
  const other = f.app.store.state.chats.at(-1);
  assert.equal(other.harnessSelections[0].personal.id, 'finis-solutus');
  const input = compileMessages(f.app.store.state, other.id, 'Hello');
  assert.ok(!JSON.stringify(input).includes('blue owl'));
  await f.command('chat.update', { id: first.id, archived: true });
});

test('invalid versions, extra grants, inconsistent shared choice and stale selections are rejected', async t => {
  const f = await fixture(t), stale = selection(f);
  await f.command('harness.select', stale);
  const payloads = [stale, selection(f, 'not-real'), selection(f, 'tutor', 'rival', { shared: true }), selection(f, 'tutor', 'tutor', { tools: ['shell'] }), selection(f, 'tutor', 'tutor', { personal: { id: 'tutor', version: 900 } })];
  for (const p of payloads) assert.equal((await f.post('/api/command', { type: 'harness.select', payload: p })).status, 400);
  assert.equal((await f.post('/api/exchange', { chatId: f.chatId, content: 'Hi', harnessRevisionId: null })).status, 400);
  assert.equal(f.requests.length, 0);
});

test('harness changes cannot cross a pending reply and do not add model permissions', async t => {
  const f = await fixture(t), started = deferred(), finish = deferred();
  f.handler = async (_, res) => { started.resolve(); await finish.promise; res.end(JSON.stringify({ choices: [{ message: { content: 'Synthetic result' }, finish_reason: 'stop' }] })); };
  const response = f.post('/api/exchange', { chatId: f.chatId, content: 'Hi' }); await started.promise;
  try { assert.equal((await f.post('/api/command', { type: 'harness.select', payload: selection(f) })).status, 400); }
  finally { finish.resolve(); }
  assert.equal((await response).status, 200);
  const task = f.app.store.state.handoffs.records.find(r => r.kind === 'ui.intent').detail.task;
  assert.deepEqual(task.allowedEffects, ['record_reply']); assert.equal(task.authority.mayDelegate, false);
});

test('changing even an empty harness invalidates the queued Both follow-up', async t => {
  const f = await fixture(t); await chairs(f);
  await f.command('table.replySettings', { chatId: f.chatId, baseRevisionId: currentAssignment(f.app.store.state, f.chatId).id, mode: 'both', speaker: 'personal' });
  assert.equal((await f.post('/api/exchange', { ...turn(f), replyMode: 'both' })).status, 200);
  const parent = f.app.store.state.exchanges.at(-1);
  await f.command('harness.select', selection(f, 'conversation'));
  const follow = { ...turn(f, 'visiting', 'ask'), requestId: parent.request.followUp.requestId, followUpOf: parent.id, replyMode: 'single' };
  assert.equal((await f.post('/api/exchange', follow)).status, 400);
  assert.equal(f.requests.length, 1);
});
