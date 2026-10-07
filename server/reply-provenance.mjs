import { digest } from './integrity.mjs';

export const REPLY_RECORD_PROFILE = 'branchline.reply-record/1';
const fail = (ok, message) => { if (!ok) throw new Error('Reply provenance boundary: ' + message); };
const same = (a, b) => digest(a ?? null) === digest(b ?? null);
const limited = turn => ['length', 'max_tokens'].includes(turn.finishReason);
const emptyHash = digest('');

// Called by the fixed writer before its live permit is sealed. Bind the exact
// final exchange and transcript entry without duplicating their text. Only the
// new terminal receipt changes; older records are never given new evidence.
export function bindReplyRecord(state, receiptId, exchangeId) {
  const receipt = state.handoffs.records.at(-1);
  const exchange = state.exchanges.find(e => e.id === exchangeId);
  const replies = state.messages.filter(m => m.exchangeId === exchangeId && m.role === 'assistant');
  fail(receipt?.id === receiptId && receipt.kind === 'model.to_record' && receipt.taskId === exchangeId
    && exchange && replies.length <= 1, 'cannot bind this reply to its output.');
  receipt.detail.replyRecord = { profile: REPLY_RECORD_PROFILE, exchangeHash: digest(exchange), messageHash: digest(replies[0] ?? null) };
  const { hash, ...record } = receipt;
  receipt.hash = digest(record);
}

// Validate historical evidence, not live permission. Handoff hashes/reviews are
// checked separately by validateHandoffs before this relationship is admitted.
// No state or original transcript bytes are changed here.
export function validateReplyProvenance(state) {
  const records = state.handoffs?.records ?? [];
  const byTask = new Map(), repliesByTurn = new Map(), heldByReceipt = new Map();
  for (const record of records) {
    if (!byTask.has(record.taskId)) byTask.set(record.taskId, []);
    byTask.get(record.taskId).push(record);
  }
  const exchanges = new Map(state.exchanges.map(e => [e.id, e]));
  const chats = new Map(state.chats.map(c => [c.id, c]));
  for (const held of state.handoffs?.heldOutputs ?? []) {
    const items = heldByReceipt.get(held.receiptId) ?? [];
    items.push(held); heldByReceipt.set(held.receiptId, items);
  }
  const result = new Map();
  for (const message of state.messages) {
    if (message.role !== 'assistant' || message.kind === 'parallel') continue;
    fail(message.kind === 'exchange' && exchanges.has(message.exchangeId), 'an assistant entry needs an exchange.');
    const replies = repliesByTurn.get(message.exchangeId) ?? [];
    replies.push(message); repliesByTurn.set(message.exchangeId, replies);
  }
  for (const turn of state.exchanges) {
    const replies = repliesByTurn.get(turn.id) ?? [], message = replies[0];
    fail(replies.length <= 1, 'more than one assistant entry claims the same exchange.');
    fail(!message || turn.status !== 'pending', 'a pending exchange cannot contain a recorded reply.');
    if (message) {
      fail(message.chatId === turn.chatId && message.modelId === turn.modelId && message.modelLabel === turn.modelLabel
        && message.modelIdentifier === turn.modelIdentifier && message.modelBaseUrl === turn.modelBaseUrl
        && message.instructionRevisionId === turn.instructionRevisionId, 'reply attribution differs from its exchange.');
      fail(message.incomplete === (turn.status !== 'completed'), 'reply incompleteness differs from its exchange.');
    }
    const related = byTask.get(turn.id) ?? [];
    const requests = related.filter(r => r.kind === 'ui.intent');
    const contexts = related.filter(r => r.kind === 'context.to_model');
    const outputs = related.filter(r => r.kind === 'model.to_record');
    const interruptions = related.filter(r => r.kind === 'episode.interrupted');
    if (!turn.handoff && !requests.length && !contexts.length && !outputs.length) {
      // Pre-handoff history remains readable, but it is not an assistant-role
      // demonstration. Deleting a link on a receipted turn cannot enter here.
      if (message) result.set(message.id, 'unverified');
      continue;
    }
    fail(requests.length === 1 && contexts.length === 1 && outputs.length <= 1 && interruptions.length <= 1,
      'missing or duplicate reply handoff records.');
    const request = requests[0], context = contexts[0], output = outputs[0], task = request.detail?.task;
    const scope = { rootId: chats.get(turn.chatId)?.rootId, chatId: turn.chatId };
    fail(task?.kind === 'reply' && same(task.scope, scope)
      && [request, context, ...outputs, ...interruptions].every(r => same(r.scope, scope)), 'reply handoff crossed its task or scope.');
    // Modern output reviews already check these exact request/input hashes in
    // validateHandoffs. Do not rehash a whole prompt twice per state validation.
    const checkedSources = output?.detail?.review?.p === 'record-effect/1';
    fail(request.to === 'shared_task' && context.from === 'shared_task' && context.to === 'model_episode'
      && same(context.parents, [request.id]) && context.detail?.taskReceipt === request.id
      && (checkedSources || digest(task) === request.contentHash && digest(context.detail.inputMessages) === context.contentHash),
    'reply lost its exact request and context.');
    const view = context.detail.contextView;
    fail(same(task.view, view) && same(task.selection, turn.speaker) && same(view?.speaker, turn.speaker)
      && view?.model?.id === turn.modelId && (view.instruction?.id ?? null) === turn.instructionRevisionId,
    'reply changed its selected model, chair or instruction.');
    if (turn.speaker) fail(view.model.hash === turn.speaker.modelProfileHash, 'reply model profile changed.');
    if (task.turnRequest !== undefined || turn.request !== undefined) fail(same(task.turnRequest, turn.request), 'reply changed its human request.');
    if (turn.handoff) {
      const h = turn.handoff;
      fail(h.taskId === turn.id && h.kind === 'reply' && same(h.scope, scope)
        && h.requestId === request.id && h.contextId === context.id && h.contextHash === context.contentHash
        && h.viewHash === digest(view) && h.modelHash === view.model.hash, 'reply lost its saved handoff binding.');
    }
    fail(!(output && interruptions.length), 'a reply cannot claim both an output and a process interruption.');
    if (!output) {
      fail(!message, 'assistant entry has no matching model output receipt.');
      fail(turn.status === 'pending' || turn.status === 'failed' && interruptions.length === 1,
        'finished exchange has neither an output nor an interruption receipt.');
      if (interruptions.length) fail(turn.status === 'failed'
        && (same(interruptions[0].parents, [context.id]) || !turn.handoff && interruptions[0].parents.length === 0)
        && interruptions[0].detail?.recoveredResult === false, 'interruption cannot supply a model reply.');
      continue;
    }
    fail(turn.status !== 'pending' && output.from === 'model_episode' && output.to === 'chat_transcript'
      && same(output.parents, [context.id]) && ['WITHIN_LOCAL_PROFILE', 'HELD'].includes(output.status), 'output lost its transcript destination or terminal state.');
    fail(output.detail?.capabilityHash === digest(task.capability) && same(task.allowedEffects, ['record_reply'])
      && output.detail.effect === (output.status === 'WITHIN_LOCAL_PROFILE' ? 'record_reply' : 'retain_output_only'),
    'output belongs to a different effect.');
    // Oversize replies historically retain their full output separately and
    // show only the bounded prefix. That exact prefix is the only exception.
    const held = heldByReceipt.get(output.id) ?? [];
    fail(held.length <= 1, 'duplicate held reply output.');
    if (held.length) {
      fail(output.status === 'HELD' && digest(held[0].content) === output.contentHash
        && held[0].content.length > 200000 && message?.content === held[0].content.slice(0, 200000), 'retained output differs from its recorded prefix.');
    } else fail(message ? digest(message.content) === output.contentHash : output.contentHash === emptyHash,
      'reply text does not match its model output receipt.');
    if (turn.status === 'completed') {
      fail(turn.truncated === limited(turn), 'reply length status changed.');
      fail(output.status === 'WITHIN_LOCAL_PROFILE' && !turn.truncated && turn.error === null
        || output.status === 'HELD' && turn.truncated === true, 'held output cannot become a completed reply.');
    } else fail(output.status === 'HELD' && !turn.truncated, 'accepted output cannot become a failed or cancelled reply.');
    if (output.detail.review && limited(turn)) fail(!(output.detail.review.y & (1 << 6)), 'truncated reply claims a complete output.');
    const binding = output.detail.replyRecord;
    if (binding !== undefined) fail(binding.profile === REPLY_RECORD_PROFILE && binding.exchangeHash === digest(turn)
      && binding.messageHash === digest(message ?? null), 'reply record differs from its exact output binding.');
    if (message) result.set(message.id, output.detail.dispatched === true && (binding || turn.speaker) ? 'recorded' : 'unverified');
  }
  return result;
}
