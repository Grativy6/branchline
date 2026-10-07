import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fixture } from './helpers.mjs';
import { configureApertus, apertusConfigured, APERTUS_PROFILE } from '../server/apertus-setup.mjs';
import { modelTransport } from '../server/model-format.mjs';
import { validateState } from '../server/domain.mjs';
import { digest } from '../server/integrity.mjs';

test('explicit Apertus setup fills only the selected empty Personal chair, once', async t => {
  const f = await fixture(t), original = structuredClone(f.app.store.state);
  await f.command('draft.save', { chatId: f.chatId, text: 'Unsent human draft' });
  await f.app.store.transact(configureApertus);
  const state = f.app.store.state, personal = state.personalParticipants.at(-1);
  assert.ok(apertusConfigured(state));
  assert.equal(state.models.at(-1).inputFormat, 'plain-dialogue-v1');
  assert.equal(personal.generations[0].adapter, null);
  assert.equal(personal.generations[0].baseIdentity, 'swiss-ai/Apertus-8B-2509');
  assert.equal(state.chats[0].table.assignments.at(-1).visitorModelId, original.models[0].id);
  assert.equal(state.chats[0].table.assignments.at(-1).personalId, personal.id);
  assert.deepEqual(state.messages, original.messages);
  assert.equal(state.drafts[f.chatId], 'Unsent human draft');
  assert.deepEqual(configureApertus(state), state);
  validateState(state);
});

test('setup does not replace an occupied chair, change another table, or generate text', async t => {
  const f = await fixture(t);
  await f.command('personal.create', { name: 'Existing personal', modelId: f.app.store.state.models[0].id, baseIdentity: 'synthetic/existing' });
  await f.command('table.assign', { chatId: f.chatId, baseRevisionId: null, personalId: f.app.store.state.personalParticipants[0].id, visitorModelId: null });
  const before = structuredClone(f.app.store.state.chats);
  await f.app.store.transact(configureApertus);
  assert.deepEqual(f.app.store.state.chats, before);
  assert.equal(f.requests.length, 0);
});

test('a conflicting saved Apertus connection is held without partial setup', async t => {
  const f = await fixture(t);
  await f.command('model.save', { ...APERTUS_PROFILE, inputFormat: 'chat' });
  const bytes = await fs.readFile(f.app.store.file);
  await assert.rejects(f.app.store.transact(configureApertus), /different settings/);
  assert.deepEqual(await fs.readFile(f.app.store.file), bytes);
});

test('plain dialogue sends the exact carried text to completions and records its transport', async t => {
  const f = await fixture(t);
  await f.command('model.save', { ...f.app.store.state.models[0], inputFormat: 'plain-dialogue-v1' });
  f.handler = async (body, res, request) => { assert.equal(request.url, '/v1/completions'); assert.equal(body.messages, undefined); res.end(JSON.stringify({ choices: [{ text: 'A base-model continuation.', finish_reason: 'stop' }] })); };
  await f.exchange('What does this preserve?');
  const record = f.app.store.state.handoffs.records.find(r => r.kind === 'context.to_model');
  const expected = modelTransport(f.app.store.state.models[0], record.detail.inputMessages);
  assert.equal(f.requests[0].prompt, expected.input.prompt);
  assert.equal(record.detail.transport.inputHash, digest(expected.input));
  assert.equal(record.detail.transport.route, '/completions');
  assert.ok(f.requests[0].stop.includes('\nUser:'));
  assert.equal(f.requests[0].tools, undefined);
  assert.equal(f.requests[0].thinking, undefined);
  assert.equal(f.app.store.state.messages.at(-1).content, 'A base-model continuation.');
  assert.equal(f.app.store.state.exchanges.at(-1).inputFormat, 'plain-dialogue-v1');
  const before = await fs.readFile(f.app.store.file);
  assert.equal((await f.post('/api/command', { type:'model.save', payload:{ ...f.app.store.state.models[0], inputFormat:'invented-format' } })).status, 400);
  assert.deepEqual(await fs.readFile(f.app.store.file), before);
});

test('plain completion streaming retains text and rejects an unfinished stream', async t => {
  const f = await fixture(t);
  await f.command('model.save', { ...f.app.store.state.models[0], inputFormat: 'plain-dialogue-v1' });
  let complete = true;
  f.handler = async (_body, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const event = 'data: ' + JSON.stringify({ choices: [{ text:'One voice.', finish_reason:null }] }) + '\n\n';
    res.write(event.slice(0, 17)); res.write(event.slice(17));
    res.end(complete ? 'data: {"choices":[{"text":"","finish_reason":"stop"}]}\n\ndata: [DONE]\n\n' : '');
  };
  for (const expected of ['completed', 'failed']) {
    const res = await fetch(f.url + '/api/exchange', { method:'POST', headers:{...f.headers,'content-type':'application/json'}, body:JSON.stringify({ chatId:f.chatId, content:'A synthetic turn',stream:true }) });
    const stream = await res.text();
    assert.match(stream,/One voice/);
    assert.equal(f.app.store.state.exchanges.at(-1).status, expected);
    assert.equal(f.app.store.state.messages.at(-1).content,'One voice.');
    complete = false;
  }
});
