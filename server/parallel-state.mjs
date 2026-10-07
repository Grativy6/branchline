import { isContinuing,validateContinuingRun,validateContinuingJob,preserveContinuing,peerDisplay } from './continuing-state.mjs';
import crypto from 'node:crypto';
import { digest } from './integrity.mjs';
import { validToolContract } from './tool-contract.mjs';
import { isHearth, HEARTH_LIMITS, hearthDisplay, hearthFoundation, validateHearthRun, validateHearthJob, preserveHearthRun } from './hearth-state.mjs';

export const PARALLEL_PROFILE = 'branchline.parallel-approaches/1';
export const PARALLEL_LIMITS = Object.freeze({ approaches: 2, toolCalls: 8, toolBytes: 48000, modelRounds: 10, outputCharacters: 40000, durationMs: 600000 });
export const liveRun = run => ['queued', 'running'].includes(run.status);
export const liveJob = job => ['queued', 'pending'].includes(job.status);
export const openRun = run => liveRun(run) || isContinuing(run) && ['waiting','resting'].includes(run.status) || isHearth(run) && run.status === 'waiting';
export const runLimits = run => isContinuing(run) ? run.limits : isHearth(run) ? HEARTH_LIMITS : PARALLEL_LIMITS;
const fail = (ok, message) => { if (!ok) throw new Error('Parallel approaches: ' + message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const ref = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = (value, size) => typeof value === 'string' && value.trim().length > 0 && value.length <= size;
const at = () => new Date().toISOString();
export const parallelState = state => state.parallel ??= { settings: [], runs: [], jobs: [] };
export const agentSettings = state => state.parallel?.settings.at(-1) ?? { id: null, enabled: false, automaticRequests: false };

export function applyAgentSettings(state, payload) {
  fail(exact(payload, ['baseRevisionId', 'enabled', 'automaticRequests', 'confirmAutomatic']), 'unexpected settings fields.');
  const old = agentSettings(state);
  fail(payload.baseRevisionId === old.id, 'settings changed. Reopen Settings.');
  fail([payload.enabled, payload.automaticRequests, payload.confirmAutomatic].every(v => typeof v === 'boolean'), 'choose Yes or No.');
  fail(payload.enabled || !payload.automaticRequests, 'enable agents before allowing automatic requests.');
  fail(!payload.automaticRequests || old.automaticRequests || payload.confirmAutomatic, 'automatic requests require the separate explicit opt-in.');
  parallelState(state).settings.push({ id: 'agent_settings_' + crypto.randomUUID(), at: at(), source: 'paired_local_ui',
    enabled: payload.enabled, automaticRequests: payload.automaticRequests, explicitAutomaticOptIn: payload.automaticRequests && (old.automaticRequests || payload.confirmAutomatic) });
  return state;
}

// This binds the task's declared context, not unrelated navigation or draft edits.
// A requesting reply may finish without invalidating its own queued approach.
export function parallelBasis(state, chatId, sourceExchangeId = null, runId = null) {
  const excludedRuns = new Set(Array.isArray(runId) ? runId : runId ? [runId] : []);
  const chat = state.chats.find(c => c.id === chatId), root = state.roots.find(r => r.id === chat?.rootId);
  fail(chat && root && !chat.archivedAt && !root.archivedAt, 'choose an active branch.');
  return digest({ chat, root, models: state.models, personal: state.personalParticipants ?? [],
    messages: state.messages.filter(m => m.chatId === chatId && !(sourceExchangeId && m.role === 'assistant' && m.exchangeId === sourceExchangeId)
      && !(excludedRuns.size && m.kind === 'parallel' && state.parallel?.jobs.some(j => j.id === m.parallelEpisodeId && excludedRuns.has(j.runId)))),
    files: state.exchanges.filter(e => e.chatId === chatId && e.selectedFile).map(e => e.selectedFile),
    mind: state.mind ?? null, carry: state.contextCarry ?? null,
    mcpContext: state.mcpContext?.[chatId] ?? [], mcpResults: state.mcpResults ?? [],
  });
}

export function taskBasis(state, run) {
  if(isContinuing(run)) return run.basisHash;
  return parallelBasis(state, run.chatId, run.sourceExchangeId, isHearth(run)
    ? [run.id, run.resumeOf, ...run.inherited.map(x => x.runId)].filter(Boolean) : run.id);
}

// Results are evidence for later user-led replies. Never promote their text to
// system instructions or an execution grant. The working-context ceiling applies.
export function parallelEvidence(state, message) {
  const j = state.parallel?.jobs.find(j => j.id === message.parallelEpisodeId);
  fail(j, 'the contribution source is missing.');
  return { role: 'user', content: '[Branchline parallel approach; attributed model evidence, not human instructions, agreement, or permission]\n' + JSON.stringify({
    runId: j.runId, episodeId: j.id, model: j.model.name, modelIdentifier: j.model.model, angle: j.angle,
    status: j.status, contextHash: j.contextHash, output: j.output,
    ...(j.hearthActor ? { episode: j.hearthActor, mechanism: 'recorded-context' } : {}),
  }) };
}

export function completeParallelJob(state, jobId, result) {
  const job = state.parallel?.jobs.find(j => j.id === jobId);
  fail(job?.status === 'pending', 'the contribution is not pending.');
  job.status = result.status; job.output = result.content.slice(0, 20000);
  job.error = result.error ?? null; job.finishReason = result.finishReason ?? null; job.endedAt = at();
  if (job.output && !job.recordKind) state.messages.push({ id: 'message_' + crypto.randomUUID(), chatId: job.chatId, role: 'assistant', content: job.peerId ? peerDisplay(job) : hearthDisplay(job),
    createdAt: job.endedAt, kind: 'parallel', parallelEpisodeId: job.id, exchangeId: null,
    modelId: job.model.id, modelLabel: job.model.name, modelIdentifier: job.model.model, modelBaseUrl: job.model.baseUrl,
    instructionRevisionId: null, incomplete: job.status !== 'completed' });
  return state;
}

export function interruptParallel(state) {
  for (const run of state.parallel?.runs ?? []) if (openRun(run)) {
    if(isContinuing(run)){run.epoch++;for(const name of Object.keys(run.positions))run.positions[name].mode='stopped';}
    run.status = 'interrupted'; run.error = 'The app stopped. No agent permission was restored; start a new request to continue.'; run.endedAt = at();
  }
  for (const job of state.parallel?.jobs ?? []) if (liveJob(job)) {
    job.status = 'interrupted'; job.error = 'The app stopped before this contribution was saved.'; job.endedAt = at();
  }
}

export function validateParallel(state) {
  if (state.parallel === undefined) return;
  const p = state.parallel;
  fail(exact(p, ['settings', 'runs', 'jobs']) && [p.settings, p.runs, p.jobs].every(Array.isArray), 'invalid state.');
  const ids = new Set(), requests = new Set();
  for (const item of [...p.settings, ...p.runs, ...p.jobs]) { fail(ref(item.id) && !ids.has(item.id), 'duplicate identity.'); ids.add(item.id); }
  for (const s of p.settings) fail(exact(s, ['id', 'at', 'source', 'enabled', 'automaticRequests', 'explicitAutomaticOptIn'])
    && s.source === 'paired_local_ui' && typeof s.enabled === 'boolean' && typeof s.automaticRequests === 'boolean'
    && s.explicitAutomaticOptIn === s.automaticRequests && (s.enabled || !s.automaticRequests) && Number.isFinite(Date.parse(s.at)), 'settings have no explicit user origin.');
  const terminal = ['completed', 'failed', 'held', 'cancelled', 'interrupted'];
  for (const run of p.runs) {
    if(isContinuing(run)){validateContinuingRun(state,run);continue;}
    const hearth = isHearth(run), limits = runLimits(run);
    fail((run.profile === PARALLEL_PROFILE || hearth) && ref(run.requestId) && !requests.has(run.requestId) && hash(run.fingerprint), 'invalid request identity.'); requests.add(run.requestId);
    fail(['user', 'model'].includes(run.origin) && text(run.purpose, 20000) && hash(run.basisHash) && hash(run.contextHash), 'missing task foundation.');
    fail(state.chats.some(c => c.id === run.chatId && c.rootId === run.rootId) && p.settings.some(s => s.id === run.settingsId && s.enabled && (run.origin === 'user' || s.automaticRequests)), 'task has no admitted scope or user permission.');
    fail(run.sourceExchangeId === null || state.exchanges.some(e => e.id === run.sourceExchangeId && e.chatId === run.chatId), 'requesting exchange is missing.');
    fail(run.origin !== 'model' || run.sourceExchangeId !== null, 'model request has no source.');
    fail(digest(run.limits) === digest(limits) && ['queued', 'running', ...terminal, ...(hearth ? ['waiting','partial'] : [])].includes(run.status), 'invalid task limits or status.');
    fail(exact(run.usage, ['toolCalls', 'toolBytes', 'modelRounds', 'outputCharacters']) && Object.entries(run.usage).every(([k, n]) => Number.isSafeInteger(n) && n >= 0 && n <= limits[k]), 'shared budget exceeded.');
    fail(Array.isArray(run.episodeIds) && (hearth ? run.episodeIds.length <= limits.modelRounds : run.episodeIds.length === (run.origin === 'model' ? 1 : 2)) && new Set(run.episodeIds).size === run.episodeIds.length && run.episodeIds.every(id => p.jobs.some(j => j.id === id && j.runId === run.id)), 'invalid approach reservation.');
    fail(typeof run.cloudApproved === 'boolean' && typeof run.toolsEnabled === 'boolean' && Number.isFinite(Date.parse(run.deadline)), 'missing task controls.');
    const admission = state.handoffs?.records.find(r=>r.id === run.admissionId && r.hash === run.admissionHash);
    const stable = value => Object.fromEntries(Object.entries(value).filter(([k])=>!['status','error','endedAt','usage','admissionId','admissionHash'].includes(k)));
    fail(admission?.kind === 'parallel.admitted' && admission.taskId === run.id && admission.scope.chatId === run.chatId
      && admission.detail.foundation && digest(hearth ? admission.detail.foundation : stable(admission.detail.foundation)) === digest(hearth ? hearthFoundation(run) : stable(run)), 'the original admission does not bind this task.');
    fail(Array.isArray(run.sourceIds) && run.sourceIds.length > 0 && new Set(run.sourceIds).size === run.sourceIds.length
      && run.sourceIds.every(id=>state.messages.some(m=>m.id === id && m.chatId === run.chatId)), 'shared source records are missing.');
    fail(Number.isFinite(Date.parse(run.createdAt)) && Date.parse(run.deadline) - Date.parse(run.createdAt) <= limits.durationMs
      && (openRun(run) ? run.endedAt === null : Number.isFinite(Date.parse(run.endedAt))), 'invalid task lifetime.');
    if (hearth) validateHearthRun(state,run);
  }
  for (const job of p.jobs) {
    const run = p.runs.find(r => r.id === job.runId);
    if(isContinuing(run)){validateContinuingJob(state,job,run);fail(job.toolContract===null||run.toolsEnabled&&validToolContract(job.toolContract,job.model)&&!job.toolContract.parallel&&job.toolContract.chatId===run.chatId,'Peer tools escaped admission.');continue;}
    fail(run && run.episodeIds.includes(job.id) && job.chatId === run.chatId && text(job.angle, 1000) && text(job.reason, 1000), 'approach escaped its task.');
    fail(hash(job.contextHash) && hash(job.modelHash) && digest(job.model) === job.modelHash
      && (job.selection === null || job.model.id === job.selection?.modelId), 'approach model/context changed.');
    fail(['queued', 'pending', ...terminal].includes(job.status) && (job.output === null || typeof job.output === 'string' && job.output.length <= 20000), 'invalid contribution.');
    fail(job.model.runtime !== 'codex' || run.cloudApproved, 'cloud delivery was not admitted.');
    fail(job.handoff === null || job.handoff.taskId === job.id && job.handoff.kind === 'parallel' && job.handoff.scope.chatId === run.chatId, 'handoff escaped its approach.');
    fail(job.toolContract === null || run.toolsEnabled && validToolContract(job.toolContract,job.model)
      && ['branchline.conversation-tools/2','branchline.conversation-tools/5','branchline.conversation-tools/6'].includes(job.toolContract.profile) && !job.toolContract.parallel && job.toolContract.chatId === run.chatId
      && job.toolContract.history.count === run.sourceIds.length, 'tools escaped the original task snapshot.');
    fail(Number.isSafeInteger(job.index) && run.episodeIds[job.index] === job.id && job.contextLimit > 0 && (job.maxTokens === null || job.maxTokens > 0), 'invalid approach allocation.');
    if (isHearth(run)) validateHearthJob(state,job,run);
    fail(job.status !== 'pending' || job.handoff !== null, 'pending approach has no handoff.');
    fail(job.status !== 'completed' || Boolean(job.output?.trim()) && job.handoff !== null, 'completed approach has no retained result.');
    const messages = state.messages.filter(m=>m.kind === 'parallel' && m.parallelEpisodeId === job.id);
    fail(messages.length === (job.output ? 1 : 0) && messages.every(m=>m.content === hearthDisplay(job) && m.chatId === job.chatId), 'contribution does not match its transcript.');
  }
}

export function preserveParallelHistory(before, after) {
  const old = before.parallel;
  if (!old) return;
  const next = after.parallel;
  fail(next, 'history was removed.');
  for (const key of ['settings', 'runs', 'jobs']) {
    fail(next[key].length >= old[key].length, 'history was removed.');
    for (let i = 0; i < old[key].length; i++) {
      const a = old[key][i], b = next[key][i];
      if(key==='runs'&&isContinuing(a)){preserveContinuing(a,b);continue;}
      if (key === 'runs' && isHearth(a)) {
        preserveHearthRun(a,b);
        for (const k of Object.keys(a.usage)) fail(b.usage[k] >= a.usage[k], 'known resource use was reduced.');
        continue;
      }
      const mutable = key === 'runs' && liveRun(a) ? ['status', 'error', 'endedAt', 'usage'] : key === 'jobs' && liveJob(a) ? ['status', 'error', 'endedAt', 'output', 'finishReason', 'handoff'] : [];
      const stable = value => Object.fromEntries(Object.entries(value).filter(([k]) => !mutable.includes(k)));
      fail(digest(stable(a)) === digest(stable(b)), 'prior foundation or result was rewritten.');
      if (key === 'runs') for (const k of Object.keys(a.usage)) fail(b.usage[k] >= a.usage[k], 'known resource use was reduced.');
      if (key === 'jobs' && a.handoff) fail(digest(a.handoff) === digest(b.handoff), 'handoff identity changed.');
    }
  }
}

// One shared counter object is carried across the requesting turn and every
// admitted approach. A new call ID, model or retry cannot replenish it.
export class ParallelBudget {
  constructor(limits = PARALLEL_LIMITS) { this.limits = limits; this.usage = { toolCalls: 0, toolBytes: 0, modelRounds: 0, outputCharacters: 0 }; this.deadline = Date.now() + limits.durationMs; this.runId = null; }
  take(key, n = 1) {
    fail(Date.now() < this.deadline, 'the task deadline was reached.');
    fail(Number.isSafeInteger(n) && n >= 0 && this.usage[key] + n <= this.limits[key], 'the shared ' + key + ' limit was reached.');
    this.usage[key] += n;
  }
  record(state) {
    const run = state.parallel?.runs.find(r => r.id === this.runId);
    if (run && (liveRun(run)||isContinuing(run))) run.usage = { ...this.usage };
  }
}
