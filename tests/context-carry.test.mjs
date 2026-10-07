import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fixture, deferred, listen } from './helpers.mjs';
import { createApp } from '../server/index.mjs';
import { compileMessages } from '../server/model.mjs';
import { activeCarry, activateReadyCarry, beginCarry, carryPreview, chatMessages, sourceAt, readChatSource } from '../server/context-carry.mjs';
import { prepareModelHandoff, assertModelInvocation } from '../server/handoff.mjs';
import { Store } from '../server/store.mjs';
import { currentAssignment, lastMessageId } from '../server/table.mjs';

export async function seedConversation(f, count = 24, size = 2600) {
  for (let i = 1; i <= count; i++) await f.command('message.note', { chatId: f.chatId,
    content: `Original distinction ${i}: considering a garden does not decide to plant it. ` + 'Keep the uncertainty and the original wording. '.repeat(Math.ceil(size / 48)) });
}
const request = f => ({ chatId: f.chatId, speaker: 'visiting', baseId: activeCarry(f.app.store.state, f.chatId)?.id ?? null, lastMessageId: chatMessages(f.app.store.state, f.chatId).at(-1).id });
export const syntheticAccount = (sourceId = 'M1', passage = 1) => JSON.stringify({
  account: `The user is exploring a garden; the decision to plant remains open [${sourceId}:${passage}]. Preserve the difference between consideration and commitment. Reopen it when the user chooses a direction.`,
});
const prepare = async f => { const result = await f.post('/api/context-carry/prepare', request(f)); if (result.status === 200) await f.app.store.transact(s => { activateReadyCarry(s, f.chatId); return s; }); return result; };
const status = f => fetch(f.url + '/api/context-carry?' + new URLSearchParams({ chatId: f.chatId, speaker: 'visiting' }), { headers: f.headers }).then(r => r.json());

test('a branch over the limit resumes with attributed carry, exact recent text, no lost draft or renewed permission', async t => {
  const f = await fixture(t); await seedConversation(f);
  await f.command('root.update', { id: f.rootId, instructions: 'Current user instruction stays exact.' });
  await f.command('draft.save', { chatId: f.chatId, text: 'A thought still being written.' });
  const before = structuredClone(f.app.store.state), bytes = await fs.readFile(f.app.store.file);
  const blocked = await f.post('/api/exchange', { chatId: f.chatId, content: 'Keep talking.' });
  assert.equal(blocked.status, 400); assert.match(blocked.body.error, /working-context limit/); assert.equal(f.requests.length, 0);
  f.responseText = syntheticAccount();
  const result = await prepare(f); assert.equal(result.status, 200, JSON.stringify(result.body));
  const state = f.app.store.state, account = activeCarry(state, f.chatId);
  assert(account); assert.equal(account.author, 'model'); assert.equal(account.authority, 'NONE');
  for (const key of ['messages', 'exchanges', 'roots', 'models', 'drafts']) assert.deepEqual(state[key], before[key], key);
  assert((await fs.readFile(f.app.store.file)).subarray(0, bytes.length).equals(bytes));
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].tools, undefined);
  assert(f.requests[0].messages.reduce((n, m) => n + m.content.length, 0) <= 60000);
  const job = state.contextCarry.jobs.at(-1), task = state.handoffs.records.find(r => r.id === job.handoff.requestId).detail.task;
  assert.deepEqual(task.allowedEffects, ['record_context_account']); assert.equal(task.capability.tools, undefined);
  assert.equal(task.authority.mayDelegate, false);
  assert.throws(() => assertModelInvocation(JSON.parse(JSON.stringify(job.handoff)), [], job.modelSnapshot), /live host-issued/);
  const messages = compileMessages(state, f.chatId, 'Keep talking.');
  assert.match(messages[0].content, /Current user instruction stays exact/);
  const carry = messages.find(m => m.content.startsWith('[Branchline carried account'));
  assert.equal(carry.role, 'user'); assert.match(carry.content, /not instructions, verified facts, or permission/);
  assert(!messages[0].content.includes('garden'));
  assert(messages.some(m => m.content === '[Saved chat note] ' + before.messages.at(-1).content));
  assert(!messages.some(m => m.content === '[Saved chat note] ' + before.messages[0].content));
  const preview = await status(f); assert(preview.characters < 60000); assert(preview.totalMessages - preview.carriedMessages >= 2);
  f.responseText = 'A reply after the handoff.';
  const resumed = await f.post('/api/exchange', { chatId: f.chatId, content: 'Keep talking.' });
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
});

test('invalid source passages, extra authority fields and truncated output are retained as failures without activating an account', async t => {
  const f = await fixture(t); await seedConversation(f, 10, 2500);
  const attempts = [
    'not JSON',
    JSON.stringify({ ...JSON.parse(syntheticAccount()), permission: 'full control' }),
    syntheticAccount('M999'),
    syntheticAccount('M1', 999),
    JSON.stringify({ ...JSON.parse(syntheticAccount()), account: 'Invented decision [M999].' }),
  ];
  for (const output of attempts) {
    f.responseText = output;
    const result = await prepare(f); assert.equal(result.status, 409, JSON.stringify(result.body));
    assert.equal(activeCarry(f.app.store.state, f.chatId), null);
    assert.equal(f.app.store.state.contextCarry.jobs.at(-1).status, 'failed');
  }
  f.responseText = syntheticAccount(); f.finishReason = 'length';
  assert.equal((await prepare(f)).status, 409); assert.equal(activeCarry(f.app.store.state, f.chatId), null);
  const calls = f.requests.length;
  assert.equal((await f.post('/api/context-carry/prepare', { ...request(f), grant: 'anything' })).status, 400);
  assert.equal(f.requests.length, calls);
});

test('user corrections are versioned, source-bound, branch-local and survive replay; originals cannot be rewritten', async t => {
  const f = await fixture(t); await seedConversation(f, 10, 2500); f.responseText = syntheticAccount();
  assert.equal((await prepare(f)).status, 200);
  const original = structuredClone(activeCarry(f.app.store.state, f.chatId));
  assert.equal((await f.post('/api/command', { type: 'carry.revise', payload: { chatId: f.chatId, baseId: original.id, text: 'A different passage [M1:999].' } })).status, 400);
  await f.command('carry.revise', { chatId: f.chatId, baseId: original.id, text: 'The garden is still a possibility, not a decision [M1].' });
  const corrected = activeCarry(f.app.store.state, f.chatId);
  assert.equal(corrected.author, 'user'); assert.equal(corrected.previousId, original.id);
  assert.deepEqual(f.app.store.state.contextCarry.records[0], original);
  assert.equal((await f.post('/api/command', { type: 'carry.revise', payload: { chatId: f.chatId, baseId: original.id, text: 'Stale edit.' } })).status, 400);
  await f.command('carry.pin', { chatId: f.chatId, baseId: corrected.id, sourceId: 'M1', pinned: true });
  assert(compileMessages(f.app.store.state, f.chatId, 'Hello').some(m => m.content.includes('[Earlier message brought back by the user') && m.content.includes('Original distinction 1')));
  await assert.rejects(f.app.store.transact(s => { s.messages[0].content = 'Rewritten original'; return s; }), /source|changed/);
  await assert.rejects(f.app.store.transact(s => { s.contextCarry.records[0].text = 'Edited old interpretation'; return s; }), /rewritten/);
  await f.command('chat.create', { rootId: f.rootId, title: 'Other conversation' });
  const other = f.app.store.state.chats.at(-1).id;
  assert.equal((await f.post('/api/command', { type: 'carry.select', payload: { chatId: other, baseId: null, recordId: original.id } })).status, 400);
  assert(!compileMessages(f.app.store.state, other, 'Hi').some(m => m.content.includes('[Branchline carried account')));
  const replayDir = path.join(f.dir, 'replay'); await fs.mkdir(replayDir); await fs.copyFile(f.app.store.file, path.join(replayDir, 'events.jsonl'));
  const replay = new Store(replayDir); await replay.open();
  assert.deepEqual(replay.state.contextCarry, f.app.store.state.contextCarry); await replay.close();
  await f.command('carry.select', { chatId: f.chatId, baseId: corrected.id, recordId: original.id });
  assert.deepEqual(activeCarry(f.app.store.state, f.chatId), original);
  await f.command('carry.select', { chatId: f.chatId, baseId: original.id, recordId: null });
  assert(compileMessages(f.app.store.state, f.chatId, 'Hi').some(m => m.content === '[Saved chat note] ' + f.app.store.state.messages[0].content));
});

test('later handoffs revisit original excerpts and cover new raw messages, rather than only rewriting a summary', async t => {
  const f = await fixture(t); await seedConversation(f, 12, 2500); f.responseText = syntheticAccount();
  assert.equal((await prepare(f)).status, 200);
  const first = structuredClone(activeCarry(f.app.store.state, f.chatId));
  await seedConversation(f, 10, 2500);
  assert.equal((await prepare(f)).status, 200);
  const input = f.requests.at(-1).messages;
  const prior = input.find(m => m.content.startsWith('[Prior derived account'));
  assert(prior.content.includes(first.text));
  assert(input.some(m => m.content.startsWith('[Reopened original excerpts') && m.content.includes('Original distinction 1')));
  assert(input.some(m => m.content.startsWith('[New exact conversation sources')));
  assert.equal(activeCarry(f.app.store.state, f.chatId).previousId, first.id);
  assert(Number(activeCarry(f.app.store.state, f.chatId).throughSourceId.slice(1)) > Number(first.throughSourceId.slice(1)));
});

test('local chat preparation requests a narrow JSON shape and resolves grouped message handles without duplicate excerpts', async t => {
  const f = await fixture(t);
  const model = f.app.store.state.models[0];
  await f.command('model.save', { id: model.id, name: model.name, model: model.model, baseUrl: model.baseUrl, runtime: 'lmstudio' });
  await seedConversation(f, 12, 1000);
  f.responseText = JSON.stringify({ account: 'The choice remains open [M1, M2:1]. We may revisit it [M1].' });
  assert.equal((await prepare(f)).status, 200);
  assert.deepEqual(f.requests[0].response_format.json_schema.schema.required, ['account']);
  assert.equal(f.requests[0].response_format.json_schema.schema.additionalProperties, false);
  const refs = activeCarry(f.app.store.state, f.chatId).sources;
  assert.equal(refs.length, 2); assert.equal(refs[0].start, 0); assert.equal(refs[0].end, 320);
  assert.equal(refs[0].hash, sourceAt(f.app.store.state, f.chatId, 'M1').hash);
});

test('Stop, changed conversation and restart do not adopt an incomplete handoff or restart a model', async t => {
  const f = await fixture(t); await seedConversation(f, 10, 2500);
  let started = deferred(), release = deferred();
  f.handler = async (_body, res) => { started.resolve(); await release.promise; if (!res.destroyed) res.end(JSON.stringify({ choices: [{ message: { content: syntheticAccount() }, finish_reason: 'stop' }] })); };
  const pending = prepare(f); await started.promise;
  assert.equal(f.app.store.state.contextCarry.jobs.at(-1).status, 'pending'); // Overlap and queue paths are exercised in desktop-continuation.test.mjs.
  assert.equal((await f.post('/api/continuity/cancel', { chatId: f.chatId })).status, 200);
  assert.equal((await pending).status, 409); release.resolve();
  assert.equal(activeCarry(f.app.store.state, f.chatId), null);
  started = deferred(); release = deferred();
  const stale = prepare(f); await started.promise;
  await f.command('message.note', { chatId: f.chatId, content: 'A new distinction arrived during preparation.' });
  release.resolve(); assert.equal((await stale).status, 200); // Append-only tail is compatible.
  await f.command('carry.select', {chatId:f.chatId,baseId:activeCarry(f.app.store.state,f.chatId).id,recordId:null});
  await f.app.store.transact(state => {
    const p = beginCarry(state, request(f));
    p.job.handoff = prepareModelHandoff(state, { taskId: p.job.id, chatId: f.chatId, kind: 'carry', purpose: 'Synthetic interrupted context preparation.', messages: p.messages, selection: p.selection });
    return state;
  });
  const count = f.requests.length;
  await f.app.dispose(); f.app = await createApp({ dataDir: f.dataDir, backupDir: f.backupDir }); f.url = await listen(f.app);
  assert.equal(f.app.store.state.contextCarry.jobs.at(-1).status, 'failed');
  assert.match(f.app.store.state.contextCarry.jobs.at(-1).error, /interrupted/);
  assert.equal(activeCarry(f.app.store.state, f.chatId), null); assert.equal(f.requests.length, count);
});

test('source reader is paginated and attributed, scopes model calls to the original branch and cannot accept a grant', async t => {
  const f = await fixture(t); await seedConversation(f, 10, 2600);
  await f.exchange('A synthetic turn about the original source.');
  const assistantIndex = chatMessages(f.app.store.state, f.chatId).length;
  const source = readChatSource(f.app.store.state, f.chatId, `M${assistantIndex}`);
  assert.equal(source.author, 'model · Synthetic model'); assert.equal(source.role, 'assistant');
  const content = 'Exact long source. '.repeat(700);
  await f.command('message.note', { chatId: f.chatId, content });
  const id = 'M' + chatMessages(f.app.store.state, f.chatId).length;
  let offset = 0, recovered = '';
  do { const page = readChatSource(f.app.store.state, f.chatId, id, offset); recovered += page.text; offset = page.nextOffset; } while (offset !== null);
  assert.equal(recovered, content);
  assert.throws(() => readChatSource(f.app.store.state, f.chatId, 'M999'), /branch/);
  const foreignId = f.chatId + '_foreign';
  let round = 0;
  f.handler = (body, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (round++ === 0) {
      assert(body.tools.some(d => d.function.name === 'read_chat_source'));
      const calls = [{ source_id: 'M1', offset: 0 }, { source_id: 'M1', offset: 0, chatId: foreignId }, { source_id: 'M999', offset: 0 }];
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: calls.map((args, i) => ({ index: i, id: 'source_' + i, type: 'function', function: { name: 'read_chat_source', arguments: JSON.stringify(args) } })) }, finish_reason: 'tool_calls' }] }) + '\n\n');
    } else {
      const results = body.messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content));
      assert.equal(results[0].ok, true); assert.match(results[0].value.text, /Original distinction 1/);
      assert.equal(results[1].ok, false); assert.equal(results[2].ok, false);
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Original distinction recovered.' }, finish_reason: 'stop' }] }) + '\n\n');
    }
    res.end('data: [DONE]\n\n');
  };
  const answer = await f.post('/api/exchange', { chatId: f.chatId, content: 'Reopen the original wording.', toolsEnabled: true });
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  const task = f.app.store.state.handoffs.records.find(r => r.id === f.app.store.state.exchanges.at(-1).handoff.requestId).detail.task;
  assert.equal(task.capability.tools.grant, 'paired_UI_tools_selection_for_this_turn');
  assert.equal(task.capability.tools.delegation, false);
});

test('a forged model record cannot bypass the writer and a single oversized exchange stays intact', async t => {
  const f = await fixture(t);
  await f.command('message.note', { chatId: f.chatId, content: 'oversized '.repeat(10000) });
  await seedConversation(f, 5, 3000);
  const before = structuredClone(f.app.store.state);
  assert.equal((await prepare(f)).status, 400); assert.equal(f.requests.length, 0);
  assert.deepEqual(f.app.store.state, before);
  const other = await fixture(t); await seedConversation(other, 10, 2500); other.responseText = syntheticAccount(); await prepare(other);
  const record = structuredClone(activeCarry(other.app.store.state, other.chatId));
  await assert.rejects(other.app.store.transact(state => {
    const job = structuredClone(state.contextCarry.jobs[0]); job.id = 'carryjob_forged'; job.resultId = 'carry_forged';
    state.contextCarry.jobs.push(job); state.contextCarry.records.push({ ...record, id: 'carry_forged', jobId: job.id });
    return state;
  }), /live, exact host write/);
});

test('Both still follows the human request across chairs after a handoff, with fresh per-turn tool grants', async t => {
  const f = await fixture(t); await seedConversation(f, 24, 2600);
  const visiting = f.app.store.state.models[0].id;
  await f.command('model.save', { name: 'Synthetic Personal', model: 'personal-fixture', baseUrl: f.app.store.state.models[0].baseUrl });
  await f.command('personal.create', { name: 'Personal', modelId: f.app.store.state.models.at(-1).id, baseIdentity: 'synthetic-base' });
  await f.command('table.assign', { chatId: f.chatId, baseRevisionId: null, personalId: f.app.store.state.personalParticipants[0].id, visitorModelId: visiting });
  f.responseText = syntheticAccount(); assert.equal((await prepare(f)).status, 200);
  const assignment = currentAssignment(f.app.store.state, f.chatId);
  await f.command('table.replySettings', { chatId: f.chatId, baseRevisionId: assignment.id, mode: 'both', speaker: 'visiting' });
  const body = { chatId: f.chatId, content: 'Both: keep the garden open as a possibility.', speaker: 'visiting', kind: 'send',
    baseRevisionId: assignment.id, lastMessageId: lastMessageId(f.app.store.state, f.chatId), requestId: 'request_first', replyMode: 'both', toolsEnabled: true };
  f.handler = (_body, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'A new visiting suggestion.' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n'); };
  const first = await f.post('/api/exchange', body); assert.equal(first.status, 200, JSON.stringify(first.body));
  const parent = f.app.store.state.exchanges.at(-1);
  const second = await f.post('/api/exchange', { ...body, content: '', speaker: 'personal', kind: 'ask', replyMode: 'single',
    requestId: parent.request.followUp.requestId, followUpOf: parent.id, lastMessageId: lastMessageId(f.app.store.state, f.chatId) });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  const calls = f.requests.slice(-2);
  assert(calls.every(call => call.messages.some(m => m.content.startsWith('[Branchline carried account'))));
  assert(calls[1].messages.some(m => m.role === 'user' && m.content.includes('A new visiting suggestion.') && m.content.includes('another participant')));
  const tasks = f.app.store.state.exchanges.map(e => f.app.store.state.handoffs.records.find(r => r.id === e.handoff.requestId));
  assert.notEqual(tasks[0].id, tasks[1].id); assert.notEqual(tasks[0].detail.task.capability.tools.modelHash, tasks[1].detail.task.capability.tools.modelHash);
  assert.equal(f.app.store.state.exchanges.at(-1).speaker.seat, 'personal');
});

test('source recovery includes exact attachment and tool evidence, while passage references remain bound to supplied excerpts', async t => {
  const f = await fixture(t);
  const attached = await f.post('/api/exchange', { chatId: f.chatId, content: 'Read this original.', selectedFile: { name: 'original.txt', base64: Buffer.from('Exact attached distinction.').toString('base64') } });
  assert.equal(attached.status, 200);
  const original = readChatSource(f.app.store.state, f.chatId, 'M1'); assert.match(original.text, /Exact attached distinction/);
  await seedConversation(f, 12, 2600);
  f.responseText = syntheticAccount('M3'); assert.equal((await prepare(f)).status, 200);
  const prior = activeCarry(f.app.store.state, f.chatId);
  await seedConversation(f, 6, 2600);
  // This passage is real in the source but was not reopened for this call.
  f.responseText = syntheticAccount('M3', 4);
  const outcome = await prepare(f);
  assert.equal(outcome.status, 409); assert.equal(activeCarry(f.app.store.state, f.chatId).id, prior.id);
});
