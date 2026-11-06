// Shared, read-only view. Old assignments remain historical records.
export const ROSTER_PROFILE = 'branchline.chair-roster/1';
export const CHAIR_PROFILE = 'branchline.chair/2';
// A read view for one captured chair; never changes the user's selected chair.
export function chairView(state, chatId, chairId) {
  if (!chairId) return state;
  const chat = state.chats.find(c => c.id === chatId), roster = chat?.seating;
  if (!roster || chairId === roster.desk.id || chairId === roster.selectedVisitorId) return state;
  if (!roster.visitors.some(c => c.id === chairId)) throw new Error('The addressed chair is no longer at this desk.');
  return { ...state, chats: state.chats.map(c => c.id === chatId ? { ...c, seating: { ...roster, selectedVisitorId: chairId } } : c) };
}
export function chairRoster(state, chat) {
  if (!chat) return null;
  if (chat.seating) return chat.seating;
  const assignment = chat.table?.assignments.at(-1);
  const participant = state.personalParticipants?.find(p => p.id === assignment?.personalId);
  const modelId = participant?.connections.at(-1)?.modelId ?? (!assignment ? state.roots.find(r => r.id === chat.rootId)?.modelId : null) ?? null;
  const model = state.models.find(m => m.id === modelId);
  const visitor = state.models.find(m => m.id === assignment?.visitorModelId);
  const desk = { id: 'desk_' + chat.id, name: participant?.nickname || participant?.name || model?.name || 'Desk Model', modelId, personalId: participant?.id ?? null, coat: null };
  const visitors = visitor ? [{ id: 'visitor_' + assignment.id, name: visitor.name, modelId: visitor.id, personalId: null, coat: null }] : [];
  return { profile: ROSTER_PROFILE, revisionId: 'legacy_' + (assignment?.id ?? chat.id), desk, visitors,
    selectedVisitorId: visitors[0]?.id ?? null, mode: chat.replySettings?.mode === 'alternate' ? 'alternate' : 'single',
    speaker: chat.replySettings?.speaker ?? (!model && visitor ? 'visiting' : 'personal'), removed: null,
    completedVisitorReplies: 0, lastCompletedVisitorTurnId: null };
}
export function rosterChair(state, chat, seat) {
  const roster = chairRoster(state, chat);
  return seat === 'personal' ? roster?.desk : roster?.visitors.find(c => c.id === roster.selectedVisitorId) ?? null;
}
export function rosterAssignment(state, chat) {
  const roster = chat?.seating;
  if (!roster) return chat?.table?.assignments.at(-1) ?? null;
  return { id: roster.revisionId, personalId: roster.desk.personalId, deskModelId: roster.desk.modelId,
    visitorModelId: roster.visitors.find(c => c.id === roster.selectedVisitorId)?.modelId ?? null };
}
export const chairLabel = speaker => speaker?.profile === CHAIR_PROFILE && speaker.seat === 'personal' ? 'Desk Model' : speaker?.seat === 'personal' ? 'Personal' : 'Visiting';
