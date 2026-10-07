import { parsePeerAccount } from './peer-context.mjs';
import { parsePeerOutput } from './continuing-state.mjs';
import { digest, receiveModelOutput, recordInterruption, recordHandoff } from './handoff.mjs';
import { finishExchange } from './domain.mjs';
import { completeReflection } from './continuity.mjs';
import { completeMindReflection, prepareWakeResult } from './mind.mjs';
import { completeCarry, parseCarryResult } from './context-carry.mjs';
import { completeParallelJob, interruptParallel } from './parallel-state.mjs';
import { parseHearthOutput, hearthDisplay } from './hearth-state.mjs';
import { bindReplyRecord } from './reply-provenance.mjs';

const writes = new WeakMap();
const fail = (ok, message) => { if (!ok) throw new Error('Write boundary: ' + message); };
const same = (a, b) => digest(a) === digest(b);
const copy = x => structuredClone(x);

// A permit exists only for one exact before/after pair constructed by these
// fixed writers. Its receipt is evidence, not a reusable authorization token.
function seal(before, after) {
  writes.set(after, { before: digest(before), after: digest(after) });
  return after;
}

function modelView(state) {
  return {
    messages: state.messages.filter(m => m.role === 'assistant'),
    results: state.exchanges.filter(e => e.status !== 'pending'),
    continuity: state.roots.map(r => ({ id: r.id,
      journal: (r.continuity?.journal || []).map(({ removedAt, ...entry }) => entry),
      proposals: (r.continuity?.proposals || []).map(({ status, decidedAt, ...p }) => p),
      jobs: (r.continuity?.jobs || []).filter(j => j.status !== 'pending'),
    })).filter(r => r.journal.length || r.proposals.length || r.jobs.length),
    mindJobs: state.mind?.jobs.filter(j => j.status !== 'pending') || [],
    wakes: state.mind?.wakes || [],
    wakeAccounts: state.mind?.accounts.filter(a => a.origin === 'wake') || [],
    carryJobs: state.contextCarry?.jobs.filter(j => j.status !== 'pending') || [],
    carryRecords: state.contextCarry?.records.filter(r => r.author === 'model') || [],
    parallelResults: state.parallel?.jobs.filter(j => j.output !== null) || [],
    receipts: state.handoffs?.records.filter(r => r.kind === 'model.to_record') || [],
  };
}

export function enforceModelWrite(before, after) {
  const permit = writes.get(after);
  if (!same(modelView(before), modelView(after))) {
    fail(permit && permit.before === digest(before) && permit.after === digest(after), 'model-authored changes need a live, exact host write; a stored receipt cannot authorize them.');
  }
  if (permit) { fail(permit.before === digest(before) && permit.after === digest(after), 'prepared write changed.'); writes.delete(after); }
}

function checkDelta(before, after, handle, content, accepted) {
  // Rebuild the allowed mutation surface, then compare the ENTIRE state. New
  // settings or unrelated fields therefore default to unavailable to a model.
  const expected = copy(before);
  expected.handoffs = copy(after.handoffs);
  const added = after.handoffs.records.slice(before.handoffs?.records.length || 0);
  fail(added.length === 1 && added[0].kind === 'model.to_record' && added[0].taskId === handle.taskId, 'unexpected output receipt.');
  const replaceJob = (prior, next, fields) => {
    fail(prior?.status === 'pending' && next?.id === prior.id, 'the destination is not the pending task.');
    for (const key of fields) { if (Object.hasOwn(next, key)) prior[key] = copy(next[key]); }
  };
  if (handle.kind === 'reply') {
    const i = before.exchanges.findIndex(e => e.id === handle.taskId && e.chatId === handle.scope.chatId);
    fail(i >= 0, 'reply escaped its exchange.');
    replaceJob(expected.exchanges[i], after.exchanges[i], ['status', 'error', 'finishReason', 'truncated', 'metrics']);
    const messages = after.messages.slice(before.messages.length);
    fail(messages.length <= 1 && messages.every(m => m.role === 'assistant' && m.exchangeId === handle.taskId && m.chatId === handle.scope.chatId && m.content === content.slice(0, 200000)), 'reply changed its destination or text.');
    expected.messages.push(...copy(messages));
  } else if (handle.kind === 'parallel') {
    const i = before.parallel.jobs.findIndex(j => j.id === handle.taskId && j.chatId === handle.scope.chatId);
    fail(i >= 0, 'contribution escaped its approach.');
    replaceJob(expected.parallel.jobs[i], after.parallel.jobs[i], ['status', 'endedAt', 'output', 'error', 'finishReason']);
    fail(after.parallel.jobs[i].output === content.slice(0, 20000), 'contribution text changed.');
    const messages = after.messages.slice(before.messages.length);
    fail(messages.length === (content && !after.parallel.jobs[i].recordKind ? 1 : 0) && messages.every(m => m.kind === 'parallel' && m.role === 'assistant' && m.parallelEpisodeId === handle.taskId && m.content === hearthDisplay(after.parallel.jobs[i], content.slice(0, 20000))), 'contribution escaped its transcript.');
    expected.messages.push(...copy(messages));
  } else if (handle.kind === 'carry') {
    const i = before.contextCarry.jobs.findIndex(j => j.id === handle.taskId && j.chatId === handle.scope.chatId);
    fail(i >= 0, 'context account escaped its preparation.');
    replaceJob(expected.contextCarry.jobs[i], after.contextCarry.jobs[i], ['status', 'error', 'endedAt', 'resultId']);
    const additions = after.contextCarry.records.slice(before.contextCarry.records.length);
    fail(additions.length === (accepted ? 1 : 0) && additions.every(r => r.chatId === handle.scope.chatId && r.jobId === handle.taskId && r.author === 'model' && r.authority === 'NONE'), 'context preparation escaped its record effect.');
    if (accepted) {
      const parsed = parseCarryResult(before, before.contextCarry.jobs[i], content);
      fail(same(parsed, { text: additions[0].text, sources: additions[0].sources }), 'context writer changed model content.');
      expected.contextCarry.records.push(...copy(additions));
      if (before.contextCarry.jobs[i].staged) (expected.contextCarry.ready ??= {})[handle.scope.chatId] = additions[0].id;
      else expected.contextCarry.active[handle.scope.chatId] = additions[0].id;
    }
  } else if (handle.kind === 'mind') {
    const i = before.mind.jobs.findIndex(j => j.id === handle.taskId && j.chatId === handle.scope.chatId);
    fail(i >= 0, 'wake escaped its reflection.');
    replaceJob(expected.mind.jobs[i], after.mind.jobs[i], ['status', 'error', 'endedAt', 'outputText', 'outcome', 'wakeId', 'summary']);
    for (const name of ['accounts', 'wakes']) {
      const items = after.mind[name].slice(before.mind[name].length);
      fail(items.length <= (accepted ? 1 : 0) && items.every(item => item.chatId === handle.scope.chatId), 'wake escaped its table.');
      expected.mind[name].push(...copy(items));
    }
  } else {
    const i = before.roots.findIndex(r => r.id === handle.scope.rootId);
    const c = expected.roots[i]?.continuity, next = after.roots[i]?.continuity;
    const j = c?.jobs.findIndex(job => job.id === handle.taskId && job.chatId === handle.scope.chatId && job.target === handle.kind);
    fail(j >= 0, 'reflection escaped its destination.');
    replaceJob(c.jobs[j], next.jobs[j], ['status', 'endedAt', 'error', 'resultId']);
    const destination = handle.kind === 'journal' ? 'journal' : 'proposals';
    const additions = next[destination].slice(c[destination].length);
    fail(additions.length === (accepted ? 1 : 0) && additions.every(item => item.jobId === handle.taskId && item.text === content && (destination === 'journal' ? item.chatId === handle.scope.chatId && item.removedAt === null : item.status === 'pending' && item.decidedAt === null && item.target === handle.kind)), 'reflection tried to exceed its one allowed effect.');
    c[destination].push(...copy(additions));
  }
  fail(same(expected, after), 'the result tried to change state outside its declared effect.');
}

// Text, finish status, bounded measurements, and a host-observed failure only.
// No caller-supplied mutator, path, command, tool, permission or destination.
export function prepareModelWrite(before, handle, { content = '', finishReason = null, problem = null, cancelled = false, metrics } = {}) {
  let next = copy(before), wake = null, carry = null, issue = problem;
  const complete = !issue && !cancelled && !['length', 'max_tokens'].includes(finishReason);
  const parallelJob = handle.kind === 'parallel' && next.parallel?.jobs.find(j => j.id === handle.taskId);
  if(parallelJob?.peerId && complete){try{if(parallelJob.recordKind){const run=next.parallel.runs.find(r=>r.id===parallelJob.runId);parsePeerAccount(next,run,run.peers.find(p=>p.id===parallelJob.peerId),parallelJob.accountPlan,content);}else parsePeerOutput(content);}catch(error){issue=error.message;}}
  if (parallelJob?.hearthActor && complete) {
    try { parseHearthOutput(parallelJob.hearthActor, content); } catch (error) { issue = error.message; }
  }
  if (handle.kind === 'mind' && complete) {
    try { wake = prepareWakeResult(next, next.mind.jobs.find(j => j.id === handle.taskId), content); }
    catch (error) { issue = error.message; }
  }
  if (handle.kind === 'carry' && complete) {
    try { carry = parseCarryResult(next, next.contextCarry.jobs.find(j => j.id === handle.taskId), content); }
    catch (error) { issue = error.message; }
  }
  const review = receiveModelOutput(next, handle, content, { complete, problem: issue });
  if (handle.kind === 'reply') {
    // Partial text stays visible in history, with its incomplete status intact.
    const truncated = !issue && ['length', 'max_tokens'].includes(finishReason);
    next = finishExchange(next, handle.taskId, { status: cancelled ? 'cancelled' : review.accepted || truncated ? 'completed' : 'failed',
      content: content.slice(0, 200000), finishReason, metrics, error: review.accepted ? null : issue || 'Reply retained with an unresolved handoff.' });
    bindReplyRecord(next, review.receipt.id, handle.taskId);
  } else if (handle.kind === 'parallel') {
    next = completeParallelJob(next, handle.taskId, { status: cancelled ? 'cancelled' : review.accepted ? 'completed' : 'failed',
      content, finishReason, error: review.accepted ? null : issue || 'Contribution retained with an unresolved or incomplete handoff.' });
  } else if (handle.kind === 'carry') {
    next = completeCarry(next, handle.taskId, review.accepted ? { result: carry }
      : { status: cancelled ? 'cancelled' : 'failed', error: issue || 'The handoff was incomplete or held. The previous context is unchanged.' });
  } else if (handle.kind === 'mind') {
    next = completeMindReflection(next, handle.taskId, review.accepted
      ? { status: 'completed', result: wake, outputText: content }
      : { status: cancelled ? 'cancelled' : problem ? 'failed' : 'held', error: issue || 'The output was held; the account was not revised.' });
  } else {
    next = completeReflection(next, handle.taskId, review.accepted ? { status: 'completed', content }
      : { status: cancelled ? 'cancelled' : 'failed', error: (issue || 'The output was held. No memory or proposal was adopted.').slice(0, 2000) });
  }
  checkDelta(before, next, handle, content, review.accepted);
  return { state: seal(before, next), accepted: review.accepted, issue };
}

// Recovery records a gap; it cannot reconstruct an answer or resurrect a grant.
export function prepareInterruptedWrite(before) {
  const state = copy(before), records = [...(state.handoffs?.records || [])];
  for (const job of (state.parallel?.jobs || []).filter(j=>j.status === 'pending')) {
    const chat = state.chats.find(c=>c.id === job.chatId);
    recordInterruption(state, job, { rootId:chat.rootId, chatId:chat.id });
  }
  interruptParallel(state);
  for (const request of records.filter(r => r.kind === 'operation.request' && !records.some(n => ['operation.result', 'operation.interrupted'].includes(n.kind) && n.parents.includes(r.id)))) {
    recordHandoff(state, { kind: 'operation.interrupted', taskId: request.taskId, scope: request.scope, from: 'prior_operation', to: 'next_episode', payload: { requestId: request.id }, parents: [request.id], status: 'UNRESOLVED', unresolved: ['No durable result was recorded. Inspect the target before retrying; effects are unknown.'], detail: { executionAuthority: 'NONE' } });
  }
  for (const exchange of state.exchanges.filter(e => e.status === 'pending')) {
    const chat = state.chats.find(c => c.id === exchange.chatId);
    recordInterruption(state, exchange, { rootId: chat.rootId, chatId: chat.id });
    exchange.status = 'failed'; exchange.error = 'The previous server stopped before this reply completed.';
  }
  for (const root of state.roots) for (const job of (root.continuity?.jobs || []).filter(j => j.status === 'pending')) {
    recordInterruption(state, job, { rootId: root.id, chatId: job.chatId });
    completeReflection(state, job.id, { status: 'failed', error: 'The previous server stopped before this reflection completed. No memory or proposal was added.' });
  }
  for (const job of (state.mind?.jobs || []).filter(j => j.status === 'pending')) {
    const chat = state.chats.find(c => c.id === job.chatId);
    recordInterruption(state, job, { rootId: chat.rootId, chatId: chat.id });
    completeMindReflection(state, job.id, { status: 'failed', error: 'The previous server stopped during learning reflection. No wake was applied.' });
  }
  for (const job of (state.contextCarry?.jobs || []).filter(j => j.status === 'pending')) {
    const chat = state.chats.find(c => c.id === job.chatId);
    recordInterruption(state, job, { rootId: chat.rootId, chatId: chat.id });
    completeCarry(state, job.id, { status: 'failed', error: 'Preparation was interrupted. The previous context remains active; no permissions were renewed.' });
  }
  return seal(before, state);
}

export function preserveContinuityHistory(before, after) {
  const appendOnly = (a, b, label, allowed = []) => {
    fail(b.length >= a.length, label + ' removed history.');
    a.forEach((old, i) => {
      const next = b[i], clean = item => Object.fromEntries(Object.entries(item).filter(([key]) => !allowed.includes(key)));
      fail(same(clean(old), clean(next)), label + ' rewrote history.');
      if (label === 'journal' && old.removedAt) fail(next.removedAt === old.removedAt, 'a removed memory was restored.');
      if (label === 'proposal' && old.status !== 'pending') fail(same(old, next), 'a decided proposal was rewritten.');
      if (label === 'reflection' && old.status !== 'pending') fail(same(old, next), 'a finished reflection was rewritten.');
    });
  };
  for (const root of before.roots) {
    const next = after.roots.find(r => r.id === root.id); fail(next, 'branch history removed.');
    appendOnly(root.instructions, next.instructions, 'instructions');
    if (!root.continuity) continue;
    fail(next.continuity, 'continuity removed.');
    appendOnly(root.continuity.heart, next.continuity.heart, 'heart');
    appendOnly(root.continuity.journal, next.continuity.journal, 'journal', ['removedAt']);
    appendOnly(root.continuity.proposals, next.continuity.proposals, 'proposal', ['status', 'decidedAt']);
    appendOnly(root.continuity.jobs, next.continuity.jobs, 'reflection', ['status', 'endedAt', 'error', 'resultId']);
  }
}
