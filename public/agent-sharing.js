// Permission follows the selected material and exact destination, not the
// attachment event. A Dream can reconnect the same immutable profile without
// making each historical attachment a separate sharing decision.
export function sameProfileSelection(a, b) {
  return !!a?.profileId && a.profileId === b?.profileId
    && Array.isArray(a.paths) && Array.isArray(b.paths) && a.paths.length > 0
    && a.paths.length === b.paths.length && a.paths.every(path => b.paths.includes(path));
}

export function profileSharingSelections(state, personalId) {
  const roots = new Set(state.chats.filter(c => c.table?.assignments.at(-1)?.personalId === personalId).map(c => c.rootId));
  const carried = new Set((state.handoffs?.records ?? [])
    .filter(r => r.kind === 'context.to_model' && roots.has(r.scope.rootId))
    .flatMap(r => r.detail.contextView?.agentExposureIds ?? (r.detail.contextView?.agentProfile ? [r.detail.contextView.agentProfile.selectionId] : [])));
  const groups = [];
  for (const selection of state.agentProfiles?.selections ?? []) {
    if (!selection.profileId || !(selection.personalId === personalId || carried.has(selection.id))) continue;
    const index = groups.findIndex(prior => sameProfileSelection(prior, selection));
    if (index < 0) groups.push(selection);
    else groups[index] = selection;
  }
  return groups;
}

export function profileSharingDestinations(state, selectionId) {
  const library = state.agentProfiles, selection = library?.selections.find(s => s.id === selectionId);
  if (!selection) return [];
  const equivalent = new Set(library.selections.filter(s => sameProfileSelection(s, selection)).map(s => s.id));
  const seen = new Set(), destinations = [];
  for (const grant of library.sharing) {
    if (!equivalent.has(grant.selectionId)) continue;
    for (const destination of grant.destinations) {
      const key = JSON.stringify([destination.runtime, destination.baseUrl, destination.model]);
      if (seen.has(key)) continue;
      seen.add(key); destinations.push(destination);
    }
  }
  return destinations;
}

export function profileSharedWith(state, selectionId, model) {
  return !!model && profileSharingDestinations(state, selectionId).some(d =>
    d.runtime === (model.runtime ?? 'compatible') && d.baseUrl === model.baseUrl && d.model === model.model);
}
