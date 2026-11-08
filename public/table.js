import { chairRoster, rosterAssignment, chairLabel } from './chair-roster.js';
import { rosterPanel } from './roster-views.js';
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
  if (!chat) return null;
  const roster = chairRoster(state, chat), participant = state.personalParticipants?.find(p => p.id === roster.desk.personalId);
  const personalModel = state.models.find(m => m.id === roster.desk.modelId);
  const visitor = roster.visitors.find(c => c.id === roster.selectedVisitorId), visitorModel = state.models.find(m => m.id === visitor?.modelId);
  const assignment = rosterAssignment(state, chat) ?? { id:roster.revisionId, personalId:roster.desk.personalId, visitorModelId:visitor?.modelId ?? null };
  return { assignment, participant, personalModel, visitorModel, roster };
}

export function tableSetup(state, chat) {
  return `<p class="muted">Choose who takes the next turn. Adding a chair saves its setup; it replies only when asked.</p><button type="button" class="quiet-button" data-action="choose-model" data-id="personal">Edit Desk Model</button>${rosterPanel(state, chat, modelsBusy(state))}`;
}

export function personalSettings(state) {
  const participants = visiblePersonalModels(state);
  return `<section class="personal-model-settings"><h3>Your personal models</h3><button class="text-button" data-action="model-archives">Archived models</button><p class="field-help">A continuing participant you can bring to different conversations. Its history stays independent of its model connection.</p>${participants.map(p => {
    const generation = p.generations.find(g => g.id === p.currentGenerationId);
    const model = state.models.find(m => m.id === p.connections.at(-1).modelId);
    const peach=state.peachesBook?.associations.findLast(a=>a.personalId===p.id);
    return `<div class="personal-model-card"><div class="personal-model-heading"><strong>${e(personalLabel(p))}</strong><button type="button" class="text-button" data-action="personal-rename" data-id="${e(p.id)}" aria-label="Rename ${e(personalLabel(p))}" ${modelsBusy(state) ? 'disabled' : ''}>Rename</button></div><span>${e(model?.name || 'Connection unavailable')}</span><small>${e(generation.baseIdentity)}</small>${peach?`<small>Origin: ${e(peach.thread.origin?.label??'Unspecified')} · ${e(state.personalContext?.profiles.find(x=>x.id===peach.profileId)?.name??'Carried profile')}</small>`:''}<div class="personal-model-actions"><button type="button" class="text-button" data-action="model-archive" data-id="${e(model.id)}">Archive model</button><button type="button" class="dream-review-button" data-action="dream-review" data-id="${e(p.id)}">Review Dreams</button><button type="button" class="text-button" data-action="agent-profile-open" data-id="${e(p.id)}">Agent profile</button><button type="button" class="text-button" data-action="peaches-open" data-personal="${e(p.id)}">${peach?'Open continuity Book':'Connect continuity Book'}</button></div></div>`;
  }).join('')}<details ${participants.length ? '' : 'open'}><summary>${participants.length ? 'Register another personal participant' : 'Set up a personal participant'}</summary><form id="personal-form"><label class="form-field">Name<input name="name" maxlength="200" placeholder="My personal AI" required></label><label class="form-field">Local model connection<select name="modelId" required><option value="">Choose a saved model</option>${activeModels(state).filter(m => !['codex','openai'].includes(m.runtime)).map(m => `<option value="${e(m.id)}">${e(m.name)}</option>`).join('')}</select></label><label class="form-field">Base identity<input name="baseIdentity" maxlength="500" placeholder="For example, swiss-ai/Apertus-8B-2509" required></label><p class="field-help">This records your declared starting model. It does not train weights or certify the server's identity.</p><button class="quiet-button" type="submit" ${state.models.length ? '' : 'disabled'}>Create personal participant</button></form></details></section>`;
}

export function personalNicknameForm(participant, returnView = 'library') {
  return `<form id="personal-nickname-form" data-id="${e(participant.id)}" data-base-nickname="${e(JSON.stringify(participant.nickname ?? null))}" data-original-name="${e(participant.name)}" data-return-view="${returnView === 'settings' ? 'settings' : 'library'}"><label class="form-field">Nickname<input autofocus name="nickname" maxlength="200" value="${e(personalLabel(participant))}" aria-describedby="nickname-hint"></label><p id="nickname-hint" class="field-help">A name for your workspace. This changes the label you see, while saved replies and model instructions keep their recorded names.</p><p class="field-help">Original name: ${e(participant.name)}</p><button type="button" class="text-button" data-action="personal-original-name">Use original name</button><div class="dialog-footer"><button type="button" class="quiet-button" data-action="personal-nickname-cancel">Cancel</button><button type="submit" class="primary-button">Save nickname</button></div></form>`;
}

export function replySettings(state, chat) {
  const r = chairRoster(state, chat);
  return r ? { mode:r.mode, speaker:r.speaker, next:r.speaker } : { mode:'single', speaker:'personal', next:'personal' };
}

export function replyControls(state, chat, busy = false, connectionBlocked = false) {
  const table = tableInfo(state, chat);
  if (!table) return '';
  const settings = replySettings(state, chat), visitors = table.roster.visitors.length > 0;
  const canAsk = state.messages.some(m => m.chatId === chat.id) && (settings.next === 'personal' ? table.personalModel : table.visitorModel);
  return `<div class="reply-controls"><div class="reply-pattern-buttons" role="group" aria-label="Reply mode">${[['single','Select','Reply from the highlighted chair'],['alternate','Alternate','Take turns through occupied chairs'],['all','All','Send the complete prompt to every occupied chair']].map(([mode,label,hint])=>`<button type="button" data-action="reply-pattern" data-id="${mode}" aria-pressed="${settings.mode===mode}" title="${hint}" ${busy?'disabled':''}>${label}</button>`).join('')}</div><button class="quiet-button ask-now" type="button" data-action="ask-now" ${busy || !canAsk || connectionBlocked ? 'disabled' : ''}>Ask now</button></div>`;
}

export function tableErrors(state, chat) {
  const table = tableInfo(state, chat);
  if (!table || !state.messages.some(m => m.chatId === chat.id)) return '';
  const blocked = [table.personalModel,table.visitorModel].filter(m=>m && (isModelArchived(state,m.id)||modelFilesHeld(state,m.id)));
  if(blocked.length) return `<p class="notice">${blocked.map(m=>e(m.name+archiveLabel(state,m.id))).join(', ')}. Choose an available model or open <button class="text-button" data-action="model-archives">Archived models</button>. Your conversation and draft stay here.</p>`;
  const failedAsks = state.exchanges.filter(turn => turn.chatId === chat.id && turn.request?.kind === 'ask' && ['failed', 'cancelled'].includes(turn.status) && !state.messages.some(m => m.exchangeId === turn.id && m.role === 'assistant'));
  return failedAsks.map(turn => `<p class="notice message-error">${chairLabel(turn.speaker)} reply ${e(turn.status)}: ${e(turn.error || 'No text was returned.')}</p>`).join('');
}

export function replyPatternLabel(state, exchange) {
  if(exchange?.request?.replyMode==='all')return 'All chairs';
  if (exchange?.request?.followUpOf) return 'Both · follow-up (2 of 2)';
  if (exchange?.request?.followUp) {
    const second = state.exchanges.find(turn => turn.request?.id === exchange.request.followUp.requestId);
    return `Both · first reply (1 of 2) · follow-up ${second?.status ?? 'not started'}`;
  }
  return exchange?.speaker?.profile === 'branchline.chair/2' ? (exchange.speaker.seat === 'personal' ? 'Desk Model reply' : exchange.request?.replyMode === 'alternate' ? 'Visiting · Alternate' : 'Visiting · Select') : exchange?.request?.replyMode === 'alternate' ? 'Alternate' : 'Single reply';
}

export function replyAuthor(message, exchange) {
  const seat = exchange?.speaker?.seat;
  return `${seat ? chairLabel(exchange.speaker) + ' · ' : ''}${exchange?.speaker?.displayName || message.modelLabel || 'Local model'}`;
}

export function tableContinuityPanel(state, chat) {
  const table = tableInfo(state, chat);
  if (!table) return '';
  const records = state.handoffs?.records || [];
  const replies = records.filter(r => r.kind === 'model.to_record' && r.scope.chatId === chat.id && r.detail.dispatched);
  const last = replies.map(r => ({ result: r, input: records.find(i => i.id === r.parents[0]) }))
    .filter(({ input }) => { const speaker=input?.detail?.contextView?.speaker; return speaker?.seat === 'personal' && (speaker.profile === 'branchline.chair/2' ? speaker.chairId === table.roster.desk.id && speaker.modelId === table.roster.desk.modelId : table.participant && speaker.participantId === table.participant.id); }).at(-1);
  const turns = state.exchanges.filter(t => t.chatId === chat.id);
  const completed = turns.filter(t => t.status === 'completed' && !t.truncated).length;
  return `<details class="details-section table-continuity"><summary>At this table</summary><dl><dt>Recorded here</dt><dd>${turns.length} turn(s) · ${completed} complete</dd><dt>Desk Model</dt><dd>${e(table.roster.desk.name)}</dd><dt>Last Desk Model call with a recorded outcome</dt><dd>${last ? `${e(new Date(last.result.at).toLocaleString())}<br><button type="button" class="text-button" data-action="table-input" data-id="${e(last.input.id)}">Inspect recorded input</button>` : 'None recorded in this chat yet.'}</dd></dl><p class="field-help">The recorded input shows which material was supplied for that reply.</p></details>`;
}

export function turnOptions(state, chat, speaker, kind = 'send') {
  const table = tableInfo(state, chat);
  const responseMode = state.roots.find(root => root.id === chat.rootId)?.mode === 'personal' ? effectiveOrientation(chat.responseMode) : null;
  return { requestId: 'request_' + crypto.randomUUID(), kind, responseMode, harnessRevisionId: chat?.harnessSelections?.at(-1)?.id ?? null, ...((chat.seating || chat.table) ? { speaker, replyMode: chat.seating?.mode ?? chat.replySettings?.mode ?? 'single', baseRevisionId: table.assignment.id,
    lastMessageId: state.messages.filter(m => m.chatId === chat.id).at(-1)?.id ?? null } : {}) };
}
