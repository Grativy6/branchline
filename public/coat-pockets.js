// Preferences only. The server resolves these against the current turn controls.
export const POCKET_PROFILE = 'branchline.coat-pockets/1';
export const BUILTIN_PROVIDER = 'branchline.builtin/1';
export const POCKET_TOOLS = Object.freeze([
  {tool:'nav_read',label:'Navigate shelves',help:'Read selected README, MAP, TEMP and journal passages with the Nav setting.',default:false},
  {tool:'nav_journal',label:'Keep an episode journal',help:'Begin, append, resume and close one journal at its starting shelf.',default:false},
  {tool:'nav_update',label:'Maintain navigation',help:'Exact edits to current navigation files, with recovery copies.',default:false},
  {tool:'write_work_artifact',label:'Create a work draft',help:'Save text, Markdown, HTML, SVG or CSV output here for review.',default:false},
  {tool:'read_work_output',label:'Read saved work output',help:'Reopen results and drafts from this conversation.',default:false},
  {tool:'make_picture',label:'Make a picture draft',help:'Uses the chosen picture provider and edit region. Separate API billing.',default:false},
  {tool:'describe_picture',label:'Ask a vision helper',help:'Sends one selected picture to the chosen vision provider.',default:false},
  {tool:'run_program',label:'Run an approved command',help:'Only saved commands approved in Work tools. Runs with Windows account access.',default:false},
  {tool:'use_window',label:'Use selected window',help:'Read/capture its content; native buttons and text fields need separate control approval.',default:false},
  {tool:'use_browser',label:'Use work browser',help:'A clean browser context on the selected websites.',default:false},
  {tool:'come_home',label:'Read Home orientation',help:'The selected read-only Home sources.',default:false},
  {tool:'find_context',label:'Find Home context',help:'Search selected shelves with source handles.',default:false},
  {tool:'read_source',label:'Read a Home source',help:'Exact passages inside selected Home locations.',default:false},
  { tool: 'find_personal_source', label: 'Find personal sources', help: 'Search only the personal continuity profile attached to this chair.', default: false },
  { tool: 'read_personal_source', label: 'Reopen personal sources', help: 'Read an exact source snapshot in this reply’s selected profile.', default: false },
  { tool: 'propose_personal_note', label: 'Propose continuity notes', help: 'Suggest an account for your review. This cannot accept or activate a note.', default: false },
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
