// Interface labels only. Recorded authorship and model instructions use their
// original bindings; a local nickname never changes those records.
export const personalLabel = (participant, fallback = 'Personal model') => participant?.nickname || participant?.name || fallback;
