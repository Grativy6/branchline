import { activeModels, isModelArchived, modelFilesHeld, archiveLabel } from './model-archives.js';
import { escapeHtml as e } from './views.js';
import { carrySettings } from './resource-settings.js';

export function recorderOptions(state, chat) {
  const assignment = chat.table?.assignments.at(-1), root = state.roots.find(r => r.id === chat.rootId);
  const personal = state.personalParticipants?.find(p => p.id === assignment?.personalId);
  const ids = { personal: personal?.connections.at(-1)?.modelId, visiting: assignment ? assignment.visitorModelId : root?.modelId };
  const chairs = Object.entries(ids).map(([value, id]) => ({ value, model: state.models.find(m => m.id === id),
    label: value === 'personal' ? 'Personal' : 'Visiting', role: 'participant' }));
  return { chairs: assignment ? chairs : chairs.filter(c => c.value === 'visiting'),
    others: activeModels(state).filter(m => !Object.values(ids).includes(m.id)).map(model => ({ value: 'model:' + model.id, model, label: model.name, role: 'reviewer' })) };
}
export const recorderHint = choice => choice?.startsWith('model:')
  ? 'Outside reviewer · reads the selected conversation and writes its account without joining either chair.'
  : 'Participant account · carries this chair’s perspective while preserving everyone’s original attribution.';
export function recorderSelect(state, chat, choice = carrySettings(chat).speaker) {
  if (!chat.table?.assignments.length && choice === 'personal') choice = 'visiting';
  const groups = recorderOptions(state, chat);
  // Moving a saved reviewer into a chair does not silently change its writing role.
  const seatedReviewer = choice.startsWith('model:') ? groups.chairs.find(c => c.model?.id === choice.slice(6)) : null;
  const retained = seatedReviewer ? [{ value: choice, model: seatedReviewer.model, role: 'reviewer', label: 'Saved reviewer · ' + seatedReviewer.model.name + ' · now in the ' + seatedReviewer.label + ' chair' }] : [];
  const entries = [...groups.chairs, ...retained, ...groups.others];
  const option = c => `<option value="${e(c.value)}" ${choice === c.value ? 'selected' : ''} ${c.model && !isModelArchived(state,c.model.id) && !modelFilesHeld(state,c.model.id) ? '' : 'disabled'}>${e(c.role === 'participant' ? c.label + ' · ' + (c.model?.name ?? 'No model selected') : c.label)}${archiveLabel(state,c.model?.id)}${c.model?.runtime === 'codex' ? ' · sends context to OpenAI' : c.model ? ' · local' : ''}</option>`;
  const missing = !entries.some(c => c.value === choice) ? `<option value="${e(choice)}" selected disabled>Saved recorder unavailable here · choose a recorder</option>` : '';
  return `<select name="speaker">${missing}<optgroup label="In this conversation · participant account">${groups.chairs.map(option).join('')}</optgroup>${retained.length ? `<optgroup label="Previously selected reviewer">${retained.map(option).join('')}</optgroup>` : ''}<optgroup label="Other connected models · outside reviewer">${groups.others.map(option).join('')}</optgroup></select>`;
}
