export const NOTE_CADENCES = Object.freeze([10, 30, 60]);
export const NOTE_DEFAULTS = Object.freeze({ enabled: false, cadenceSeconds: 30, revision: 0, offRevision: 0 });
export const noteSettings = chat => ({ ...NOTE_DEFAULTS, ...chat?.reasoningNotes });
export function checkNoteSettings(value, stored = false) {
  const keys = stored ? ['enabled', 'cadenceSeconds', 'revision', 'offRevision'] : ['enabled', 'cadenceSeconds'];
  if (!value || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))
    || typeof value.enabled !== 'boolean' || !NOTE_CADENCES.includes(value.cadenceSeconds)
    || stored && (!Number.isSafeInteger(value.revision) || value.revision < 0 || !Number.isSafeInteger(value.offRevision) || value.offRevision < 0 || value.offRevision > value.revision))
    throw new Error('Choose Reasoning notes on or off and a 10, 30 or 60 second interval.');
  return value;
}
