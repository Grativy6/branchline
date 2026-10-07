// Derived display indexes, scoped to an exact received state. They never admit
// history or provide authority; those checks remain in the server.
const indexes = new WeakMap();
export function historyIndex(state) {
  let index = indexes.get(state);
  if (index) return index;
  index = { exchanges: new Map(), messages: new Map(), approaches: new Map(), replies: new Set(), recorded: new Set(), speakerRecorded: new Set() };
  for (const exchange of state.exchanges) index.exchanges.set(exchange.id, exchange);
  for (const message of state.messages) {
    if (!index.messages.has(message.chatId)) index.messages.set(message.chatId, []);
    index.messages.get(message.chatId).push(message);
    if (message.role === 'assistant' && message.content) index.replies.add(message.exchangeId);
  }
  for (const job of state.parallel?.jobs ?? []) index.approaches.set(job.id, job);
  for (const record of state.handoffs?.records ?? []) {
    if (record.kind !== 'model.to_record' || record.detail.dispatched !== true) continue;
    index.speakerRecorded.add(record.taskId);
    if (record.detail.replyRecord) index.recorded.add(record.taskId);
  }
  indexes.set(state, index); return index;
}
