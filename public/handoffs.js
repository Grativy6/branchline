import { pocketLabel } from './coat-pockets.js';

export function coatToolReceipt(state, taskId, escape) {
  const task = state.handoffs?.records.find(r => r.taskId === taskId && r.kind === 'ui.intent')?.detail.task;
  if (!task) return '';
  const tools = task.capability?.tools;
  const names = { request_parallel_approach: 'Request another approach', request_hearth: 'Request a hearth' };
  return `<h3>Tools offered for this reply</h3><p class="field-help">${tools?.tools.length ? tools.tools.map(tool => escape(names[tool] ?? pocketLabel({ tool }))).join('; ') + '.' : 'No app tools were offered.'}</p>${tools?.bindings?.length ? `<details><summary>Recorded tool providers</summary><ul>${tools.bindings.map(p => `<li>${escape(pocketLabel(p))} · <span class="detail-value">${escape(p.provider)}</span></li>`).join('')}</ul></details>` : ''}`;
}

export function handoffSummary(state, taskId, escape) {
  const records = (state.handoffs?.records || []).filter(r => r.taskId === taskId);
  if (!records.length) return '<p class="field-help">This exchange predates handoff records.</p>';
  const names = { 'file.selection': 'File selection and purpose', 'file.read': 'Selected file read', 'ui.intent': 'Founded request', 'context.to_model': 'Context supplied to the model', 'model.to_record': 'Returned model text', 'episode.interrupted': 'Interrupted episode' };
  const task = records.find(r => r.kind === 'ui.intent')?.detail.task;
  const effectNames = { record_parallel_contribution: 'retain this attributed contribution', record_reply: 'retain the reply', append_chat_journal: 'add a model journal entry', record_proposal: 'save a proposal for your review' };
  const retained = (state.handoffs?.heldOutputs || []).filter(item => records.some(r => r.id === item.receiptId));
  return `<details class="details-section"><summary>Handoff trace</summary><p class="field-help">Context and returned text stay linked. A trace does not approve an action.</p>${task ? `<p><strong>Purpose:</strong> ${escape(task.whyThisCapability)}</p><details><summary>Recorded request</summary><div class="message-body">${escape(task.purpose)}</div></details><p class="field-help">${task.capability?.tools ? 'The model can request the app tools recorded for this episode.' : 'This episode supplies no app tools.'} The app may ${escape(effectNames[task.allowedEffects[0]] || task.allowedEffects[0])} after its checks. This does not establish limits on the separate model server.</p>` : ''}<ol class="handoff-records">${records.map(r => `<li>${escape(names[r.kind] || r.kind)} · ${r.status === 'HELD' || r.status === 'UNRESOLVED' ? 'Unresolved' : 'Recorded'}<small class="field-help detail-value handoff-id">${escape(r.id)}</small>${['HELD', 'UNRESOLVED'].includes(r.status) ? `<p class="field-help">${r.unresolved.map(escape).join(' ')}</p>` : ''}</li>`).join('')}</ol>${task?.kind === 'reply' ? retained.map(item => `<details><summary>Full retained output (chat display shortened)</summary><div class="message-body">${escape(item.content)}</div></details>`).join('') : ''}</details>`;
}

export function reflectionHandoffs(state, root, chatId, escape) {
  const jobs = (root.continuity?.jobs || []).filter(job => job.chatId === chatId);
  if (!jobs.length) return '';
  return `<details class="continuity-history"><summary>Reflection history (${jobs.length})</summary>${jobs.map(job => {
    const records = (state.handoffs?.records || []).filter(r => r.taskId === job.id);
    const held = (state.handoffs?.heldOutputs || []).filter(item => records.some(r => r.id === item.receiptId));
    return `<article class="continuity-card"><p>${escape(job.target)} · ${escape(job.status)}</p>${job.error ? `<p class="field-help">${escape(job.error)}</p>` : ''}${handoffSummary(state, job.id, escape)}${held.map(item => `<details><summary>Retained text (not applied)</summary><div class="message-body">${escape(item.content || '(No output was received.)')}</div></details>`).join('')}</article>`;
  }).join('')}</details>`;
}
