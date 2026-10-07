import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fixture, deferred, listen } from './helpers.mjs';
import { currentAssignment, lastMessageId, resolveSpeaker } from '../server/table.mjs';
import { compileMessages } from '../server/model.mjs';
import { replayJournal } from '../server/journal.mjs';
import { createApp } from '../server/index.mjs';

async function personalFixture(t) {
  const f = await fixture(t), modelId = f.app.store.state.models[0].id;
  await f.command('personal.create', { name: 'Original participant', modelId, baseIdentity: 'synthetic/base' });
  await f.command('personal.create', { name: 'Another participant', modelId, baseIdentity: 'synthetic/base' });
  f.personalId = f.app.store.state.personalParticipants[0].id;
  await f.command('table.assign', { chatId: f.chatId, personalId: f.personalId, visitorModelId: modelId, baseRevisionId: null });
  f.turn = () => ({ chatId: f.chatId, content: 'A synthetic conversation.', kind: 'send', speaker: 'personal', requestId: 'request_' + crypto.randomUUID(),
    baseRevisionId: currentAssignment(f.app.store.state, f.chatId).id, lastMessageId: lastMessageId(f.app.store.state, f.chatId) });
  return f;
}

test('nickname persists independently of the founding record, transcript and model input', async t => {
  const f = await personalFixture(t);
  assert.equal((await f.post('/api/exchange', f.turn())).status, 200);
  const before = structuredClone(f.app.store.state), bytes = await fs.readFile(f.app.store.file);
  const prompt = state => ['personal', 'visiting'].map(seat => {
    const { selection } = resolveSpeaker(state, f.chatId, seat);
    return compileMessages(state, f.chatId, 'Continue the same conversation.', { selection });
  });
  const beforeInput = prompt(before);
  await f.command('personal.nickname', { participantId: f.personalId, nickname: 'Hearthline 🌱', baseNickname: null });
  const after = structuredClone(f.app.store.state);
  assert.deepEqual(after.personalParticipants[0], { ...before.personalParticipants[0], nickname: 'Hearthline 🌱' });
  assert.deepEqual(after.personalParticipants[1], before.personalParticipants[1]);
  for (const key of ['messages', 'exchanges', 'models', 'chats', 'roots']) assert.deepEqual(after[key], before[key], key);
  assert.deepEqual(after.handoffs.records.slice(0, before.handoffs.records.length), before.handoffs.records);
  assert.equal(after.handoffs.records.at(-1).detail.command, 'personal.nickname');
  assert.deepEqual(prompt(after), beforeInput, 'The UI nickname must not enter model context.');
  assert.equal(f.requests.length, 1, 'Only the explicitly requested test exchange invokes the fake model.');
  assert.deepEqual((await fs.readFile(f.app.store.file)).subarray(0, bytes.length), bytes);
  assert.deepEqual((await replayJournal(f.app.store.file)).state, after);

  const savedBytes = await fs.readFile(f.app.store.file);
  await f.app.dispose();
  f.app = await createApp({ dataDir: f.dataDir, backupDir: f.backupDir }); f.url = await listen(f.app);
  assert.deepEqual(f.app.store.state, after);
  assert.deepEqual(await fs.readFile(f.app.store.file), savedBytes);
  await f.command('personal.nickname', { participantId: f.personalId, nickname: null, baseNickname: 'Hearthline 🌱' });
  assert.equal(f.app.store.state.personalParticipants[0].name, 'Original participant');
  assert.equal(f.app.store.state.personalParticipants[0].nickname, null);
  assert.deepEqual(prompt(f.app.store.state), beforeInput);
});

test('nickname commands reject stale editors, malformed labels and unrelated changes without writing', async t => {
  const f = await personalFixture(t);
  await f.command('personal.nickname', { participantId: f.personalId, nickname: 'Rowan', baseNickname: null });
  const bytes = await fs.readFile(f.app.store.file);
  const valid = { participantId: f.personalId, nickname: 'Willow', baseNickname: 'Rowan' };
  const invalid = [
    { ...valid, baseNickname: null }, { ...valid, baseNickname: undefined },
    { ...valid, nickname: '' }, { ...valid, nickname: ' ' }, { ...valid, nickname: ' trailing ' },
    { ...valid, nickname: 'x'.repeat(201) }, { ...valid, nickname: 'two\nlines' },
    { ...valid, nickname: {} }, { ...valid, nickname: false },
    { ...valid, participantId: 'missing' }, { ...valid, name: 'Replace the founding name' },
    { ...valid, modelId: 'different' }, { ...valid, grant: 'new permission' },
  ];
  for (const payload of invalid) assert.equal((await f.post('/api/command', { type: 'personal.nickname', payload })).status, 400);
  assert.equal((await f.post('/api/command', { type: 'personal.nickname', payload: valid, actor: 'model' })).status, 400);
  for (const mutate of [
    s => { s.personalParticipants[0].name = 'Changed identity'; },
    s => { s.personalParticipants[0].generations[0].baseIdentity = 'Changed base'; },
    s => { s.personalParticipants[0].nickname = { unvalidated: true }; },
  ]) await assert.rejects(f.app.store.transact(s => { mutate(s); return s; }));
  assert.deepEqual(await fs.readFile(f.app.store.file), bytes);
  assert.equal(f.requests.length, 0);
  const otherId = f.app.store.state.personalParticipants[1].id;
  await f.command('personal.nickname', { participantId: otherId, nickname: 'Rowan', baseNickname: null });
  assert.notEqual(f.personalId, otherId, 'Duplicate nicknames are labels, not unique identities.');
  assert.deepEqual(f.app.store.state.personalParticipants.map(p => p.nickname), ['Rowan', 'Rowan']);
});

test('renaming cannot disturb an in-flight reply', async t => {
  const f = await personalFixture(t), entered = deferred(), finish = deferred();
  t.after(() => finish.resolve());
  f.handler = async (_request, response) => {
    entered.resolve(); await finish.promise;
    response.end(JSON.stringify({ choices: [{ message: { content: 'Completed synthetic reply.' }, finish_reason: 'stop' }] }));
  };
  const pending = f.post('/api/exchange', f.turn()); await entered.promise;
  assert.equal((await f.post('/api/command', { type: 'personal.nickname', payload: { participantId: f.personalId, nickname: 'During turn', baseNickname: null } })).status, 400);
  assert.equal(f.app.store.state.personalParticipants[0].nickname, undefined);
  finish.resolve(); assert.equal((await pending).status, 200);
  assert.equal(f.requests.length, 1);
});
