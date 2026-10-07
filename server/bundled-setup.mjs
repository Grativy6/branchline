import { applyCommand } from './domain.mjs';
import { recordHandoff } from './handoff.mjs';
import { BUNDLED_PROFILE } from './bundled-profile.mjs';

// Called once, under the workspace writer lock, only for a genuinely new store.
// Existing empty chairs/workspaces are choices and are never auto-filled.
export function configureBundledModel(before, { fresh = false } = {}) {
  if (!fresh || before.models.length || before.roots.length || before.messages.length || before.exchanges.length) return before;
  let state = structuredClone(before); const commands = [];
  const apply = (type, payload) => { state = applyCommand(state, { type, payload }); commands.push({ type, payload }); };
  apply('model.save', BUNDLED_PROFILE);
  apply('personal.create', { name: 'Qwen', modelId: state.models.at(-1).id, baseIdentity: 'Qwen/Qwen3.5-4B' });
  apply('root.create', { name: 'My desk', mode: 'personal', setupChairs: true });
  recordHandoff(state, { kind: 'desktop.setup', from: 'fresh_install_default', to: 'fixed_workspace_commands', payload: commands,
    detail: { profile: 'bundled-qwen35-4b/1', commands, weightsTrained: false, authoritySource: 'included-model installation on a new workspace',
      sourceStanding: 'stock Qwen model; not a private Hearthline Dream or certification', modelAvailability: 'verified on first local invocation' } });
  return state;
}
