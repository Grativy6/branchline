import { personalArchived } from './model-archives.js';
// Pure views of recorded history. These helpers never grant access or activate weights.
export const emptyDreamHistory = () => ({ version: 1, origins: [], records: [], notes: [], links: [], transitions: [] });
export const dreamHistory = state => state.dreamHistory ?? emptyDreamHistory();
export const dreamOwner = (state, id) => dreamHistory(state).links.findLast(r => r.memberId === id)?.ownerId || id;
export const visiblePersonalModels = state => (state.personalParticipants ?? []).filter(p => dreamOwner(state, p.id) === p.id && !personalArchived(state,p));
export const personalDreams = (state, id) => dreamHistory(state).records.filter(r => r.personalId === id);
export const dreamNote = (state, id) => dreamHistory(state).notes.findLast(n => n.dreamId === id) ?? null;
export const currentDream = (state, id) => {
  const person = state.personalParticipants?.find(p => p.id === id);
  return personalDreams(state, id).findLast(r => r.generationId === person?.currentGenerationId) ?? null;
};
export const DREAM_OUTCOMES = Object.freeze({ applied: 'Reported applied', kept: 'Kept previous state', failed: "Didn't finish", unadopted: 'Not adopted', unrecorded: 'Outcome not recorded' });
export function dreamOutcome(state, record) {
  return dreamHistory(state).transitions.some(t => t.dreamId === record.id) ? 'Selected in Branchline' : DREAM_OUTCOMES[record.outcome];
}
