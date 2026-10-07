// Response shape is independent of model identity, memory and executable grants.
// Keep these small, versioned instructions easy to adjust without changing those systems.
import { ORIENTATIONS, MODE_LABELS, effectiveOrientation } from '../public/response-orientations.js';
export const RESPONSE_MODE_PROFILE = 'response-shape/4';
const guidance = Object.freeze({
  ...ORIENTATIONS,
  chat: `Be a warm, curious conversational participant. Follow the thread the user cares about and contribute what you notice in it. An implication worth developing, a connection, or a considered disagreement can give the conversation somewhere to grow.

The exchange can be exploratory, playful, practical, or simply companionable. Questions can open useful space; a developed thought can also leave its own opening for a response.

Let conversation be worthwhile in itself. Practical help can emerge when wanted, without every interesting idea needing to become a task.`,
  build: `Help make progress on the user’s intended result. Carry the purpose, relevant context, and decisions already made into the work.

Exercise judgment within the agreed scope. For routine gaps, a reasonable default or small draft can keep things moving. When missing information materially changes the goal, scope, or consequences, bring that choice to the user.

Explain consequential choices where useful, and keep proposals, attempts, and observed results distinct. Keep progress clear and proportionate to the work.`,
});

export const isResponseMode = value => typeof value === 'string' && Object.hasOwn(guidance, value);

export function responseModeFor(state, chatId) {
  const chat = state.chats.find(item => item.id === chatId);
  const root = state.roots.find(item => item.id === chat?.rootId);
  // FS retains its own DM instruction shape.
  return root?.mode === 'personal' ? effectiveOrientation(chat.responseMode) : null;
}

export function responseModeInstruction(mode) {
  if (mode === null) return null;
  if (!isResponseMode(mode)) throw new Error('Unknown response mode.');
  const label = Object.hasOwn(ORIENTATIONS, mode) ? 'Base Coat' : 'Response mode';
  return `[${label}: ${MODE_LABELS[mode]}]\n\n${guidance[mode]}`;
}

export function responseModeEvidence(mode, profile = RESPONSE_MODE_PROFILE) {
  return { mode, profile, instruction: responseModeInstruction(mode) };
}

// Earlier continuing tasks have the full immutable input, but no separate base
// orientation field. Recover its existing instruction, never today's selection.
export function capturedPeerOrientation(peer) {
  if (peer.baseOrientation) return peer.baseOrientation;
  const system = peer.baseMessages.filter(m => m.role === 'system').map(m => m.content).join('\n');
  const found = Object.keys(guidance).map(mode => ({ mode, at: system.indexOf(responseModeInstruction(mode)) })).filter(x => x.at >= 0).sort((a,b) => a.at-b.at)[0];
  return found ? responseModeEvidence(found.mode, ['chat','build'].includes(found.mode) ? 'response-shape/3' : RESPONSE_MODE_PROFILE) : { mode:null,profile:'not-recorded',instruction:null };
}
