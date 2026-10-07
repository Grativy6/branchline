import { assertModelAvailable } from './model-archives.mjs';
import { currentAssignment, resolveSpeaker } from './table.mjs';
import { isRecorderChoice } from '../public/resource-settings.js';
import { digest } from './integrity.mjs';

// A recorder is a bounded writing job, never a third conversation chair.
export function resolveRecorder(state, chatId, choice) {
  if (!isRecorderChoice(choice)) throw new Error('Choose a saved handoff recorder.');
  const outside = choice.startsWith('model:');
  const chosen = outside ? { model: state.models.find(m => m.id === choice.slice(6)), selection: null }
    : resolveSpeaker(state, chatId, currentAssignment(state, chatId) ? choice : null);
  if (!chosen.model) throw new Error('The selected recorder is unavailable. Choose a connected model in Conversation settings.');
  assertModelAvailable(state,chosen.model.id);
  const recorder = { profile: 'branchline.recorder/1', choice,
    role: outside ? 'reviewer' : 'participant', seat: outside ? null : chosen.selection?.seat ?? 'visiting',
    modelId: chosen.model.id, modelHash: digest(chosen.model), chair: chosen.selection };
  return { model: chosen.model, selection: { seat: 'recorder', recorder, modelSnapshot: structuredClone(chosen.model) } };
}

export function recorderInstruction(recorder) {
  if (!recorder) return '';
  return recorder.role === 'reviewer'
    ? 'Recorder perspective: outside reviewer. You are reviewing the supplied conversation, not a participant in it. Preserve its warmth, tone, meaning and unresolved questions without inventing personal memories of the exchange.'
    : `Recorder perspective: participant account from the ${recorder.seat === 'personal' ? 'Personal' : 'Visiting'} chair. You may carry that perspective, emphasis and relational tone while recording a shared account for everyone. Attribute earlier words to their actual speakers and model identities; occupying this chair now does not make you the author of all its past replies.`;
}
