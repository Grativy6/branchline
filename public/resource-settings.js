// One shared definition for the controls and their server-side bounds.
export const RESOURCE_DEFAULTS = Object.freeze({ replyTokens: null, inputCharacters: 60000, fileBytes: 131072,
  toolCalls: 32, toolResultBytes: 160000, replySeconds: 300, handoffSeconds: 300 });
export const RESOURCE_FIELDS = Object.freeze({
  replyTokens: { label: 'Maximum reply tokens', min: 128, max: 32768, step: 128, help: 'Leave blank for the connection default. Codex does not expose a hard reply-token cap.' },
  inputCharacters: { label: 'Working input ceiling (characters)', min: 4000, max: 500000, step: 1000, help: 'An estimate, further limited by the loaded model window. Larger inputs need more memory.' },
  fileBytes: { label: 'Text intake (bytes)', min: 131072, max: 1048576, step: 131072, help: 'Exact UTF-8 snapshots. Large sources are read in bounded passages, not inserted whole.' },
  toolCalls: { label: 'Tool calls per reply', min: 1, max: 128, step: 1, help: 'Includes document pages. More calls can take longer and use more provider capacity.' },
  toolResultBytes: { label: 'Tool evidence per reply (bytes)', min: 20000, max: 1048576, step: 10000, help: 'A ceiling, not a promise that it fits the model window. Reading can resume in a later reply.' },
  replySeconds: { label: 'Reply timeout (seconds)', min: 30, max: 1800, step: 30, help: 'Stop is always available. This does not change a provider’s own deadline.' },
  handoffSeconds: { label: 'Handoff timeout (seconds)', min: 30, max: 1800, step: 30, help: 'A stopped or incomplete preparation never replaces the active account.' },
});
export function resourceSettings(root) { return { ...RESOURCE_DEFAULTS, ...root?.resources }; }
export function checkResources(value) {
  if (!value || Array.isArray(value) || Object.keys(value).sort().join() !== Object.keys(RESOURCE_DEFAULTS).sort().join()) throw new Error('Choose only the supported resource controls.');
  for (const [key, spec] of Object.entries(RESOURCE_FIELDS)) {
    const n = value[key];
    if (key === 'replyTokens' && n === null) continue;
    if (!Number.isSafeInteger(n) || n < spec.min || n > spec.max) throw new Error(`${spec.label} must be between ${spec.min} and ${spec.max}.`);
  }
  return value;
}
export const CARRY_DEFAULTS = Object.freeze({ automatic: false, speaker: 'personal', review: false, nearPopup: false, showCount: true });
export const isRecorderChoice = value => typeof value === 'string' && (['personal', 'visiting'].includes(value) || /^model:[A-Za-z0-9_-]{1,120}$/.test(value));
export function carrySettings(chat) { return { ...CARRY_DEFAULTS, ...chat?.carrySettings }; }
export function checkCarrySettings(value) {
  if (!value || Object.keys(value).sort().join() !== Object.keys(CARRY_DEFAULTS).sort().join()
    || !isRecorderChoice(value.speaker)
    || ['automatic','review','nearPopup','showCount'].some(k => typeof value[k] !== 'boolean')) throw new Error('Invalid conversation settings.');
  return value;
}
