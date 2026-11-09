import crypto from 'node:crypto';
import { digest } from './integrity.mjs';
import { assertModelAvailable } from './model-archives.mjs';
import { findHarness, harnessDeleted, currentHarnessRef } from '../public/harness-catalog.js';
import { retiredCoat } from '../public/legacy-coats.js';
import { chairRoster, ROSTER_PROFILE, CHAIR_PROFILE } from '../public/chair-roster.js';
const fail = (ok, why) => { if (!ok) throw new Error(why); };
const exact = (p, keys) => p && typeof p === 'object' && !Array.isArray(p) && Object.keys(p).every(k => keys.includes(k));
const ref = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(v);
const name = v => typeof v === 'string' && v.trim() === v && v.length > 0 && v.length <= 200 && !/[\u0000-\u001f\u007f]/.test(v);
const uid = () => 'seating_' + crypto.randomUUID();
export function applyRosterCommand(state, type, p) {
  const chat = state.chats.find(c => c.id === p.chatId), root = state.roots.find(r => r.id === chat?.rootId);
  fail(chat && root && !chat.archivedAt && !root.archivedAt, 'Choose an active conversation.');
  if (type === 'table.roster.start') {
    fail(exact(p, ['chatId']), 'Choose one conversation.');
    if (!chat.seating) chat.seating = { ...structuredClone(chairRoster(state, chat)), revisionId: uid() };
    return;
  }
  const r = chat.seating;
  fail(r && p.baseRevisionId === r.revisionId, 'The chairs changed. Reopen their choices before saving.');
  const base = ['chatId', 'baseRevisionId'];
  if (type === 'table.roster.chair') {
    fail(exact(p, [...base, 'chairId', 'modelId', 'personalId', 'name', 'coat']), 'Choose a chair name, saved connection and Coat.');
    const old = p.chairId === r.desk.id ? r.desk : r.visitors.find(c => c.id === p.chairId);
    fail(p.chairId === null || old, 'This chair is no longer at the desk.');
    fail(p.chairId !== null || r.visitors.length < 32, 'This conversation already has 32 visiting chairs.');
    fail(name(p.name), 'Give the chair a name of up to 200 characters.');
    fail(p.modelId === null && old === r.desk || ref(p.modelId) && state.models.some(m => m.id === p.modelId), 'Choose an available model connection.');
    if (p.modelId) assertModelAvailable(state, p.modelId);
    fail(p.coat === null || exact(p.coat, ['id', 'version']) && findHarness(p.coat, state), 'Choose an available Coat.');
    if (p.coat && (harnessDeleted(p.coat, state) || retiredCoat(p.coat))) fail(digest(p.coat) === digest(currentHarnessRef(old?.coat ?? null,state)), 'Choose an active Coat or restore it first.');
    const personalId = p.personalId ?? null;
    const participant = state.personalParticipants?.find(x => x.id === personalId);
    fail(personalId === null || old === r.desk && participant?.connections.at(-1)?.modelId === p.modelId, 'The saved identity does not match this Desk Model connection.');
    const chair = { id: old?.id ?? 'chair_' + crypto.randomUUID(), name: p.name, modelId: p.modelId, personalId, coat: structuredClone(p.coat) };
    if (old === r.desk) r.desk = chair;
    else if (old) r.visitors[r.visitors.indexOf(old)] = chair;
    else { r.visitors.push(chair); r.selectedVisitorId ??= chair.id; }
  } else if (type === 'table.roster.select') {
    fail(exact(p, [...base, 'chairId']) && [r.desk,...r.visitors].some(c => c.id === p.chairId), 'Choose a chair at this desk.');
    r.speaker = p.chairId === r.desk.id ? 'personal' : 'visiting';
    if (r.speaker === 'visiting') r.selectedVisitorId = p.chairId;
    r.mode = 'single';
  } else if (type === 'table.roster.move') {
    fail(exact(p, [...base, 'chairId', 'direction']) && [-1, 1].includes(p.direction), 'Choose a visitor and move direction.');
    const i = r.visitors.findIndex(c => c.id === p.chairId), j = i + p.direction;
    fail(i >= 0 && j >= 0 && j < r.visitors.length, 'The chair is already at that end of the list.');
    [r.visitors[i], r.visitors[j]] = [r.visitors[j], r.visitors[i]];
  } else if (type === 'table.roster.remove') {
    fail(exact(p, [...base, 'chairId']), 'Choose one visiting chair.');
    const index = r.visitors.findIndex(c => c.id === p.chairId);
    fail(index >= 0, 'This visitor has already left the list.');
    r.removed = { chair: r.visitors[index], index, selectedVisitorId: r.selectedVisitorId };
    r.visitors.splice(index, 1);
    if (r.selectedVisitorId === p.chairId) r.selectedVisitorId = r.visitors[index % (r.visitors.length || 1)]?.id ?? null;
    if (!r.visitors.length) r.speaker = 'personal';
  } else if (type === 'table.roster.undo') {
    fail(exact(p, base) && r.removed && r.visitors.length < 32, 'There is no removed chair to restore.');
    fail(!r.visitors.some(c => c.id === r.removed.chair.id), 'This chair is already present.');
    assertModelAvailable(state, r.removed.chair.modelId);
    r.visitors.splice(Math.min(r.removed.index, r.visitors.length), 0, r.removed.chair);
    r.selectedVisitorId = r.removed.selectedVisitorId;
    if (!r.visitors.some(c => c.id === r.selectedVisitorId)) r.selectedVisitorId = r.removed.chair.id;
    r.removed = null;
  } else throw new Error('Unknown chair arrangement command.');
  if (type !== 'table.roster.select') r.revisionId = uid();
}
export function validateRoster(state, chat) {
  const r = chat.seating;
  if (!r) return;
  fail(exact(r, ['profile','revisionId','desk','visitors','selectedVisitorId','mode','speaker','removed','completedVisitorReplies','lastCompletedVisitorTurnId','lastAlternateTurnId']) && r.profile === ROSTER_PROFILE && ref(r.revisionId), 'Invalid chair arrangement.');
  fail(Array.isArray(r.visitors) && r.visitors.length <= 32 && ['single','alternate','all'].includes(r.mode) && ['personal','visiting'].includes(r.speaker), 'Invalid visitor settings.');
  const ids = new Set();
  for (const c of [r.desk, ...r.visitors]) {
    fail(exact(c, ['id','name','modelId','personalId','coat']) && ref(c.id) && !ids.has(c.id) && name(c.name), 'Invalid chair.'); ids.add(c.id);
    fail(c.modelId === null && c === r.desk || state.models.some(m => m.id === c.modelId), 'Chair connection missing.');
    fail(c.personalId === null || c === r.desk && state.personalParticipants?.some(p => p.id === c.personalId && p.connections.at(-1).modelId === c.modelId), 'Chair continuity connection changed.');
    fail(c.coat === null || exact(c.coat, ['id','version']) && findHarness(c.coat,state), 'Chair Coat missing.');
  }
  fail(r.visitors.length ? r.visitors.some(c => c.id === r.selectedVisitorId) : r.selectedVisitorId === null, 'Selected visitor missing.');
  fail(Number.isSafeInteger(r.completedVisitorReplies) && r.completedVisitorReplies >= 0 && (r.lastCompletedVisitorTurnId === null || state.exchanges.some(t => t.id === r.lastCompletedVisitorTurnId && t.chatId === chat.id && t.speaker?.profile === CHAIR_PROFILE && t.speaker.seat === 'visiting' && t.status === 'completed' && !t.truncated)), 'Visitor completion marker invalid.');
  if (r.removed) fail(exact(r.removed, ['chair','index','selectedVisitorId']) && ref(r.removed.chair?.id) && Number.isInteger(r.removed.index), 'Invalid removed chair.');
  if (r.lastAlternateTurnId) fail(state.exchanges.some(t=>t.id===r.lastAlternateTurnId&&t.chatId===chat.id&&t.status==='completed'&&t.speaker?.profile===CHAIR_PROFILE),'Invalid alternating reply marker.');
}
// Host completion only, applied in the same durable transaction as the reply.
// Retrying a request returns its saved result; reopening cannot advance it again.
export function completeVisitorTurn(state, exchangeId) {
  const turn = state.exchanges.find(t => t.id === exchangeId), r = state.chats.find(c => c.id === turn?.chatId)?.seating;
  if (!r || turn.speaker?.profile !== CHAIR_PROFILE || turn.status !== 'completed' || turn.truncated) return;
  if (turn.speaker.seat === 'visiting' && r.lastCompletedVisitorTurnId !== turn.id) {
    r.completedVisitorReplies++;
    r.lastCompletedVisitorTurnId = turn.id;
  }
  const highlighted = r.speaker === 'personal' ? r.desk.id : r.selectedVisitorId;
  if (r.mode==='alternate' && turn.request?.replyMode === 'alternate' && turn.speaker.assignmentId === r.revisionId
      && highlighted===turn.speaker.chairId && r.lastAlternateTurnId!==turn.id) {
    const chairs=[r.desk,...r.visitors].filter(c=>c.modelId),i=chairs.findIndex(c=>c.id===turn.speaker.chairId),next=chairs[(i+1)%chairs.length];
    if (i>=0&&next) { r.speaker=next.id===r.desk.id?'personal':'visiting'; if(r.speaker==='visiting')r.selectedVisitorId=next.id; }
    r.lastAlternateTurnId=turn.id;
  }
  if (!turn.request?.deskTaskId) r.revisionId = 'seating_' + turn.id;
}


// Queued work keeps the exact source turn's chair view. Undo only that turn's
// automatic cursor update in this read-only view; user/model/Coat edits remain
// visible to the existing stale-context checks. This never changes saved state.
export function stateBeforeVisitorAdvance(state, sourceExchangeId) {
  const turn = state.exchanges.find(t => t.id === sourceExchangeId), chat = state.chats.find(c => c.id === turn?.chatId), r = chat?.seating;
  if (!r || turn?.speaker?.profile !== CHAIR_PROFILE || turn.speaker.seat !== 'visiting' || r.lastCompletedVisitorTurnId !== turn.id || r.revisionId !== 'seating_' + turn.id || turn.status !== 'completed' || turn.truncated) return state;
  const earlier = state.exchanges.slice(0,state.exchanges.indexOf(turn)).findLast(t => t.chatId === chat.id && t.speaker?.profile === CHAIR_PROFILE && t.speaker.seat === 'visiting' && t.status === 'completed' && !t.truncated);
  const seating = {...r, revisionId:turn.speaker.assignmentId, selectedVisitorId:turn.speaker.chairId,
    completedVisitorReplies:r.completedVisitorReplies-1, lastCompletedVisitorTurnId:earlier?.id ?? null};
  return {...state,chats:state.chats.map(c => c.id === chat.id ? {...c,seating} : c)};
}
