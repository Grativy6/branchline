import test from 'node:test';
import assert from 'node:assert/strict';
import { digest, assertModelInvocation } from '../server/handoff.mjs';
import { packHandoffs, unpackHandoffs, packetBytes } from '../server/handoff-wire.mjs';
import { receiptFixture } from './receipt-fixture.mjs';

test('cold and cached packets recover the exact receipts, Unicode and unresolved context', () => {
  const f = receiptFixture({ instructions: 'Keep 💛 and e\u0301 distinct. Preserve CRLF:\r\nKeep the gap.', purpose: 'Literal data: [1,"hash"] is not a reference.' });
  const cache = new Map();
  const cold = packHandoffs(f.records);
  assert.deepEqual(unpackHandoffs(JSON.parse(JSON.stringify(cold)), { cache }), f.records);
  const warm = packHandoffs(f.records, { known: [...cache.keys()] });
  assert.equal(Object.keys(warm.n).length, 0);
  assert.deepEqual(unpackHandoffs(warm, { cache }), f.records);
  assert.ok(packetBytes(warm) < packetBytes(cold));
  assert.throws(() => assertModelInvocation(unpackHandoffs(warm, { cache })[0], f.messages, f.state.models[0]), /live host-issued/);
});

test('missing cache context fails closed without admitting the partial packet', () => {
  const f = receiptFixture(), cold = packHandoffs(f.records);
  const warm = packHandoffs(f.records, { known: Object.keys(cold.n) });
  const cache = new Map();
  assert.throws(() => unpackHandoffs(warm, { cache }), /required context is missing/);
  assert.equal(cache.size, 0);
  const partial = structuredClone(cold);
  const root = partial.r.at(-1).b[1]; delete partial.n[root];
  assert.throws(() => unpackHandoffs(partial, { cache }), /required context is missing/);
  assert.equal(cache.size, 0);
});

test('changed transmitted or cached context cannot retain its original reference', () => {
  const cold = packHandoffs(receiptFixture().records);
  const altered = structuredClone(cold); altered.n[altered.r[0].b[1]] = ['v', 'changed'];
  assert.throws(() => unpackHandoffs(altered), /node hash differs/);
  const cache = new Map(); unpackHandoffs(cold, { cache });
  cache.set(cold.r[0].b[1], ['v', 'changed cached node']);
  const omitted = { ...cold, n: {} };
  assert.throws(() => unpackHandoffs(omitted, { cache }), /node changed/);
});

test('compact decisions cannot differ from the complete receipt', () => {
  const cold = packHandoffs(receiptFixture().records);
  for (const field of ['h', 'k', 's', 'm']) {
    const packet = structuredClone(cold);
    packet.r.at(-1)[field] = field === 'm' ? null : 'invented';
    assert.throws(() => unpackHandoffs(packet), /compact header differs/);
  }
});

test('unknown versions, extensions and profiles require an explicit new interpretation', () => {
  const f = receiptFixture(), cold = packHandoffs(f.records);
  assert.throws(() => unpackHandoffs({ ...cold, v: 'future/9' }), /unknown schema/);
  assert.throws(() => unpackHandoffs({ ...cold, floor: 'new' }), /unknown schema/);
  const header = structuredClone(cold); header.r[0].grant = 'self';
  assert.throws(() => unpackHandoffs(header), /unknown or missing header/);
  const records = structuredClone(f.records), r = records.at(-1);
  r.profile = 'unknown'; const { hash, ...value } = r; r.hash = digest(value);
  assert.throws(() => packHandoffs(records), /unknown source profile/);
});

test('a packet cannot omit a source receipt even when all transmitted nodes are valid', () => {
  const f = receiptFixture();
  assert.throws(() => packHandoffs(f.records.slice(1)), /predecessor is missing/);
  const cold = packHandoffs(f.records); cold.r.shift();
  const cache = new Map();
  assert.throws(() => unpackHandoffs(cold, { cache }), /predecessor is missing/);
  assert.equal(cache.size, 0);
});

test('one packet cannot combine different whole tasks or duplicate a receipt', () => {
  const a = receiptFixture({ taskId: 'one' }), b = receiptFixture({ state: a.state, taskId: 'two' });
  assert.throws(() => packHandoffs([...a.records, ...b.records]), /mixed task/);
  assert.throws(() => packHandoffs([...a.records, a.records[0]]), /duplicate receipt/);
});

test('legacy receipts remain exact evidence without invented review fields', () => {
  const f = receiptFixture();
  const legacy = f.records.slice(0, 2);
  assert.deepEqual(unpackHandoffs(packHandoffs(legacy)), legacy);
  assert.ok(legacy.every(r => r.detail.review === undefined));
});

test('reference expansion and excessive advertisements have finite bounds', () => {
  const cold = packHandoffs(receiptFixture().records);
  const nodes = {};
  let node = ['v', 'x'.repeat(200)]; let key = digest(node); nodes[key] = node;
  for (let i = 0; i < 16; i++) { node = ['a', [[1, key], [1, key]]]; key = digest(node); nodes[key] = node; }
  const packet = { ...cold, n: nodes, r: [{ ...cold.r[0], b: [1, key] }] };
  assert.throws(() => unpackHandoffs(packet), /expanded data exceeds limit/);
  assert.throws(() => packHandoffs([], { known: Array(4097).fill(digest('known')) }), /invalid cache advertisement/);
});

test('reused context reduces bytes while each new outcome still resolves completely', () => {
  const instructions = 'Synthetic enduring guidance. '.repeat(500);
  const first = receiptFixture({ instructions, taskId: 'one' });
  const second = receiptFixture({ state: first.state, purpose: 'Next request', taskId: 'two' });
  const cache = new Map(); unpackHandoffs(packHandoffs(first.records), { cache });
  const packet = packHandoffs(second.records, { known: [...cache.keys()] });
  assert.deepEqual(unpackHandoffs(packet, { cache }), second.records);
  assert.ok(packetBytes(packet) < packetBytes(second.records));
});
