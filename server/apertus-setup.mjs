import { applyCommand } from './domain.mjs';
import { assertInferenceIdle, currentAssignment } from './table.mjs';
import { recordHandoff } from './handoff.mjs';

export const APERTUS_SETUP = 'desktop-apertus-base/1';
export const APERTUS_PROFILE = Object.freeze({ name: 'Apertus 8B · base', model: 'branchline-apertus8b-base',
  baseUrl: 'http://127.0.0.1:1234/v1', runtime: 'lmstudio', thinking: false, inputFormat: 'plain-dialogue-v1' });
export const apertusConfigured = state => state.handoffs?.records.some(record => record.kind === 'desktop.setup' && record.detail.profile === APERTUS_SETUP) ?? false;

// Only the explicitly requested desktop setup flag calls this. No API route or
// model output can choose a setup operation. One atomic append, never a rewrite.
export function configureApertus(before) {
  if (apertusConfigured(before)) return before;
  assertInferenceIdle(before);
  let state = structuredClone(before);
  const commands = [];
  const apply = (type, payload) => { const command = { type, payload }; state = applyCommand(state, command); commands.push(command); };
  let model = state.models.find(item => item.model === APERTUS_PROFILE.model && item.baseUrl === APERTUS_PROFILE.baseUrl);
  if (model && (model.inputFormat !== APERTUS_PROFILE.inputFormat || model.runtime !== 'lmstudio')) {
    throw new Error('An Apertus connection already exists with different settings. Review it in Settings; setup left it unchanged.');
  }
  if (!model) { apply('model.save', APERTUS_PROFILE); model = state.models.at(-1); }
  let participant = state.personalParticipants?.find(item => item.connections.at(-1).modelId === model.id);
  if (!participant) {
    apply('personal.create', { name: 'Apertus', modelId: model.id, baseIdentity: 'swiss-ai/Apertus-8B-2509' });
    participant = state.personalParticipants.at(-1);
  }
  // Bring it to the selected personal conversation only when that chair is open.
  // Keep the current visitor, drafts, guidance, response mode, and other tables.
  const chat = state.chats.find(item => item.id === state.ui.selected?.personal?.chatId && !item.archivedAt);
  const root = state.roots.find(item => item.id === chat?.rootId && item.mode === 'personal' && !item.archivedAt);
  const assignment = chat && currentAssignment(state, chat.id);
  if (root && !assignment?.personalId) apply('table.assign', { chatId: chat.id, baseRevisionId: assignment?.id ?? null,
    personalId: participant.id, visitorModelId: assignment?.visitorModelId ?? root.modelId ?? null });
  recordHandoff(state, { kind: 'desktop.setup', from: 'explicit_desktop_setup_flag', to: 'fixed_workspace_commands',
    payload: commands, detail: { profile: APERTUS_SETUP, commands, weightsTrained: false,
      modelAvailability: 'not verified by registration; checked separately by local launcher', sourceStanding: 'publisher_declared_base; serving bytes recorded separately',
      authoritySource: 'user-requested local model setup; not model text',
      servingSource: { repository: 'mradermacher/Apertus-8B-2509-GGUF', revision: '5d93e9d75f9907ccc3e89ce5c3ffc7fb1eb35ed4',
        file: 'Apertus-8B-2509.Q4_K_M.gguf', sha256: '9bc93ce242f34f0b1527563627d75efa6401572046d9d9a3d26f6d7125a89d22' } } });
  return state;
}
