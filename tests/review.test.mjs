import test from 'node:test';
import assert from 'node:assert/strict';
import { REVIEW_PROFILES, makeReview, validateReview, reviewAllowsEffect, explainReview } from '../server/review.mjs';
import { digest, validateHandoffs } from '../server/handoff.mjs';
import { receiptFixture } from './receipt-fixture.mjs';

const profile = 'record-effect/1';
const all = () => Object.fromEntries(REVIEW_PROFILES[profile].map(key => [key, true]));
const basis = { purpose: 'Synthetic task', scope: 'one chat', capability: 'text only', authority: 'one record effect' };
const rehash = record => { const { hash, ...body } = record; record.hash = digest(body); };

test('every predicate must be observed true before a local effect can pass', () => {
  const complete = makeReview(profile, basis, all());
  assert.equal(reviewAllowsEffect(complete), true);
  for (const key of REVIEW_PROFILES[profile]) {
    const values = all(); delete values[key];
    const missing = makeReview(profile, basis, values);
    assert.equal(reviewAllowsEffect(missing), false);
    assert.equal(explainReview(missing).predicates[key], 'unknown');
    values[key] = false;
    assert.equal(explainReview(makeReview(profile, basis, values)).predicates[key], 'false');
    assert.equal(reviewAllowsEffect(makeReview(profile, basis, values)), false);
  }
  assert.equal(explainReview(complete).authorityCreated, false);
  assert.equal(explainReview(complete).peaJudgment, null);
});

test('malformed masks, hidden fields, unknown versions and unknown profiles fail closed', () => {
  const good = makeReview(profile, basis, all());
  for (const edit of [{ y: 0 }, { f: 1 }, { y: -1 }, { u: 0.5 }, { y: 512 }, { v: 2 }, { p: 'future/1' }, { p: 'toString' }, { p: 'constructor' }, { floor: 'different' }]) {
    assert.throws(() => validateReview({ ...good, ...edit }), /Mechanical review/);
  }
  assert.throws(() => makeReview('toString', basis, {}), /unknown profile/);
  assert.throws(() => makeReview(profile, basis, { ...all(), new_permission: true }), /unknown predicate/);
  assert.throws(() => makeReview(profile, basis, { ...all(), scope_current: 'yes' }), /true, false or unknown/);
});

test('exceptions inherit the exact predicate, section and original basis', () => {
  const reference = digest('Context changed during this exchange.');
  const review = makeReview(profile, basis, all(), [[2, 2, reference]]);
  assert.deepEqual(explainReview(review).exceptions, [{ check: 'scope_current', section: 'scope', basis: digest(basis), code: 'CHANGED', reference }]);
  assert.equal(reviewAllowsEffect(review), false);
  assert.equal(review.b, digest(basis));
});

test('exceptions cannot name a new floor, scope, capability, authority or out-of-profile check', () => {
  for (const exception of [[9, 0, null], [-1, 0, null], [2, 99, null], [2, 0, 'new floor'], [2, 0, null, { scope: 'all drives' }], { check: 2, floor: 'new', authority: 'self' }]) {
    assert.throws(() => makeReview(profile, basis, all(), [exception]), /exception/);
  }
  const extension = [2, 0, null]; extension.floor = 'new';
  assert.throws(() => makeReview(profile, basis, all(), [extension]), /exception/);
  for (let i = 0; i < REVIEW_PROFILES[profile].length; i++) {
    assert.equal(reviewAllowsEffect(makeReview(profile, basis, all(), [[i, 0, null]])), false);
  }
});

test('one action floor cannot reuse the same exception index from another profile', () => {
  const review = makeReview('proposal-accept/1', basis, {}, [[4, 1, null]]);
  assert.equal(explainReview(review).exceptions[0].check, 'local_request');
  assert.throws(() => makeReview('proposal-accept/1', basis, {}, [[8, 1, null]]), /exception/);
});

test('an operational problem binds its exception to the actual output and retains the text', () => {
  const f = receiptFixture({ kind: 'journal', reply: 'Unfinished interpretation', problem: 'Synthetic interruption' });
  const record = f.result.receipt;
  assert.equal(f.result.accepted, false);
  assert.equal(f.state.handoffs.heldOutputs[0].content, 'Unfinished interpretation');
  const explanation = explainReview(record.detail.review);
  assert.equal(explanation.predicates.operation_clean, 'false');
  assert.equal(explanation.exceptions[0].check, 'operation_clean');
  assert.equal(explanation.exceptions[0].reference, digest('Synthetic interruption'));
  assert.equal(record.detail.reviewBasis.output, digest('Unfinished interpretation'));
  validateHandoffs(f.state);
});

test('receipt validation rejects review transplantation or a changed floor even after rehashing', () => {
  const original = receiptFixture().state;
  for (const mutate of [
    r => { r.detail.reviewBasis.effect = 'delete_files'; },
    r => { r.contentHash = digest('A different answer'); },
    r => { r.kind = 'tool.dispatch'; },
    r => { r.detail.reviewBasis.floor = 'different floor'; },
    r => { r.detail.review.p = 'proposal-accept/1'; r.detail.review.y = 31; },
  ]) {
    const state = structuredClone(original), r = state.handoffs.records.at(-1);
    mutate(r); r.detail.review.b = digest(r.detail.reviewBasis); rehash(r);
    assert.throws(() => validateHandoffs(state), /review|floor|effect|output|proposal/i);
  }
});

test('review basis must resolve to the recorded request and exact context in the same task', () => {
  const state = receiptFixture().state, r = state.handoffs.records.at(-1);
  r.detail.reviewBasis.request = digest('an absent grant');
  r.detail.review.b = digest(r.detail.reviewBasis); rehash(r);
  assert.throws(() => validateHandoffs(state), /required review source is missing/);
});
