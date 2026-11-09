import { escapeHtml as e } from './views.js';
import { renderMarkdown } from './markdown.js';
import { NOTE_CADENCES, noteSettings } from './reasoning-notes-settings.js';

export function reasoningNotesForm(chat) {
  const value = noteSettings(chat);
  return `<form id="reasoning-notes-form" data-chat-id="${e(chat.id)}"><h3>Reasoning notes</h3>
    <p>For this conversation and its chairs.</p>
    <label class="settings-check"><input type="checkbox" name="enabled" ${value.enabled ? 'checked' : ''}> Reasoning notes</label>
    <fieldset class="note-cadence"><legend>Requested interval</legend>${NOTE_CADENCES.map(seconds => `<label><input type="radio" name="cadenceSeconds" value="${seconds}" ${value.cadenceSeconds === seconds ? 'checked' : ''}> ${seconds}s</label>`).join('')}</fieldset>
    <p class="field-help">Pings wait behind current work. Providers send summaries on their own schedule; other supported chairs can write a short note at a work checkpoint. Silence is okay. Notes use the current connection and may use its allowance.</p>
    <p class="field-help">Turning on applies at the next supported reply. Turning off stops new notes without stopping the work. Saved notes remain in Details and the chair’s work log.</p>
    <button type="submit" class="primary-button">Save reasoning notes</button></form><hr>`;
}

export function reasoningNotesView(state, { taskId, exchangeId, chairId, chatId, live = false, status = null } = {}) {
  const records = (state.deskWork?.events ?? []).filter(event => event.kind === 'reasoning.note'
    && (!taskId || event.taskId === taskId) && (!exchangeId || event.detail.exchangeId === exchangeId)
    && (!chairId || event.chairId === chairId) && (!chatId || event.chatId === chatId));
  if (!records.length && !status) return '';
  const groups = new Map();
  for (const record of records) { const list = groups.get(record.detail.noteId) ?? []; list.push(record); groups.set(record.detail.noteId, list); }
  const entries = [...groups.values()].slice(-12);
  const limited = (state.deskWork?.events ?? []).some(event => event.kind === 'reasoning.limit' && (taskId ? event.taskId === taskId : exchangeId ? event.detail.exchangeId === exchangeId : event.chatId === chatId && (!chairId || event.chairId === chairId)));
  return `<details class="reasoning-notes" data-note-panel="${e(taskId ?? exchangeId ?? chairId ?? 'history')}"><summary>Reasoning notes${groups.size ? ` · ${groups.size}` : ''}${live && status ? ` · ${e(status)}` : ''}</summary>
    <p class="field-help">Recorded expressions from this chair. Kept in its work log; tool results remain separate evidence.</p>
    ${entries.map(versions => {
      const record = versions.at(-1), note = record.detail;
      return `<article class="reasoning-note"><small><strong>${e(record.author.chair)}</strong> · ${note.source === 'provider_summary' ? 'Provider summary' : 'Agent note'} · received ${e(new Date(note.receivedAt).toLocaleString())} · ${e(note.status)}</small><div class="markdown-body">${renderMarkdown(note.text)}</div>
        ${note.omitted ? '<p class="field-help">This passage reached the retained text limit.</p>' : ''}
        <details><summary>Source record${versions.length > 1 ? ` · ${versions.length} versions` : ''}</summary><pre class="drawer-log">${e(JSON.stringify({ noteId: note.noteId, chairId: record.chairId, taskId: record.taskId, exchangeId: note.exchangeId, model: note.model, source: note.sourceIds, ping: note.ping, corrects: note.corrects, eventId: record.id }, null, 2))}</pre>${versions.slice(0, -1).map(prior => `<p class="field-help">Earlier record · ${e(prior.detail.status)} · ${e(prior.detail.receivedAt)}</p><div class="markdown-body">${renderMarkdown(prior.detail.text)}</div>`).join('')}</details></article>`;
    }).join('')}${groups.size > entries.length ? '<p class="field-help">Showing the last 12 notes. Earlier notes remain in the work log.</p>' : ''}${limited ? '<p class="field-help">The note storage limit was reached; further material was omitted. Ordinary work continued.</p>' : ''}</details>`;
}
