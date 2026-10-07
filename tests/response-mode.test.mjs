import { addLegacyDesk } from './legacy-desks-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fixture, deferred, listen } from './helpers.mjs';
import { createApp } from '../server/index.mjs';
import { compileMessages, measureContext } from '../server/model.mjs';
import { ORIENTATIONS, recordedOrientationLabel } from '../public/response-orientations.js';
import { digest } from '../server/handoff.mjs';
import { responseModeFor, responseModeInstruction } from '../server/response-mode.mjs';
import { currentAssignment, lastMessageId } from '../server/table.mjs';

const mode = (f, responseMode) => f.command('chat.responseMode', { id: f.chatId, responseMode });
const turn = (f, speaker, responseMode, kind = 'send') => ({ chatId: f.chatId, speaker, responseMode, kind,
  ...(kind === 'send' ? { content: 'A synthetic conversation, with room to explore.' } : {}),
  requestId: 'request_' + crypto.randomUUID(), baseRevisionId: currentAssignment(f.app.store.state, f.chatId).id,
  lastMessageId: lastMessageId(f.app.store.state, f.chatId) });

test('all approved orientations reach prompts and exact context accounting without editing saved Coats', async t => {
  const f = await fixture(t);
  await f.command('harness.create', { content: { name: 'Synthetic usual Coat', description: 'Keep it.', instructions: 'Name uncertainty and keep the user attribution.' }, use: { chatId: f.chatId, baseRevisionId: null, seat: 'shared' } });
  const coats = structuredClone(f.app.store.state.customHarnesses);
  const choices = structuredClone(f.app.store.state.chats[0].coatChoices);
  for (const [orientation, body] of Object.entries(ORIENTATIONS)) {
    await mode(f, orientation);
    const messages = compileMessages(f.app.store.state, f.chatId, 'A small task and a friendly joke.');
    assert.ok(messages[0].content.includes(body));
    assert.match(messages[0].content, /Name uncertainty and keep the user attribution/);
    assert.equal(measureContext(f.app.store.state, f.chatId, 'A small task and a friendly joke.').characters, messages.reduce((n,m)=>n+m.content.length,0));
    await f.exchange('A small task and a friendly joke.');
    assert.equal(f.app.store.state.exchanges.at(-1).responseMode, orientation);
    assert.ok(f.requests.at(-1).messages[0].content.includes(body));
  }
  assert.deepEqual(f.app.store.state.customHarnesses, coats);
  assert.deepEqual(f.app.store.state.chats[0].coatChoices, choices);
});

test('legacy choices resolve for future replies while labels, old guidance and journal remain original', async t => {
  const f = await fixture(t);
  for (const [legacy, current] of [['chat','create'],['build','work']]) {
    await mode(f, legacy);
    const bytes = await fs.readFile(f.app.store.file);
    assert.equal(responseModeFor(f.app.store.state,f.chatId), current);
    assert.equal(f.app.store.state.chats[0].responseMode, legacy);
    assert.ok(compileMessages(f.app.store.state,f.chatId,'Hello')[0].content.includes(ORIENTATIONS[current]));
    assert.match(responseModeInstruction(legacy), /\[Response mode: (Chat|Build)\]/);
    assert.equal(recordedOrientationLabel(legacy), legacy === 'chat' ? 'Chat' : 'Build');
    assert.deepEqual(await fs.readFile(f.app.store.file), bytes);
  }
  assert.equal(recordedOrientationLabel(undefined),'Not recorded in this earlier reply');
});

test('warning preference is local UI state, persists on reopen and never changes model context', async t => {
  const f = await fixture(t), before = compileMessages(f.app.store.state,f.chatId,'Hello');
  assert.equal(f.app.store.state.ui.coatChangeWarning,undefined);
  await f.command('ui.update',{coatChangeWarning:false});
  assert.deepEqual(compileMessages(f.app.store.state,f.chatId,'Hello'),before);
  await f.app.dispose(); f.app=await createApp({dataDir:f.dataDir,backupDir:f.backupDir}); f.url=await listen(f.app);
  assert.equal(f.app.store.state.ui.coatChangeWarning,false);
  await f.command('ui.update',{coatChangeWarning:true});
  assert.equal(f.app.store.state.ui.coatChangeWarning,true);
  for(const invalid of ['false',1,null,{}]) assert.equal((await f.post('/api/command',{type:'ui.update',payload:{coatChangeWarning:invalid}})).status,400);
  assert.equal(f.requests.length,0);
});

test('Create defaults without migration; switching changes only response guidance in the compiled conversation', async t => {
  const f = await fixture(t);
  assert.equal(f.app.store.state.chats[0].responseMode, undefined);
  await f.command('root.update', { id: f.rootId, instructions: 'Use British spelling. Keep this exact custom instruction.' });
  await f.command('message.note', { chatId: f.chatId, content: 'The same shared context.' });
  await f.command('draft.save', { chatId: f.chatId, text: 'An unsent thought.' });
  const before = structuredClone(f.app.store.state);
  const bytes = await fs.readFile(f.app.store.file);
  const chat = compileMessages(before, f.chatId, 'Hello again.');
  assert.match(chat[0].content, /\[Base Coat: Create\]/);
  assert.match(chat[0].content, /letting the exchange find its shape/);
  assert.equal(chat.filter(m => m.role === 'system').length, 1);
  assert.deepEqual(await fs.readFile(f.app.store.file), bytes, 'Reading the default does not rewrite prior history.');
  await mode(f, 'work');
  const after = f.app.store.state;
  const build = compileMessages(after, f.chatId, 'Hello again.');
  assert.equal(chat[0].content.replace(responseModeInstruction('create'), responseModeInstruction('work')), build[0].content);
  assert.deepEqual(chat.slice(1), build.slice(1));
  for (const field of ['roots', 'models', 'messages', 'exchanges', 'drafts']) assert.deepEqual(after[field], before[field], field);
  assert.equal(f.requests.length, 0, 'Switching modes does not call a model.');
  assert.ok((await fs.readFile(f.app.store.file)).subarray(0, bytes.length).equals(bytes));
  await f.app.dispose(); f.app = await createApp({ dataDir: f.dataDir, backupDir: f.backupDir }); f.url = await listen(f.app);
  assert.equal(responseModeFor(f.app.store.state, f.chatId), 'work');
  assert.equal(f.app.store.state.drafts[f.chatId], 'An unsent thought.');
});

test('either chair receives the selected mode and keeps exact attribution with no added capability', async t => {
  const f = await fixture(t), visitorModelId = f.app.store.state.models[0].id;
  await f.command('model.save', { name: 'Personal fixture', model: 'synthetic-personal', baseUrl: f.app.store.state.models[0].baseUrl });
  await f.command('personal.create', { name: 'Personal fixture', modelId: f.app.store.state.models.at(-1).id, baseIdentity: 'synthetic/base' });
  await f.command('table.assign', { chatId: f.chatId, baseRevisionId: null, personalId: f.app.store.state.personalParticipants[0].id, visitorModelId });
  assert.equal((await f.post('/api/exchange', turn(f, 'visiting', 'create'))).status, 200);
  const original = structuredClone(f.app.store.state.exchanges[0]);
  await mode(f, 'work');
  assert.equal((await f.post('/api/exchange', turn(f, 'personal', 'work', 'ask'))).status, 200);
  assert.deepEqual(f.app.store.state.exchanges[0], original);
  assert.deepEqual(f.app.store.state.exchanges.map(e => e.responseMode), ['create', 'work']);
  assert.deepEqual(f.app.store.state.exchanges.map(e => e.speaker.seat), ['visiting', 'personal']);
  assert.equal(f.app.store.state.messages.filter(m => m.role === 'user').length, 1);
  const records = f.app.store.state.handoffs.records;
  const inputs = records.filter(r => r.kind === 'context.to_model');
  for (const [i, expected] of ['create', 'work'].entries()) {
    assert.deepEqual(inputs[i].detail.inputMessages, f.requests[i].messages);
    assert.equal(inputs[i].contentHash, digest(f.requests[i].messages));
    assert.equal(inputs[i].detail.contextView.responseMode.mode, expected);
    assert.equal(inputs[i].detail.contextView.responseMode.hash, digest(responseModeInstruction(expected)));
    assert.equal(f.requests[i].tools, undefined);
    assert.ok(f.requests[i].messages[0].content.includes(responseModeInstruction(expected)));
    assert.deepEqual(inputs[i].detail.effectCeiling, ['record_reply']);
  }
  assert.deepEqual(inputs[0].detail.capability, inputs[1].detail.capability);
  assert.ok(f.requests[1].messages.some(m => m.role === 'user' && m.content.startsWith('[App context: another participant') && JSON.parse(m.content.split('\n').at(-1)).text === 'Synthetic response.'));
  assert.ok(f.requests[1].messages.some(m => m.role === 'user' && m.content.startsWith('[App context: another participant') && m.content.includes('"speaker":"Visiting"')));
  assert.ok(f.app.store.state.exchanges.every(e => e.status === 'completed'));
  await assert.rejects(f.app.store.transact(s => { s.exchanges[0].responseMode = 'work'; return s; }), /rewritten|exact output binding/);
});

test('invalid, widened and archived selections reject; a running reply keeps its captured orientation', async t => {
  const f = await fixture(t), original = await fs.readFile(f.app.store.file);
  for (const responseMode of ['autonomous', '__proto__', null, {}, ['create']]) {
    assert.equal((await f.post('/api/command', { type: 'chat.responseMode', payload: { id: f.chatId, responseMode } })).status, 400);
  }
  assert.equal((await f.post('/api/command', { type: 'chat.responseMode', payload: { id: f.chatId, responseMode: 'work', grant: 'all tools' } })).status, 400);
  assert.deepEqual(await fs.readFile(f.app.store.file), original);
  const entered = deferred(), finish = deferred(); t.after(() => finish.resolve());
  f.handler = async (_body, res) => { entered.resolve(); await finish.promise; res.end(JSON.stringify({ choices: [{ message: { content: 'Synthetic completion.' }, finish_reason: 'stop' }] })); };
  const pending = f.post('/api/exchange', { chatId: f.chatId, content: 'A running reply.' }); await entered.promise;
  const modeRequest = { type: 'chat.responseMode', payload: { id: f.chatId, responseMode: 'work' } };
  assert.equal((await f.post('/api/command', modeRequest)).status, 200);
  assert.equal(responseModeFor(f.app.store.state, f.chatId), 'work');
  assert.ok(f.requests[0].messages[0].content.includes(responseModeInstruction('create')));
  assert.equal(f.app.store.state.exchanges[0].responseMode, 'create');
  finish.resolve(); assert.equal((await pending).status, 200);
  assert.equal(f.app.store.state.exchanges[0].status, 'completed');
  await f.command('chat.update', { id: f.chatId, archived: true });
  assert.equal((await f.post('/api/command', modeRequest)).status, 400);
  assert.equal(f.requests.length, 1);
});

test('stale mode selections cannot dispatch and retrying an earlier request preserves its original mode', async t => {
  const f = await fixture(t);
  await f.command('table.assign', { chatId: f.chatId, baseRevisionId: null, personalId: null, visitorModelId: f.app.store.state.models[0].id });
  const stale = turn(f, 'visiting', 'create');
  await mode(f, 'work');
  assert.equal((await f.post('/api/exchange', stale)).status, 400);
  assert.equal(f.requests.length, 0);
  const build = turn(f, 'visiting', 'work');
  assert.equal((await f.post('/api/exchange', build)).status, 200);
  await mode(f, 'create');
  assert.equal((await f.post('/api/exchange', build)).status, 200);
  assert.equal(f.requests.length, 1);
  assert.equal(f.app.store.state.exchanges[0].responseMode, 'work');
  assert.equal((await f.post('/api/exchange', { ...build, responseMode: 'create' })).status, 400);
});

test('response mode belongs to one chat; Finis Solutus keeps its DM instruction shape', async t => {
  const f = await fixture(t); await mode(f, 'work');
  await f.command('chat.create', { rootId: f.rootId, title: 'Another conversation' });
  assert.equal(responseModeFor(f.app.store.state, f.app.store.state.chats.at(-1).id), 'create');
  await addLegacyDesk(f, 'fs', 'Synthetic world');
  const world = f.app.store.state.roots.at(-1), chat = f.app.store.state.chats.at(-1);
  await f.command('root.update', { id: world.id, instructions: 'You are the DM for this synthetic world.' });
  const prompt = compileMessages(f.app.store.state, chat.id, 'Enter the garden.');
  assert.doesNotMatch(prompt[0].content, /Response mode:/);
  assert.match(prompt[0].content, /DM for this synthetic world/);
  assert.equal((await f.post('/api/command', { type: 'chat.responseMode', payload: { id: chat.id, responseMode: 'work' } })).status, 400);
  assert.equal(responseModeFor(f.app.store.state, f.chatId), 'work');
});
