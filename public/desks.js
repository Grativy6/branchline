import { chairRoster } from './chair-roster.js';
import { rosterPanel, chairEditor } from './roster-views.js';
import { findHarness } from './harness-catalog.js';
import { activeModels, archiveLabel } from './model-archives.js';
import { visiblePersonalModels } from './dream-records.js';
import { harnessLabel } from './harness-views.js';
import { tableInfo } from './table.js';
import { personalLabel } from './personal-label.js';
import {resolvedCoat} from './harness-catalog.js';
import {codexConnection} from './codex.js';

const e = (value = '') => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const footer = label => `<div class="dialog-footer"><button type="button" class="quiet-button" data-action="close-dialog">Cancel</button><button type="submit" class="primary-button">${label}</button></div>`;
export function deskBar(state, root, chat, busy, codexStatus = null) {
  if (!root || !chat) return '<button type="button" class="quiet-button" data-action="desks">Choose a desk</button>';
  const r = chairRoster(state, chat), model = state.models.find(m => m.id === r.desk.modelId);
  const coat = findHarness(resolvedCoat(state, {...chat, seating:r}, 'personal').ref, state)?.name ?? 'Coat unavailable';
  const connection=model?.runtime==='codex'?codexConnection(codexStatus,model):null;
  return `<div class="chair personal-chair ${r.speaker==='personal'?'is-selected':''}"><button type="button" class="chair-symbol chair-menu" data-action="choose-model" data-id="personal" aria-label="Edit Desk Model" ${busy?'disabled':''}>⌁</button><button type="button" class="chair-picker chair-copy" data-action="highlight-chair" data-id="${e(r.desk.id)}" aria-label="Select ${e(r.desk.name)}" aria-pressed="${r.speaker==='personal'}" title="${e(model?model.name+' · '+model.model:'Choose a model')}"><small>DESK MODEL${connection?`<span class="chair-connection" role="status" title="${e(connection.label)}">${e(connection.ready?'Connected':connection.label)}</span>`:''}</small><span class="chair-name-line"><strong>${e(r.desk.name)}</strong><span class="chair-coat" aria-label="Coat: ${e(coat)}" title="Coat: ${e(coat)}">${e(coat)}</span></span></button></div><div class="desk-controls"><button type="button" class="current-branch" data-action="rename-branch" title="Rename this branch">${e(chat.title)}</button><button type="button" class="desk-selector" data-action="desks" title="Choose a desk"><span>Desk</span><strong>${e(root.name)}</strong><span aria-hidden="true">⌄</span></button></div>${rosterPanel(state,chat,busy)}`;
}
export function modelPicker(state, root, chat, seat) {
  const r = chairRoster(state, chat);
  return chairEditor(state, chat, seat === 'personal' ? r.desk.id : r.selectedVisitorId);
}

export function deskPicker(state) {
  return `<p class="muted">Desks group your conversation branches. Each branch keeps its own conversation and Coat choices.</p><div class="library-list">${state.roots.filter(r => !r.archivedAt).map(r => `<div><button type="button" class="quiet-button" data-action="select-root" data-id="${e(r.id)}"><strong>${e(r.name)}</strong><small>${state.chats.filter(c => c.rootId === r.id && !c.archivedAt).length} branches</small></button><button type="button" class="text-button" data-action="root-menu" data-id="${e(r.id)}" aria-label="Manage ${e(r.name)}">•••</button></div>`).join('') || '<p class="field-help">Create your first desk to begin.</p>'}</div><div class="dialog-footer"><button type="button" class="primary-button" data-action="new-root">New desk</button></div>`;
}

export function branchDialog(state, root) {
  const roots = state.roots.filter(r => !r.archivedAt);
  return `<form id="new-branch-form"><label class="form-field">Branch name<input name="title" maxlength="100" required autofocus placeholder="A new conversation"></label><label class="form-field">Desk<select name="rootId" required>${roots.map(r => `<option value="${e(r.id)}" ${root?.id === r.id ? 'selected' : ''}>${e(r.name)}</option>`).join('')}</select></label><p class="field-help">Starts a fresh conversation with this desk’s default Coat. Other branches’ messages stay in their own branches.</p>${footer('Create branch')}</form>`;
}
