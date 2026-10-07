import { prepareModelWrite } from './effect-boundary.mjs';
import { beginReflection } from './continuity.mjs';
import fs from 'node:fs/promises';
import { beginMindReflection, MIND_LIMITS } from './mind.mjs';
import { generateResult } from './model.mjs';
import { prepareModelHandoff, protocolMessages, digest } from './handoff.mjs';
import { beginCarry, carryBasis, carryPreview, chatMessages, activeCarry, readyCarry, CARRY_OUTPUT_SCHEMA } from './context-carry.mjs';
import { resourceSettings, carrySettings } from '../public/resource-settings.js';
import { contextBudget } from './context-budget.mjs';
import { sharedContextPlan } from './shared-context.mjs';
import { resolveRecorder } from './carry-recorder.mjs';
import { inferencePending } from './table.mjs';
import { setTimeout as delay } from 'node:timers/promises';

// Only this local generation path supplies model-authored text to the store.
// Human commands can review/remove it but cannot submit replacement journal text.
export class ReflectionManager {
  constructor(store, modelOptions = {}) {
    this.store = store;
    this.modelOptions = modelOptions;
    this.active = new Map();
    this.running = new Set();
    this.queued = new Map();
    this.lastResult = new Map();
    this.suspended = new Set();
    this.considering = false;
  }

  run(input, options) {
    const task = this.perform(input, options);
    this.running.add(task);
    task.finally(() => this.running.delete(task)).catch(() => {});
    return task;
  }

  startCarry(input) {
    if (this.active.has(input.chatId)) throw new Error('A handoff or reflection is already preparing.');
    // A queue receipt is not a new model grant. Capture the source cutoff now.
    this.suspended.delete(input.chatId);
    const task = this.run({ ...input, target: 'carry' }, { queue: true });
    task.then(result => this.lastResult.set(input.chatId, { status: result.status, error: result.error ?? null }),
      error => this.lastResult.set(input.chatId, { status: 400, error: error.message }));
    return { status: this.queued.has(input.chatId) ? 'queued' : 'preparing', cutoff: input.lastMessageId,
      connection: 'HTTP preparations may overlap replies on compatible connections; Codex and the included runner use the queue.' };
  }

  status(chatId) { return { phase: this.queued.has(chatId) ? 'queued' : this.active.has(chatId) ? 'preparing' : 'idle', paused: this.suspended.has(chatId)||this.store.state.chats.find(c=>c.id===chatId)?.workStopped===true, result: this.lastResult.get(chatId) ?? null }; }

  async consider() {
    if (this.considering || this.active.size || inferencePending(this.store.state)) return;
    this.considering = true;
    try {
      for (const chat of this.store.state.chats) {
        const settings = carrySettings(chat);
        if (!settings.automatic || chat.workStopped || this.suspended.has(chat.id) || chat.archivedAt || readyCarry(this.store.state, chat.id)) continue;
        const state = this.store.state, root = state.roots.find(r => r.id === chat.rootId);
        if (root?.archivedAt) continue;
        try {
          const shared = await sharedContextPlan(state, chat.id, this.modelOptions);
          const headroom = Math.max(3000, shared.target?.recentCharacters ?? 0);
          if (shared.characters < shared.limit - headroom || !shared.target) continue;
          const chosen = resolveRecorder(state, chat.id, settings.speaker), model = chosen.model;
          if (chat.carryWriter !== digest(model)) { this.lastResult.set(chat.id,{status:400,error:'The automatic recorder connection changed. Review and save the conversation settings to use it.'}); continue; }
          const budget = await contextBudget(model, { ...this.modelOptions, maxTokens: 2048 });
          const preview = carryPreview(state, chat.id, { maxContextCharacters: budget.characters, target: shared.target, recorder: chosen.selection.recorder });
          if (!preview.preparation || state.contextCarry?.jobs.some(j => j.chatId === chat.id && j.baseId === preview.activeId && j.through === preview.preparation.through)) continue;
          if (this.store.state !== state || this.suspended.has(chat.id) || this.active.size || inferencePending(state)) return;
          this.startCarry({ chatId: chat.id, speaker: settings.speaker, baseId: activeCarry(state, chat.id)?.id ?? null, lastMessageId: chatMessages(state, chat.id).at(-1)?.id });
          return;
        } catch (error) { this.lastResult.set(chat.id, { status: 400, error: error.message }); }
      }
    } finally { this.considering = false; }
  }

  async perform(input, { signal, queue = false } = {}) {
    const isMind = input.target === 'mind';
    const isCarry = input.target === 'carry';
    if (this.active.has(input.chatId)) throw new Error('A reflection is already running in this chat.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    this.active.set(input.chatId, controller);
    let prepared;
    let result;
    let timedOut = false;
    let timer;
    try {
      const initialBasis = isCarry ? carryBasis(this.store.state, input.chatId) : null;
      const preferences = () => digest(this.store.state.chats.find(c => c.id === input.chatId)?.carrySettings ?? null);
      const initialPreferences = isCarry ? preferences() : null;
      const initialWriter = isCarry ? digest(resolveRecorder(this.store.state, input.chatId, input.speaker)) : null;
      if (isCarry && queue && inferencePending(this.store.state)) {
        const basis = carryBasis(this.store.state, input.chatId);
        this.queued.set(input.chatId, input.lastMessageId);
        const deadline = Date.now() + 300000;
        while (inferencePending(this.store.state)) {
          if (Date.now() > deadline) throw new Error('The handoff queue expired. No model request was made.');
          await delay(200, undefined, { signal: controller.signal });
        }
        if (basis !== carryBasis(this.store.state, input.chatId)) throw new Error('The handoff base or settings changed while queued. Prepare again.');
        this.queued.delete(input.chatId);
      }
      if (isCarry && (preferences() !== initialPreferences || carryBasis(this.store.state, input.chatId) !== initialBasis || digest(resolveRecorder(this.store.state, input.chatId, input.speaker)) !== initialWriter)) throw new Error('The writer or context changed while queued. No model request was made.');
      let carryBudget = null, carryModelHash = null, carryTarget = null, carryState = null;
      if (isCarry) {
        const state = this.store.state;
        carryState = carryBasis(state, input.chatId);
        const root = state.roots.find(r => r.id === state.chats.find(c => c.id === input.chatId)?.rootId);
        const model = resolveRecorder(state, input.chatId, input.speaker).model;
        carryModelHash = model ? digest(model) : null;
        const [writerBudget, shared] = await Promise.all([
          contextBudget(model, { ...this.modelOptions, maxTokens: 2048 }), sharedContextPlan(state, input.chatId, this.modelOptions),
        ]);
        if (!shared.target) throw new Error(shared.contextIssue);
        carryBudget = writerBudget; carryTarget = shared.target;
      }
      if (isMind) {
        const journalBytes = this.store.journalBytes; // Compression cannot enlarge the existing learning budget.
        if (journalBytes >= (this.modelOptions.mindJournalQuotaBytes ?? MIND_LIMITS.journalBytes)) throw new Error('Learning reflection is paused at its journal budget. History is preserved; no model call was made.');
      }
      await this.store.transact(state => {
        if (controller.signal.aborted) throw new Error('Reflection stopped before it began.');
        if (isCarry) {
          if (carryBasis(state, input.chatId) !== carryState) throw new Error('The handoff base or guidance changed while its shared window was checked. Reopen Context and try again.');
          const { target, ...request } = input;
          prepared = beginCarry(state, request, { ...this.modelOptions, maxContextCharacters: carryBudget.characters, target: carryTarget });
          if (preferences() !== initialPreferences || digest(prepared.model) !== carryModelHash || digest({ model: prepared.model, selection: prepared.selection }) !== initialWriter) throw new Error('The recorder changed during preparation. Reopen the handoff and choose the current recorder.');
          prepared.job.budget = carryBudget;
        } else prepared = isMind ? beginMindReflection(state, input, this.modelOptions) : beginReflection(state, { chatId: input.chatId, exchangeId: input.exchangeId, target: input.target, speaker: input.speaker, maxContextCharacters: this.modelOptions.maxContextCharacters ?? 60000 });
        if (prepared.replay) return state;
        prepared.messages = protocolMessages(prepared.messages);
        if (prepared.messages.reduce((n, message) => n + message.content.length, 0) > (carryBudget?.characters ?? this.modelOptions.maxContextCharacters ?? 60000)) throw new Error('Reflection context exceeds limit including the handoff.');
        if (!isCarry) prepared.job.inputMessages = prepared.messages;
        prepared.handoff = prepareModelHandoff(state, { taskId: prepared.job.id, chatId: input.chatId, kind: input.target, messages: prepared.messages, purpose: isCarry ? 'Prepare a source-linked working account for the next episode, preserving recent exchanges and all original history.' : `Reflect on the selected exchange into ${input.target}.`, sourceExchangeId: input.exchangeId ?? null, selection: prepared.selection, workspaceId:this.store.workspaceId,workspacePath:this.store.dataDir });
        prepared.job.handoff = prepared.handoff;
        return state;
      });
      if (prepared.replay) return { status: prepared.replay.status === 'pending' ? 409 : 200, state: this.store.state, ...(prepared.replay.status === 'pending' ? { error: 'This learning reflection is already running.' } : {}) };
      const root = this.store.state.roots.find(r => r.id === this.store.state.chats.find(c => c.id === input.chatId)?.rootId);
      timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.modelOptions.reflectionTimeoutMs ?? this.modelOptions.timeoutMs ?? (isCarry ? resourceSettings(root).handoffSeconds * 1000 : 120000));
      result = await generateResult(prepared.model, prepared.messages, controller.signal, {
        ...this.modelOptions, maxTokens: input.target === 'journal' ? 1024 : 2048, handoff: prepared.handoff,
        ...(isCarry ? { outputSchema: CARRY_OUTPUT_SCHEMA } : {}),
      });
      if (controller.signal.aborted) throw new Error('Reflection stopped.');
      let accepted;
      let issue = null;
      const state = await this.store.transact(state => {
        controller.signal.throwIfAborted();
        const write = prepareModelWrite(state, prepared.handoff, result);
        accepted = write.accepted; issue = write.issue;
        return write.state;
      });
      return { status: accepted ? 200 : 409, state, ...(accepted ? {} : { error: issue ?? 'The handoff was held. No memory, wake, or proposal was adopted.' }) };
    } catch (error) {
      if (!prepared?.job || !(isCarry ? this.store.state.contextCarry?.jobs.some(job => job.id === prepared.job.id) : isMind ? this.store.state.mind?.jobs.some(job => job.id === prepared.job.id) : this.store.state.roots.some(root => root.continuity?.jobs.some(job => job.id === prepared.job.id)))) throw error;
      const cancelled = controller.signal.aborted && !timedOut;
      const message = isCarry && (timedOut || cancelled) ? 'Context preparation stopped. The previous account and original history are unchanged.' : timedOut ? 'The local model did not finish the reflection in time. No memory or proposal was added.'
        : cancelled ? 'Reflection stopped. No memory or proposal was added.'
        : error.message === 'fetch failed' ? 'Could not reach the local model. Check that its server and model are ready.' : error.message;
      const state = await this.store.transact(state => {
        return prepareModelWrite(state, prepared.handoff, { content: result?.content ?? '', problem: message, cancelled }).state;
      });
      return { status: cancelled ? 409 : 502, state, error: message };
    } finally {
      clearTimeout(timer);
      this.queued.delete(input.chatId);
      signal?.removeEventListener('abort', abort);
      if (this.active.get(input.chatId) === controller) this.active.delete(input.chatId);
    }
  }

  cancel(chatId) {
    this.suspended.add(chatId);
    const controller = this.active.get(chatId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  async close() {
    for (const controller of this.active.values()) controller.abort();
    await Promise.allSettled(this.running);
  }
}

export function exportContinuity(state, { rootId, chatId, document }) {
  const root = state.roots.find(item => item.id === rootId);
  if (!root) throw new Error('Branch not found.');
  if (document === 'agents') return root.instructions.at(-1)?.text || '';
  if (document === 'heart') return root.continuity?.heart.at(-1)?.text || '';
  if (document !== 'memories') throw new Error('Unknown continuity document.');
  const chat = state.chats.find(item => item.id === chatId && item.rootId === root.id);
  if (!chat) throw new Error('Choose a chat in this branch.');
  const entries = (root.continuity?.journal || []).filter(entry => entry.chatId === chat.id && !entry.removedAt);
  const header = '# memories.md\n\nModel-authored context for this chat. Not verified facts, instructions, or permissions.\n\n';
  return header + entries.map(entry => {
    const job = root.continuity.jobs.find(item => item.id === entry.jobId);
    return `## ${entry.createdAt}\n\nEntry: ${entry.id}\nSource exchange: ${job.sourceExchangeId}\nModel: ${job.modelLabel} (${job.modelIdentifier})\n\n${entry.text}\n`;
  }).join('\n');
}
