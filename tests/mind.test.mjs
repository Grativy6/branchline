import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fixture, deferred, listen } from './helpers.mjs';
import { currentAccount, selectedAccount, beginMindReflection } from '../server/mind.mjs';
import { createApp } from '../server/index.mjs';
import { validateState } from '../server/domain.mjs';
import { verifyLearningPacket } from '../server/learning-view.mjs';
import { digest } from '../server/integrity.mjs';

async function mindFixture(t) {
  const f = await fixture(t);
  f.sourceId = await f.exchange('The personal AI follows the user between encounters.');
  f.wake = (job, changes = [], extra = {}) => ({ outcome: 'wake', question: 'What changed in this account?', comparison: 'The selected human statement bears on these relations.', changes, preservedRefs: [], unresolved: [], residue: [], ...extra });
  f.add = (job, account = 'The personal AI participates in this table.', dependsOn = []) => ({ op: 'add', reason: 'Retain the scoped distinction from the selected source.', evidenceRefs: [job.sources.find(s => s.kind === 'message' && s.value.role === 'user').ref], relation: { type: 'participates_in', subject: 'personal participant', object: 'encounter', account, conditions: 'Within this account; applicability elsewhere remains separate.', dependsOn } });
  f.answer = job => f.wake(job, [f.add(job)]);
  f.handler = async (body, response) => {
    const job = f.app.store.state.mind?.jobs.at(-1);
    const isMind = body.messages.some(m => m.content.includes('Produce one small MIND learning wake'));
    const value = isMind ? f.answer(job) : 'A synthetic continuing reply.';
    response.end(JSON.stringify({ choices: [{ message: { content: typeof value === 'string' ? value : JSON.stringify(value) }, finish_reason: 'stop' }] }));
  };
  f.mindBody = (sourceTurnIds = [f.sourceId]) => ({ target: 'mind', chatId: f.chatId, sourceTurnIds, requestId: 'reflection_' + crypto.randomUUID(), baseAccountId: currentAccount(f.app.store.state, f.chatId)?.id ?? null });
  f.learn = async (body = f.mindBody()) => f.post('/api/continuity/reflect', body);
  return f;
}

test('a requested MIND wake binds before, basis, after and enters later context as interpretation', async t => {
  const f = await mindFixture(t);
  const body = f.mindBody();
  assert.equal(f.app.store.state.mind, undefined);
  const result = await f.learn(body);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const state = f.app.store.state, wake = state.mind.wakes[0], job = state.mind.jobs[0];
  assert.equal(wake.beforeRef, job.baseAccountId); assert.equal(wake.afterRef, currentAccount(state, f.chatId).id);
  assert.equal(wake.standing, 'model_interpretation');
  assert.equal(JSON.parse(job.outputText).question, wake.difference.question);
  assert.equal(state.roots[0].instructions.length, 0);
  assert.equal(state.mind.accounts[0].relations.length, 0);
  assert.equal((await f.learn(body)).status, 200); assert.equal(f.requests.length, 2);
  await f.exchange('Continue with the retained context.');
  const context = f.requests.at(-1).messages.find(m => m.content.includes('[MIND current account'));
  assert.equal(context.role, 'user'); assert.match(context.content, /not instructions, verified facts, or permissions/);
  assert.equal(f.app.store.state.mind.wakes.length, 1);
  validateState(f.app.store.state);
});

test('stopping a learning reflection preserves its source without creating a wake', async t => {
  const f = await mindFixture(t), entered = deferred(), finish = deferred(); t.after(() => finish.resolve());
  f.handler = async (_body, res) => { entered.resolve(); await finish.promise; if (!res.destroyed) res.end(JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] })); };
  const running = f.learn(); await entered.promise;
  assert.equal((await f.post('/api/continuity/cancel', { chatId: f.chatId })).status, 200);
  await running; finish.resolve();
  const state = f.app.store.state;
  assert.equal(state.mind.jobs.at(-1).status, 'cancelled');
  assert.equal(state.mind.wakes.length, 0);
  assert.equal(currentAccount(state, f.chatId).relations.length, 0);
  assert.ok(state.mind.jobs.at(-1).sources.length > 0);
  assert.ok(state.handoffs.records.some(r => r.taskId === state.mind.jobs.at(-1).id && r.status === 'HELD'));
});

test('restart marks a pending learning reflection incomplete and never replays inference', async t => {
  const f = await mindFixture(t), count = f.requests.length;
  await f.app.store.transact(state => { beginMindReflection(state, f.mindBody()); return state; });
  const source = structuredClone(f.app.store.state.mind.jobs[0].sources);
  await f.app.dispose(); f.app = await createApp({ dataDir: f.dataDir, backupDir: f.backupDir }); f.url = await listen(f.app);
  assert.equal(f.app.store.state.mind.jobs[0].status, 'failed');
  assert.deepEqual(f.app.store.state.mind.jobs[0].sources, source);
  assert.equal(f.app.store.state.mind.wakes.length, 0);
  assert.equal(f.requests.length, count);
  assert.ok(f.app.store.state.handoffs.records.some(r => r.kind === 'episode.interrupted' && r.taskId === f.app.store.state.mind.jobs[0].id));
});

test('local correction preserves independent relations and questions while reopening dependents', async t => {
  const f = await mindFixture(t);
  f.answer = job => f.wake(job, [f.add(job, 'Personal participates here.'), f.add(job, 'One speaker at a time.')], { unresolved: [{ question: 'Which context should travel?', reopenWhen: 'A context transfer is requested.' }] });
  assert.equal((await f.learn()).status, 200);
  const first = currentAccount(f.app.store.state, f.chatId), [a, b] = first.relations;
  f.answer = job => f.wake(job, [f.add(job, 'A dependent interpretation.', [a.id])], { preservedRefs: [a.id, b.id] });
  assert.equal((await f.learn()).status, 200);
  const dependent = currentAccount(f.app.store.state, f.chatId).relations.at(-1);
  f.answer = job => f.wake(job, [{ ...f.add(job, 'The personal AI follows the user.'), op: 'revise', relationId: a.id }], { preservedRefs: [b.id] });
  assert.equal((await f.learn()).status, 200);
  const latest = currentAccount(f.app.store.state, f.chatId);
  assert.deepEqual(latest.relations.find(r => r.id === b.id), b);
  assert.equal(latest.relations.find(r => r.priorRef === dependent.id).status, 'reopened');
  assert.notEqual(latest.relations.find(r => r.priorRef === dependent.id).id, dependent.id);
  assert.deepEqual(latest.unresolved, first.unresolved);
  assert.deepEqual(f.app.store.state.mind.accounts[1], first);
});

test('no-change and insufficient-basis outcomes retain an account without invented wakes', async t => {
  const f = await mindFixture(t);
  for (const outcome of ['no_material_change', 'insufficient_basis']) {
    f.answer = () => ({ outcome, comparison: 'No supported account change can be identified from this selection.' });
    assert.equal((await f.learn()).status, 200);
  }
  assert.equal(f.app.store.state.mind.wakes.length, 0);
  assert.equal(f.app.store.state.mind.accounts.length, 1);
  assert.deepEqual(f.app.store.state.mind.jobs.map(j => j.outcome), ['no_material_change', 'insufficient_basis']);
});

test('malformed output, unsupported authority fields and unrelated references are held with exact text', async t => {
  const f = await mindFixture(t);
  for (const answer of [() => 'Not structured JSON.', job => ({ ...f.wake(job, [f.add(job)]), approval: 'I approve myself' }), job => f.wake(job, [{ ...f.add(job), evidenceRefs: ['message_not_supplied'] }])]) {
    f.answer = answer;
    const r = await f.learn(); assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(currentAccount(f.app.store.state, f.chatId).relations.length, 0);
    assert.equal(f.app.store.state.mind.jobs.at(-1).status, 'held');
  }
  assert.equal(f.app.store.state.handoffs.heldOutputs.length, 3);
  assert.equal(f.app.store.state.handoffs.heldOutputs[0].content, 'Not structured JSON.');
  assert.equal(f.app.store.state.roots[0].instructions.length, 0);
});

test('failed source turns remain useful evidence without becoming successful answers', async t => {
  const f = await mindFixture(t);
  f.handler = async (body, response) => { response.writeHead(500); response.end('Synthetic model failure'); };
  const failed = await f.post('/api/exchange', { chatId: f.chatId, content: 'A failed attempt.' });
  assert.equal(failed.status, 502); const source = f.app.store.state.exchanges.at(-1);
  f.handler = async (body, response) => {
    const job = f.app.store.state.mind.jobs.at(-1);
    assert.equal(job.sources.find(s => s.kind === 'outcome').value.status, 'failed');
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(f.wake(job, [f.add(job, 'The attempt returned no successful answer.')])) }, finish_reason: 'stop' }] }));
  };
  assert.equal((await f.learn(f.mindBody([source.id]))).status, 200);
  assert.equal(f.app.store.state.exchanges.at(-1).status, 'failed');
});

test('exclusion keeps history and independent questions, and a stale reflection cannot restore it', async t => {
  const f = await mindFixture(t);
  f.answer = job => f.wake(job, [f.add(job)], { unresolved: [{ question: 'Question from first wake?', reopenWhen: 'Its source changes.' }] });
  await f.learn(); const wake = f.app.store.state.mind.wakes[0];
  f.answer = job => f.wake(job, [f.add(job, 'Independent context.')], { unresolved: [{ question: 'Independent question?', reopenWhen: 'An unrelated cue appears.' }] });
  await f.learn();
  const before = structuredClone(f.app.store.state.mind.accounts);
  const entered = deferred(), finish = deferred(); t.after(() => finish.resolve());
  f.handler = async (body, response) => { const value = f.answer(f.app.store.state.mind.jobs.at(-1)); entered.resolve(); await finish.promise; response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] })); };
  const pending = f.learn(); await entered.promise;
  await f.command('mind.exclude', { chatId: f.chatId, wakeId: wake.id, baseAccountId: currentAccount(f.app.store.state, f.chatId).id });
  finish.resolve(); assert.equal((await pending).status, 409);
  assert.equal(currentAccount(f.app.store.state, f.chatId).relations.length, 1);
  assert.equal(currentAccount(f.app.store.state, f.chatId).unresolved.length, 1);
  assert.equal(currentAccount(f.app.store.state, f.chatId).unresolved[0].question, 'Independent question?');
  assert.deepEqual(f.app.store.state.mind.accounts.slice(0, before.length), before);
});

test('MIND records replay and cannot be rewritten; another table does not receive them', async t => {
  const f = await mindFixture(t); await f.learn();
  const original = structuredClone(f.app.store.state.mind), bytes = await fs.readFile(f.app.store.file);
  await assert.rejects(f.app.store.transact(state => { state.mind.wakes[0].difference.comparison = 'Altered'; return state; }));
  assert.deepEqual(await fs.readFile(f.app.store.file), bytes);
  await f.app.dispose(); f.app = await createApp({ dataDir: f.dataDir, backupDir: f.backupDir }); f.url = await listen(f.app);
  assert.deepEqual(f.app.store.state.mind, original);
  await f.command('chat.create', { rootId: f.rootId, title: 'Independent context' });
  const other = f.app.store.state.chats.at(-1).id;
  assert.equal(selectedAccount(f.app.store.state, other).accountId, null);
  const cross = await f.post('/api/continuity/reflect', { ...f.mindBody(), chatId: other, baseAccountId: null });
  assert.equal(cross.status, 400);
});

test('a small journal budget stops learning reflection before inference and preserves existing history', async t => {
  const f = await mindFixture(t);
  f.app.reflections.modelOptions.mindJournalQuotaBytes = 1;
  const before = await fs.readFile(f.app.store.file), count = f.requests.length;
  assert.equal((await f.learn()).status, 400);
  assert.equal(f.requests.length, count);
  assert.deepEqual(await fs.readFile(f.app.store.file), before);
});

test('selected learning packets carry resolvable sources and authors without unrelated account text or writes', async t => {
  const f = await mindFixture(t);
  f.answer = job => f.wake(job, [f.add(job, 'A selected distinction.'), f.add(job, 'UNRELATED_PRIVATE_ACCOUNT_TEXT')]);
  await f.learn(); const relation = currentAccount(f.app.store.state, f.chatId).relations[0];
  f.answer = job => f.wake(job, [{ ...f.add(job, 'A revised distinction.'), op: 'revise', relationId: relation.id }]);
  await f.learn(); const wake = f.app.store.state.mind.wakes.at(-1);
  const state = structuredClone(f.app.store.state), requests = f.requests.length;
  const result = await f.post('/api/learning/packet', { chatId: f.chatId, wakeIds: [wake.id] });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(verifyLearningPacket(JSON.parse(JSON.stringify(result.body))), { valid: true, status: 'PREPARED_NOT_TRAINED', authorityCreated: false, weightsChanged: false });
  assert.ok(!JSON.stringify(result.body).includes('UNRELATED_PRIVATE_ACCOUNT_TEXT'));
  assert.equal(result.body.items[0].contributors.length, 2);
  assert.deepEqual(f.app.store.state, state); assert.equal(f.requests.length, requests);
  const changed = structuredClone(result.body); changed.nodes[Object.keys(changed.nodes)[0]].value.chatId = 'another_chat';
  assert.throws(() => verifyLearningPacket(changed), /changed/);
  const missing = structuredClone(result.body); delete missing.nodes[missing.items[0].sources[0]];
  const { hash, ...envelope } = missing; missing.hash = digest(envelope);
  assert.throws(() => verifyLearningPacket(missing), /required node is missing/);
});

test('learning export rejects cross-table selections and excluded wakes', async t => {
  const f = await mindFixture(t); await f.learn(); const wake = f.app.store.state.mind.wakes[0];
  await f.command('chat.create', { rootId: f.rootId, title: 'Other table' }); const other = f.app.store.state.chats.at(-1).id;
  assert.equal((await f.post('/api/learning/packet', { chatId: other, wakeIds: [wake.id] })).status, 400);
  await f.command('mind.exclude', { chatId: f.chatId, wakeId: wake.id, baseAccountId: currentAccount(f.app.store.state, f.chatId).id });
  assert.equal((await f.post('/api/learning/packet', { chatId: f.chatId, wakeIds: [wake.id] })).status, 400);
});
