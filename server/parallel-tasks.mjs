import { assertModelAvailable } from './model-archives.mjs';
import crypto from 'node:crypto';
import { digest, recordHandoff, prepareModelHandoff } from './handoff.mjs';
import { compileMessages, streamGenerate, replyTokenLimit } from './model.mjs';
import { contextBudget } from './context-budget.mjs';
import { resolveSpeaker, currentAssignment, assertInferenceIdle, ordinaryInferencePending } from './table.mjs';
import { makeToolContract, connectionToolProtocol, toolBindings } from './tool-contract.mjs';
import { ConversationTools } from './conversation-tools.mjs';
import { activeImageIds } from './images.mjs';
import { prepareModelWrite } from './effect-boundary.mjs';
import { agentSettings, parallelState, parallelBasis, ParallelBudget, PARALLEL_PROFILE, PARALLEL_LIMITS, liveRun, liveJob, openRun } from './parallel-state.mjs';

const fail = (ok, message) => { if (!ok) throw new Error(message); };
const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o,k));
const text = (v,n) => typeof v === 'string' && v.trim().length > 0 && v.length <= n;
const ref = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(v);
const uid = prefix => prefix + '_' + crypto.randomUUID();
const now = () => new Date().toISOString();

export function approachCandidates(state, chatId) {
  return (currentAssignment(state, chatId) ? ['personal', 'visiting'] : ['legacy']).flatMap(seat => {
    try { const selected = resolveSpeaker(state, chatId, seat); return [{ seat, ...selected }]; } catch { return []; }
  });
}

export class ParallelTasks {
  constructor(store, interactions, modelOptions = {}) {
    this.store = store; this.interactions = interactions; this.modelOptions = modelOptions;
    this.entries = new Map(); this.origins = new Map(); this.draining = null; this.preparing = false; this.closed = false; this.admissionEpoch = 0;
    this.chatAdmissionEpochs = new Map();
  }
  options(chatId) {
    return { settings: agentSettings(this.store.state), basisHash: parallelBasis(this.store.state, chatId), limits: PARALLEL_LIMITS,
      models: approachCandidates(this.store.state, chatId).map(c => ({ seat: c.seat, id: c.model.id, name: c.model.name, cloud: c.model.runtime === 'codex' })) };
  }
  requestProfile(state, chatId, model, replyMode) {
    const settings = agentSettings(state);
    if (!settings.enabled || !settings.automaticRequests || replyMode === 'both' || !connectionToolProtocol(model)) return null;
    // A local request has no implicit permission to send its context to OpenAI.
    const models = approachCandidates(state, chatId).filter(c => c.model.runtime !== 'codex' || model.runtime === 'codex')
      .map(c => ({ id: c.model.id, name: c.model.name, hash: digest(c.model) }));
    return models.length ? { grant: 'explicit_user_agent_settings', settingsId: settings.id, models } : null;
  }
  bindOrigin(exchangeId, { handoff, messages, model, contract, content, kind, selectedFile }) {
    if (!contract?.parallel) return null;
    const budget = new ParallelBudget();
    const origin = { exchangeId, handoff, messages, model, contract, content, kind, selectedFile, budget,
      basisHash: parallelBasis(this.store.state, handoff.scope.chatId, exchangeId) };
    this.origins.set(exchangeId, origin);
    return { sharedBudget: budget, parallelRequest: (args, callId) => this.requestFromModel(origin, args, callId) };
  }
  async requestFromModel(origin, args, callId) {
    const state = this.store.state, settings = agentSettings(state), chatId = origin.handoff.scope.chatId;
    fail(this.origins.get(origin.exchangeId) === origin && state.exchanges.find(e => e.id === origin.exchangeId)?.status === 'pending', 'This requesting episode is no longer active.');
    fail(settings.enabled && settings.automaticRequests && settings.explicitAutomaticOptIn && settings.id === origin.contract.parallel.settingsId, 'Automatic agent requests are not currently permitted.');
    fail(exact(args, ['angle', 'reason', 'model_id']) && text(args.angle,1000) && text(args.reason,1000), 'Use only a bounded angle, reason and admitted model.');
    const requested = origin.contract.parallel.models.find(m => m.id === args.model_id);
    const candidate = approachCandidates(state, chatId).find(c => c.model.id === args.model_id && digest(c.model) === requested?.hash);
    fail(candidate && (candidate.model.runtime !== 'codex' || origin.model.runtime === 'codex'), 'That model or data destination was not admitted for this task.');
    const fingerprint = digest({ source: origin.exchangeId, args });
    const prior = state.parallel?.runs.find(r => r.sourceExchangeId === origin.exchangeId);
    if (prior) { fail(prior.fingerprint === fingerprint, 'This task already used its additional approach allowance.'); return { runId: prior.id, status: prior.status, resultAvailable: !liveRun(prior) }; }
    fail(origin.basisHash === parallelBasis(state, chatId, origin.exchangeId), 'The original conversation changed. The request is held.');
    const run = await this.admit({ requestId: 'model_request_' + digest({ source: origin.exchangeId, callId }).slice(0,40), fingerprint,
      chatId, content: origin.content || state.handoffs.records.find(r => r.id === origin.handoff.requestId).detail.task.purpose,
      approaches: [{ seat: candidate.seat, angle: args.angle, reason: args.reason }], toolsEnabled: origin.contract.conversationEnabled === true,
      cloudApproved: origin.model.runtime === 'codex', basisHash: origin.basisHash }, origin);
    return { runId: run.id, status: 'queued', resultAvailable: false, message: 'The additional approach will run after this reply finishes. Continue without inventing its result.' };
  }
  async start(input) {
    fail(!activeImageIds(this.store.state, input.chatId).length, 'Pictures currently go to ordinary replies or Both. Remove pictures from the next reply before starting peer work; saved pictures stay available.');
    fail(exact(input, ['requestId', 'chatId', 'content', 'approaches', 'toolsEnabled', 'cloudApproved', 'basisHash']), 'Unexpected agent request fields.');
    fail(ref(input.requestId) && ref(input.chatId) && text(input.content,20000), 'Write a task of at most 20,000 characters.');
    fail(Array.isArray(input.approaches) && input.approaches.length === 2 && input.approaches.every(a => exact(a,['seat','angle']) && text(a.angle,1000)), 'Choose two approaches.');
    fail(typeof input.toolsEnabled === 'boolean' && typeof input.cloudApproved === 'boolean', 'Choose the task controls explicitly.');
    const fingerprint = digest(input);
    const prior = this.store.state.parallel?.runs.find(r => r.requestId === input.requestId);
    if (prior) { fail(prior.fingerprint === fingerprint, 'That request ID belongs to different work.'); return { runId: prior.id, state: this.store.state }; }
    assertInferenceIdle(this.store.state);
    const run = await this.admit({ ...input, fingerprint, approaches: input.approaches.map(a => ({ ...a, reason: 'This approach was explicitly selected by the user for the shared task.' })) });
    this.kick();
    return { runId: run.id, state: this.store.state };
  }
  async admit(input, origin = null) {
    fail(!this.closed && !this.preparing, 'Another agent request is being prepared.');
    this.preparing = true; const epoch=this.admissionEpoch;
    const chatEpoch = this.chatAdmissionEpochs.get(input.chatId) ?? 0;
    try {
      const before = this.store.state, settings = agentSettings(before), sourceExchangeId = origin?.exchangeId ?? null;
      fail(settings.enabled && (!origin || settings.automaticRequests), 'Enable agents in Settings. Automatic requests require the separate checkbox.');
      fail(!(before.parallel?.runs ?? []).some(openRun), 'Another parallel task is already using the shared allowance.');
      fail(input.basisHash === parallelBasis(before, input.chatId, sourceExchangeId), 'The task context changed. Review it before starting.');
      const candidates = input.approaches.map(a => {
        const c = approachCandidates(before,input.chatId).find(c => c.seat === a.seat);
        fail(c && (c.model.runtime !== 'codex' || input.cloudApproved), 'Choose an available chair and explicitly allow any OpenAI context delivery.');
        return c;
      });
      const root = before.roots.find(r => r.id === before.chats.find(c => c.id === input.chatId)?.rootId);
      const maxTokens = replyTokenLimit(root);
      const budgets = await Promise.all(candidates.map(c => contextBudget(c.model, { ...this.modelOptions, maxTokens })));
      const runId = uid('parallel'), budget = origin?.budget ?? new ParallelBudget(), prepared = new Map();
      let run;
      await this.store.transact(state => {
        fail(epoch===this.admissionEpoch && chatEpoch===(this.chatAdmissionEpochs.get(input.chatId)??0) && !this.closed,'Preparation was stopped; start deliberately again.');
        fail(settings.id === agentSettings(state).id && input.basisHash === parallelBasis(state,input.chatId,sourceExchangeId), 'Permissions or context changed while preparing the task.');
        if (!origin) assertInferenceIdle(state);
        else fail(state.exchanges.find(e => e.id === sourceExchangeId)?.status === 'pending', 'The requesting reply has ended.');
        const p = parallelState(state);
        fail(!p.runs.some(openRun), 'Another parallel task already reserved the device.');
        if (!origin) {
          state.messages.push({ id: uid('message'), chatId: input.chatId, role: 'user', content: input.content, createdAt: now(), kind: 'note', exchangeId: null,
            modelId: null, modelLabel: null, modelIdentifier: null, modelBaseUrl: null, instructionRevisionId: null });
          delete state.drafts[input.chatId];
        }
        const sourceIds = state.messages.filter(m => m.chatId === input.chatId && !(sourceExchangeId && m.role === 'assistant' && m.exchangeId === sourceExchangeId)).map(m => m.id);
        const basisHash = parallelBasis(state,input.chatId,sourceExchangeId);
        run = { id: runId, profile: PARALLEL_PROFILE, requestId: input.requestId, fingerprint: input.fingerprint, origin: origin ? 'model' : 'user',
          chatId: input.chatId, rootId: root.id, sourceExchangeId, purpose: input.content, basisHash,
          contextHash: digest({ basisHash, purpose: input.content, sourceIds }), sourceIds, settingsId: settings.id,
          limits: { ...PARALLEL_LIMITS }, usage: { ...budget.usage }, deadline: new Date(budget.deadline).toISOString(),
          toolsEnabled: input.toolsEnabled, cloudApproved: input.cloudApproved, episodeIds: [], status: 'queued', error: null, createdAt: now(), endedAt: null };
        for (let i = 0; i < candidates.length; i++) {
          const { model, selection, seat } = candidates[i], a = input.approaches[i];
          const messages = compileMessages(state,input.chatId,origin ? origin.content : '', { maxContextCharacters: Infinity, selection,
            requestKind: origin ? origin.kind : 'ask', selectedFile: origin?.selectedFile ?? null });
          messages.push({ role: 'user', content: '[Branchline task view: this angle is a contribution to the shared purpose. Return findings, source references, assumptions and anything unresolved. It supplies no new permission.]\n' + JSON.stringify({
            purpose: input.content, angle: a.angle, reason: a.reason, requestedBy: origin ? 'model under user-enabled settings' : 'user',
            priorRequester: sourceExchangeId, independentConfirmation: false,
          }) });
          const contextLimit = budgets[i].characters;
          fail(messages.reduce((n,m) => n + m.content.length,0) <= contextLimit, 'An approach exceeds its model context limit. Prepare a context handoff or choose a different model; nothing was trimmed.');
          const job = { id: uid('approach'), runId, chatId: input.chatId, index: i, seat, angle: a.angle, reason: a.reason,
            model: structuredClone(model), modelHash: digest(model), selection: structuredClone(selection), contextHash: digest(messages),
            toolContract: makeToolContract(state,{chatId:input.chatId,model,selectedFile:origin?.selectedFile,enabled:input.toolsEnabled,seat:selection?.seat ?? 'visiting',ceiling:origin ? toolBindings(origin.contract) : null}),
            contextLimit, maxTokens, status: 'queued', output: null, error: null, finishReason: null, handoff: null, endedAt: null };
          run.episodeIds.push(job.id); p.jobs.push(job); prepared.set(job.id,messages);
        }
        p.runs.push(run);
        const foundation = structuredClone(run);
        const admission = recordHandoff(state,{ kind:'parallel.admitted', taskId:run.id, scope:{ rootId:root.id,chatId:input.chatId }, from:origin?'model_request':'paired_local_ui',to:'app_task_queue',
          payload:foundation, status:'WITHIN_LOCAL_PROFILE', detail:{ foundation, profile:PARALLEL_PROFILE, sourceExchangeId, settingsId:settings.id, execution:'sequential', authorityCreated:false, effect:'record_parallel_contribution' } });
        run.admissionId = admission.id; run.admissionHash = admission.hash;
        return state;
      });
      budget.runId = runId;
      this.entries.set(runId,{ budget, prepared, controller:null, stopped:false, stopStatus:'cancelled', liveText:'', activeJobId:null });
      return run;
    } finally { this.preparing = false; }
  }
  check(run, entry) {
    fail(!this.closed && !entry.stopped && liveRun(run), 'This parallel task is stopped.');
    const settings = agentSettings(this.store.state);
    fail(settings.enabled && (run.origin === 'user' || settings.automaticRequests && settings.id === run.settingsId), 'Agent permission changed.');
    fail(Date.now() < entry.budget.deadline, 'The shared task deadline was reached.');
    fail(run.basisHash === parallelBasis(this.store.state,run.chatId,run.sourceExchangeId,run.id), 'The task context changed. Start a new request with the current context.');
  }
  async releaseOrigin(exchangeId) {
    const origin = this.origins.get(exchangeId); if (!origin) return;
    this.origins.delete(exchangeId);
    const run = this.store.state.parallel?.runs.find(r => r.sourceExchangeId === exchangeId);
    if (!run || !liveRun(run)) return;
    const exchange = this.store.state.exchanges.find(e => e.id === exchangeId);
    try {
      fail(exchange?.status === 'completed' && !exchange.truncated, 'The requesting reply did not complete. Its additional approach is held.');
      origin.budget.take('outputCharacters',this.store.state.messages.filter(m => m.exchangeId === exchangeId && m.role === 'assistant').reduce((n,m)=>n+m.content.length,0));
      await this.store.transact(state => { origin.budget.record(state); return state; });
      this.kick();
    } catch (error) { await this.cancel(run.id,'held',error.message); }
  }
  kick() {
    if (this.closed || this.draining || ordinaryInferencePending(this.store.state)) return;
    this.draining = this.drain().catch(error => { this.lastError = error.message; }).finally(() => { this.draining = null; });
  }
  async drain() {
    for (const [runId,entry] of this.entries) {
      let run = this.store.state.parallel?.runs.find(r => r.id === runId);
      if (!run || !liveRun(run) || this.closed || ordinaryInferencePending(this.store.state)) continue;
      try {
        if (run.sourceExchangeId) fail(this.store.state.exchanges.find(e=>e.id===run.sourceExchangeId)?.status === 'completed', 'The requesting reply is not complete.');
        await this.processRun(run,entry);
      } catch (error) {
        await this.finish(runId,entry.stopped?entry.stopStatus:'held',entry.stopped ? entry.stopReason || error.message : error.message);
      } finally {
        // If recording failed, retain received text for inspection instead of
        // silently discarding it. The unresolved run continues to block dispatch.
        if (!openRun(this.store.state.parallel.runs.find(r=>r.id===runId))) this.entries.delete(runId);
      }
    }
  }
  async processRun(run,entry) {
    for (const jobId of run.episodeIds) {
      run = this.store.state.parallel.runs.find(r=>r.id===run.id); this.check(run,entry);
      const job = this.store.state.parallel.jobs.find(j=>j.id===jobId);
      if (job.status !== 'queued') continue;
      await this.runJob(run,job,entry);
      fail(this.store.state.parallel.jobs.find(j=>j.id===jobId).status === 'completed', 'An approach did not complete. Remaining work is held.');
    }
    await this.finish(run.id,'completed');
  }
  async runJob(run,job,entry) {
    const messages = entry.prepared.get(job.id);
    fail(messages && digest(messages) === job.contextHash, 'The original context is unavailable; no saved receipt can resume it.');
    const controller = new AbortController(); entry.controller = controller; entry.activeJobId = job.id; entry.liveText = '';
    let handoff, contract, tools, content = '', finishReason = null, problem = null;
    const timeout = Math.min(this.modelOptions.timeoutMs ?? (job.model.runtime === 'codex' ? 300000 : 120000), entry.budget.deadline - Date.now());
    let expired = false;
    const timer = setTimeout(()=>{ expired=true; controller.abort(); }, Math.max(1,timeout));
    try {
      let preparedHandoff;
      await this.store.transact(state => {
        this.check(run,entry); fail(!ordinaryInferencePending(state), 'The model connection is occupied.');
        const live = state.parallel.jobs.find(j=>j.id===job.id); fail(live.status==='queued','This approach already ran.');
        assertModelAvailable(state,job.model.id);
        contract = job.toolContract;
        live.status = 'pending'; state.parallel.runs.find(r=>r.id===run.id).status='running';
        preparedHandoff = prepareModelHandoff(state,{ taskId:job.id,chatId:run.chatId,kind:'parallel',messages,purpose:run.purpose,
          selection:job.selection,toolContract:contract,parallelRunId:run.id,sourceExchangeId:run.sourceExchangeId,workspaceId:this.store.workspaceId,workspacePath:this.store.dataDir });
        live.handoff = preparedHandoff; return state;
      });
      handoff=preparedHandoff;
      const guard = () => this.check(this.store.state.parallel.runs.find(r=>r.id===run.id),entry);
      tools = contract ? new ConversationTools({store:this.store,handoff,contract,signal:controller.signal,interactions:this.interactions,sharedBudget:entry.budget,guard,
        ...(this.modelOptions.pageReader?{pageReader:this.modelOptions.pageReader}:{})}) : null;
      if (!tools) { entry.budget.take('modelRounds'); await this.store.transact(s=>{entry.budget.record(s);return s;}); }
      const stream = streamGenerate(job.model,messages,controller.signal,{ ...this.modelOptions,handoff,tools,maxTokens:job.maxTokens,maxContextCharacters:job.contextLimit,maxResponseBytes:80000 });
      for (;;) {
        const step = await stream.next();
        if (step.done) { finishReason=step.value; break; }
        content += step.value.text; entry.liveText = content.slice(0,20000);
        if ((job.hearthActor || job.peerId) && content.length > Math.min(20000, entry.budget.limits.outputCharacters-entry.budget.usage.outputCharacters-(job.hearthActor==='hearth'?0:3000))) {
          controller.abort(); await stream.return(); throw new Error('This episode reached its shared output allowance; received text is retained as incomplete.');
        }
      }
      guard();
    } catch (error) { problem = expired ? 'The approach reached its time limit.' : error.message; }
    finally { clearTimeout(timer); await tools?.close(); }
    if(job.hearthActor || job.peerId) {
      const remaining=entry.budget.limits.outputCharacters-entry.budget.usage.outputCharacters;
      entry.budget.usage.outputCharacters+=Math.min(remaining,content.length);
      if(content.length>remaining)problem||='The shared output allowance was reached.';
    } else try {
      entry.budget.take('outputCharacters',Math.min(content.length,20000));
    } catch (error) { problem ||= error.message; }
    await this.store.transact(state=>{entry.budget.record(state);return state;});
    if (handoff) await this.store.transact(state => prepareModelWrite(state,handoff,{content,finishReason,problem,cancelled:controller.signal.aborted&&!expired}).state);
    else if (problem) throw new Error(problem);
    entry.controller=null; entry.activeJobId=null; entry.liveText='';
  }
  async finish(runId,status,error=null,expectedMailCount=null) {
    const entry=this.entries.get(runId);
    await this.store.transact(state=>{
      const run=state.parallel?.runs.find(r=>r.id===runId); if (!run || !openRun(run)) return state;
      if(expectedMailCount!==null&&run.mail?.length!==expectedMailCount)return state;
      entry?.budget.record(state);
      for (const job of state.parallel.jobs.filter(j=>j.runId===runId&&liveJob(j))) { job.status=['completed','partial'].includes(status)?'held':status;job.error=error;job.endedAt=now(); }
      run.status=status;run.error=error;run.endedAt=now();
      recordHandoff(state,{kind:'parallel.finished',taskId:run.id,scope:{rootId:run.rootId,chatId:run.chatId},from:'app_task_queue',to:'shared_task',payload:{status,error,usage:run.usage},status:status==='completed'?'OBSERVED':'UNRESOLVED',detail:{authorityCreated:false}});
      return state;
    });
  }
  async cancel(runId,status='cancelled',reason='Stopped by the user. Completed contributions remain in history.') {
    const run=this.store.state.parallel?.runs.find(r=>r.id===runId); fail(run,'Parallel task not found.');
    if (!openRun(run)) return;
    const entry=this.entries.get(runId);
    if(entry) {entry.stopped=true;entry.stopStatus=status;entry.stopReason=reason;entry.controller?.abort();}
    if(!entry?.controller) { await this.finish(runId,status,reason); this.entries.delete(runId); }
  }
  stopAdmission(chatId = null) {
    if (chatId === null) this.admissionEpoch++;
    else this.chatAdmissionEpochs.set(chatId, (this.chatAdmissionEpochs.get(chatId) ?? 0) + 1);
  }
  async cancelChat(chatId) { for (const run of this.store.state.parallel?.runs??[]) if(run.chatId===chatId&&openRun(run)) await this.cancel(run.id); }
  async recheck() {
    for(const [id,entry] of this.entries) {
      const run=this.store.state.parallel?.runs.find(r=>r.id===id); if(!run||!openRun(run))continue;
      try {this.check(run,entry);} catch(error) {await this.cancel(id,'held',error.message);}
    }
  }
  status(chatId) {
    return { runtimeError:this.lastError??null, runs:(this.store.state.parallel?.runs??[]).filter(r=>r.chatId===chatId).slice(-5).map(r=>({id:r.id,status:r.status,error:r.error,usage:r.usage,
      profile:r.profile, waitingForUser:r.waitingForUser, mailCount:r.mail?.length ?? 0,
      jobs:r.episodeIds.map(id=>{const j=this.store.state.parallel.jobs.find(j=>j.id===id);return {id,status:j.status,angle:j.angle,model:j.model.name,hearthActor:j.hearthActor};}),
      active:this.entries.get(r.id)?.activeJobId??null,liveText:this.entries.get(r.id)?.liveText??''})) };
  }
  async close() {
    this.closed=true;
    for (const run of this.store.state.parallel?.runs??[]) if(openRun(run)) await this.cancel(run.id);
    await this.draining; this.origins.clear(); this.entries.clear();
  }
}
