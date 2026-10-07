// Review navigation only. The server remains the disclosure enforcement point.
export function profileSharingSelections(state, personalId) {
  const roots = new Set(state.chats.filter(c => c.table?.assignments.at(-1)?.personalId === personalId).map(c => c.rootId));
  const carried = new Set((state.handoffs?.records ?? [])
    .filter(r => r.kind === 'context.to_model' && roots.has(r.scope.rootId))
    .flatMap(r => r.detail.contextView?.agentExposureIds ?? (r.detail.contextView?.agentProfile ? [r.detail.contextView.agentProfile.selectionId] : [])));
  return (state.agentProfiles?.selections ?? []).filter(s => s.profileId && (s.personalId === personalId || carried.has(s.id)));
}

export function profileSharedWith(state, selectionId, model) {
  return !!model && (state.agentProfiles?.sharing ?? []).some(r => r.selectionId === selectionId && r.destinations.some(d =>
    d.runtime === (model.runtime ?? 'compatible') && d.baseUrl === model.baseUrl && d.model === model.model));
}
