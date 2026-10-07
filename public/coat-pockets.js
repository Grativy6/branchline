// Preferences only. The server resolves these against the current turn controls.
export const POCKET_PROFILE = 'branchline.coat-pockets/1';
export const BUILTIN_PROVIDER = 'branchline.builtin/1';
export const POCKET_TOOLS = Object.freeze([
  { tool: 'list_pc_files', label: 'List permitted folders', help: 'Only folders and connections enabled in Agents → Agent PC access.', default: false },
  { tool: 'read_pc_text', label: 'Read PC text files', help: 'Bounded UTF-8 pages; exclusions always apply.', default: false },
  { tool: 'search_pc_text', label: 'Find text in a PC file', help: 'Literal search inside one permitted text file.', default: false },
  { tool: 'create_pc_text', label: 'Create PC text files', help: 'Create new files in writable folders. Existing files are not replaced.', default: false },
  { tool: 'edit_pc_text', label: 'Edit PC text files', help: 'Exact-base edits with protected recovery copies. No delete or move.', default: false },
  { tool: 'read_clock', label: 'Read the clock', help: 'Date, time and timezone from this computer.' },
  { tool: 'read_capacity', label: 'Inspect working capacity', help: 'Read current context estimates and remaining source-reading allowance.', default: false },
  { tool: 'read_sketch_book', label: 'Read Sketch Book', help: 'Find and read sketches across desks, with this model’s separate library permission.', default: false },
  { tool: 'write_sketch', label: 'Create/edit sketches', help: 'Save sketches from this chat when editing permission is enabled. No deletion or task execution.', default: false },
  { tool: 'run_calculation', label: 'Calculate', help: 'Small calculations without files or network access.' },
  { tool: 'ask_user', label: 'Ask a question', help: 'Offer a question with choices you can answer or skip.' },
  { tool: 'read_selected_document', label: 'Read attached text', help: 'Reopen text already selected for this conversation.' },
  { tool: 'read_chat_source', label: 'Reopen chat sources', help: 'Read earlier messages and their evidence in this branch.' },
  { tool: 'fetch_public_page', label: 'Read a public page', help: 'Ask you to approve the exact URL before connecting.' },
].map(Object.freeze));
export const ordinaryToolNames = () => POCKET_TOOLS.filter(p => p.default !== false).map(p => p.tool);
export const defaultPockets = () => ({ profile: POCKET_PROFILE, selected: POCKET_TOOLS.filter(p => p.default !== false).map(p => ({ tool: p.tool, provider: BUILTIN_PROVIDER })) });
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const identifier = v => typeof v === 'string' && /^[a-z][a-z0-9._-]{0,79}(?:\/[1-9][0-9]{0,3})?$/.test(v);
export function checkPockets(pockets) {
  if (!exact(pockets, ['profile', 'selected']) || pockets.profile !== POCKET_PROFILE || !Array.isArray(pockets.selected) || pockets.selected.length > 32)
    throw new Error('Use a supported Coat pocket list with at most 32 tools.');
  const seen = new Set();
  for (const p of pockets.selected) {
    if (!exact(p, ['tool', 'provider']) || !identifier(p.tool) || !identifier(p.provider) || seen.has(p.tool))
      throw new Error('Each pocket needs one tool identifier and one provider identifier, with no duplicate tools or connection secrets.');
    seen.add(p.tool);
  }
  return pockets;
}
export const availablePocket = p => p.provider === BUILTIN_PROVIDER && POCKET_TOOLS.some(t => t.tool === p.tool);
export const selectedPockets = preset => preset.pockets === undefined ? defaultPockets().selected : preset.pockets.selected;
export const pocketLabel = p => POCKET_TOOLS.find(t => t.tool === p.tool)?.label ?? p.tool;
export const pocketContent = content => Object.hasOwn(content, 'pockets') ? { pockets: structuredClone(content.pockets) } : {};
