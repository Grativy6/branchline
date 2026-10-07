import { initialState, applyCommand } from '../server/domain.mjs';
import { compileMessages } from '../server/model.mjs';
import { prepareModelHandoff, assertModelInvocation, receiveModelOutput } from '../server/handoff.mjs';

// Pure synthetic receipts. No model, file access or process is invoked.
export function receiptFixture({ instructions = 'Retain unresolved questions.', purpose = 'Synthetic whole task', reply = 'Synthetic answer.', kind = 'reply', complete = true, problem = null, state = null, taskId = 'task_packet' } = {}) {
  let s = state;
  if (!s) {
    s = applyCommand(initialState(), { type: 'root.create', payload: { name: 'Synthetic packet branch', mode: 'personal' } });
    s = applyCommand(s, { type: 'model.save', payload: { name: 'Synthetic model', model: 'synthetic', baseUrl: 'http://127.0.0.1:1/v1' } });
    s = applyCommand(s, { type: 'root.model', payload: { id: s.roots[0].id, modelId: s.models[0].id } });
    s = applyCommand(s, { type: 'root.update', payload: { id: s.roots[0].id, instructions } });
  }
  const messages = compileMessages(s, s.chats[0].id, purpose);
  const handle = prepareModelHandoff(s, { taskId, chatId: s.chats[0].id, kind, messages, purpose });
  assertModelInvocation(handle, messages, s.models[0]);
  const result = receiveModelOutput(s, handle, reply, { complete, problem });
  return { state: s, handle, messages, result, records: s.handoffs.records.filter(r => r.taskId === taskId) };
}
