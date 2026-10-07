import { contextBudget } from './context-budget.mjs';
import { measureContext, replyTokenLimit } from './model.mjs';
import { currentAssignment, resolveSpeaker } from './table.mjs';
import { CARRY_LIMITS } from './context-carry.mjs';

// The writer's reading window and the conversation's destination window are
// distinct. Only metadata is read here; preparation still runs one chosen model.
export async function sharedContextPlan(state, chatId, options = {}) {
  const chat = state.chats.find(c => c.id === chatId);
  const root = state.roots.find(r => r.id === chat?.rootId);
  if (!chat || !root) throw new Error('Choose a branch.');
  const assignment = currentAssignment(state, chatId);
  const seats = assignment ? [assignment.personalId && 'personal', assignment.visitorModelId && 'visiting'].filter(Boolean) : ['legacy'];
  const participants = await Promise.all(seats.map(async seat => {
    const { model, selection } = resolveSpeaker(state, chatId, seat);
    const budget = await contextBudget(model, { maxContextCharacters: root.resources?.inputCharacters ?? 60000, ...options, maxTokens: replyTokenLimit(root, model) });
    const measured = measureContext(state, chatId, state.drafts[chatId] || '', { selection });
    return { seat, modelId: model.id, modelLabel: model.name, ...measured, budget };
  }));
  if (!participants.length) throw new Error('Choose a model before preparing the shared context.');
  const pressured = participants.reduce((a, b) => a.characters / a.budget.characters >= b.characters / b.budget.characters ? a : b);
  // Leave headroom for a next message and attribution. Excerpts and their
  // wrappers get a separate allowance instead of spending the entire window
  // on the summary alone. These are conservative character estimates.
  const available = Math.floor(Math.min(...participants.map(p => p.budget.characters * 0.8 - p.fixedCharacters)));
  const sources = Math.max(1, Math.min(6, Math.floor(available / 3500)));
  const proseAndRecent = available - 1000 - sources * 800;
  const target = proseAndRecent >= 400 ? {
    profile: 'branchline.shared-context-target/1',
    accountCharacters: Math.min(CARRY_LIMITS.account, Math.floor(proseAndRecent * 0.55)),
    sources, recentCharacters: Math.min(CARRY_LIMITS.recent, Math.floor(proseAndRecent * 0.45)),
  } : null;
  return { scope: 'conversation', limitingSeat: pressured.seat, participants, characters: pressured.characters, limit: pressured.budget.characters,
    budget: pressured.budget, target,
    contextIssue: target ? null : 'Current instructions, selected sources or the draft leave too little room for a shared handoff. Shorten those or choose a larger window; the saved conversation is unchanged.' };
}
