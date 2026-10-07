import { LEGACY_COATS } from './legacy-coats.js';
import { pocketContent } from './coat-pockets.js';
// Published versions stay immutable: old turns must resolve their original text.
export const STARTER_HARNESSES = Object.freeze([
  { id: 'conversation', version: 1, name: 'Conversation', description: 'Your usual Chat or Build voice, with no extra instructions.', instructions: '' },
  { id: 'brainstorm', version: 1, name: 'Brainstorm', description: 'Explore possibilities and connect ideas.', instructions: 'Explore the idea with the user. Bring useful connections, possibilities, examples, or counterpoints when they help. Let promising ideas develop before narrowing them. Carry earlier distinctions and corrections forward; leave room for the user to shape what grows.' },
  { id: 'tutor', version: 1, name: 'Tutor', description: 'Understand together, at the learner’s pace.', instructions: 'Help the user develop understanding at their own pace. Use concrete examples and explanations suited to what they already know. Offer a small exercise or question when it would help them discover a connection. Give direct answers when requested and let their curiosity guide the depth.' },
  { id: 'assistant', version: 1, name: 'Assistant', description: 'Practical help with the task at hand.', instructions: 'Help the user make progress on the task they bring. Use the available context, propose sensible next steps, and make useful drafts when appropriate. Keep the scope proportionate and explain consequential choices. Distinguish a suggestion or draft from something actually performed.' },
  { id: 'roleplay', version: 1, name: 'Roleplay', description: 'A shared scene with room for the user’s choices.', instructions: 'Join the fictional setting and role the user establishes. Help the scene unfold through vivid but proportionate detail, dialogue, and consequences. Preserve established facts and leave the user control of their own character’s choices. Clarify an uncertain rule when it matters to play.' },
  { id: 'rival', version: 1, name: 'Rival', description: 'A constructive opposing perspective.', instructions: 'Offer a thoughtful opposing perspective where the idea benefits from one. Look for a stronger alternative, a counterexample, or a premise worth questioning. Explain the reasoning and acknowledge what survives the challenge. Let agreement stand when there is no useful disagreement.' },
  { id: 'redteam', version: 1, name: 'Red team', description: 'Examine failure modes in a proposed design.', instructions: 'Examine the user’s proposed design for concrete failure modes, missing assumptions, and unintended consequences. Tie concerns to a plausible example and suggest a bounded check or repair. Separate demonstrated failures from possibilities that remain untested.' },
].map(Object.freeze));

export const defaultHarnessRef = () => ({ id: 'conversation', version: 1 });
export function findHarness(ref, state = {}) {
  const starter = [...STARTER_HARNESSES, ...LEGACY_COATS].find(h => h.id === ref?.id && h.version === ref?.version);
  if (starter) return starter;
  const custom = state.customHarnesses?.find(h => h.id === ref?.id);
  const version = custom?.versions.find(v => v.version === ref?.version);
  return version ? { id: custom.id, version: version.version, name: version.name, description: version.description, instructions: version.instructions, ...pocketContent(version) } : undefined;
}
export const harnessKey = ref => ref.id.startsWith('custom_') ? `${ref.id}@${ref.version}` : ref.id;
export function harnessRef(key) {
  const [id, version] = String(key).split('@');
  return { id, version: version === undefined ? 1 : Number(version) };
}
export const harnessDeleted = (ref, state) => Boolean(state.customHarnesses?.find(h => h.id === ref?.id)?.deletedAt);
export const allHarnesses = state => [...STARTER_HARNESSES, ...(state.customHarnesses ?? []).filter(h => !h.deletedAt).flatMap(h => h.versions.map(v => findHarness({ id: h.id, version: v.version }, state)))];
export const harnessChoice = chat => chat?.harnessSelections?.at(-1) ?? { id: null, shared: true, personal: defaultHarnessRef(), visiting: defaultHarnessRef() };

// Stable identities, independent of display labels and occupied chair positions.
export function coatIdentity(state, chat, seat) {
  const a = chat?.table?.assignments.at(-1);
  return seat === 'personal' ? (a?.personalId ? 'personal:' + a.personalId : 'unbound:personal')
    : (a?.visitorModelId ? 'model:' + a.visitorModelId : !a && state.roots?.find(r=>r.id===chat?.rootId)?.modelId ? 'model:' + state.roots.find(r=>r.id===chat.rootId).modelId : 'unbound:visiting');
}
export const usualCoat = (state, key) => state.coatUsuals?.filter(r=>r.key===key).at(-1) ?? null;
export function resolvedCoat(state, chat, seat, key = coatIdentity(state, chat, seat)) {
  const choice = chat?.coatChoices?.filter(r=>r.key===key).at(-1);
  const usual = usualCoat(state,key);
  const legacy = harnessChoice(chat);
  if (!chat?.coatPolicy) return { ref:legacy[seat], source:legacy.id, mode:'preserved', key };
  if(chat?.coatStarter && !choice) return {ref:chat.coatDefault?.[seat]??legacy[seat],source:chat.coatDefault?.selectionId??legacy.id,mode:'starter',key};
  if (choice?.mode === 'override') return { ref:choice.ref, source:choice.id, mode:'override', key };
  const fallback = chat?.coatDefault?.[seat] ?? defaultHarnessRef();
  return { ref:usual?.ref ?? fallback, source:usual?.id ?? chat?.coatDefault?.selectionId ?? null, mode:'follow', key };
}
export function resolvedHarnessChoice(state, chat) {
  const a=resolvedCoat(state,chat,'personal'), b=resolvedCoat(state,chat,'visiting');
  return {id:harnessChoice(chat).id, personal:a.ref, visiting:b.ref, shared:JSON.stringify(a.ref)===JSON.stringify(b.ref)};
}
