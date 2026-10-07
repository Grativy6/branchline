// Regression derived from Claude review F4; synthetic providers only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { activeCarry, readyCarry, chatMessages, carryBasis } from '../server/context-carry.mjs';

async function readyAccountThenSibling(t, { siblingReflection }) {
  const f = await fixture(t);
  for (let i = 1; i <= 24; i++) await f.command('message.note', { chatId: f.chatId,
    content: `Original distinction ${i}: considering a garden does not decide to plant it. ` + 'Keep the uncertainty and the original wording. '.repeat(55) });
  const a = f.chatId, state = () => f.app.store.state;
  f.responseText = JSON.stringify({ account: 'The user is exploring a garden; the decision to plant remains open [M1:1].' });
  const prepared = await f.post('/api/context-carry/prepare', { chatId: a, speaker: 'visiting', baseId: null, lastMessageId: chatMessages(state(), a).at(-1).id });
  assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
  assert(readyCarry(state(), a), 'account is ready, waiting for the next reply');
  const basisBefore = carryBasis(state(), a);
  // Sibling branch B in the same desk: one reply, then (optionally) a journal reflection on it.
  await f.command('chat.create', { rootId: f.rootId, title: 'Sibling branch B' });
  const b = state().chats.at(-1).id;
  f.responseText = 'Synthetic reply in branch B.';
  const reply = await f.post('/api/exchange', { chatId: b, content: 'Hello from branch B.' });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  if (siblingReflection) {
    f.responseText = 'Branch B noted something about its own topic.';
    const exchangeId = state().exchanges.filter(e => e.chatId === b).at(-1).id;
    const reflected = await f.post('/api/continuity/reflect', { chatId: b, exchangeId, target: 'journal' });
    assert.equal(reflected.status, 200, JSON.stringify(reflected.body));
  }
  const basisAfter = carryBasis(state(), a);
  // Back in branch A: send the next message, which should activate the ready account.
  f.responseText = 'Synthetic reply in branch A.';
  await f.command('ui.update', { selected: { personal: { rootId: f.rootId, chatId: a } } });
  const next = await f.post('/api/exchange', { chatId: a, content: 'Continue in branch A.' });
  return { status: next.status, error: next.body.error ?? null, basisChanged: basisBefore !== basisAfter,
    activated: activeCarry(state(), a)?.id === prepared.body.contextCarry?.ready?.[a] || !!activeCarry(state(), a),
    stillReady: !!readyCarry(state(), a), branchAJournalEntries: (state().roots[0].continuity?.journal ?? []).filter(j => j.chatId === a).length };
}

test('control: sibling reply without reflection leaves the ready account usable', async t => {
  const r = await readyAccountThenSibling(t, { siblingReflection: false });
  console.log('control', JSON.stringify(r));
  assert.equal(r.status, 200);
});

test('sibling-branch journal reflection preserves branch A\'s next reply', async t => {
  const r = await readyAccountThenSibling(t, { siblingReflection: true });
  console.log('sibling-reflection', JSON.stringify(r));
  assert.equal(r.branchAJournalEntries, 0, 'nothing was added to branch A');
  assert.equal(r.basisChanged, false);
  assert.equal(r.status, 200);
  assert.equal(r.activated, true);
});
