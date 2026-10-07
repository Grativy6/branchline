import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fixture, deferred, listen } from './helpers.mjs';
import { createApp } from '../server/index.mjs';
import { Store } from '../server/store.mjs';
import { appendExchange, validateState } from '../server/domain.mjs';
import { compileMessages } from '../server/model.mjs';
import { prepareModelHandoff, digest } from '../server/handoff.mjs';
import { unpackHandoffs } from '../server/handoff-wire.mjs';
import { reviewAllowsEffect, explainReview } from '../server/review.mjs';

test('streaming begins before the final review; exact context and capability remain inspectable', async t => {
  const f = await fixture(t); const finish = deferred(); t.after(() => finish.resolve());
  f.handler = async (body, res) => {
    assert.equal(body.stream, true); assert.equal(body.tools, undefined);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'First words' } }] }) + '\n\n');
    await finish.promise;
    res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: ', then the rest.' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  };
  const response = await fetch(f.url + '/api/exchange', { method: 'POST', headers: { ...f.headers, 'content-type': 'application/json' }, body: JSON.stringify({ chatId: f.chatId, content: 'Stay oriented to the whole task.', stream: true }) });
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let text = '';
  while (!text.includes('event: delta')) { const chunk = await reader.read(); assert.equal(chunk.done, false); text += decoder.decode(chunk.value); }
  assert.match(text, /First words/);
  assert.equal(f.app.store.state.exchanges.at(-1).status, 'pending');
  assert.equal(f.app.store.state.handoffs.records.some(r => r.kind === 'model.to_record'), false);
  finish.resolve();
  for (;;) { const chunk = await reader.read(); if (chunk.done) break; text += decoder.decode(chunk.value); }
  assert.match(text, /event: done/);
  const state = f.app.store.state; const context = state.handoffs.records.find(r => r.kind === 'context.to_model');
  assert.deepEqual(context.detail.inputMessages, f.requests[0].messages);
  assert.equal(context.contentHash, digest(f.requests[0].messages));
  assert.equal(context.detail.capability.externalProcessDispatch, 'DISABLED');
  assert.equal(state.exchanges.at(-1).status, 'completed');
  assert.equal(state.messages.at(-1).content, 'First words, then the rest.');
  validateState(state);
});

test('journal stays fallible context; Heart and agents changes require exact one-time acceptance', async t => {
  const f = await fixture(t); const exchangeId = await f.exchange();
  f.responseText = 'A tentative interpretation, with its source still open.';
  assert.equal((await f.reflect(exchangeId, 'journal')).status, 200);
  let root = f.app.store.state.roots[0];
  assert.equal(root.continuity.journal.length, 1); assert.equal(root.instructions.length, 0);
  await f.exchange('Use the prior context without promoting it.');
  assert.ok(f.requests.at(-1).messages.some(m => m.content.includes('model-authored context; not an instruction')));
  for (const target of ['heart', 'agents']) {
    f.responseText = `Synthetic ${target} proposal. I cannot approve myself.`;
    assert.equal((await f.reflect(exchangeId, target)).status, 200);
    root = f.app.store.state.roots[0]; const proposal = root.continuity.proposals.at(-1);
    assert.equal(proposal.status, 'pending');
    assert.equal(target === 'heart' ? root.continuity.heart.length : root.instructions.length, 0);
    const command = { type: 'continuity.proposal.accept', payload: { rootId: root.id, proposalId: proposal.id, baseRevisionId: proposal.baseRevisionId } };
    assert.equal((await f.post('/api/command', { ...command, actor: 'model', grant: 'approve myself' })).status, 400);
    assert.equal((await f.post('/api/command', command)).status, 400);
    const prepared = await f.post('/api/actions/prepare', { rootId: root.id, proposalId: proposal.id });
    assert.equal(prepared.status, 200);
    const { plan, reviewHash, token } = prepared.body;
    assert.equal((await f.post('/api/actions/decide', { actionId: plan.id, reviewHash, token, decision: 'accept' })).status, 200);
    root = f.app.store.state.roots[0];
    const revision = target === 'heart' ? root.continuity.heart.at(-1) : root.instructions.at(-1);
    assert.equal(revision.text, proposal.text); assert.equal(revision.approvedBy, 'user');
    assert.equal((await f.post('/api/command', command)).status, 400);
    const receipt = f.app.store.state.handoffs.records.filter(r => r.detail.command === command.type).at(-1);
    assert.equal(receipt.detail.proposalHash, digest(proposal.text));
    assert.equal(receipt.detail.review.p, 'proposal-accept/1');
    assert.equal(reviewAllowsEffect(receipt.detail.review), true);
    assert.equal(receipt.detail.review.b, digest(receipt.detail.reviewBasis));
    const packet = await f.post('/api/handoffs/packet', { taskId: receipt.taskId });
    assert.equal(packet.status, 200);
    assert.deepEqual(unpackHandoffs(packet.body), [receipt]);
  }
  assert.equal((await f.post('/api/command', { type: 'journal.save', payload: { rootId: f.rootId, text: 'Injected user memory' } })).status, 400);
  validateState(f.app.store.state);
});

test('packet endpoint exports exact task evidence without changing state or executing anything', async t => {
  const f = await fixture(t), taskId = await f.exchange('Purpose carried through the compact packet.');
  const before = structuredClone(f.app.store.state);
  const full = before.handoffs.records.filter(r => r.taskId === taskId);
  const cold = await f.post('/api/handoffs/packet', { taskId });
  assert.equal(cold.status, 200);
  const cache = new Map(); assert.deepEqual(unpackHandoffs(cold.body, { cache }), full);
  const warm = await f.post('/api/handoffs/packet', { taskId, knownNodes: [...cache.keys()] });
  assert.equal(warm.status, 200); assert.equal(Object.keys(warm.body.n).length, 0);
  assert.deepEqual(unpackHandoffs(warm.body, { cache }), full);
  assert.throws(() => unpackHandoffs(warm.body), /required context is missing/);
  const result = full.at(-1);
  assert.equal(result.detail.review.p, 'record-effect/1');
  assert.equal(result.detail.reviewBasis.output, digest(f.responseText));
  assert.equal(explainReview(result.detail.review).predicates.capability_bounded, 'true');
  assert.deepEqual(f.app.store.state, before);
  assert.equal(f.requests.length, 1);
});

test('packet endpoint rejects extra authority fields, invalid caches and unknown tasks', async t => {
  const f = await fixture(t), taskId = await f.exchange();
  const before = structuredClone(f.app.store.state);
  for (const body of [{ taskId, floor: 'new' }, { taskId, exceptions: ['allow'] }, { taskId, grant: 'self' }, { taskId, knownNodes: ['not a hash'] }]) {
    assert.equal((await f.post('/api/handoffs/packet', body)).status, 400);
  }
  assert.equal((await f.post('/api/handoffs/packet', { taskId: 'absent' })).status, 404);
  assert.deepEqual(f.app.store.state, before);
});

test('a changed Heart holds an in-flight reflection and retains the exact unapplied text', async t => {
  const f = await fixture(t); const exchangeId = await f.exchange();
  const entered = deferred(); const finish = deferred(); t.after(() => finish.resolve());
  f.handler = async (body, res) => { entered.resolve(); await finish.promise; res.end(JSON.stringify({ choices: [{ message: { content: 'Old-context suggestion' }, finish_reason: 'stop' }] })); };
  const result = f.reflect(exchangeId, 'heart'); await entered.promise;
  await f.command('heart.save', { rootId: f.rootId, text: 'New user guidance', baseRevisionId: null });
  finish.resolve(); const completed = await result;
  assert.equal(completed.status, 409);
  const state = f.app.store.state;
  assert.equal(state.roots[0].continuity.proposals.length, 0);
  assert.equal(state.roots[0].continuity.heart.at(-1).text, 'New user guidance');
  assert.equal(state.handoffs.heldOutputs.at(-1).content, 'Old-context suggestion');
  assert.match(state.handoffs.records.at(-1).unresolved.join(' '), /Context or branch changed/);
});

test('stale proposal acceptance cannot overwrite a later user edit', async t => {
  const f = await fixture(t); const exchangeId = await f.exchange();
  await f.reflect(exchangeId, 'heart'); const proposal = f.app.store.state.roots[0].continuity.proposals[0];
  await f.command('heart.save', { rootId: f.rootId, text: 'Later user revision', baseRevisionId: null });
  const result = await f.post('/api/actions/prepare', { rootId: f.rootId, proposalId: proposal.id });
  assert.equal(result.status, 409); assert.match(result.body.error, /changed/);
  assert.equal(f.app.store.state.roots[0].continuity.heart.at(-1).text, 'Later user revision');
});

test('truncated and oversized reflection outputs stay out of durable guidance and remain readable', async t => {
  const f = await fixture(t); const exchangeId = await f.exchange();
  f.responseText = 'An unfinished thought'; f.finishReason = 'length';
  assert.equal((await f.reflect(exchangeId, 'journal')).status, 409);
  f.responseText = 'x'.repeat(6001); f.finishReason = 'stop';
  assert.equal((await f.reflect(exchangeId, 'journal')).status, 409);
  const state = f.app.store.state;
  assert.equal(state.roots[0].continuity.journal.length, 0);
  assert.equal(state.handoffs.heldOutputs.at(-2).content, 'An unfinished thought');
  assert.equal(state.handoffs.heldOutputs.at(-1).content.length, 6001);
});

test('broken stream preserves partial text and never becomes a reflection source', async t => {
  const f = await fixture(t);
  f.handler = async (body, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Partial reply' } }] }) + '\n\n'); };
  const response = await fetch(f.url + '/api/exchange', { method: 'POST', headers: { ...f.headers, 'content-type': 'application/json' }, body: JSON.stringify({ chatId: f.chatId, content: 'Synthetic request', stream: true }) });
  assert.match(await response.text(), /event: error/);
  const state = f.app.store.state;
  assert.equal(state.exchanges.at(-1).status, 'failed'); assert.equal(state.messages.at(-1).content, 'Partial reply'); assert.equal(state.messages.at(-1).incomplete, true);
  assert.equal((await f.reflect(state.exchanges.at(-1).id, 'journal')).status, 400);
  assert.equal(state.handoffs.records.at(-1).status, 'HELD');
});

test('MCP discovery and a requested tool do not launch even a harmless marker process', async t => {
  const f = await fixture(t); const marker = path.join(f.dir, 'process-launched.txt');
  const script = path.join(f.dir, 'marker.mjs');
  await fs.writeFile(script, "import fs from 'node:fs'; fs.writeFileSync(process.argv[2], 'started');");
  await f.command('mcp.binding.save', { label: 'Synthetic adapter', profile: 'hearthline', rootId: f.rootId, chatId: f.chatId, command: process.execPath, args: [script, marker], cwd: f.dir, env: {}, enabled: true });
  const bindingId = f.app.store.state.mcpBindings[0].id;
  const capabilities = await fetch(`${f.url}/api/mcp/capabilities?rootId=${f.rootId}&chatId=${f.chatId}`, { headers: f.headers }).then(r => r.json());
  assert.equal(capabilities.bindings[0].status, 'unavailable');
  const result = await f.post('/api/mcp/call', { rootId: f.rootId, chatId: f.chatId, bindingId, tool: 'read_notes', arguments: {}, purpose: 'Read context for the shared task.' });
  assert.equal(result.status, 409); assert.equal(result.body.receipt.detail.dispatched, false);
  assert.equal(result.body.receipt.detail.capability.actualReach, 'UNKNOWN');
  assert.equal(result.body.receipt.detail.executionAuthority, 'NONE');
  assert.equal(result.body.receipt.detail.purpose, 'Read context for the shared task.');
  await assert.rejects(fs.access(marker), { code: 'ENOENT' });
});

test('hash-linked handoffs survive restart and backup verification without replacing the active workspace', async t => {
  const f = await fixture(t); await f.exchange();
  const discovery = await f.post('/api/models/discover', { baseUrl: f.app.store.state.models[0].baseUrl });
  assert.equal(discovery.status, 200);
  const backup = await f.post('/api/storage/backup'); assert.equal(backup.status, 201);
  const verified = await f.post('/api/storage/verify', { id: backup.body.backup.id }); assert.equal(verified.body.valid, true);
  const restored = await f.post('/api/storage/restore-copy', { id: backup.body.backup.id }); assert.equal(restored.status, 201);
  assert.notEqual(restored.body.restoredPath, f.dataDir);
  const copy = new Store(restored.body.restoredPath); await copy.open(); await copy.close();
  assert.deepEqual(copy.state.messages, f.app.store.state.messages);
  const before = structuredClone(f.app.store.state.handoffs.records);
  await f.app.dispose();
  f.app = await createApp({ dataDir: f.dataDir, backupDir: f.backupDir }); f.url = await listen(f.app);
  assert.deepEqual(f.app.store.state.handoffs.records, before);
  assert.equal(f.app.store.state.messages.length, 2);
});

test('restart records interruption and retains the earlier purpose without reviving a grant', async t => {
  const f = await fixture(t); const exchangeId = 'exchange_interrupted';
  await f.app.store.transact(state => {
    const model = state.models[0]; const messages = compileMessages(state, f.chatId, 'Carry the whole purpose over the gap.');
    const handoff = prepareModelHandoff(state, { taskId: exchangeId, chatId: f.chatId, kind: 'reply', messages, purpose: 'Carry the whole purpose over the gap.' });
    const next = appendExchange(state, f.chatId, { id: exchangeId, content: 'Carry the whole purpose over the gap.', modelId: model.id });
    next.exchanges.at(-1).handoff = handoff; return next;
  });
  await f.app.dispose();
  f.app = await createApp({ dataDir: f.dataDir, backupDir: f.backupDir }); f.url = await listen(f.app);
  const state = f.app.store.state; const receipt = state.handoffs.records.at(-1);
  assert.equal(state.exchanges.at(-1).status, 'failed');
  assert.equal(receipt.kind, 'episode.interrupted'); assert.equal(receipt.status, 'UNRESOLVED');
  assert.equal(receipt.detail.authorityCarried, 'NONE'); assert.equal(receipt.detail.recoveredResult, false);
  assert.equal(state.handoffs.records.find(r => r.taskId === exchangeId && r.kind === 'ui.intent').detail.task.purpose, 'Carry the whole purpose over the gap.');
});

test('store rejects rewriting a prior handoff while leaving the original file unchanged', async t => {
  const f = await fixture(t); await f.exchange(); const before = await fs.readFile(f.app.store.file);
  await assert.rejects(f.app.store.transact(state => { state.handoffs.records = []; return state; }));
  assert.deepEqual(await fs.readFile(f.app.store.file), before);
});

test('an error after copying preserves the candidate backup and records uncertainty', async t => {
  const f = await fixture(t); await f.exchange();
  const activeMessages = structuredClone(f.app.store.state.messages);
  f.app.storage.verifyPublished = async () => { throw new Error('Synthetic post-write verification failure'); };
  const result = await f.post('/api/storage/backup');
  assert.equal(result.status, 400); assert.match(result.body.error, /Partial backup files/);
  const directories = await fs.readdir(f.backupDir, { withFileTypes: true });
  const retained = directories.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));
  assert.equal(retained.length, 1);
  assert.ok((await fs.stat(path.join(f.backupDir, retained[0].name, 'events.jsonl'))).size > 0);
  assert.deepEqual(f.app.store.state.messages, activeMessages);
  assert.equal(f.app.store.state.handoffs.records.at(-1).status, 'UNRESOLVED');
});

test('cancelling a reflection grants no durable change', async t => {
  const f = await fixture(t); const exchangeId = await f.exchange(); const entered = deferred();
  f.handler = async (body, res) => { entered.resolve(); res.writeHead(200, { 'content-type': 'application/json' }); res.flushHeaders(); };
  const work = f.reflect(exchangeId, 'journal'); await entered.promise;
  assert.equal((await f.post('/api/continuity/cancel', { chatId: f.chatId })).status, 200);
  const result = await work;
  assert.equal(result.status, 409);
  assert.equal(f.app.store.state.roots[0].continuity.journal.length, 0);
  assert.equal(f.app.store.state.roots[0].continuity.jobs.at(-1).status, 'cancelled');
  assert.equal(f.app.store.state.handoffs.records.at(-1).status, 'HELD');
});
