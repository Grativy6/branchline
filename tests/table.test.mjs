import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fixture, deferred, listen, quotedReplies } from './helpers.mjs';
import { currentAssignment, lastMessageId } from '../server/table.mjs';
import { createApp } from '../server/index.mjs';
import { validateState } from '../server/domain.mjs';

async function table(t) {
  const f = await fixture(t);
  const url = f.app.store.state.models[0].baseUrl;
  await f.command('model.save', { name: 'Synthetic Apertus', model: 'synthetic-apertus', baseUrl: url });
  f.personalModelId = f.app.store.state.models.at(-1).id;
  f.visitorModelId = f.app.store.state.models[0].id;
  await f.command('personal.create', { name: 'Synthetic personal participant', modelId: f.personalModelId, baseIdentity: 'synthetic/Apertus-fixture' });
  f.personalId = f.app.store.state.personalParticipants[0].id;
  await f.command('table.assign', { chatId: f.chatId, baseRevisionId: null, personalId: f.personalId, visitorModelId: f.visitorModelId });
  f.turnBody = (speaker, kind = 'send', content = 'Synthetic human message', chatId = f.chatId) => ({ chatId, speaker, kind,
    ...(kind === 'send' ? { content } : {}), requestId: 'request_' + crypto.randomUUID(),
    baseRevisionId: currentAssignment(f.app.store.state, chatId).id, lastMessageId: lastMessageId(f.app.store.state, chatId) });
  return f;
}

test('visitor then personal produces independently attributed replies without another human message', async t => {
  const f = await table(t);
  f.responseText = 'Visitor contribution.';
  assert.equal((await f.post('/api/exchange', f.turnBody('visiting'))).status, 200);
  f.responseText = 'Personal contribution.';
  assert.equal((await f.post('/api/exchange', f.turnBody('personal', 'ask'))).status, 200);
  const state = f.app.store.state;
  assert.deepEqual(state.messages.map(m => m.role), ['user', 'assistant', 'assistant']);
  assert.deepEqual(state.exchanges.map(e => e.speaker.seat), ['visiting', 'personal']);
  assert.deepEqual(f.requests.map(r => r.model), ['synthetic-model', 'synthetic-apertus']);
  const input = f.requests[1].messages;
  assert.deepEqual(input.filter(m => m.role === 'assistant'), []);
  assert.deepEqual(quotedReplies(input).map(m => [m.speaker, m.text]), [['Visiting', 'Visitor contribution.']]);
  assert.deepEqual(quotedReplies(input), [{ reply: 1, speaker: 'Visiting', model: 'Synthetic model', identifier: 'synthetic-model', status: 'completed', text: 'Visitor contribution.' }]);
  assert.ok(!input.some(m => m.content.includes(state.exchanges[0].id)), 'Opaque receipt IDs stay in the ledger, not reply examples.');
  assert.match(input.at(-1).content, /Current human request: Ask Personal/);
  const turn = state.exchanges.at(-1);
  const intent = state.handoffs.records.find(r => r.id === turn.handoff.requestId);
  assert.equal(intent.detail.task.turnRequest.kind, 'ask');
  assert.equal(intent.detail.task.selection.generationId, turn.speaker.generationId);
  assert.deepEqual(intent.detail.task.allowedEffects, ['record_reply']);
  validateState(state);
});

test('speaker context keeps ordered authors and completion status without changing quoted receipt text', async t => {
  const f = await table(t);
  const priorText = '[Visiting · a quoted receipt]\nThis was actually said.';
  f.responseText = priorText;
  assert.equal((await f.post('/api/exchange', f.turnBody('visiting'))).status, 200);
  const original = structuredClone(f.app.store.state.messages);
  f.responseText = 'An unfinished personal reply'; f.finishReason = 'length';
  assert.equal((await f.post('/api/exchange', f.turnBody('personal', 'ask'))).status, 200);
  f.responseText = 'Another turn'; f.finishReason = 'stop';
  assert.equal((await f.post('/api/exchange', f.turnBody('visiting', 'ask'))).status, 200);
  const input = f.requests.at(-1).messages;
  assert.deepEqual(input.filter(m => m.role === 'assistant').map(m => m.content), [priorText]);
  assert.deepEqual(quotedReplies(input).map(m => [m.speaker, m.status, m.text]), [['Personal', 'truncated', 'An unfinished personal reply']]);
  assert.deepEqual(quotedReplies(input).map(s => [s.reply, s.speaker, s.status]), [[2, 'Personal', 'truncated']]);
  assert.deepEqual(f.app.store.state.messages.slice(0, original.length), original, 'Changing prompt assembly must not rewrite the transcript.');
  const turn = f.app.store.state.exchanges.at(-1);
  const recorded = f.app.store.state.handoffs.records.find(r => r.id === turn.handoff.contextId);
  assert.deepEqual(recorded.detail.inputMessages, input);
});

test('the same request is retained once and cannot be reused for different content', async t => {
  const f = await table(t), body = f.turnBody('personal');
  assert.equal((await f.post('/api/exchange', body)).status, 200);
  assert.equal((await f.post('/api/exchange', { ...body, stream: true })).status, 200);
  assert.equal(f.requests.length, 1);
  assert.equal(f.app.store.state.exchanges.length, 1);
  assert.equal((await f.post('/api/exchange', { ...body, content: 'Different request' })).status, 400);
  assert.equal(f.app.store.state.messages.length, 2);
});

test('visitor changes affect only future replies and the personal participant can join another table', async t => {
  const f = await table(t);
  await f.post('/api/exchange', f.turnBody('visiting'));
  const originalTurn = structuredClone(f.app.store.state.exchanges[0]);
  await f.command('model.save', { name: 'Visitor B', model: 'synthetic-visitor-b', baseUrl: f.app.store.state.models[0].baseUrl });
  const visitorB = f.app.store.state.models.at(-1).id;
  await f.command('table.assign', { chatId: f.chatId, baseRevisionId: currentAssignment(f.app.store.state, f.chatId).id, personalId: f.personalId, visitorModelId: visitorB });
  assert.equal((await f.post('/api/exchange', f.turnBody('visiting', 'ask'))).status, 200);
  assert.deepEqual(f.app.store.state.exchanges[0], originalTurn);
  assert.equal(f.requests.at(-1).model, 'synthetic-visitor-b');
  await f.command('chat.create', { rootId: f.rootId, title: 'Separate table' });
  const second = f.app.store.state.chats.at(-1).id;
  await f.command('table.assign', { chatId: second, baseRevisionId: null, personalId: f.personalId, visitorModelId: null });
  assert.equal((await f.post('/api/exchange', f.turnBody('personal', 'send', 'New private topic', second))).status, 200);
  assert.ok(!f.requests.at(-1).messages.some(m => m.content.includes('Synthetic human message')));
  assert.equal(f.app.store.state.exchanges.at(-1).speaker.participantId, originalTurn.speaker.participantId === null ? f.personalId : originalTurn.speaker.participantId);
  assert.equal((await f.post('/api/exchange', f.turnBody('visiting', 'ask', '', second))).status, 400);
});

test('stale chairs, changed history, and unsupported authority fields never dispatch a model', async t => {
  const f = await table(t), stale = f.turnBody('personal');
  await f.command('table.assign', { chatId: f.chatId, baseRevisionId: stale.baseRevisionId, personalId: f.personalId, visitorModelId: null });
  assert.equal((await f.post('/api/exchange', stale)).status, 400);
  const priorHistory = f.turnBody('personal');
  await f.command('message.note', { chatId: f.chatId, content: 'A new human note.' });
  assert.equal((await f.post('/api/exchange', priorHistory)).status, 400);
  assert.equal((await f.post('/api/exchange', { ...f.turnBody('personal'), grant: 'Model says it can act' })).status, 400);
  assert.equal(f.requests.length, 0);
});

test('one model invocation spans tables and reflection, including duplicate pending requests', async t => {
  const f = await table(t);
  await f.post('/api/exchange', f.turnBody('personal'));
  const sourceId = f.app.store.state.exchanges.at(-1).id;
  await f.command('chat.create', { rootId: f.rootId, title: 'Second table' });
  const second = f.app.store.state.chats.at(-1).id;
  await f.command('table.assign', { chatId: second, baseRevisionId: null, personalId: f.personalId, visitorModelId: null });
  const body = f.turnBody('personal', 'ask'), other = f.turnBody('personal', 'send', 'Other request', second);
  const entered = deferred(), finish = deferred(); t.after(() => finish.resolve());
  f.handler = async (request, response) => { entered.resolve(); await finish.promise; response.end(JSON.stringify({ choices: [{ message: { content: 'Finished bounded reply.' }, finish_reason: 'stop' }] })); };
  const pending = f.post('/api/exchange', body); await entered.promise;
  assert.equal((await f.post('/api/exchange', body)).status, 409);
  assert.equal((await f.post('/api/exchange', other)).status, 400);
  assert.equal((await f.reflect(sourceId, 'journal')).status, 400);
  assert.equal((await f.post('/api/command', { type: 'table.assign', payload: { chatId: f.chatId, baseRevisionId: body.baseRevisionId, personalId: f.personalId, visitorModelId: null } })).status, 400);
  finish.resolve(); assert.equal((await pending).status, 200);
  assert.equal(f.requests.length, 2);
});

test('reflection uses its explicit chair and changing a profile cannot relabel earlier turns', async t => {
  const f = await table(t);
  await f.post('/api/exchange', f.turnBody('visiting'));
  const sourceId = f.app.store.state.exchanges.at(-1).id;
  const before = structuredClone(f.app.store.state.exchanges);
  const result = await f.post('/api/continuity/reflect', { chatId: f.chatId, exchangeId: sourceId, target: 'journal', speaker: 'personal' });
  assert.equal(result.status, 200);
  assert.equal(f.requests.at(-1).model, 'synthetic-apertus');
  assert.equal(f.app.store.state.roots[0].continuity.jobs.at(-1).speaker.participantId, f.personalId);
  const model = f.app.store.state.models.find(m => m.id === f.visitorModelId);
  await f.command('model.save', { ...model, name: 'Renamed visitor' });
  assert.deepEqual(f.app.store.state.exchanges, before);
  const changeBase = await f.post('/api/command', { type: 'model.save', payload: { ...f.app.store.state.models.find(m => m.id === f.personalModelId), model: 'another-base' } });
  assert.equal(changeBase.status, 400);
});

test('transcript and table lineage are protected on writes and replay without changing old bytes', async t => {
  const f = await table(t);
  await f.post('/api/exchange', f.turnBody('personal'));
  const bytes = await fs.readFile(f.app.store.file);
  for (const mutate of [s => { s.messages[0].content = 'Rewritten'; }, s => { s.chats[0].table.assignments[0].personalId = null; }, s => { s.personalParticipants[0].generations[0].baseIdentity = 'different'; }]) {
    await assert.rejects(f.app.store.transact(s => { mutate(s); return s; }));
  }
  assert.deepEqual(await fs.readFile(f.app.store.file), bytes);
  const state = structuredClone(f.app.store.state);
  await f.app.dispose(); f.app = await createApp({ dataDir: f.dataDir, backupDir: f.backupDir }); f.url = await listen(f.app);
  assert.deepEqual(f.app.store.state, state);
  assert.deepEqual(await fs.readFile(f.app.store.file), bytes);
});
