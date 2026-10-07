import { isContinuing } from './continuing-state.mjs';
import crypto from 'node:crypto';
import { PAL_INSTRUCTION, PAL_GUIDE_PROFILE } from './pal-guide.mjs';
import { assertMediaClearance, mediaReferences } from './model-media.mjs';
import { digest } from './integrity.mjs';
import { agentSettings, runLimits, taskBasis, openRun } from './parallel-state.mjs';
import { validToolContract } from './tool-contract.mjs';
import { carryContextView } from './context-carry.mjs';
import { resolveRecorder } from './carry-recorder.mjs';
import { isCodex, codexCapability } from './codex-policy.mjs';
import { resolveSpeaker } from './table.mjs';
import { selectedAccount } from './mind.mjs';
import { responseModeFor, responseModeEvidence, capturedPeerOrientation } from './response-mode.mjs';
import { makeReview, reviewAllowsEffect, validateRecordedReview, validateReviewSources } from './review.mjs';
import { transportReceipt } from './model-format.mjs';
import { harnessSnapshot } from './harnesses.mjs';
import { agentProfileSnapshot, agentExposureIds, assertAgentDisclosure } from './agent-profiles.mjs';
import { assertSketchDisclosure, sketchDestination } from './sketches.mjs';
import { assertPcDisclosure } from './pc-permissions.mjs';
import { SPEAKER_CONTEXT_PROFILE, chairIdentitySnapshot, validateChairIdentityRecord } from './speaker-context.mjs';
export { digest } from './integrity.mjs';

// Branchline's finite application profile. These checks do not claim complete
// PAL/PECAN/PEA conformance or turn a model judgement into execution authority.
export const PROFILE = 'branchline.ppp-handoff/0.1';
const fail = (ok, message) => { if (!ok) throw new Error('PPP handoff: ' + message); };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const uid = prefix => `${prefix}_${crypto.randomUUID()}`;
const invocations = new WeakSet();
const dispatched = new WeakSet();

const withoutHash = ({ hash, ...value }) => value;

// Snapshots repeat identical receipts. Cache only a successful hash check of
// the EXACT serialized receipt; ordering, source, review and scope checks still
// run on every validation. Nothing is trusted from a disk cache or a hash alone.
const checkedReceiptBytes = new Map();
let checkedReceiptChars = 0;
const RECEIPT_CACHE_CHARS = 4 * 1024 * 1024;
function receiptHashMatches(record) {
  const encoded = JSON.stringify(record);
  if (checkedReceiptBytes.has(encoded)) return true;
  if (record.hash !== digest(withoutHash(record))) return false;
  // Whole-ledger scans are ordered. Evicting the prefix to admit the suffix
  // made every next scan a complete miss once the ledger exceeded this bound.
  // Retain the admitted prefix; uncached bytes still receive their full check.
  if (checkedReceiptChars + encoded.length <= RECEIPT_CACHE_CHARS && checkedReceiptBytes.size < 4096) {
    checkedReceiptBytes.set(encoded, true); checkedReceiptChars += encoded.length;
  }
  return true;
}
const sameRecord = (before, after) => JSON.stringify(before) === JSON.stringify(after) || digest(before) === digest(after);

function ledger(state) {
  if (!state.handoffs) state.handoffs = { profile: PROFILE, records: [], heldOutputs: [] };
  return state.handoffs;
}

export function validateHandoffs(state) {
  const l = state.handoffs;
  if (l === undefined) return true; // Old records remain historical, not retro-certified.
  fail(object(l) && l.profile === PROFILE && Array.isArray(l.records) && Array.isArray(l.heldOutputs), 'invalid ledger');
  const seen = new Map(), byHash = new Map(); let previous = null;
  for (const r of l.records) {
    fail(object(r) && typeof r.id === 'string' && !seen.has(r.id), 'duplicate or missing receipt');
    fail(r.sequence === seen.size + 1 && r.previous === previous, 'broken receipt order');
    fail(r.profile === PROFILE && receiptHashMatches(r), 'receipt content mismatch');
    fail(Array.isArray(r.parents) && r.parents.every(p => seen.has(p)), 'missing predecessor');
    fail(object(r.scope) && typeof r.kind === 'string' && typeof r.taskId === 'string', 'missing task boundary');
    fail(r.authorityCreated === false, 'a receipt cannot create authority');
    validateRecordedReview(r);
    validateReviewSources(r, byHash);
    validateChairIdentityRecord(r);
    if (r.scope.chatId !== null) {
      fail(state.chats.some(c => c.id === r.scope.chatId && c.rootId === r.scope.rootId), 'receipt crossed chat boundary');
    } else if (r.scope.rootId !== null) fail(state.roots.some(root => root.id === r.scope.rootId), 'missing branch');
    seen.set(r.id, r); byHash.set(r.hash, r); previous = r.hash;
  }
  for (const held of l.heldOutputs) {
    fail(typeof held.content === 'string' && digest(held.content) === held.contentHash, 'held output changed');
    fail(seen.has(held.receiptId) && seen.get(held.receiptId).status === 'HELD', 'held output receipt missing');
  }
  return true;
}

export function preserveHandoffHistory(before, after) {
  const prior = before.handoffs;
  if (!prior) return;
  fail(after.handoffs?.records.length >= prior.records.length, 'prior receipts removed');
  for (let i = 0; i < prior.records.length; i++) fail(sameRecord(prior.records[i], after.handoffs.records[i]), 'prior receipt rewritten');
  fail(after.handoffs.heldOutputs.length >= prior.heldOutputs.length, 'held output removed');
  for (let i = 0; i < prior.heldOutputs.length; i++) fail(sameRecord(prior.heldOutputs[i], after.handoffs.heldOutputs[i]), 'held output rewritten');
}

export function recordHandoff(state, { kind, taskId = uid('task'), scope = { rootId: null, chatId: null }, from, to, payload, parents = [], status = 'RECORDED', checks = [], unresolved = [], detail = {} }) {
  const l = ledger(state);
  const r = {
    id: uid('handoff'), sequence: l.records.length + 1, at: new Date().toISOString(), profile: PROFILE,
    taskId, scope: structuredClone(scope), kind, from, to, contentHash: digest(payload), parents: [...parents],
    status, checks: [...checks], unresolved: [...unresolved], detail: structuredClone(detail),
    authorityCreated: false, previous: l.records.at(-1)?.hash ?? null,
  };
  r.hash = digest(r); l.records.push(r); return r;
}

export function scopeFor(state, chatId) {
  const chat = state.chats.find(c => c.id === chatId);
  const root = state.roots.find(r => r.id === chat?.rootId);
  fail(chat && root, 'chat and branch must be present');
  fail(!chat.archivedAt && !root.archivedAt, 'branch or chat is archived');
  return { rootId: root.id, chatId: chat.id };
}

function contextView(state, scope, selection = null, kind = 'reply', taskId = null, capturedOrientation = null) {
  const conversational = kind === 'reply' || kind === 'parallel';
  const root = state.roots.find(r => r.id === scope.rootId);
  const instruction = root.instructions.at(-1) ?? null;
  const heart = root.continuity?.heart.at(-1) ?? null;
  const peerRun=selection?.episodeId && state.parallel?.runs.find(r=>isContinuing(r)&&r.chatId===scope.chatId&&r.peers.some(p=>p.id===selection.episodeId));
  const peer=peerRun?.peers.find(p=>p.id===selection.episodeId);
  const orientation = peer ? capturedPeerOrientation(peer) : responseModeEvidence(responseModeFor(state, scope.chatId));
  const chosen = kind === 'carry' && selection?.seat === 'recorder'
    ? resolveRecorder(state, scope.chatId, selection.recorder.choice)
    : peer ? {model:peer.model,selection:peer.selection} : selection ? resolveSpeaker(state, scope.chatId, selection.seat) : null;
  if(peer) fail(digest(selection)===digest(peer.selection) && digest(state.models.find(m=>m.id===peer.model.id))===peer.modelHash,'selected peer connection changed');
  const model = chosen?.model ?? state.models.find(m => m.id === root.modelId) ?? null;
  const memory = (root.continuity?.journal || []).filter(e => e.chatId === scope.chatId && !e.removedAt);
  const results = (state.mcpContext?.[scope.chatId] || []).map(id => state.mcpResults.find(r => r.id === id));
  fail(results.every(r => r && r.rootId === scope.rootId && r.chatId === scope.chatId), 'selected tool result escaped scope');
  return {
    workingMethod: PAL_GUIDE_PROFILE,
    instruction: instruction ? { id: instruction.id, hash: digest(instruction.text), role: 'user_adopted_guidance' } : null,
    ...(conversational ? { harness: peer?.coat || (taskId && state.exchanges.find(e=>e.id===taskId)?.harness) || harnessSnapshot(state, scope.chatId, selection?.seat ?? 'visiting') } : {}),
    ...(conversational && agentProfileSnapshot(state, selection) ? { agentProfile: agentProfileSnapshot(state, selection) } : {}),
    ...(agentExposureIds(state, scope.chatId, selection, kind).length ? { agentExposureIds: agentExposureIds(state, scope.chatId, selection, kind) } : {}),
    ...(conversational ? { responseMode: capturedOrientation ?? { mode: orientation.mode, profile: orientation.profile, hash: digest(orientation.instruction), role: 'response_guidance_only' } } : {}),
    heart: heart ? { id: heart.id, hash: digest(heart.text), role: 'user_adopted_guidance' } : null,
    memory: memory.map(e => ({ id: e.id, hash: digest(e.text), role: 'model_interpretation' })),
    toolResults: results.map(r => ({ id: r.id, hash: digest(r.payload), role: 'tool_evidence' })),
    model: model ? { id: model.id, hash: digest(model) } : null,
    ...(selection ? { speaker: chosen.selection } : {}),
    ...(kind === 'carry' && selection?.seat === 'recorder' ? { recorderPreferences: digest(state.chats.find(c => c.id === scope.chatId)?.carrySettings ?? null) } : {}),
    ...(selection && conversational ? { speakerContextProfile: SPEAKER_CONTEXT_PROFILE, chairIdentity: chairIdentitySnapshot(state, scope.chatId, chosen.selection) } : {}),
    ...(state.mind ? { mind: selectedAccount(state, scope.chatId) } : {}),
    ...(state.contextCarry ? { carriedContext: carryContextView(state, scope.chatId) } : {}),
  };
}

// The actual serialized messages are bound separately from the referenced view.
// Every peer would receive this same task record plus its explicitly named view.
export function prepareModelHandoff(state, { taskId, chatId, kind, messages, purpose, sourceExchangeId = null, inputReceipts = [], selection = null, turnRequest = null, toolContract = null, parallelRunId = null, mediaClearance = null, workspaceId = null, workspacePath = null }) {
  fail(['reply', 'journal', 'heart', 'agents', 'mind', 'carry', 'parallel'].includes(kind), 'unknown model operation');
  fail(typeof purpose === 'string' && purpose.trim(), 'whole-task purpose is required');
  const scope = scopeFor(state, chatId);
  const view = contextView(state, scope, selection, kind);
  const transportModel = selection ? selection.modelSnapshot : state.models.find(model => model.id === view.model?.id);
  assertAgentDisclosure(state, chatId, transportModel, selection, kind);
  const sketchDisclosure = assertSketchDisclosure(state,chatId,transportModel,workspaceId);
  assertPcDisclosure(state,chatId,transportModel,workspaceId,workspacePath);
  assertMediaClearance(mediaClearance, messages, transportModel, chatId);
  const transport = transportReceipt(transportModel, messages);
  if (toolContract) fail(['reply', 'parallel'].includes(kind) && toolContract.chatId === chatId && validToolContract(toolContract, transportModel)
    && (kind !== 'parallel' || !toolContract.tools.includes('request_parallel_approach')), 'invalid tool contract');
  if (selection) fail(digest(selection) === digest(view.speaker), 'selected chair changed before preparation');
  fail(Array.isArray(inputReceipts) && inputReceipts.length <= 1 && inputReceipts.every(id => state.handoffs?.records.some(r => r.id === id && r.kind === 'file.read' && r.taskId === taskId && r.status === 'WITHIN_LOCAL_PROFILE' && digest(r.scope) === digest(scope))), 'selected input escaped its task');
  const parallelRun = kind === 'parallel' ? state.parallel?.runs.find(r => r.id === parallelRunId && r.chatId === chatId && r.episodeIds.includes(taskId)) : null;
  const parallelJob = parallelRun && state.parallel.jobs.find(j => j.id === taskId);
  if (kind === 'parallel') fail(parallelRun && ['queued', 'running'].includes(parallelRun.status) && purpose === parallelRun.purpose, 'parallel contribution has no shared task grant');
  const allowedEffects = kind === 'parallel' ? ['record_parallel_contribution'] : kind === 'reply' ? ['record_reply'] : kind === 'journal' ? ['append_chat_journal'] : kind === 'mind' ? ['append_mind_wake'] : kind === 'carry' ? ['record_context_account'] : ['record_proposal'];
  const capability = {
    ...(mediaClearance ? { images: { ...mediaClearance.capability, sourceRole: 'image_evidence', imagesHash: mediaClearance.imagesHash } } : {}),
    modelInterface: toolContract ? 'text_generation_with_app_owned_tools' : 'text_generation_without_tools', modelServiceIsolation: 'NOT_ASSESSED',
    hostWriter: { effects: allowedEffects, boundary: scope, enforcement: 'fixed_application_code_paths' },
    externalProcessDispatch: isCodex(transportModel) ? 'PINNED_CODEX_TEXT_BRIDGE_ONLY' : 'DISABLED',
    ...(isCodex(transportModel) ? { codex: codexCapability(Boolean(toolContract)) } : {}),
    ...(toolContract ? { tools: structuredClone(toolContract) } : {}),
  };
  const task = { purpose, kind, scope, view, sourceExchangeId, allowedEffects, capability, ...(selection ? { selection } : {}), ...(turnRequest ? { turnRequest } : {}), ...(inputReceipts.length ? { inputReceipts: [...inputReceipts] } : {}),
    ...(parallelRun ? { parallel: { profile: parallelRun.profile, runId: parallelRun.id, contextHash: parallelRun.contextHash, basisHash: parallelRun.basisHash,
      settingsId: parallelRun.settingsId, admissionHash: parallelRun.admissionHash, origin: parallelRun.origin, sourceExchangeId: parallelRun.sourceExchangeId, limits: parallelRun.limits, authorityCreated: false,
      ...(parallelJob.hearthActor ? { turnAdmissionHash: parallelJob.admissionHash, actor: parallelJob.hearthActor } : parallelJob.peerId ? { turnAdmissionHash:parallelJob.admissionHash,actor:parallelJob.peerName,peerId:parallelJob.peerId,allowanceHashes:parallelRun.extensions.map(x=>state.handoffs.records.find(a=>a.id===x.receiptId).hash) } : {}) } } : {}),
    whyThisCapability: kind === 'parallel' ? 'Read the shared task context from one declared angle and retain an attributed contribution. This adds no execution authority.' : kind === 'reply' ? 'Generate a response to this request and retain the exchange.' : kind === 'carry' ? 'Read attributed original conversation and write one derived context account with checked source references. This does not carry or grant permission.' : kind === 'mind' ? 'Read selected source turns and propose a bounded, fallible account revision or a no-change outcome.' : `Read the selected exchange and return ${kind === 'journal' ? 'a fallible journal entry' : 'a proposal for human review'}.`,
    authority: { source: parallelRun ? 'app_admitted_shared_task' : 'local_ui_request', effectCeiling: allowedEffects, mayDelegate: false },
    verificationNeeded: ['exact_input_and_model', 'same_scope_and_context', 'complete_result', 'bounded_record_effect'],
  };
  const request = recordHandoff(state, { kind: 'ui.intent', taskId, scope, from: parallelRun ? 'app_task_queue' : 'local_ui', to: 'shared_task', payload: task,
    status: 'REQUEST_RECORDED', parents: [...inputReceipts,...(parallelRun ? [parallelRun.admissionId, ...((parallelJob.hearthActor||parallelJob.peerId) ? [parallelJob.admissionId] : [])] : [])], detail: { task, localIdentityAssumption: parallelRun ? 'app admission under recorded local user settings; not independently authenticated human identity' : 'local UI request; not independently authenticated human identity' } });
  const outgoing = recordHandoff(state, { kind: 'context.to_model', taskId: request.taskId, scope, from: 'shared_task', to: 'model_episode', payload: messages, parents: [request.id],
    checks: ['branch_and_chat_scope', 'source_roles_retained', 'messages_bound'], unresolved: ['Model interpretation is fallible.', isCodex(transportModel) ? 'Selected context is sent to OpenAI. The pinned capability profile is not an OS container or a full PPPS conformance claim.' : 'The local model service is independently operated; its process isolation has not been assessed.'], detail: { inputMessages: structuredClone(messages), transport, contextView: view, capability, effectCeiling: task.allowedEffects, taskReceipt: request.id, ...(sketchDisclosure?{sketchDestination:sketchDestination(transportModel)}:{}) } });
  const handle = Object.freeze({ taskId: request.taskId, requestId: request.id, contextId: outgoing.id, contextHash: outgoing.contentHash, scope: Object.freeze({ ...scope }), kind, viewHash: digest(view), modelHash: view.model?.hash ?? null });
  invocations.add(handle);
  return handle;
}

export function assertModelInvocation(handle, messages, model) {
  fail(invocations.has(handle), 'model invocation has no live host-issued handoff');
  fail(!dispatched.has(handle), 'model invocation already dispatched');
  fail(handle.contextHash === digest(messages) && handle.modelHash === digest(model), 'model or context changed after preparation');
  dispatched.add(handle);
}

export function assertToolInvocation(state, handle, contract) {
  fail(invocations.has(handle) && dispatched.has(handle) && ['reply', 'parallel'].includes(handle.kind), 'tool request has no active model episode');
  const task = state.handoffs?.records.find(r => r.id === handle.requestId)?.detail.task;
  const exchange = handle.kind === 'parallel' ? state.parallel?.jobs.find(j => j.id === handle.taskId) : state.exchanges.find(e => e.id === handle.taskId);
  fail(exchange?.status === 'pending' && digest(task?.capability?.tools) === digest(contract), 'tool contract or pending episode changed');
  if (contract.coat) {
    const current = task.view.harness;
    fail(current.selectionId === contract.coat.selectionId && current.hash === contract.coat.hash
      && digest(current.preset.pockets ?? null) === digest(contract.coat.pockets), 'Coat pocket choices changed');
  }
  scopeFor(state, handle.scope.chatId);
  fail(handle.viewHash === digest(contextView(state, handle.scope, task.selection ?? null, handle.kind, handle.taskId, task.view.responseMode)), 'tool request has stale context');
}

export function receiveModelOutput(state, handle, content, { complete = true, problem = null } = {}) {
  fail(invocations.has(handle), 'output has no live host-issued handoff');
  const records = ledger(state).records;
  const context = records.find(r => r.id === handle.contextId);
  const request = records.find(r => r.id === handle.requestId);
  fail(context && request && context.taskId === handle.taskId && context.contentHash === handle.contextHash, 'unknown task or changed context');
  fail(digest(handle.scope) === digest(context.scope) && request.detail.task.kind === handle.kind, 'task boundary changed');
  fail(!records.some(r => r.kind === 'model.to_record' && r.parents.includes(context.id)), 'model result already received');
  fail(!records.some(r => r.kind === 'episode.interrupted' && r.parents.includes(context.id)), 'interrupted episode requires a new invocation');
  let current = false;
  try { scopeFor(state, handle.scope.chatId); current = handle.viewHash === digest(contextView(state, handle.scope, request.detail.task.selection ?? null, handle.kind, handle.taskId, request.detail.task.view.responseMode)); } catch { /* retain changed scope as unresolved */ }
  fail(typeof content === 'string', 'model output must be text');
  const withinSize = content.length <= (['journal', 'mind'].includes(handle.kind) ? 6000 : handle.kind === 'reply' ? 200000 : 20000) && Boolean(content.trim());
  const wasDispatched = dispatched.has(handle);
  const task = request.detail.task;
  const effect = handle.kind === 'parallel' ? 'record_parallel_contribution' : handle.kind === 'reply' ? 'record_reply' : handle.kind === 'journal' ? 'append_chat_journal' : handle.kind === 'mind' ? 'append_mind_wake' : handle.kind === 'carry' ? 'record_context_account' : 'record_proposal';
  const reviewBasis = { request: request.hash, context: context.hash, output: digest(content), effect };
  const run = handle.kind === 'parallel' ? state.parallel?.runs.find(r => r.id === task.parallel?.runId) : null;
  const settings = agentSettings(state);
  let sharedCurrent = false;
  if (run) try { sharedCurrent = run.basisHash === taskBasis(state,run); } catch { /* explicit unresolved context */ }
  const review = makeReview(handle.kind === 'parallel' ? 'record-effect/2' : 'record-effect/1', reviewBasis, {
    purpose_bound: typeof task.purpose === 'string' && Boolean(task.purpose.trim()),
    context_bound: context.contentHash === handle.contextHash,
    scope_current: current,
    capability_bounded: (task.capability?.externalProcessDispatch === 'DISABLED' || (task.capability?.externalProcessDispatch === 'PINNED_CODEX_TEXT_BRIDGE_ONLY' && digest(task.capability.codex) === digest(codexCapability(Boolean(task.capability.tools))) && context.detail.transport?.format === 'codex-app-server-v1')) && digest(task.capability.hostWriter) === digest({ effects: [effect], boundary: handle.scope, enforcement: 'fixed_application_code_paths' }),
    authority_applicable: task.authority?.mayDelegate === false && digest(task.allowedEffects) === digest([effect]) && digest(task.authority.effectCeiling) === digest([effect]),
    invocation_dispatched: wasDispatched, output_complete: complete, output_bounded: withinSize, operation_clean: problem === null,
    ...(handle.kind === 'parallel' ? {
      shared_task_bound: !!run && openRun(run) && sharedCurrent && run.episodeIds.includes(handle.taskId) && task.purpose === run.purpose,
      shared_budget_bound: !!run && digest(run.limits) === digest(runLimits(run)) && Object.entries(run.usage).every(([key,n])=>n<=runLimits(run)[key]),
      initiation_permission: !!run && settings.enabled && (run.origin === 'user' || settings.automaticRequests && settings.explicitAutomaticOptIn && settings.id === run.settingsId),
    } : {}),
  }, problem ? [[8, 4, digest(problem)]] : []);
  const accepted = reviewAllowsEffect(review);
  const receipt = recordHandoff(state, { kind: 'model.to_record', taskId: handle.taskId, scope: handle.scope, from: 'model_episode', to: ['reply','parallel'].includes(handle.kind) ? 'chat_transcript' : 'continuity_review', payload: content, parents: [context.id],
    status: accepted ? 'WITHIN_LOCAL_PROFILE' : 'HELD', checks: ['context_identity', 'single_result', 'source_is_model_output', ...(current ? ['current_scope_and_context'] : [])],
    unresolved: ['No semantic truth or complete PEA review is certified.', ...(!current ? ['Context or branch changed before the result returned.'] : []), ...(!complete ? ['Model output is incomplete.'] : []), ...(!wasDispatched ? ['No model dispatch was recorded for this invocation.'] : []), ...(!withinSize ? ['Returned text is empty or exceeds the destination limit.'] : []), ...(problem ? [problem] : [])],
    detail: { effect: accepted ? effect : 'retain_output_only', peaJudgment: null, reviewProfile: 'local-record-effects/0.1', executionAuthority: 'NONE', dispatched: wasDispatched, capabilityHash: digest(request.detail.task.capability), reviewBasis, review } });
  if (!accepted && (handle.kind !== 'reply' || content.length > 200000)) ledger(state).heldOutputs.push({ receiptId: receipt.id, content, contentHash: digest(content) });
  return { accepted, receipt };
}

export function protocolMessages(messages) {
  // Local templates commonly accept only one leading system message. Format
  // before binding the receipt; preserve each instruction block and its order.
  const leading = [];
  let index = 0;
  while (messages[index]?.role === 'system') leading.push(messages[index++].content);
  if (!leading.some(text => text.includes(PAL_INSTRUCTION))) leading.push(PAL_INSTRUCTION);
  const conversation = messages.slice(index);
  fail(!conversation.some(message => message.role === 'system'), 'instruction block appeared inside conversation data');
  return [...(leading.length ? [{ role: 'system', content: leading.join('\n\n') }] : []), ...conversation];
}

export function recordUiCommand(before, after, command) {
  fail(object(command) && Object.keys(command).every(k => ['type', 'payload'].includes(k)), 'UI command cannot supply an actor or grant');
  if (['ui.update', 'draft.save'].includes(command.type)) return null; // No trust/capability transfer; ordinary snapshots suffice.
  const p = command.payload || {};
  const appliedChat = ['harness.create', 'harness.revise'].includes(command.type) ? p.use?.chatId : null;
  const chat = after.chats.find(c => c.id === (p.chatId || appliedChat || p.id)) || (['root.create', 'chat.create'].includes(command.type) ? after.chats.find(c => !before.chats.some(old => old.id === c.id)) : null);
  const root = after.roots.find(r => r.id === (chat?.rootId || p.rootId || p.id));
  const scope = { rootId: root?.id ?? null, chatId: chat?.id ?? null };
  const proposal = command.type === 'continuity.proposal.accept' ? before.roots.flatMap(r => r.continuity?.proposals || []).find(p => p.id === command.payload.proposalId) : null;
  let mechanical = {};
  if (proposal) {
    const beforeRoot = before.roots.find(r => r.id === root?.id);
    const priorRevision = (proposal.target === 'heart' ? beforeRoot.continuity.heart : beforeRoot.instructions).at(-1)?.id ?? null;
    const revision = (proposal.target === 'heart' ? root.continuity.heart : root.instructions).at(-1);
    const reviewBasis = { scope, command, proposal: structuredClone(proposal), capability: 'adopt_exact_local_proposal', authority: 'local_UI_request_not_independently_authenticated' };
    const review = makeReview('proposal-accept/1', reviewBasis, { proposal_pending: proposal.status === 'pending', root_active: !beforeRoot.archivedAt, base_current: proposal.baseRevisionId === priorRevision && (p.baseRevisionId ?? null) === priorRevision, exact_text: revision?.proposalId === proposal.id && revision.text === proposal.text, local_request: true });
    fail(reviewAllowsEffect(review), 'proposal adoption was not within the fixed effect profile');
    mechanical = { reviewBasis, review };
  }
  return recordHandoff(after, { kind: 'ui.to_state', scope, from: 'local_ui', to: 'workspace_store', payload: command,
    status: 'WITHIN_LOCAL_PROFILE', checks: ['known_application_command', 'domain_validation', ...(proposal ? ['exact_proposal_selected', 'current_base_revision'] : [])],
    detail: { command: command.type, proposalHash: proposal ? digest(proposal.text) : null, peaJudgment: null, reviewProfile: 'local-record-effects/0.1', capability: { interface: 'fixed_workspace_command', effect: command.type, processDispatch: false }, localIdentityAssumption: 'local UI request', ...mechanical } });
}

// Pure peer admission contract only. There is deliberately no peer launcher.
export function reviewPeerContribution(task, contribution) {
  const reasons = [];
  if (!object(task) || !object(contribution)) return { status: 'HELD', reasons: ['missing task or contribution'], authorityCreated: false };
  if (typeof task.id !== 'string' || typeof task.purpose !== 'string' || !task.purpose.trim() || typeof task.grantRef !== 'string' || !task.grantRef.trim() || typeof task.contextHash !== 'string' || !Array.isArray(task.episodes) || !task.episodes.length) reasons.push('shared task is not sufficiently declared');
  if (contribution.taskId !== task.id || contribution.taskHash !== digest(task)) reasons.push('different shared task or task revision');
  if (contribution.contextHash !== task.contextHash) reasons.push('undeclared context view');
  if (contribution.grantRef !== task.grantRef) reasons.push('changed grant reference');
  if (!object(task.capability) || contribution.capabilityHash !== digest(task.capability)) reasons.push('missing or changed capability declaration');
  if (contribution.purposeHash !== digest(task.purpose ?? null)) reasons.push('whole-task purpose was not carried');
  if (typeof contribution.rationale !== 'string' || !contribution.rationale.trim()) reasons.push('missing reason for using the capability');
  if (contribution.parentEpisodeId !== undefined || contribution.children !== undefined) reasons.push('recursive delegation is not admitted');
  if (!Array.isArray(contribution.unresolved) || !Array.isArray(contribution.sources)) reasons.push('missing sources or unresolved remainder');
  if (!task.episodes?.includes(contribution.episodeId)) reasons.push('episode was not admitted by the shared task');
  if ((contribution.requestedEffects || []).length) reasons.push('peer evidence cannot carry executable effects');
  return { status: reasons.length ? 'HELD' : 'EVIDENCE_ONLY', reasons, authorityCreated: false, capabilityEnforcement: 'NOT_ASSESSED', rationaleUnderstanding: 'NOT_ASSESSED' };
}

export function holdExternalProcess(state, { rootId, chatId, bindingId, method, tool = null, arguments: args = {}, purpose = null, bindingSnapshot = null }) {
  const scope = scopeFor(state, chatId); fail(scope.rootId === rootId, 'tool branch mismatch');
  return recordHandoff(state, { kind: 'tool.dispatch', scope, from: 'local_ui', to: 'external_process', payload: { bindingId, method, tool, arguments: args, purpose, bindingSnapshot }, status: 'HELD',
    unresolved: ['This application profile has no enforced process capability boundary for this adapter.', ...(!purpose ? ['The reason for this tool use has not been supplied.'] : [])],
    detail: { bindingId, tool, purpose, bindingSnapshot, dispatched: false, peaJudgment: null, executionAuthority: 'NONE',
      capability: { interface: 'adapter_process', actualReach: 'UNKNOWN', isolation: 'NOT_IMPLEMENTED', inheritedHostAccess: 'POSSIBLE', enforcedDispatch: 'DISABLED' },
      rationaleUnderstanding: 'NOT_ASSESSED' } });
}

export function recordInterruption(state, item, scope) {
  const parent = state.handoffs?.records.find(r => r.id === item.handoff?.contextId)?.id;
  return recordHandoff(state, { kind: 'episode.interrupted', taskId: item.id, scope, from: 'prior_episode', to: 'next_episode', payload: { id: item.id, priorStatus: item.status }, parents: parent ? [parent] : [], status: 'UNRESOLVED',
    unresolved: ['The previous process ended before a result was durably recorded. Completion and unsaved output are unknown.'],
    detail: { authorityCarried: 'NONE', capability: 'NEW_INVOCATION_REQUIRED', recoveredResult: false } });
}
