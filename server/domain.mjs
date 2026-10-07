import { applyArchiveCommand, validateModelArchives, assertModelAvailable } from './model-archives.mjs';
import { isModelArchived } from '../public/model-archives.js';
import { visiblePersonalModels } from '../public/dream-records.js';
import crypto from 'node:crypto';
import { applyDreamCommand, validateDreamHistory } from './dream-history.mjs';
import { digest } from './integrity.mjs';
import { checkResources, checkCarrySettings } from '../public/resource-settings.js';
import { resolveRecorder } from './carry-recorder.mjs';
import { validSettingsSize } from '../public/settings-size.js';
import { validToyShelf } from '../public/toy-shelf.js';
import { validateCoatDraft } from '../public/coat-draft.js';
import { checkSketchDraft } from '../public/sketch-format.js';
import { validateSketchBook, applySketchCommand, transferSketch } from './sketches.mjs';
import { validatePc } from './pc-permissions.mjs';
import { applyImageConnection, validateImageConnection } from './image-provider.mjs';
import { assertBundledProfile } from './bundled-profile.mjs';
import { validateImages } from './images.mjs';
import { validateReplyMetrics } from './reply-metrics.mjs';
import { messageInfoKeys } from '../public/message-info.js';
import { validateParallel, applyAgentSettings } from './parallel-state.mjs';
import { hearthDisplay } from './hearth-state.mjs';
import { validateCarry, applyCarryCommand } from './context-carry.mjs';
import { CODEX_ADDRESS } from './codex-policy.mjs';
import { validateSelectedFiles } from './selected-file.mjs';
import { validateHandoffs } from './handoff.mjs';
import { validateReplyProvenance } from './reply-provenance.mjs';
import { validateTables, applyTableCommand, assertInferenceIdle, assertReplyAvailable, currentAssignment, resolveSpeaker } from './table.mjs';
import { validateMind, applyMindCommand } from './mind.mjs';
import { isResponseMode, responseModeFor } from './response-mode.mjs';
import { validateLoopback } from './model.mjs';
import { MODEL_INPUT_FORMATS } from './model-format.mjs';
import { validateHarnesses, applyHarnessCommand, inheritHarness, harnessSnapshot, migrateCoats } from './harnesses.mjs';
import { validateAgentProfiles, applyAgentProfileCommand, agentProfileSnapshot } from './agent-profiles.mjs';
import { validateContinuity, applyContinuityCommand, continuityPending, captureContinuityContext } from './continuity.mjs';

const MODES = new Set(['personal', 'fs']);
const EXCHANGE_STATUSES = new Set(['pending', 'completed', 'failed', 'cancelled']);
const ROLES = new Set(['user', 'assistant']);
const REPLY_LENGTHS = new Set(['short', 'medium', 'long']);
const MODEL_RUNTIMES = new Set(['compatible', 'lmstudio', 'codex', 'bundled']);
function validateModelRoute(model) {
  if (model.runtime === 'bundled') return assertBundledProfile(model);
  if (model.runtime !== 'codex') return validateLoopback(model.baseUrl);
  if (model.baseUrl !== CODEX_ADDRESS || model.thinking === true || (model.inputFormat && model.inputFormat !== 'chat')) throw new Error('Codex uses the fixed ChatGPT subscription connection.');
}

export const now = () => new Date().toISOString();
export const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
export function clone(value) {
  return structuredClone(value);
}

export function initialState() {
  return { schemaVersion: 1, roots: [], chats: [], messages: [], exchanges: [], models: [], drafts: {}, mcpBindings: [], mcpResults: [], mcpContext: {}, ui: { mode: 'personal', selected: { personal: { rootId: null, chatId: null }, fs: { rootId: null, chatId: null } }, sidebarCollapsed: false } };
}

export function ensureId(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(value)) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}
export function ensureText(value, label, max = 200000) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`invalid ${label}`);
  return value;
}
// Only this bounded leaf changes. Store can retain the already validated graph.
export function updateDraft(state, payload) {
  const chat = requireChat(state, payload.chatId), root = requireRoot(state, chat.rootId);
  if (root.archivedAt || chat.archivedAt) throw new Error('chat archived');
  const text = ensureText(payload.text, 'text', 200000);
  return { ...state, drafts: { ...state.drafts, [chat.id]: text } };
}
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const assertTimestamp = (value, label) => assert(typeof value === 'string' && !Number.isNaN(Date.parse(value)), `invalid ${label}`);
function validateMessageInfo(value) {
  assert(isObject(value) && Object.keys(value).length === messageInfoKeys.length
    && messageInfoKeys.every(key => typeof value[key] === 'boolean'), 'invalid message info settings');
}

function assertUniqueIds(items, label) {
  assert(Array.isArray(items), `${label} must be an array`); const seen = new Set();
  for (const item of items) { assert(isObject(item), `invalid ${label} entry`); ensureId(item.id, `${label} id`); assert(!seen.has(item.id), `duplicate ${label} id`); seen.add(item.id); }
}

export function validateState(state) {
  assert(isObject(state) && state.schemaVersion === 1, 'malformed state');
  for (const root of state.roots || []) if (root.resources !== undefined) checkResources(root.resources);
  for (const chat of state.chats || []) { if (chat.carrySettings !== undefined) checkCarrySettings(chat.carrySettings);
    if (chat.carryWriter !== undefined && chat.carryWriter !== null) assert(/^[a-f0-9]{64}$/.test(chat.carryWriter), 'invalid recorder binding'); }
  for (const name of ['roots', 'chats', 'messages', 'exchanges', 'models']) {
    assertUniqueIds(state[name], name);
  }
  validateImages(state);
  validateSketchBook(state);
  validatePc(state);
  validateImageConnection(state);
  assert(isObject(state.drafts), 'drafts must be an object');
  assert(isObject(state.ui), 'ui must be an object');
  assert(MODES.has(state.ui.mode) && typeof state.ui.sidebarCollapsed === 'boolean', 'invalid ui state');
  assert(isObject(state.ui.selected), 'invalid ui selection');
  if (state.ui.coatChangeWarning !== undefined) assert(typeof state.ui.coatChangeWarning === 'boolean', 'invalid Coat-change warning preference');
  if (state.ui.settingsSize !== undefined) assert(validSettingsSize(state.ui.settingsSize), 'invalid Settings size');
  if (state.ui.dreamSize !== undefined) assert(validSettingsSize(state.ui.dreamSize), 'invalid Dream review size');
  if (state.ui.dreamDraft !== undefined && state.ui.dreamDraft !== null) {
    const d = state.ui.dreamDraft;
    assert(isObject(d) && Object.keys(d).sort().join() === 'baseNoteId,dreamId,personalId,text' && typeof d.text === 'string' && d.text.length <= 64000
      && state.personalParticipants?.some(p=>p.id===d.personalId) && state.dreamHistory?.records.some(r=>r.id===d.dreamId&&r.personalId===d.personalId)
      && (d.baseNoteId===null || state.dreamHistory.notes.some(n=>n.id===d.baseNoteId&&n.dreamId===d.dreamId)), 'Invalid Dream note draft');
  }
  if (state.ui.sketchSize !== undefined) assert(validSettingsSize(state.ui.sketchSize), 'invalid Sketch Book size');
  if (state.ui.toyShelf !== undefined) assert(validToyShelf(state.ui.toyShelf), 'invalid Toy Shelf preferences');
  if (state.ui.coatDraft !== undefined) validateCoatDraft(state.ui.coatDraft);
  if (state.ui.messageInfo !== undefined) validateMessageInfo(state.ui.messageInfo);
  if (state.ui.appearance !== undefined) {
    assert(isObject(state.ui.appearance) && Object.keys(state.ui.appearance).every(key => ['theme', 'reading'].includes(key)), 'invalid appearance settings');
    assert(['garden', 'starlight', 'paper'].includes(state.ui.appearance.theme) && ['standard', 'relaxed', 'large'].includes(state.ui.appearance.reading), 'unknown appearance choice');
  }
  const roots = new Map(state.roots.map(r => [r.id, r]));
  const chats = new Map(state.chats.map(c => [c.id, c]));
  const exchanges = new Map(state.exchanges.map(e => [e.id, e]));
  const models = new Map(state.models.map(m => [m.id, m]));
  assert(Array.isArray(state.mcpBindings || []), 'mcpBindings must be an array');
  const bindingIds = new Set();
  for (const binding of state.mcpBindings || []) {
    assert(isObject(binding), 'invalid MCP binding'); ensureId(binding.id, 'MCP binding id'); assert(!bindingIds.has(binding.id), 'duplicate MCP binding id'); bindingIds.add(binding.id);
    ensureText(binding.label, 'MCP binding label', 200); assert(binding.label.trim(), 'MCP binding label required');
    assert(binding.profile === 'foundation' || binding.profile === 'hearthline', 'invalid MCP binding profile');
    assert(binding.rootId === null || roots.has(binding.rootId), 'MCP binding root ref missing');
    assert(binding.chatId === null || chats.has(binding.chatId), 'MCP binding chat ref missing');
    if (binding.chatId) assert(chats.get(binding.chatId).rootId === binding.rootId, 'MCP binding chat/root mismatch');
    assert(typeof binding.command === 'string' && /^[A-Za-z0-9._: \\/-]{1,300}$/.test(binding.command), 'invalid MCP binding command');
    assert(Array.isArray(binding.args) && binding.args.every(arg => typeof arg === 'string' && arg.length <= 1000), 'invalid MCP binding args');
    assert(binding.cwd === null || (typeof binding.cwd === 'string' && binding.cwd.length <= 500 && !/[\r\n]/.test(binding.cwd)), 'invalid MCP binding cwd');
    const bindingEnv = binding.env ?? {}; assert(bindingEnv && typeof bindingEnv === 'object' && !Array.isArray(bindingEnv), 'invalid MCP binding env'); for (const [key, value] of Object.entries(bindingEnv)) { assert(/^(HEARTHLINE_|PYTHON)/.test(key) && /^[A-Z][A-Z0-9_]{0,63}$/.test(key), 'invalid MCP binding env key'); assert(typeof value === 'string' && value.length <= 1000 && !/[\r\n]/.test(value), 'invalid MCP binding env value'); }
    assert(typeof binding.enabled === 'boolean', 'invalid MCP binding enabled');
  }
  assert(Array.isArray(state.mcpResults || []), 'mcpResults must be an array');
  for (const result of state.mcpResults || []) {
    ensureId(result.id, 'MCP result id'); ensureId(result.bindingId, 'MCP result binding id'); ensureId(result.rootId, 'MCP result root id'); ensureId(result.chatId, 'MCP result chat id'); ensureText(result.tool, 'MCP result tool', 200); ensureText(result.profile, 'MCP result profile', 40); ensureText(result.payload, 'MCP result payload', 200000); assertTimestamp(result.observedAt, 'MCP result observedAt');
    assert(isObject(result.bindingSnapshot), 'MCP result binding snapshot missing'); ensureId(result.bindingSnapshot.id, 'MCP snapshot id'); ensureText(result.bindingSnapshot.label, 'MCP snapshot label', 200); assert(result.bindingSnapshot.rootId === result.rootId && (result.bindingSnapshot.chatId === null || result.bindingSnapshot.chatId === result.chatId), 'MCP result binding snapshot scope mismatch');
    assert(isObject(result.scopeSnapshot) && result.scopeSnapshot.rootId === result.rootId && result.scopeSnapshot.chatId === result.chatId, 'MCP result scope snapshot missing'); ensureText(result.scopeSnapshot.workspaceId, 'MCP workspace id', 100); ensureText(result.scopeSnapshot.profile, 'MCP scope profile', 40); assert(result.scopeSnapshot.namespace === null || typeof result.scopeSnapshot.namespace === 'string', 'MCP namespace snapshot invalid');
  }
  assert(isObject(state.mcpContext || {}), 'mcpContext must be an object');
  for (const [chatId, resultIds] of Object.entries(state.mcpContext || {})) { ensureId(chatId, 'MCP context chat id'); assert(chats.has(chatId), 'MCP context chat ref missing'); assert(Array.isArray(resultIds), 'MCP context results must be an array'); for (const resultId of resultIds) { ensureId(resultId, 'MCP context result id'); const result = (state.mcpResults || []).find(item => item.id === resultId); assert(result && result.chatId === chatId, 'MCP context result scope missing'); } }
  for (const root of state.roots) {
    ensureText(root.name, 'root name', 200);
    assert(root.name.trim() && MODES.has(root.mode), 'invalid root');
    assert(root.workspaceKind === undefined || (root.workspaceKind === 'tend' && root.mode === 'personal'), 'invalid desk workspace kind');
    assertTimestamp(root.createdAt, 'root createdAt');
    assert(Array.isArray(root.instructions), 'instructions must be an array');
    const ids = new Set();
    for (const instruction of root.instructions) {
      assert(isObject(instruction), 'invalid instruction');
      ensureId(instruction.id, 'instruction id');
      assert(!ids.has(instruction.id), 'duplicate instruction id');
      ids.add(instruction.id); ensureText(instruction.text, 'instruction text', 20000);
      assertTimestamp(instruction.createdAt, 'instruction createdAt');
    }
    ensureText(root.notes, 'root notes', 30000);
    assert(root.modelId === null || models.has(root.modelId), 'root model ref missing');
    assert(root.replyLength === undefined || REPLY_LENGTHS.has(root.replyLength), 'invalid root replyLength');
    assert(root.archivedAt === null || typeof root.archivedAt === 'string', 'invalid root archivedAt');
  }
  for (const chat of state.chats) {
    assert(roots.has(chat.rootId), 'chat root ref missing'); ensureText(chat.title, 'chat title', 200);
    assert(chat.title.trim(), 'chat title required'); assertTimestamp(chat.createdAt, 'chat createdAt');
    assert(chat.archivedAt === null || typeof chat.archivedAt === 'string', 'invalid chat archivedAt');
    assert(chat.responseMode === undefined || (roots.get(chat.rootId).mode === 'personal' && isResponseMode(chat.responseMode)), 'invalid chat response mode');
  }
  for (const model of state.models) { ensureText(model.name, 'model name', 200); ensureText(model.model, 'model identifier', 200); ensureText(model.baseUrl, 'model baseUrl', 500); assert(model.name.trim() && model.model.trim() && model.baseUrl.trim(), 'model fields required'); validateModelRoute(model); assert(model.thinking === undefined || typeof model.thinking === 'boolean', 'invalid model thinking'); assert(model.runtime === undefined || MODEL_RUNTIMES.has(model.runtime), 'invalid model runtime'); }
  for (const model of state.models) assert(model.inputFormat === undefined || MODEL_INPUT_FORMATS.has(model.inputFormat), 'invalid model input format');
  for (const exchange of state.exchanges) {
    if (exchange.metrics !== undefined) {
      assert(exchange.status !== 'pending', 'pending reply cannot have final measurements');
      validateReplyMetrics(exchange.metrics);
    }
    assert(exchange.responseMode === undefined || exchange.responseMode === null || isResponseMode(exchange.responseMode), 'invalid recorded response mode');
    assert(chats.has(exchange.chatId), 'exchange chat ref missing'); ensureId(exchange.modelId, 'exchange modelId'); ensureText(exchange.modelIdentifier, 'exchange modelIdentifier', 200); ensureText(exchange.modelBaseUrl, 'exchange modelBaseUrl', 500); assert(exchange.modelIdentifier.trim() && exchange.modelBaseUrl.trim(), 'exchange runtime model fields required');
    if (exchange.status === 'pending') {
      assert(!state.exchanges.some(other => other !== exchange && other.chatId === exchange.chatId && other.status === 'pending'), 'multiple pending exchanges');
    }
    const exchangeRoot = roots.get(chats.get(exchange.chatId).rootId);
    if (exchange.instructionRevisionId !== null) assert(exchangeRoot.instructions.some(instruction => instruction.id === exchange.instructionRevisionId), 'exchange instruction ref missing');
    if (exchange.heartRevisionId !== undefined) {
      assert(exchange.heartRevisionId === null || (exchangeRoot.continuity?.heart || []).some(revision => revision.id === exchange.heartRevisionId), 'exchange heart ref missing');
    }
    if (exchange.memoryEntryIds !== undefined) {
      assert(Array.isArray(exchange.memoryEntryIds), 'exchange memory refs must be an array');
      for (const memoryId of exchange.memoryEntryIds) {
        assert((exchangeRoot.continuity?.journal || []).some(entry => entry.id === memoryId && entry.chatId === exchange.chatId), 'exchange memory ref missing');
      }
    }
    assert(EXCHANGE_STATUSES.has(exchange.status), 'invalid exchange status'); assertTimestamp(exchange.createdAt, 'exchange createdAt'); assert(exchange.instructionRevisionId === null || typeof exchange.instructionRevisionId === 'string', 'invalid instruction ref'); assert(exchange.error === null || typeof exchange.error === 'string', 'invalid exchange error'); assert(exchange.replyLength === undefined || REPLY_LENGTHS.has(exchange.replyLength), 'invalid exchange replyLength'); assert(exchange.thinking === undefined || typeof exchange.thinking === 'boolean', 'invalid exchange thinking'); assert(exchange.runtime === undefined || MODEL_RUNTIMES.has(exchange.runtime), 'invalid exchange runtime'); assert(exchange.finishReason === undefined || exchange.finishReason === null || typeof exchange.finishReason === 'string', 'invalid finishReason'); assert(exchange.truncated === undefined || typeof exchange.truncated === 'boolean', 'invalid truncated');
  }
  for (const message of state.messages) {
    assert(chats.has(message.chatId), 'message chat ref missing'); ensureId(message.id, 'message id'); assert(ROLES.has(message.role), 'invalid message role'); ensureText(message.content, 'message content', 200000); assertTimestamp(message.createdAt, 'message createdAt'); assert(['note', 'exchange', 'parallel'].includes(message.kind), 'invalid message kind');
    if (message.kind === 'parallel') {
      const job = state.parallel?.jobs.find(j => j.id === message.parallelEpisodeId);
      assert(job && job.chatId === message.chatId && message.role === 'assistant' && message.exchangeId === null && message.content === hearthDisplay(job)
        && message.modelId === job.model.id && message.modelLabel === job.model.name && message.modelIdentifier === job.model.model && message.modelBaseUrl === job.model.baseUrl, 'parallel contribution attribution mismatch');
    } else if (message.kind === 'exchange') {
      assert(message.exchangeId !== null && exchanges.has(message.exchangeId), 'message exchange ref missing');
      const exchange = exchanges.get(message.exchangeId);
      assert(exchange.chatId === message.chatId, 'message exchange chat mismatch');
      assert(message.modelId === exchange.modelId && message.modelLabel === exchange.modelLabel && message.modelIdentifier === exchange.modelIdentifier && message.modelBaseUrl === exchange.modelBaseUrl, 'message runtime attribution mismatch');
      assert(message.instructionRevisionId === exchange.instructionRevisionId, 'message instruction attribution mismatch');
    } else assert(message.exchangeId === null, 'note exchange ref must be null');
    assert(message.modelId === null || typeof message.modelId === 'string', 'invalid message modelId'); assert(message.modelLabel === null || typeof message.modelLabel === 'string', 'invalid message modelLabel'); assert(message.modelIdentifier === null || typeof message.modelIdentifier === 'string', 'invalid message modelIdentifier'); assert(message.modelBaseUrl === null || typeof message.modelBaseUrl === 'string', 'invalid message modelBaseUrl'); assert(message.instructionRevisionId === null || typeof message.instructionRevisionId === 'string', 'invalid message instruction ref');
  }
  for (const [chatId, text] of Object.entries(state.drafts)) { assert(chats.has(chatId), 'draft chat ref missing'); ensureText(text, 'draft text', 200000); }
  validateContinuity(state);
  validateHandoffs(state);
  validateReplyProvenance(state);
  for (const mode of MODES) {
    const selected = state.ui.selected[mode]; assert(isObject(selected), 'invalid selected mode');
    assert(selected.rootId === null || roots.has(selected.rootId), 'selected root ref missing');
    if (selected.rootId === null) { assert(selected.chatId === null, 'selected chat without root'); continue; }
    const root = roots.get(selected.rootId); assert(root.mode === mode && !root.archivedAt, 'invalid selected root');
    if (selected.chatId === null) {
      assert(!state.chats.some(chat => chat.rootId === root.id && !chat.archivedAt), 'selected root requires active chat');
      continue;
    }
    const chat = chats.get(selected.chatId); assert(chat && chat.rootId === root.id && !chat.archivedAt, 'invalid selected chat');
  }
  validateSelectedFiles(state);
  validateTables(state);
  validateDreamHistory(state);
  validateHarnesses(state);
  validateAgentProfiles(state);
  validateMind(state);
  validateModelArchives(state);
  validateCarry(state);
  validateParallel(state);
  return true;
}

export function publicState(state) { validateState(state); return clone(state); }
function requireRoot(state, rootId) { ensureId(rootId, 'rootId'); const root = state.roots.find(r => r.id === rootId); if (!root) throw new Error('root not found'); return root; }
function requireChat(state, chatId) { ensureId(chatId, 'chatId'); const chat = state.chats.find(c => c.id === chatId); if (!chat) throw new Error('chat not found'); return chat; }
export function rootFor(state, chatId) { const chat = state.chats.find(c => c.id === chatId); return chat && state.roots.find(r => r.id === chat.rootId); }
const rootHasPending = (state, rootId) => (state.parallel?.runs??[]).some(r=>r.rootId===rootId && ['queued','running'].includes(r.status)) || state.exchanges.some(e => e.status === 'pending' && rootFor(state, e.chatId)?.id === rootId) || continuityPending(state.roots.find(root => root.id === rootId)) || (state.contextCarry?.jobs || []).some(j => j.status === 'pending' && rootFor(state, j.chatId)?.id === rootId);
function selectRoot(state, root) { const chat = state.chats.find(c => c.rootId === root.id && !c.archivedAt); state.ui.mode = root.mode; state.ui.selected[root.mode] = { rootId: root.id, chatId: chat?.id ?? null }; }
function selectFallback(state, mode, preferredRootId = null) {
  const preferred = preferredRootId && state.roots.find(root => root.id === preferredRootId && root.mode === mode && !root.archivedAt);
  const root = preferred ?? state.roots.find(candidate => candidate.mode === mode && !candidate.archivedAt);
  const chat = root && state.chats.find(candidate => candidate.rootId === root.id && !candidate.archivedAt);
  state.ui.selected[mode] = { rootId: root?.id ?? null, chatId: chat?.id ?? null };
}

export function applyCommand(state, command) {
  const s = clone(state);
  validateState(s);
  const type = command?.type;
  const p = command?.payload ?? {};
  if (typeof type !== 'string') throw new Error('command type required');
  if (type.startsWith('modelArchive.')) { assertInferenceIdle(s); applyArchiveCommand(s,type,p); validateState(s); return s; }
  if (type.startsWith('dream.')) {
    if (type !== 'dream.note') assertInferenceIdle(s);
    applyDreamCommand(s,type,p);validateState(s);return s;
  }
  if (type === 'sketch.transfer') {
    transferSketch(s,p,(rootId,title)=>{
      Object.assign(s,applyCommand(s,{type:'chat.create',payload:{rootId,title,setupChairs:true}}));
      return s.chats.at(-1);
    });
    validateState(s);return s;
  }
  if (type.startsWith('sketch.')) { applySketchCommand(s,type,p);validateState(s);return s; }
  if (type === 'root.resources') {
    assertInferenceIdle(s);
    assert(Object.keys(p).sort().join() === 'id,resources', 'invalid resource settings');
    requireRoot(s, p.id).resources = clone(checkResources(p.resources));
    validateState(s); return s;
  }
  if (type === 'chat.carrySettings') {
    assertInferenceIdle(s);
    assert(Object.keys(p).sort().join() === 'id,settings', 'invalid conversation settings');
    const chat = requireChat(s, p.id);
    chat.carrySettings = clone(checkCarrySettings(p.settings));
    chat.carryWriter = p.settings.automatic ? digest(resolveRecorder(s, p.id, p.settings.speaker).model) : null;
    validateState(s); return s;
  }
  if (type === 'parallel.settings') { applyAgentSettings(s, p); validateState(s); return s; }
  if (type.startsWith('image-provider.')) { applyImageConnection(s, type, p); validateState(s); return s; }
  if (type.startsWith('carry.')) { applyCarryCommand(s, type, p); validateState(s); return s; }
  if (type.startsWith('harness.')) { applyHarnessCommand(s, type, p); validateState(s); return s; }
  if (type.startsWith('profile.')) { applyAgentProfileCommand(s, type, p); validateState(s); return s; }
  if (type.startsWith('mind.')) { applyMindCommand(s, type, p); validateState(s); return s; }
  if (type.startsWith('table.') || type.startsWith('personal.')) { applyTableCommand(s, type, p); validateState(s); return s; }
  if (type === 'heart.save' || type === 'journal.remove' || type.startsWith('continuity.')) { applyContinuityCommand(s, type, p); validateState(s); return s; }
  if (type === 'root.create') {
    const name = ensureText(p.name, 'name', 200).trim();
    if (!name) throw new Error('name required');
    if (p.mode !== 'personal' || p.workspaceKind !== undefined) throw new Error('Only ordinary desks can be created. Retired desk types remain readable in existing history.');
    const timestamp = now();
    const root = { id: id('root'), name, mode: p.mode, createdAt: timestamp, instructions: [], notes: '', modelId: null, archivedAt: null };
    const chat = { id: id('chat'), rootId: root.id, title: name, createdAt: timestamp, archivedAt: null };
    chat.coatPolicy=2; chat.coatChoices=[];
    if (p.setupChairs === true) chat.table = { assignments: [{ id: id('seats'), createdAt: timestamp, personalId: visiblePersonalModels(s).at(-1)?.id ?? null, visitorModelId: null }] };
    s.roots.push(root);
    s.chats.push(chat);
    selectRoot(s, root);
    return s;
  }
  if (type === 'root.update') {
    const root = requireRoot(s, p.id);
    if (rootHasPending(s, root.id)) throw new Error('root locked during exchange');
    if (root.archivedAt && (p.notes !== undefined || p.instructions !== undefined)) throw new Error('archived root cannot receive updates');
    if (p.name !== undefined) {
      const name = ensureText(p.name, 'name', 200).trim();
      if (!name) throw new Error('name required');
      root.name = name;
    }
    if (p.notes !== undefined) root.notes = ensureText(p.notes, 'notes', 30000);
    if (p.instructions !== undefined) {
      const text = ensureText(p.instructions, 'instructions', 20000);
      if (root.instructions.at(-1)?.text !== text) root.instructions.push({ id: id('instruction'), text, createdAt: now() });
    }
    return s;
  }
  if (type === 'root.archive') {
    const root = requireRoot(s, p.id);
    if (rootHasPending(s, root.id)) throw new Error('root locked during exchange');
    if (typeof p.archived !== 'boolean') throw new Error('archived must be boolean');
    root.archivedAt = p.archived ? now() : null;
    if (p.archived && s.ui.selected[root.mode].rootId === root.id) selectFallback(s, root.mode);
    return s;
  }
  if (type === 'root.model') {
    const root = requireRoot(s, p.id);
    if (rootHasPending(s, root.id)) throw new Error('root locked during exchange');
    if (p.modelId !== null) {
      ensureId(p.modelId, 'modelId');
      assertModelAvailable(s,p.modelId);
    }
    root.modelId = p.modelId;
    return s;
  }
  if (type === 'root.replyLength') {
    throw new Error('Reply length presets were retired. Use Resources to choose a supported token maximum or the connection default.');
  }
  if (type === 'chat.create') {
    const root = requireRoot(s, p.rootId);
    if (root.archivedAt) throw new Error('root archived');
    const title = ensureText(p.title ?? 'New chat', 'title', 200).trim() || 'New chat';
    const chat = { id: id('chat'), rootId: root.id, title, createdAt: now(), archivedAt: null };
    chat.coatPolicy=2; chat.coatChoices=[];
    inheritHarness(root, chat);
    if (p.setupChairs === true) chat.table = { assignments: [{ id: id('seats'), createdAt: now(), personalId: visiblePersonalModels(s).at(-1)?.id ?? null, visitorModelId: null }] };
    s.chats.push(chat);
    s.ui.selected[root.mode] = { rootId: root.id, chatId: chat.id };
    return s;
  }
  if (type === 'chat.responseMode') {
    assert(Object.keys(p).every(key => ['id', 'responseMode'].includes(key)), 'response mode cannot carry other settings or grants');
    const chat = requireChat(s, p.id);
    const root = requireRoot(s, chat.rootId);
    // A running reply and queued task already hold their captured instructions.
    // Only the branch's next reply changes; stale follow-up checks still apply.
    if (root.archivedAt || chat.archivedAt) throw new Error('chat archived');
    if (root.mode !== 'personal') throw new Error('Finis Solutus uses its own DM instructions.');
    if (!isResponseMode(p.responseMode)) throw new Error('Choose Play, Create or Work.');
    chat.responseMode = p.responseMode;
    return s;
  }
  if (type === 'chat.update') {
    const chat = requireChat(s, p.id);
    const root = requireRoot(s, chat.rootId);
    if (rootHasPending(s, root.id)) throw new Error('chat locked during exchange');
    if (p.title !== undefined) chat.title = ensureText(p.title, 'title', 200).trim() || 'Untitled';
    if (p.archived !== undefined) {
      if (typeof p.archived !== 'boolean') throw new Error('archived must be boolean');
      if(!p.archived && root.archivedAt) throw new Error('Restore the parent desk first. Other archived branches will remain archived.');
      chat.archivedAt = p.archived ? now() : null;
      if (p.archived && s.ui.selected[root.mode].chatId === chat.id || !p.archived && s.ui.selected[root.mode].rootId===root.id && !s.ui.selected[root.mode].chatId) selectFallback(s, root.mode, root.id);
    }
    return s;
  }
  if (type === 'draft.save' || type === 'message.note') {
    const chat = requireChat(s, p.chatId);
    const root = requireRoot(s, chat.rootId);
    if (root.archivedAt || chat.archivedAt) throw new Error('chat archived');
    if (type === 'draft.save') return updateDraft(s, p);
    else {
      const content = ensureText(p.content, 'content', 200000);
      if (!content.trim()) throw new Error('content required');
      if (s.exchanges.some(exchange => exchange.chatId === chat.id && exchange.status === 'pending')) throw new Error('chat locked during exchange');
      s.messages.push({
        id: id('message'), chatId: chat.id, role: 'user', content, createdAt: now(),
        exchangeId: null, modelId: null, modelIdentifier: null, modelBaseUrl: null,
        modelLabel: null, instructionRevisionId: null, kind: 'note',
      });
      if (s.drafts[chat.id]?.trim() === content.trim()) delete s.drafts[chat.id];
    }
    return s;
  }
  if (type === 'model.save') {
    if (p.thinking !== undefined && typeof p.thinking !== 'boolean') throw new Error('invalid model thinking');
    if (p.runtime !== undefined && !MODEL_RUNTIMES.has(p.runtime)) throw new Error('invalid model runtime');
    if (p.inputFormat !== undefined && !MODEL_INPUT_FORMATS.has(p.inputFormat)) throw new Error('invalid model input format');
    const name = ensureText(p.name, 'name', 200).trim();
    const identifier = ensureText(p.model, 'model', 200).trim();
    const baseUrl = ensureText(p.baseUrl, 'baseUrl', 500).trim();
    if (!name || !identifier || !baseUrl) throw new Error('model fields required');
    const existing = p.id ? s.models.find(m => m.id === p.id) : null;
    if(existing && (existing.model!==identifier || existing.baseUrl!==baseUrl) && (s.coatUsuals??[]).some(r=>r.key==='model:'+existing.id) && p.coatRetarget!=='keep') throw new Error('This connection has a usual Coat. Explicitly keep it, or save a separate connection for the new model.');
    if (existing && isModelArchived(s,existing.id)) throw new Error('Return this archived connection to the active list before editing it.');
    if (existing && (existing.runtime === 'bundled') !== ((p.runtime ?? existing.runtime) === 'bundled')) throw new Error('Save a separate connection when changing the included model.');
    validateModelRoute({ ...existing, ...p, baseUrl, runtime: p.runtime ?? existing?.runtime });
    if (existing && (existing.runtime === 'codex') !== (p.runtime === 'codex' || (!p.runtime && existing.runtime === 'codex'))) throw new Error('Save a separate connection when changing between local and subscription models.');
    if (p.id && (s.exchanges.some(e => e.status === 'pending' && e.modelId === p.id) || s.roots.some(root => root.continuity?.jobs?.some(job => job.status === 'pending' && job.modelId === p.id)))) throw new Error('model locked during active work');
    let model = p.id ? s.models.find(m => m.id === p.id) : null;
    if (p.id && !model) throw new Error('model not found');
    if (!model) {
      model = { id: id('model'), name, model: identifier, baseUrl, thinking: p.thinking === true, runtime: p.runtime ?? 'compatible', inputFormat: p.inputFormat ?? 'chat' };
      s.models.push(model);
    } else Object.assign(model, { name, model: identifier, baseUrl, thinking: p.thinking === undefined ? (model.thinking ?? false) : p.thinking === true, runtime: p.runtime ?? model.runtime ?? 'compatible', inputFormat: p.inputFormat ?? model.inputFormat ?? 'chat' });
    return s;
  }
  if (type === 'model.delete') {
    if (s.modelArchives?.some(r=>r.modelId===p.id)) throw new Error('Keep this saved connection for its archive history. Archive it to hide it from active use.');
    ensureId(p.id, 'id');
    if (!s.models.some(m => m.id === p.id)) throw new Error('model not found');
    if ((s.personalParticipants || []).some(personal => personal.connections.at(-1).modelId === p.id) || s.chats.some(chat => currentAssignment(s, chat.id)?.visitorModelId === p.id)) throw new Error('This model occupies a chair. Change its assignment before removing the connection.');
    if (s.exchanges.some(e => e.status === 'pending' && e.modelId === p.id) || s.roots.some(root => root.continuity?.jobs?.some(job => job.status === 'pending' && job.modelId === p.id))) throw new Error('model locked during active work');
    for (const root of s.roots) if (root.modelId === p.id) root.modelId = null;
    s.models = s.models.filter(m => m.id !== p.id);
    return s;
  }
  if (type === 'ui.update') {
    if (p.dreamSize !== undefined) { assert(validSettingsSize(p.dreamSize), 'Invalid Dream review size'); s.ui.dreamSize = clone(p.dreamSize); }
    if (p.dreamDraft !== undefined) s.ui.dreamDraft = clone(p.dreamDraft);
    if (p.toyShelf !== undefined) { assert(validToyShelf(p.toyShelf), 'Invalid Toy Shelf preferences'); s.ui.toyShelf = clone(p.toyShelf); }
    if (p.sketchDraft !== undefined) { checkSketchDraft(p.sketchDraft); s.ui.sketchDraft = clone(p.sketchDraft); }
    if (p.sketchSize !== undefined) { assert(validSettingsSize(p.sketchSize), 'Invalid Sketch Book size'); s.ui.sketchSize = clone(p.sketchSize); }
    if (p.coatDraft !== undefined) { validateCoatDraft(p.coatDraft); s.ui.coatDraft = clone(p.coatDraft); }
    if (p.settingsSize !== undefined) { assert(validSettingsSize(p.settingsSize), 'Invalid Settings size'); s.ui.settingsSize = clone(p.settingsSize); }
    if (p.coatChangeWarning !== undefined) {
      assert(typeof p.coatChangeWarning === 'boolean', 'invalid Coat-change warning preference');
      s.ui.coatChangeWarning = p.coatChangeWarning;
    }
    if(p.foldedDesks!==undefined) { assert(isObject(p.foldedDesks) && Object.entries(p.foldedDesks).every(([id,v])=>s.roots.some(r=>r.id===id)&&typeof v==='boolean'),'Invalid desk folding'); s.ui.foldedDesks={...p.foldedDesks}; }
    if (p.welcomeTour !== undefined) {
      assert(isObject(p.welcomeTour) && Object.keys(p.welcomeTour).sort().join() === 'completedAt,skipped,version' && p.welcomeTour.version === 1 && typeof p.welcomeTour.skipped === 'boolean', 'invalid welcome tour state');
      assertTimestamp(p.welcomeTour.completedAt, 'tour completion'); s.ui.welcomeTour = clone(p.welcomeTour);
    }
    if (p.messageInfo !== undefined) {
      validateMessageInfo(p.messageInfo);
      s.ui.messageInfo = Object.fromEntries(messageInfoKeys.map(key => [key, p.messageInfo[key]]));
    }
    if (p.appearance !== undefined) {
      assert(isObject(p.appearance) && Object.keys(p.appearance).every(key => ['theme', 'reading'].includes(key)), 'invalid appearance settings');
      assert(['garden', 'starlight', 'paper'].includes(p.appearance.theme) && ['standard', 'relaxed', 'large'].includes(p.appearance.reading), 'unknown appearance choice');
      s.ui.appearance = { theme: p.appearance.theme, reading: p.appearance.reading };
    }
    if (p.mode !== undefined) {
      if (!MODES.has(p.mode)) throw new Error('invalid mode');
      s.ui.mode = p.mode;
    }
    if (p.selected) {
      for (const mode of MODES) {
        if (p.selected[mode] === undefined) continue;
        const selection = p.selected[mode];
        assert(isObject(selection), 'invalid selection');
        s.ui.selected[mode] = { rootId: selection.rootId ?? null, chatId: selection.chatId ?? null };
      }
    }
    if (p.sidebarCollapsed !== undefined) {
      if (typeof p.sidebarCollapsed !== 'boolean') throw new Error('invalid sidebarCollapsed');
      s.ui.sidebarCollapsed = p.sidebarCollapsed;
    }
    validateState(s);
    return s;
  }
  if (type === 'mcp.binding.save') {
    const label = ensureText(p.label, 'label', 200).trim(); if (!label) throw new Error('label required');
    if (!['foundation', 'hearthline'].includes(p.profile)) throw new Error('invalid MCP binding profile');
    const rootId = p.rootId ?? null; const chatId = p.chatId ?? null;
    if (rootId !== null) requireRoot(s, rootId);
    if (chatId !== null) { const chat = requireChat(s, chatId); if (chat.rootId !== rootId) throw new Error('MCP binding chat/root mismatch'); }
    if (typeof p.command !== 'string' || !/^[A-Za-z0-9._: \\/-]{1,300}$/.test(p.command)) throw new Error('binding command must be an executable name or path');
    if (!Array.isArray(p.args) || p.args.some(arg => typeof arg !== 'string' || arg.length > 1000)) throw new Error('binding args must be strings');
    const cwd = p.cwd ?? null; if (cwd !== null && (typeof cwd !== 'string' || cwd.length > 500 || /[\r\n]/.test(cwd))) throw new Error('invalid MCP binding cwd');
    const env = p.env ?? {}; if (!env || typeof env !== 'object' || Array.isArray(env)) throw new Error('invalid MCP binding env'); for (const [key, value] of Object.entries(env)) if (!/^(HEARTHLINE_|PYTHON)/.test(key) || !/^[A-Z][A-Z0-9_]{0,63}$/.test(key) || typeof value !== 'string' || value.length > 1000 || /[\r\n]/.test(value)) throw new Error('only bounded HEARTHLINE_/PYTHON env settings are accepted');
    const binding = { id: p.id || id('mcp'), label, profile: p.profile, rootId, chatId, command: p.command, args: [...p.args], cwd, env: { ...env }, enabled: p.enabled !== false };
    if (p.id) { ensureId(p.id, 'binding id'); const index = s.mcpBindings.findIndex(item => item.id === p.id); if (index < 0) throw new Error('MCP binding not found'); s.mcpBindings[index] = binding; }
    else s.mcpBindings.push(binding);
    return s;
  }
  if (type === 'mcp.binding.remove') {
    ensureId(p.id, 'binding id'); if (!s.mcpBindings.some(item => item.id === p.id)) throw new Error('MCP binding not found');
    s.mcpBindings = s.mcpBindings.filter(item => item.id !== p.id); return s;
  }
  if (type === 'mcp.context.set') {
    const chat = requireChat(s, p.chatId); const ids = Array.isArray(p.resultIds) ? p.resultIds : [];
    for (const resultId of ids) { ensureId(resultId, 'result id'); const result = s.mcpResults.find(item => item.id === resultId); if (!result || result.chatId !== chat.id) throw new Error('MCP result is outside this chat scope'); }
    s.mcpContext[chat.id] = [...new Set(ids)]; return s;
  }
  throw new Error(`unknown command: ${type}`);
}

export function appendExchange(state, chatId, exchange) {
  const s = clone(state);
  const chat = requireChat(s, chatId), root = requireRoot(s, chat.rootId);
  if (root.archivedAt || chat.archivedAt) throw new Error('chat archived');
  const model = s.models.find(m => m.id === exchange.modelId);
  if (!model) throw new Error('model not found');
  assertModelAvailable(s,model.id);
  assertReplyAvailable(s, model);
  const asking = exchange.request?.kind === 'ask';
  const content = ensureText(exchange.content ?? '', 'content', 200000);
  if (!asking && !content.trim()) throw new Error('content required');
  const modelIdentifier = ensureText(exchange.modelIdentifier ?? model.model, 'modelIdentifier', 200).trim();
  const modelBaseUrl = ensureText(exchange.modelBaseUrl ?? model.baseUrl, 'modelBaseUrl', 500).trim();
  validateModelRoute({ ...model, baseUrl: modelBaseUrl });
  const revision = root.instructions.at(-1) ?? null;
  const continuity = captureContinuityContext(s, chatId);
  const record = { id: exchange.id ?? id('exchange'), chatId, status: 'pending', error: null, createdAt: now(), modelId: model.id,
    modelLabel: exchange.modelLabel ?? model.name, modelIdentifier, modelBaseUrl, instructionRevisionId: revision?.id ?? null,
    responseMode: responseModeFor(s, chatId),
    harness: harnessSnapshot(s, chatId, exchange.speaker?.seat ?? 'visiting'),
    ...(agentProfileSnapshot(s, exchange.speaker) ? { agentProfile: agentProfileSnapshot(s, exchange.speaker) } : {}),
    replyLength: exchange.replyLength ?? root.replyLength ?? 'short', thinking: exchange.thinking ?? model.thinking ?? false,
    runtime: exchange.runtime ?? model.runtime ?? 'compatible', inputFormat: model.inputFormat ?? 'chat', heartRevisionId: continuity.heartRevisionId, memoryEntryIds: continuity.memoryEntryIds,
    ...(exchange.request ? { request: clone(exchange.request) } : {}), ...(exchange.speaker ? { speaker: clone(exchange.speaker) } : {}) };
  s.exchanges.push(record);
  if (!asking) {
    s.messages.push({ id: id('message'), chatId, role: 'user', content, createdAt: now(), exchangeId: record.id, modelId: record.modelId,
      modelLabel: record.modelLabel, modelIdentifier, modelBaseUrl, instructionRevisionId: record.instructionRevisionId, kind: 'exchange' });
    if (s.drafts[chatId]?.trim() === content.trim()) delete s.drafts[chatId];
  }
  return s;
}

export function finishExchange(state, exchangeId, result) {
  const s = clone(state); const exchange = s.exchanges.find(e => e.id === exchangeId); if (!exchange) throw new Error('exchange not found'); if (exchange.status !== 'pending') throw new Error('exchange is no longer pending'); if (!EXCHANGE_STATUSES.has(result?.status) || result.status === 'pending') throw new Error('invalid exchange completion status'); exchange.status = result.status; exchange.error = result.error ?? null; if (result.finishReason !== undefined) exchange.finishReason = result.finishReason; if (result.status === 'completed') exchange.truncated = ['length', 'max_tokens'].includes(result.finishReason);
  if (result.metrics !== undefined) exchange.metrics = clone(validateReplyMetrics(result.metrics));
  if (exchange.status === 'completed' || exchange.status === 'cancelled' || exchange.status === 'failed') {
    const content = ensureText(result.content ?? '', 'content', 200000);
    if (content) s.messages.push({ id: id('message'), chatId: exchange.chatId, role: 'assistant', content, createdAt: now(), exchangeId: exchange.id, modelId: exchange.modelId, modelLabel: exchange.modelLabel, modelIdentifier: exchange.modelIdentifier, modelBaseUrl: exchange.modelBaseUrl, instructionRevisionId: exchange.instructionRevisionId, kind: 'exchange', incomplete: exchange.status !== 'completed' });
  }
  return s;
}

export function validatePayload(payload) { return isObject(payload); }
