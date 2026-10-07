import crypto from 'node:crypto';
import { applyCommand } from './domain.mjs';
import { digest, recordHandoff, recordUiCommand } from './handoff.mjs';
import { assertInferenceIdle } from './table.mjs';

const grants = new WeakMap();
const fail = (ok, message) => { if (!ok) throw Object.assign(new Error(message), { status: 409 }); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
const revision = (root, target) => (target === 'heart' ? root.continuity?.heart : root.instructions)?.at(-1) ?? null;
function adopted(state) {
  return state.roots.map(root => ({ id: root.id,
    instructions: root.instructions.filter(r => r.author === 'model'),
    heart: (root.continuity?.heart || []).filter(r => r.author === 'model'),
    decisions: (root.continuity?.proposals || []).filter(p => p.status === 'accepted'),
  })).filter(r => r.instructions.length || r.heart.length || r.decisions.length);
}

export function enforceAdoptionWrite(before, after) {
  if (digest(adopted(before)) === digest(adopted(after))) return;
  const grant = grants.get(after);
  fail(grant && grant.before === digest(before) && grant.after === digest(after), 'Guidance adoption needs the exact live human decision. A proposal or receipt is not permission.');
  grants.delete(after);
}

function proposalIn(state, rootId, proposalId) {
  const root = state.roots.find(r => r.id === rootId);
  const proposal = root?.continuity?.proposals.find(p => p.id === proposalId);
  fail(root && !root.archivedAt && proposal?.status === 'pending', 'This proposal is no longer available for adoption.');
  const base = revision(root, proposal.target);
  fail(proposal.baseRevisionId === (base?.id ?? null), 'The guidance changed after this proposal. Review a new proposal against the current text.');
  const job = root.continuity.jobs.find(j => j.id === proposal.jobId);
  return { root, proposal, base, job };
}

// This broker supports exactly one concrete operation. It cannot dispatch a
// shell, extend another grant, or interpret model text as an action definition.
export class AdoptionBroker {
  #pending = new Map();
  constructor(store, { now = () => Date.now(), lifetimeMs = 5 * 60 * 1000 } = {}) {
    this.store = store; this.now = now; this.lifetimeMs = lifetimeMs;
  }
  async prepare(input) {
    fail(exact(input, ['rootId', 'proposalId']), 'Review accepts only a branch and a stored proposal.');
    for (const [key, entry] of this.#pending) if (entry.expires <= this.now()) this.#pending.delete(key);
    fail(this.#pending.size < 64, 'Too many open reviews. Finish or cancel an existing review.');
    let plan, receipt;
    await this.store.transact(state => {
      const { root, proposal, base, job } = proposalIn(state, input.rootId, input.proposalId);
      plan = {
        id: 'action_' + crypto.randomUUID(), kind: 'adopt_guidance',
        scope: { rootId: root.id, chatId: null }, branchName: root.name, target: proposal.target,
        proposalId: proposal.id, sourceJobId: job.id, sourceExchangeId: job.sourceExchangeId,
        modelLabel: job.modelLabel, baseRevisionId: base?.id ?? null,
        previousText: base?.text ?? '', proposedText: proposal.text, proposalHash: digest(proposal),
        consequence: `Replace ${proposal.target}.md for this branch. Future exchanges in its chats will receive the accepted text. Earlier instructions and conversations remain recorded.`,
        expiresAt: new Date(this.now() + this.lifetimeMs).toISOString(),
        capability: { operation: 'adopt_exact_local_proposal', count: 1, mayDelegate: false, externalProcessDispatch: false },
        review: { scopeAndBase: 'CHECKED', peaJudgment: null, semanticReview: 'HUMAN_REVIEW_REQUIRED', authorityCreated: false },
      };
      receipt = recordHandoff(state, { kind: 'action.prepared', taskId: plan.id, scope: plan.scope, from: 'local_ui', to: 'human_review', payload: plan,
        status: 'AWAITING_HUMAN', detail: { plan, executionAuthority: 'NONE', receiptIsNotGrant: true } });
      return state;
    });
    const reviewHash = digest(plan), token = crypto.randomBytes(32).toString('hex');
    this.#pending.set(plan.id, { plan, reviewHash, token, receiptId: receipt.id, expires: Date.parse(plan.expiresAt) });
    return { plan, reviewHash, token };
  }
  async decide(input) {
    fail(exact(input, ['actionId', 'reviewHash', 'token', 'decision']) && ['accept', 'cancel'].includes(input.decision), 'Decision accepts only the unchanged review and accept or cancel.');
    const entry = this.#pending.get(input.actionId);
    fail(entry && typeof input.token === 'string' && /^[a-f0-9]{64}$/.test(input.token)
      && crypto.timingSafeEqual(Buffer.from(input.token, 'hex'), Buffer.from(entry.token, 'hex'))
      && entry.reviewHash === input.reviewHash, 'This review is unavailable or changed. Open it again.');
    // Consume before queueing. Concurrent clicks, retries, and copied receipts
    // cannot apply a second write. An interrupted decision needs a fresh review.
    this.#pending.delete(input.actionId);
    let issue;
    const state = await this.store.transact(before => {
      let after = structuredClone(before);
      const { plan } = entry;
      const decision = recordHandoff(after, { kind: 'action.decision', taskId: plan.id, scope: plan.scope, from: 'paired_local_ui', to: 'fixed_guidance_writer', payload: { reviewHash: entry.reviewHash, decision: input.decision }, parents: [entry.receiptId],
        status: input.decision === 'cancel' ? 'CANCELLED' : 'REQUEST_RECORDED', detail: { reviewHash: entry.reviewHash, decision: input.decision, localIdentityAssumption: 'paired local interface; no independent human identity proof', effects: ['adopt_exact_local_proposal'], mayDelegate: false } });
      if (input.decision === 'accept') {
        try {
          fail(entry.expires > this.now(), 'The review expired. Open it again before accepting.');
          const { proposal, base } = proposalIn(before, plan.scope.rootId, plan.proposalId);
          fail(digest(proposal) === plan.proposalHash && (base?.id ?? null) === plan.baseRevisionId, 'The proposal or guidance changed. Open a fresh review.');
          assertInferenceIdle(before);
          const command = { type: 'continuity.proposal.accept', payload: { rootId: plan.scope.rootId, proposalId: plan.proposalId, baseRevisionId: plan.baseRevisionId } };
          const next = applyCommand(after, command);
          recordUiCommand(after, next, command);
          after = next;
        } catch (error) { issue = error.message; }
      }
      recordHandoff(after, { kind: 'action.result', taskId: plan.id, scope: plan.scope, from: 'fixed_guidance_writer', to: 'human_review', payload: { reviewHash: entry.reviewHash, applied: input.decision === 'accept' && !issue, error: issue ?? null }, parents: [decision.id],
        status: issue ? 'HELD' : input.decision === 'cancel' ? 'CANCELLED' : 'OBSERVED', unresolved: issue ? [issue] : [], detail: { applied: input.decision === 'accept' && !issue, target: plan.target, proposalId: plan.proposalId, peaJudgment: null } });
      if (!issue && input.decision === 'accept') grants.set(after, { before: digest(before), after: digest(after) });
      return after;
    });
    return { state, ...(issue ? { error: issue } : {}), status: issue ? 409 : 200 };
  }
  close() { this.#pending.clear(); }
}
