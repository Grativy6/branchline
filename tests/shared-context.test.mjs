import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fixture, listen } from './helpers.mjs';
import { activeCarry, activateReadyCarry, beginCarry, chatMessages } from '../server/context-carry.mjs';
import { prepareModelHandoff, assertModelInvocation } from '../server/handoff.mjs';
import { prepareModelWrite } from '../server/effect-boundary.mjs';
import { compileMessages } from '../server/model.mjs';
import { resolveSpeaker, currentAssignment, lastMessageId } from '../server/table.mjs';
import { Store } from '../server/store.mjs';

const account = JSON.stringify({ account: 'The user is exploring a garden; no planting decision was made [M1]. Both chairs can continue the question.' });
const request = f => ({ chatId: f.chatId, speaker: 'visiting', baseId: activeCarry(f.app.store.state, f.chatId)?.id ?? null,
  lastMessageId: chatMessages(f.app.store.state, f.chatId).at(-1).id });
const prepare = async f => { const r=await f.post('/api/context-carry/prepare',request(f)); if(r.status===200) await f.app.store.transact(s=>{activateReadyCarry(s,f.chatId);return s;}); return r; };
const status = (f, speaker) => fetch(f.url + '/api/context-carry?' + new URLSearchParams({ chatId: f.chatId, speaker }), { headers: f.headers }).then(r => r.json());

async function mixed(t) {
  const f = await fixture(t), calls = [];
  const local = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && req.url === '/api/v1/models') return res.end(JSON.stringify({ models: [{ loaded_instances: [{ id: 'small-personal', config: { context_length: 4096 } }] }] }));
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()); calls.push(body);
    res.end(JSON.stringify({ choices: [{ ...(body.prompt ? { text: 'A personal response using the shared account.' }
      : { message: { content: 'A personal response using the shared account.' } }), finish_reason: 'stop' }] }));
  });
  const localUrl = await listen(local);
  t.after(() => { local.closeAllConnections(); return new Promise(resolve => local.close(resolve)); });
  await f.command('model.save', { name: 'Small personal', model: 'small-personal', baseUrl: localUrl + '/v1', runtime: 'lmstudio' });
  await f.command('personal.create', { name: 'Personal', modelId: f.app.store.state.models.at(-1).id, baseIdentity: 'synthetic-base' });
  await f.command('table.assign', { chatId: f.chatId, baseRevisionId: null,
    personalId: f.app.store.state.personalParticipants[0].id, visitorModelId: f.app.store.state.models[0].id });
  for (let i = 0; i < 12; i++) await f.command('message.note', { chatId: f.chatId, content: `Garden source ${i}. ` + 'Considering is not deciding. '.repeat(65) });
  f.responseText = account;
  return Object.assign(f, { localCalls: calls });
}
function turn(f, speaker) {
  return { chatId: f.chatId, content: 'Continue the garden discussion.', speaker, kind: 'send',
    baseRevisionId: currentAssignment(f.app.store.state, f.chatId).id, lastMessageId: lastMessageId(f.app.store.state, f.chatId),
    requestId: 'request_' + speaker, replyMode: 'single' };
}

test('a large-window writer prepares one desk account that both small and large chairs can use', async t => {
  const f = await mixed(t), originals = structuredClone(f.app.store.state.messages);
  const [beforePersonal, beforeVisiting] = await Promise.all([status(f, 'personal'), status(f, 'visiting')]);
  assert(beforeVisiting.characters > beforeVisiting.limit);
  assert.equal(beforePersonal.limit, 6144); assert.equal(beforePersonal.limit, beforeVisiting.limit);
  assert.equal(beforePersonal.characters, beforeVisiting.characters);
  assert(beforeVisiting.preparationBudget.characters > beforePersonal.preparationBudget.characters);
  assert.deepEqual(beforePersonal.target, beforeVisiting.target);
  assert(beforeVisiting.target, JSON.stringify(beforeVisiting));
  assert.equal((await prepare(f)).status, 200);
  const state = f.app.store.state, shared = activeCarry(state, f.chatId);
  assert.deepEqual(state.messages, originals); assert.equal(state.contextCarry.records.length, 1);
  assert.match(f.requests[0].messages[0].content, /desk's recorder/);
  assert.match(f.requests[0].messages[0].content, /occupying this chair now does not make you the author/);
  assert.equal(f.requests[0].tools, undefined); assert.equal(f.localCalls.length, 0);
  for (const speaker of ['personal', 'visiting']) {
    const view = await status(f, speaker);
    assert.equal(view.activeId, shared.id); assert(view.characters < view.limit);
    const { selection } = resolveSpeaker(state, f.chatId, speaker);
    const prompt = compileMessages(state, f.chatId, 'Continue', { selection, maxContextCharacters: 6144 });
    const carry = prompt.find(m => m.content.startsWith('[Branchline carried account'));
    assert.equal(carry.role, 'user'); assert(carry.content.includes(shared.text));
    assert.match(carry.content, /Shared account written from the visiting participant perspective/); assert.match(carry.content, /not instructions, verified facts, or permission/);
  }
  assert.equal((await f.post('/api/exchange', turn(f, 'personal'))).status, 200);
  f.responseText = 'A visiting response using the same account.';
  assert.equal((await f.post('/api/exchange', turn(f, 'visiting'))).status, 200);
  assert.equal(activeCarry(f.app.store.state, f.chatId).id, shared.id);
  assert.equal(f.localCalls.length, 1);
  assert(f.localCalls[0].messages.some(m => m.content.includes(shared.text)));
  assert(f.requests.at(-1).messages.some(m => m.content.includes(shared.text)));
  const assignment = currentAssignment(f.app.store.state, f.chatId);
  await f.command('table.replySettings', { chatId: f.chatId, baseRevisionId: assignment.id, mode: 'both', speaker: 'visiting' });
  const both = { ...turn(f, 'visiting'), replyMode: 'both', requestId: 'request_both' };
  assert.equal((await f.post('/api/exchange', both)).status, 200);
  const first = f.app.store.state.exchanges.at(-1);
  assert.equal((await f.post('/api/exchange', { ...turn(f, 'personal'), content: '', kind: 'ask',
    requestId: first.request.followUp.requestId, followUpOf: first.id })).status, 200);
  assert.equal(activeCarry(f.app.store.state, f.chatId).id, shared.id);
  assert.equal(f.localCalls.length, 2);
  const replayDir = path.join(f.dir, 'shared-replay'); await fs.mkdir(replayDir);
  await fs.copyFile(f.app.store.file, path.join(replayDir, 'events.jsonl'));
  const replay = new Store(replayDir); await replay.open();
  assert.deepEqual(replay.state.contextCarry, f.app.store.state.contextCarry); await replay.close();
});

test('a text-only personal base receives the same desk account without preparing its own', async t => {
  const f = await mixed(t);
  const personal = f.app.store.state.models.at(-1);
  await f.command('model.save', { id: personal.id, name: personal.name, model: personal.model,
    baseUrl: personal.baseUrl, runtime: 'lmstudio', inputFormat: 'plain-dialogue-v1' });
  assert.equal((await prepare(f)).status, 200);
  const shared = activeCarry(f.app.store.state, f.chatId);
  assert.equal((await f.post('/api/exchange', turn(f, 'personal'))).status, 200);
  assert.equal(f.localCalls.length, 1); assert(f.localCalls[0].prompt.includes(shared.text));
  assert(f.localCalls[0].prompt.includes('Shared account written from the visiting participant perspective'));
  assert.equal(f.app.store.state.contextCarry.jobs.length, 1);
});

test('an existing writer-sized handoff is reused then resized by the visitor, never duplicated for the personal chair', async t => {
  const f = await mixed(t);
  let prepared;
  await f.app.store.transact(state => {
    prepared = beginCarry(state, request(f)); // Simulate the previous writer-only plan.
    prepared.handoff = prepareModelHandoff(state, { taskId: prepared.job.id, chatId: f.chatId, kind: 'carry',
      messages: prepared.messages, purpose: 'Synthetic earlier handoff.', selection: prepared.selection });
    prepared.job.handoff = prepared.handoff; return state;
  });
  assertModelInvocation(prepared.handoff, prepared.messages, prepared.model);
  await f.app.store.transact(state => prepareModelWrite(state, prepared.handoff, { content: account, finishReason: 'stop' }).state);
  await f.app.store.transact(s=>{activateReadyCarry(s,f.chatId);return s;});
  const prior = structuredClone(activeCarry(f.app.store.state, f.chatId));
  const before = await status(f, 'personal');
  assert.equal(before.activeId, prior.id); assert(before.characters > before.limit); // Reproduces the reported mismatch.
  assert.equal((await prepare(f)).status, 200);
  const after = await status(f, 'personal'); assert(after.characters < after.limit);
  assert.equal(activeCarry(f.app.store.state, f.chatId).previousId, prior.id);
  assert.deepEqual(f.app.store.state.contextCarry.records[0], prior);
  assert.equal(f.localCalls.length, 0);
});

test('the same shared account can be shortened without any new source range; excessive output is held', async t => {
  const f = await mixed(t);
  assert.equal((await prepare(f)).status, 200);
  const first = activeCarry(f.app.store.state, f.chatId);
  await f.command('carry.revise', { chatId: f.chatId, baseId: first.id, text: 'A verbose user correction [M1]. ' + 'Context. '.repeat(700) });
  const previous = structuredClone(activeCarry(f.app.store.state, f.chatId)), preview = await status(f, 'visiting');
  assert.equal(preview.preparation.rewriteOnly, true); assert(preview.characters > preview.limit);
  f.responseText = JSON.stringify({ account: '[M1] ' + 'x'.repeat(preview.target.accountCharacters) });
  assert.equal((await prepare(f)).status, 409);
  assert.deepEqual(activeCarry(f.app.store.state, f.chatId), previous);
  f.responseText = account; assert.equal((await prepare(f)).status, 200);
  const current = activeCarry(f.app.store.state, f.chatId), job = f.app.store.state.contextCarry.jobs.at(-1);
  assert.equal(job.rewriteOnly, true); assert.equal(job.from, job.through);
  assert.equal(current.throughMessageId, previous.throughMessageId); assert.equal(current.previousId, previous.id);
  const after = await status(f, 'personal'); assert(after.characters < after.limit);
  await f.command('chat.create', { rootId: f.rootId, title: 'Separate branch' });
  assert.equal(activeCarry(f.app.store.state, f.app.store.state.chats.at(-1).id), null);
});

test('fixed instructions cannot be silently compacted to make a small chair appear ready', async t => {
  const f = await mixed(t);
  await f.command('root.update', { id: f.rootId, instructions: 'Exact guidance. '.repeat(450) });
  const before = await status(f, 'visiting'); assert.equal(before.target, null); assert.equal(before.preparation, null);
  const result = await prepare(f);
  assert.equal(result.status, 400); assert.match(result.body.error, /Current instructions/);
  assert.equal(f.requests.length, 0); assert.equal(f.localCalls.length, 0);
  assert.equal(f.app.store.state.roots[0].instructions.at(-1).text, 'Exact guidance. '.repeat(450));
});
