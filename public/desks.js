import { activeModels, archiveLabel } from './model-archives.js';
import { visiblePersonalModels } from './dream-records.js';
import { harnessLabel } from './harness-views.js';
import { tableInfo } from './table.js';
import { personalLabel } from './personal-label.js';

const e = (value = '') => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const footer = label => `<div class="dialog-footer"><button type="button" class="quiet-button" data-action="close-dialog">Cancel</button><button type="submit" class="primary-button">${label}</button></div>`;
export function deskBar(state, root, chat, busy) {
  if (!root) return '<button type="button" class="quiet-button" data-action="desks">Choose a desk</button>';
  const table = tableInfo(state, chat);
  const visitor = table ? table.visitorModel : state.models.find(m => m.id === root.modelId);
  const chair = (seat, name, caption, symbol) => `<button type="button" class="chair chair-picker ${seat}-chair" data-action="choose-model" data-id="${seat}" aria-label="Choose ${seat} model" ${busy || !chat ? 'disabled' : ''}><span class="chair-symbol" aria-hidden="true">${symbol}</span><span class="chair-copy"><small>${seat.toUpperCase()}</small><strong title="${e(name)}">${e(name)}</strong><span class="field-help" title="${e(caption)}">${e(caption)}</span></span></button>`;
  return `${chair('personal', personalLabel(table?.participant, 'Empty chair') + archiveLabel(state,table?.personalModel?.id), table?.personalModel?.name || 'Choose a personal model', '⌁')}<div class="desk-controls"><button type="button" class="desk-selector" data-action="desks" title="Choose a desk"><span>Desk</span><strong>${e(root.name)}</strong><span aria-hidden="true">⌄</span></button><button type="button" class="harness-selector" data-action="harnesses" ${!chat ? 'disabled' : ''} title="${e(harnessLabel(state, chat))}"><span>Coat</span><strong>${e(harnessLabel(state, chat))}</strong><span aria-hidden="true">⌄</span></button><button type="button" class="current-branch" data-action="rename-branch" title="Rename this branch">${e(chat?.title || 'No branch selected')}</button></div>${chair('visiting', (visitor?.name || 'Open chair') + archiveLabel(state,visitor?.id), visitor ? (visitor.runtime === 'codex' ? 'OpenAI · subscription' : 'Local model · click to swap') : 'Invite a visiting model', '◇')}`;
}

export function modelPicker(state, root, chat, seat) {
  const table = tableInfo(state, chat), personal = seat === 'personal';
  const items = personal ? visiblePersonalModels(state).map(p => ({ id: p.id, name: personalLabel(p), detail: state.models.find(m => m.id === p.connections.at(-1).modelId)?.name || 'Connection unavailable' })) : activeModels(state).map(m => ({ id: m.id, name: m.name, detail: m.model }));
  const chosen = personal ? table?.assignment.personalId : table ? table.assignment.visitorModelId : root.modelId;
  return `<form id="chair-picker-form" data-chat-id="${e(chat.id)}" data-seat="${seat}" data-base-revision-id="${e(table?.assignment.id || '')}" data-other-id="${e(personal ? (table ? table.assignment.visitorModelId : root.modelId) || '' : table?.assignment.personalId || '')}"><p class="muted">${personal ? 'Choose a saved personal participant to bring to this branch.' : 'Choose a saved model for this branch. Subscription visitors receive this branch’s selected context at OpenAI.'} This chair keeps its Coat when you swap models.</p><fieldset class="choice-list"><legend class="sr-only">${personal ? 'Personal' : 'Visiting'} model</legend><label><input type="radio" name="modelChoice" value="" ${!chosen ? 'checked' : ''}><span><strong>Leave this chair open</strong></span></label>${items.map(m => `<label><input type="radio" name="modelChoice" value="${e(m.id)}" ${chosen === m.id ? 'checked' : ''}><span><strong>${e(m.name)}</strong><small>${e(m.detail)}</small></span></label>`).join('')}</fieldset><button type="button" class="text-button" data-action="models">Manage saved models</button>${footer('Use this model')}</form>`;
}

export function deskPicker(state) {
  return `<p class="muted">Desks group your conversation branches. Each branch keeps its own conversation and Coat choices.</p><div class="library-list">${state.roots.filter(r => !r.archivedAt).map(r => `<div><button type="button" class="quiet-button" data-action="select-root" data-id="${e(r.id)}"><strong>${e(r.name)}</strong><small>${state.chats.filter(c => c.rootId === r.id && !c.archivedAt).length} branches</small></button><button type="button" class="text-button" data-action="root-menu" data-id="${e(r.id)}" aria-label="Manage ${e(r.name)}">•••</button></div>`).join('') || '<p class="field-help">Create your first desk to begin.</p>'}</div><div class="dialog-footer"><button type="button" class="primary-button" data-action="new-root">New desk</button></div>`;
}

export function branchDialog(state, root) {
  const roots = state.roots.filter(r => !r.archivedAt);
  return `<form id="new-branch-form"><label class="form-field">Branch name<input name="title" maxlength="100" required autofocus placeholder="A new conversation"></label><label class="form-field">Desk<select name="rootId" required>${roots.map(r => `<option value="${e(r.id)}" ${root?.id === r.id ? 'selected' : ''}>${e(r.name)}</option>`).join('')}</select></label><p class="field-help">Starts a fresh conversation with this desk’s default Coat. Other branches’ messages stay in their own branches.</p>${footer('Create branch')}</form>`;
}
