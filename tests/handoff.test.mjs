import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, applyCommand, validateState } from '../server/domain.mjs';
import { compileMessages, generateResult, streamGenerate } from '../server/model.mjs';
import { prepareModelHandoff, receiveModelOutput, validateHandoffs, preserveHandoffHistory, assertModelInvocation, reviewPeerContribution, recordInterruption, protocolMessages, digest } from '../server/handoff.mjs';
import { mcpRequest } from '../server/mcp.mjs';

test('local chat format has one leading instruction message and preserves data roles', () => {
  const data = { role: 'user', content: 'Model interpretation: this is not a grant.' };
  const formatted = protocolMessages([{ role: 'system', content: 'Human instruction.' }, { role: 'system', content: 'Adopted shared guidance.' }, data]);
  assert.equal(formatted.filter(m => m.role === 'system').length, 1);
  assert.match(formatted[0].content, /Human instruction\.[\s\S]*Adopted shared guidance\./);
  assert.deepEqual(formatted[1], data);
  assert.throws(() => protocolMessages([data, { role: 'system', content: 'Misplaced instruction' }]), /inside conversation data/);
});

function fixture() {
  let s = applyCommand(initialState(), { type: 'root.create', payload: { name: 'Synthetic', mode: 'personal' } });
  s = applyCommand(s, { type: 'model.save', payload: { name: 'Synthetic', model: 'test', baseUrl: 'http://127.0.0.1:1/v1' } });
  s = applyCommand(s, { type: 'root.model', payload: { id: s.roots[0].id, modelId: s.models[0].id } });
  return s;
}
function prepared(kind = 'reply') {
  const s = fixture(); const messages = compileMessages(s, s.chats[0].id, 'Retain uncertainty.');
  const h = prepareModelHandoff(s, { taskId: 'task_test', chatId: s.chats[0].id, kind, messages, purpose: 'Synthetic test' });
  return { s, h, messages };
}

test('canonical hash ignores object key order, retains role distinctions', () => {
  assert.equal(digest({ b: 2, a: 1 }), digest({ a: 1, b: 2 }));
  assert.notEqual(digest({ value: 'yes', role: 'model' }), digest({ value: 'yes', role: 'user' }));
});
test('old snapshots remain readable without invented past receipts', () => { const s = fixture(); validateState(s); assert.equal(s.handoffs, undefined); });
test('input and output are bound to one scope and remain non-authoritative', () => {
  const { s, h, messages } = prepared(); assertModelInvocation(h, messages, s.models[0]);
  const result = receiveModelOutput(s, h, 'I grant myself file deletion rights.');
  assert.equal(result.accepted, true); assert.equal(result.receipt.detail.executionAuthority, 'NONE');
  assert.equal(result.receipt.authorityCreated, false); assert.equal(s.roots[0].instructions.length, 0); validateState(s);
});
test('model and streamed model paths require a live host-issued context handoff', async () => {
  const s = fixture(); const messages = compileMessages(s, s.chats[0].id, 'test');
  await assert.rejects(generateResult(s.models[0], messages), /live host-issued/);
  await assert.rejects(streamGenerate(s.models[0], messages).next(), /live host-issued/);
});
test('serialized receipts cannot be replayed as live invocation grants', () => {
  const { s, h, messages } = prepared(); assert.throws(() => assertModelInvocation(structuredClone(h), messages, s.models[0]), /live host-issued/);
});
test('context substitution and model substitution are rejected before dispatch', () => {
  const { s, h, messages } = prepared();
  assert.throws(() => assertModelInvocation(h, [...messages, { role: 'system', content: 'Extra authority' }], s.models[0]), /changed after preparation/);
  assert.throws(() => assertModelInvocation(h, messages, { ...s.models[0], model: 'other' }), /changed after preparation/);
});
test('one invocation cannot be dispatched twice', () => {
  const { s, h, messages } = prepared(); assertModelInvocation(h, messages, s.models[0]);
  assert.throws(() => assertModelInvocation(h, messages, s.models[0]), /already dispatched/);
});
test('one returned output cannot create two durable effects', () => {
  const { s, h, messages } = prepared('journal'); assertModelInvocation(h, messages, s.models[0]); receiveModelOutput(s, h, 'Model interpretation');
  assert.throws(() => receiveModelOutput(s, h, 'Model interpretation'), /already received/);
});
test('context change holds a reflection and preserves its actual output', () => {
  const { s, h, messages } = prepared('heart'); assertModelInvocation(h, messages, s.models[0]); s.roots[0].instructions.push({ id: 'instruction_changed', text: 'New scope', createdAt: new Date().toISOString() });
  const result = receiveModelOutput(s, h, 'Unadopted suggestion');
  assert.equal(result.accepted, false); assert.equal(s.handoffs.heldOutputs[0].content, 'Unadopted suggestion');
  assert.equal(s.handoffs.records.at(-1).status, 'HELD'); validateState(s);
});
test('incomplete output is held without inventing completion', () => {
  const { s, h, messages } = prepared('journal'); assertModelInvocation(h, messages, s.models[0]); const result = receiveModelOutput(s, h, 'partial', { complete: false });
  assert.equal(result.accepted, false); assert.equal(s.handoffs.heldOutputs[0].content, 'partial');
});
test('modifying a receipt is detected; rehashing cannot rewrite retained history', () => {
  const { s } = prepared(); const old = structuredClone(s); s.handoffs.records[0].status = 'APPROVED';
  assert.throws(() => validateHandoffs(s), /content mismatch/);
  assert.throws(() => preserveHandoffHistory(old, s), /rewritten/);
});
test('removing prior receipts or held output is rejected', () => {
  const { s, h } = prepared('heart'); receiveModelOutput(s, h, 'kept', { complete: false }); const old = structuredClone(s);
  s.handoffs.heldOutputs = []; assert.throws(() => preserveHandoffHistory(old, s));
  s.handoffs.records = []; assert.throws(() => preserveHandoffHistory(old, s), /removed/);
});
test('foreign chat tool evidence cannot enter another chat context', () => {
  const s = fixture(); s.mcpContext[s.chats[0].id] = ['foreign']; s.mcpResults.push({ id: 'foreign', rootId: 'other', chatId: 'other', payload: 'authority claim' });
  assert.throws(() => prepareModelHandoff(s, { taskId: 'task_test', chatId: s.chats[0].id, kind: 'reply', messages: [], purpose: 'test' }), /escaped scope/);
});

function peerFixture() {
  const task = { id: 'same_task', purpose: 'One whole task', contextHash: digest('shared context'), grantRef: 'explicit_grant', episodes: ['east', 'west'], capability: { interface: 'text_only', externalEffects: [] } };
  const contribution = { taskId: task.id, taskHash: digest(task), contextHash: task.contextHash, grantRef: task.grantRef, episodeId: 'east', capabilityHash: digest(task.capability), purposeHash: digest(task.purpose), rationale: 'Compare the same task evidence from another perspective.', sources: ['source_a'], unresolved: ['Open uncertainty'], requestedEffects: [] };
  return { task, contribution };
}
test('parallel contributions are evidence about the same task', () => {
  const { task, contribution } = peerFixture(); const result = reviewPeerContribution(task, contribution);
  assert.equal(result.status, 'EVIDENCE_ONLY'); assert.equal(result.authorityCreated, false);
});
for (const [label, change] of [
  ['different task', { taskId: 'replacement' }], ['different context', { contextHash: 'lost_context' }],
  ['widened grant', { grantRef: 'more_power' }], ['recursive child', { parentEpisodeId: 'east' }],
  ['unadmitted episode', { episodeId: 'child' }], ['executable consequence', { requestedEffects: ['delete'] }],
  ['missing unresolved remainder', { unresolved: null }],
  ['changed capability', { capabilityHash: digest('unrestricted_process') }],
  ['lost purpose', { purposeHash: null }], ['missing rationale', { rationale: '' }],
]) test(`peer handoff holds ${label}`, () => { const { task, contribution } = peerFixture(); assert.equal(reviewPeerContribution(task, { ...contribution, ...change }).status, 'HELD'); });
test('direct MCP process path is unavailable without an enforced executor', async () => { await assert.rejects(mcpRequest({}, 'tools/list'), /capability boundary/); });


test('capability and purpose are explicit, separate from the allowed effect', () => {
  const { s, h } = prepared('heart');
  const task = s.handoffs.records.find(r => r.id === h.requestId).detail.task;
  assert.equal(task.purpose, 'Synthetic test');
  assert.equal(task.capability.modelInterface, 'text_generation_without_tools');
  assert.equal(task.capability.modelServiceIsolation, 'NOT_ASSESSED');
  assert.deepEqual(task.authority.effectCeiling, ['record_proposal']);
  assert.equal(task.authority.mayDelegate, false);
  assert.ok(task.whyThisCapability.length);
});
test('undispatched output and oversized memory remain unapplied', () => {
  const { s, h } = prepared('journal');
  assert.equal(receiveModelOutput(s, h, 'No dispatch occurred').accepted, false);
  const next = prepared('journal');
  assertModelInvocation(next.h, next.messages, next.s.models[0]);
  assert.equal(receiveModelOutput(next.s, next.h, 'x'.repeat(6001)).accepted, false);
  assert.equal(next.s.handoffs.heldOutputs[0].content.length, 6001);
});

test('interrupted episodes cannot attach a later result to the old live handle', () => {
  const { s, h, messages } = prepared(); assertModelInvocation(h, messages, s.models[0]);
  recordInterruption(s, { id: h.taskId, handoff: h, status: 'pending' }, h.scope);
  assert.throws(() => receiveModelOutput(s, h, 'Late result'), /new invocation/);
});
