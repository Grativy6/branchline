import { digest } from './integrity.mjs';
import { dreamOwner } from '../public/dream-records.js';

// Authorship is resolved from saved host bindings, never from what a reply says.
// These views help a model follow the conversation; they do not make its prose
// an identity claim the application will trust.
export const SPEAKER_CONTEXT_PROFILE = 'branchline.chair-context/3';
export const CHAIR_IDENTITY_PROFILE = 'branchline.chair-identity/1';

function newChairIdentity(chatId, selection) {
  if (!['personal', 'visiting'].includes(selection?.seat)) throw new Error('Chair identity requires a selected chair.');
  const own = selection.seat === 'personal' ? 'Personal' : 'Visiting';
  const other = selection.seat === 'personal' ? 'Visiting' : 'Personal';
  const stamp = { profile: CHAIR_IDENTITY_PROFILE, bindingHash: digest({ chatId, speaker: selection }),
    text: `[Chair identity]\nYou are the ${own} model (${selection.modelSnapshot.model}), not the ${other} model or the user. Earlier ${other} replies and user messages are their words, not yours.` };
  return { ...stamp, hash: digest(stamp) };
}

// The first outgoing context for this assignment/model pins the wording. Later
// episodes copy that exact record, including after restart. A changed binding
// creates a new stamp; nothing is retroactively added to old exchanges.
export function chairIdentitySnapshot(state, chatId, selection) {
  const expected = newChairIdentity(chatId, selection);
  const prior = state.handoffs?.records.find(record => record.kind === 'context.to_model' && record.scope.chatId === chatId
    && record.detail.contextView?.chairIdentity?.bindingHash === expected.bindingHash);
  if (!prior) return expected;
  const saved = prior.detail.contextView.chairIdentity;
  if (digest(saved) !== digest(expected)) throw new Error('Stored chair identity does not match its supported wording and model binding.');
  return structuredClone(saved);
}

export function validateChairIdentityRecord(record) {
  const view = record.detail?.contextView;
  if (record.kind !== 'context.to_model' || view?.chairIdentity === undefined) return;
  const expected = newChairIdentity(record.scope.chatId, view.speaker);
  if (digest(view.chairIdentity) !== digest(expected)) throw new Error('Chair identity stamp changed its wording or binding.');
  const leading = record.detail.inputMessages?.[0];
  if (leading?.role !== 'system' || !leading.content.split('\n\n').includes(expected.text)) {
    throw new Error('Chair identity stamp is missing from the leading model instructions.');
  }
}

export function isOwnReply(turn, selection) {
  const prior = turn?.speaker;
  if (!prior || !selection || prior.seat !== selection.seat) return false;
  if (prior.modelId !== selection.modelId || prior.modelSnapshot.model !== selection.modelSnapshot.model
    || prior.modelSnapshot.baseUrl !== selection.modelSnapshot.baseUrl) return false;
  return selection.seat === 'visiting' || (prior.participantId === selection.participantId && prior.generationId === selection.generationId);
}

export function replySpeaker(state, message, turn, selection, reply) {
  const binding = turn?.speaker;
  const personal = state.personalParticipants?.find(item => item.id === binding?.participantId);
  return {
    reply,
    speaker: binding?.seat === 'personal' ? 'Personal' : binding?.seat === 'visiting' ? 'Visiting' : 'Earlier model',
    ...(personal ? { participant: personal.name } : {}),
    model: binding?.modelSnapshot.name ?? message.modelLabel,
    identifier: binding?.modelSnapshot.model ?? message.modelIdentifier,
    status: turn?.truncated ? 'truncated' : turn?.status ?? 'unknown',
    relation: isOwnReply(turn, selection) ? 'your_prior_reply' : 'another_participant',
    ...(binding?.seat==='personal' && selection?.seat==='personal' && !isOwnReply(turn,selection)
      && dreamOwner(state,binding.participantId)===dreamOwner(state,selection.participantId)
      ? { personalContinuity:'Earlier recorded state of the same personal model; original author and connection retained.' } : {}),
  };
}

export function attributedReply(message, speaker) {
  // Only this identity's own replies become assistant-role demonstrations.
  // JSON quoting keeps peer text and its embedded role labels in a data value.
  // The original transcript is retained byte-for-byte in the ledger.
  if (speaker.relation === 'your_prior_reply') return { role: 'assistant', content: message.content };
  const { relation, ...author } = speaker;
  return { role: 'user', content: '[App context: another participant\'s reply]\n'
    + JSON.stringify({ ...author, text: message.content }) };
}
