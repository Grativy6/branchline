import { activeModels, isModelArchived, modelFilesHeld, archiveLabel } from './model-archives.js';
import { personalLabel } from './personal-label.js';
import { visiblePersonalModels } from './dream-records.js';
import { effectiveOrientation } from './response-orientations.js';
import { historyIndex } from './history-index.js';

export function replyBusy(state, model) {
  const jobs=(state.contextCarry?.jobs ?? []).filter(j=>j.status==='pending');
  if (!jobs.length) return modelsBusy(state);
  if ((model?.runtime ?? 'compatible') !== 'compatible' || jobs.some(j=>!j.staged || (j.modelSnapshot.runtime ?? 'compatible') !== 'compatible')) return true;
  return modelsBusy({...state,contextCarry:{...state.contextCarry,jobs:[]}});
}

const e = (value = '') => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Display only. The server validates the exact receipt/content relationship
// before releasing state; this UI helper never admits a record or grants access.
export function hasRecordedReply(state, exchange) {
  if (!exchange) return false;
  const index = historyIndex(state);
  return index.recorded.has(exchange.id) || !!exchange.speaker && index.speakerRecorded.has(exchange.id);
}

export const modelsBusy = state => state.exchanges.some(item => item.status === 'pending') || state.roots.some(root => root.continuity?.jobs?.some(job => job.status === 'pending')) || (state.mind?.jobs || []).some(job => job.status === 'pending') || (state.contextCarry?.jobs || []).some(job => job.status === 'pending') || (state.parallel?.runs || []).some(run => ['queued','running'].includes(run.status));

export function tableInfo(state, chat) {
  const assignment = chat?.table?.assignments.at(-1);
  if (!assignment) return null;
  const participant = (state.personalParticipants || []).find(item => item.id === assignment.personalId);
  const personalModel = state.models.find(item => item.id === participant?.connections.at(-1)?.modelId);
  const visitorModel = state.models.find(item => item.id === assignment.visitorModelId);
  return { assignment, participant, personalModel, visitorModel };
}

export function tableSetup(state, chat) {
  const table = tableInfo(state, chat);
  const participants = visiblePersonalModels(state);
  return `<form id="table-form" data-chat-id="${e(chat.id)}" data-base-revision-id="${e(table?.assignment.id || '')}"><p class="muted">One conversation. You choose who takes the next turn.</p><label class="form-field">Personal participant<select name="personalId"><option value="">Leave this chair open</option>${table?.participant && isModelArchived(state,table.personalModel?.id) ? `<option value="${e(table.participant.id)}" selected>${e(personalLabel(table.participant))} · Archived (current)</option>` : ''}${participants.map(p => `<option value="${e(p.id)}" ${table?.assignment.personalId === p.id ? 'selected' : ''}>${e(personalLabel(p))}</option>`).join('')}</select></label>${participants.length ? '' : '<p class="field-help">Set up your personal model in Settings, then bring it to any table.</p><button type="button" class="text-button" data-action="models">Open model settings</button>'}<label class="form-field">Visiting model<select name="visitorModelId"><option value="">Leave this chair open</option>${table?.visitorModel && isModelArchived(state,table.visitorModel.id) ? `<option value="${e(table.visitorModel.id)}" selected>${e(table.visitorModel.name)} · Archived (current)</option>` : ''}${activeModels(state).map(m => `<option value="${e(m.id)}" ${table?.assignment.visitorModelId === m.id ? 'selected' : ''}>${e(m.name)}</option>`).join('')}</select></label><p class="field-help">Changing a chair affects future turns. Earlier replies keep their original author, model, and sources.</p><div class="dialog-footer"><button type="button" class="quiet-button" data-action="close-dialog">Cancel</button><button type="submit" class="primary-button">Save chairs</button></div></form>`;
}

export function personalSettings(state) {
  const participants = visiblePersonalModels(state);
  return `<section class="personal-model-settings"><h3>Your personal models</h3><button class="text-button" data-action="model-archives">Archived models</button><p class="field-help">A continuing participant you can bring to different conversations. Its history stays independent of its model connection.</p>${participants.map(p => {
    const generation = p.generations.find(g => g.id === p.currentGenerationId);
    const model = state.models.find(m => m.id === p.connections.at(-1).modelId);
    return `<div class="personal-model-card"><div class="personal-model-heading"><strong>${e(personalLabel(p))}</strong><button type="button" class="text-button" data-action="personal-rename" data-id="${e(p.id)}" aria-label="Rename ${e(personalLabel(p))}" ${modelsBusy(state) ? 'disabled' : ''}>Rename</button></div><span>${e(model?.name || 'Connection unavailable')}</span><small>${e(generation.baseIdentity)}</small><div class="personal-model-actions"><button type="button" class="text-button" data-action="model-archive" data-id="${e(model.id)}">Archive model</button><button type="button" class="dream-review-button" data-action="dream-review" data-id="${e(p.id)}">Review Dreams</button><button type="button" class="text-button" data-action="agent-profile-open" data-id="${e(p.id)}">Agent profile</button></div></div>`;
  }).join('')}<details ${participants.length ? '' : 'open'}><summary>${participants.length ? 'Register another personal participant' : 'Set up a personal participant'}</summary><form id="personal-form"><label class="form-field">Name<input name="name" maxlength="200" placeholder="My personal AI" required></label><label class="form-field">Local model connection<select name="modelId" required><option value="">Choose a saved model</option>${activeModels(state).filter(m => m.runtime !== 'codex').map(m => `<option value="${e(m.id)}">${e(m.name)}</option>`).join('')}</select></label><label class="form-field">Base identity<input name="baseIdentity" maxlength="500" placeholder="For example, swiss-ai/Apertus-8B-2509" required></label><p class="field-help">This records your declared starting model. It does not train weights or certify the server's identity.</p><button class="quiet-button" type="submit" ${state.models.length ? '' : 'disabled'}>Create personal participant</button></form></details></section>`;
}

export function personalNicknameForm(participant, returnView = 'library') {
  return `<form id="personal-nickname-form" data-id="${e(participant.id)}" data-base-nickname="${e(JSON.stringify(participant.nickname ?? null))}" data-original-name="${e(participant.name)}" data-return-view="${returnView === 'settings' ? 'settings' : 'library'}"><label class="form-field">Nickname<input autofocus name="nickname" maxlength="200" value="${e(personalLabel(participant))}" aria-describedby="nickname-hint"></label><p id="nickname-hint" class="field-help">A name for your workspace. This changes the label you see, while saved replies and model instructions keep their recorded names.</p><p class="field-help">Original name: ${e(participant.name)}</p><button type="button" class="text-button" data-action="personal-original-name">Use original name</button><div class="dialog-footer"><button type="button" class="quiet-button" data-action="personal-nickname-cancel">Cancel</button><button type="submit" class="primary-button">Save nickname</button></div></form>`;
}

export function replySettings(state, chat) {
  const table = tableInfo(state, chat);
  const saved = chat?.replySettings ?? { mode: 'single', speaker: !table?.personalModel && table?.visitorModel ? 'visiting' : 'personal' };
  const previous = state.exchanges.filter(turn => turn.chatId === chat?.id && turn.status === 'completed' && turn.speaker).at(-1);
  return { ...saved, next: saved.mode === 'alternate' ? (previous?.speaker.seat === 'personal' ? 'visiting' : 'personal') : saved.speaker };
}

export function replyControls(state, chat, busy = false) {
  const table = tableInfo(state, chat);
  if (!table) return '';
  const settings = replySettings(state, chat), bothAvailable = !!(table.personalModel && table.visitorModel);
  const canAsk = state.messages.some(message => message.chatId === chat.id) && (settings.next === 'personal' ? table.personalModel : table.visitorModel) && (settings.mode === 'single' || bothAvailable);
  return `<div class="reply-controls"><span class="reply-controls-label">Another perspective?</span><div class="reply-chair-buttons" role="group" aria-label="Next reply">${['personal', 'visiting'].map(seat => `<button type="button" data-action="select-chair" data-id="${seat}" aria-pressed="${settings.next === seat}" title="${settings.mode === 'alternate' ? 'Alternate chooses the next chair automatically' : 'Choose who replies first'}" ${busy || settings.mode === 'alternate' || !(seat === 'personal' ? table.personalModel : table.visitorModel) ? 'disabled' : ''}>${seat === 'personal' ? 'Personal' : 'Visiting'}</button>`).join('')}</div><div class="reply-pattern-buttons" role="group" aria-label="Reply pattern"><button type="button" data-action="reply-pattern" data-id="both" aria-pressed="${settings.mode === 'both'}" title="${bothAvailable ? 'Both reply, selected chair first. The second sees the first reply.' : 'Set up both chairs to use Both'}" ${busy || (!bothAvailable && settings.mode !== 'both') ? 'disabled' : ''}>Both</button><button type="button" data-action="reply-pattern" data-id="alternate" aria-pressed="${settings.mode === 'alternate'}" title="${bothAvailable ? 'One reply each time. Switch chairs after a completed reply.' : 'Set up both chairs to use Alternate'}" ${busy || (!bothAvailable && settings.mode !== 'alternate') ? 'disabled' : ''}>Alternate</button></div><button class="quiet-button ask-now" type="button" data-action="ask-now" ${busy || !canAsk ? 'disabled' : ''}>Ask now</button></div>`;
}

export function tableErrors(state, chat) {
  const table = tableInfo(state, chat);
  if (!table || !state.messages.some(m => m.chatId === chat.id)) return '';
  const blocked = [table.personalModel,table.visitorModel].filter(m=>m && (isModelArchived(state,m.id)||modelFilesHeld(state,m.id)));
  if(blocked.length) return `<p class="notice">${blocked.map(m=>e(m.name+archiveLabel(state,m.id))).join(', ')}. Choose an available model or open <button class="text-button" data-action="model-archives">Archived models</button>. Your conversation and draft stay here.</p>`;
  const failedAsks = state.exchanges.filter(turn => turn.chatId === chat.id && turn.request?.kind === 'ask' && ['failed', 'cancelled'].includes(turn.status) && !state.messages.some(m => m.exchangeId === turn.id && m.role === 'assistant'));
  return failedAsks.map(turn => `<p class="notice message-error">${turn.speaker?.seat === 'personal' ? 'Personal' : 'Visiting'} reply ${e(turn.status)}: ${e(turn.error || 'No text was returned.')}</p>`).join('');
}

export function replyPatternLabel(state, exchange) {
  if (exchange?.request?.followUpOf) return 'Both · follow-up (2 of 2)';
  if (exchange?.request?.followUp) {
    const second = state.exchanges.find(turn => turn.request?.id === exchange.request.followUp.requestId);
    return `Both · first reply (1 of 2) · follow-up ${second?.status ?? 'not started'}`;
  }
  return exchange?.request?.replyMode === 'alternate' ? 'Alternate' : 'Single reply';
}

export function replyAuthor(message, exchange) {
  const seat = exchange?.speaker?.seat;
  return `${seat === 'personal' ? 'Personal · ' : seat === 'visiting' ? 'Visiting · ' : ''}${message.modelLabel || 'Local model'}`;
}

export function tableContinuityPanel(state, chat) {
  const table = tableInfo(state, chat);
  if (!table) return '';
  const records = state.handoffs?.records || [];
  const replies = records.filter(r => r.kind === 'model.to_record' && r.scope.chatId === chat.id && r.detail.dispatched);
  const last = replies.map(r => ({ result: r, input: records.find(i => i.id === r.parents[0]) }))
    .filter(({ input }) => input?.detail?.contextView?.speaker?.seat === 'personal' && input.detail.contextView.speaker.participantId === table.participant?.id).at(-1);
  const turns = state.exchanges.filter(t => t.chatId === chat.id);
  const completed = turns.filter(t => t.status === 'completed' && !t.truncated).length;
  return `<details class="details-section table-continuity"><summary>At this table</summary><dl><dt>Recorded here</dt><dd>${turns.length} turn(s) · ${completed} complete</dd><dt>Personal model</dt><dd>${e(personalLabel(table.participant, 'Open chair'))}</dd><dt>Last Personal call with a recorded outcome</dt><dd>${last ? `${e(new Date(last.result.at).toLocaleString())}<br><button type="button" class="text-button" data-action="table-input" data-id="${e(last.input.id)}">Inspect recorded input</button>` : 'None recorded in this chat yet.'}</dd><dt>Weight training</dt><dd>Not enabled in this preview</dd></dl><p class="field-help">Saving a turn preserves it here. It does not mean the personal model has received it or learned it in its weights. The input receipt shows the material used for a particular call.</p></details>`;
}

export function turnOptions(state, chat, speaker, kind = 'send') {
  const table = tableInfo(state, chat);
  const responseMode = state.roots.find(root => root.id === chat.rootId)?.mode === 'personal' ? effectiveOrientation(chat.responseMode) : null;
  return { requestId: 'request_' + crypto.randomUUID(), kind, responseMode, harnessRevisionId: chat?.harnessSelections?.at(-1)?.id ?? null, ...(table ? { speaker, replyMode: replySettings(state, chat).mode, baseRevisionId: table.assignment.id,
    lastMessageId: state.messages.filter(m => m.chatId === chat.id).at(-1)?.id ?? null } : {}) };
}
