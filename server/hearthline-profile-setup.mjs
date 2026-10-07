import fs from 'node:fs';
import { applyCommand } from './domain.mjs';
import { assertInferenceIdle } from './table.mjs';
import { recordHandoff, recordUiCommand } from './handoff.mjs';
import { profileDestination, currentAgentSelection } from './agent-profiles.mjs';

export const HEARTHLINE_SETUP = 'desktop-hearthline-profile/1';
export const hearthlineConfigured = state => state.handoffs?.records.some(r => r.kind === 'desktop.setup' && r.detail.profile === HEARTHLINE_SETUP) ?? false;

// This opt-in launcher action is never reachable from model tools. It selects
// only the packaged public seed, once. A later disconnect remains disconnected.
export function configureHearthline(before) {
  if (hearthlineConfigured(before)) return before;
  assertInferenceIdle(before);
  const personalId = before.chats.find(c => c.id === before.ui.selected?.personal?.chatId)?.table?.assignments.at(-1)?.personalId
    ?? (before.personalParticipants?.length === 1 ? before.personalParticipants[0].id : null);
  if (!personalId) throw new Error('Choose a Personal participant first; the Hearthline profile can then be connected in My Models.');
  if (currentAgentSelection(before, personalId)?.profileId) throw new Error('A profile is already connected. Review Hearthline in My Models; no selection was replaced.');
  const bundle = JSON.parse(fs.readFileSync(new URL('../public/agent-profiles/hearthline.json', import.meta.url), 'utf8'));
  let state = structuredClone(before);
  const commands = [];
  const apply = (type, payload) => { const command = { type, payload }, next = applyCommand(state, command); recordUiCommand(state, next, command); state = next; commands.push({ type, profileId: payload.profileId ?? null }); };
  apply('profile.import', { bundle, replaces: null });
  const profile = state.agentProfiles.profiles.at(-1);
  apply('profile.connect', { personalId, baseSelectionId: currentAgentSelection(state, personalId)?.id ?? null, profileId: profile.id,
    paths: ['FOUNDING-SEED.txt'], models: state.models.map(m => ({ id: m.id, destination: profileDestination(m) })) });
  recordHandoff(state, { kind: 'desktop.setup', from: 'explicit_desktop_setup_flag', to: 'fixed_workspace_commands', payload: commands,
    detail: { profile: HEARTHLINE_SETUP, profileId: profile.id, selectionId: currentAgentSelection(state, personalId).id,
      authoritySource: 'Chris requested the existing Hearthline connection; this human launcher selects the public seed and currently saved model destinations only.',
      sources: bundle.entries.map(e => e.source), privateCabinIncluded: false, modelExecution: false, weightsChanged: false, mcpLaunched: false } });
  return state;
}
