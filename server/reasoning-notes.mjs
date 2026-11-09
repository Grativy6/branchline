import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { noteSettings } from '../public/reasoning-notes-settings.js';
import { deskEvent } from './desk-work.mjs';

export const NOTE_TOOL = 'record_reasoning_note';
export const NOTE_PROFILE = 'branchline.reasoning-notes/1';
const catalog = JSON.parse(readFileSync(new URL('./codex-model-catalog.json', import.meta.url), 'utf8')).models;
export function noteSource(model) {
  if (model.runtime === 'codex') {
    const entry = catalog.find(m => m.slug === model.model);
    return entry?.supports_reasoning_summaries === true && entry?.supports_reasoning_summary_parameter === true ? 'provider_summary' : 'agent_note';
  }
  return model.runtime === 'openai' ? 'provider_summary' : 'agent_note';
}

// A task-local recorder, driven by the existing Activity tick. It cannot call a
// model, interrupt a turn, or schedule work. A due ping rides the next tool result.
export class ReasoningNotes {
  constructor({ store, task, exchangeId, settings, clock = () => performance.now(), wall = () => new Date().toISOString() }) {
    Object.assign(this, { store, task, exchangeId, settings, clock, wall });
    this.source = noteSource(task.model);
    this.started = clock(); this.lastRelease = -Infinity; this.nextDue = this.started + settings.cadenceSeconds * 1000;
    this.pending = null; this.parts = new Map(); this.queue = Promise.resolve(); this.closed = false;
    this.count = 0; this.bytes = 0; this.limited = false; this.error = null; this.work = 0;
    this.operations = Promise.resolve(); this.cadence = settings.cadenceSeconds;
  }
  serial(fn) {
    const result = this.operations.then(fn);
    this.operations = result.catch(error => { this.error ??= error; });
    return result;
  }
  tick() { return this.serial(() => this.tickNow()); }
  checkpoint(result) { return this.serial(() => this.checkpointNow(result)); }
  authored(args, callId) { return this.serial(() => this.authoredNow(args, callId)); }
  receive(value) { return this.serial(() => this.receiveNow(value)); }
  close(status) { return this.serial(() => this.closeNow(status)); }
  current() { return noteSettings(this.store.state.chats.find(c => c.id === this.task.chatId)); }
  enabled() { const c = this.current(); return !this.closed && !this.stopRequested && this.settings.enabled && c.enabled && c.offRevision === this.settings.offRevision && !this.limited; }
  status() {
    if (!this.enabled()) return this.limited ? 'Note limit reached; work continues' : null;
    if (this.source === 'unavailable') return 'No note source for this reply';
    return this.source === 'provider_summary' ? (this.parts.size ? 'Provider summaries' : 'Waiting for an exposed summary')
      : this.pending ? (this.pending.offeredAt ? 'Note offered at a work checkpoint' : 'Note queued behind current work') : 'Notes at work checkpoints';
  }
  append(kind, detail) {
    const operation = this.queue.then(async () => {
      let event;
      await this.store.transact(s => { event = deskEvent(s, this.task, kind, { profile: NOTE_PROFILE, exchangeId: this.exchangeId, ...detail }, 'drawer'); return s; });
      return event;
    });
    this.queue = operation.catch(error => { this.error ??= error; });
    return operation;
  }
  async tickNow() {
    if (this.closed) return;
    if (!this.enabled()) { await this.closeNow('interrupted'); return; }
    if (this.source === 'unavailable') return;
    const time = this.clock();
    const cadence = this.current().cadenceSeconds;
    if (cadence !== this.cadence) { this.cadence = cadence; this.nextDue = time + cadence * 1000; }
    if (!this.pending && time >= this.nextDue) this.pending = { id: 'noteping_' + crypto.randomUUID(), dueAt: this.wall(), offeredAt: null };
    if (time - this.lastRelease >= this.current().cadenceSeconds * 1000) await this.flush();
  }
  async checkpointNow(result) {
    await this.tickNow();
    if (!this.enabled() || this.source !== 'agent_note' || !this.pending || this.pending.offeredAt || this.work) return result;
    this.pending.offeredAt = this.wall();
    const ping = { ...this.pending, message: 'A short consideration note is due. Keep doing the assignment. If useful, use record_reasoning_note for an interpretation, choice, uncertainty or correction; an empty text declines it. Do not interrupt work or make a closing note just for the timer.' };
    await this.append('reasoning.ping', ping);
    return { ...result, reasoningNote: ping };
  }
  async authoredNow(args, callId) {
    if (!this.enabled()) return { ok: true, value: { saved: false, reason: 'Reasoning notes are off. Continue the assignment.' } };
    if (typeof args.text !== 'string' || args.text.length > 4000 || typeof args.ping_id !== 'string' || typeof args.corrects !== 'string')
      return { ok: false, error: 'Use a short note, the offered ping_id (or empty), and a saved note ID for a correction (or empty).' };
    const prior = args.corrects && [...this.parts.values()].find(p => p.id === args.corrects);
    if (args.corrects && !prior) return { ok: false, error: 'Corrections must reference a saved note from this task.' };
    if (args.ping_id && args.ping_id !== this.pending?.id) return { ok: false, error: 'That ping is no longer pending; continue the assignment.' };
    if (this.count && !this.pending?.offeredAt && !prior) return { ok: true, value: { saved: false, reason: 'No note is due. Continue the assignment.' } };
    const ping = this.pending;
    this.pending = null; this.nextDue = this.clock() + this.current().cadenceSeconds * 1000;
    if (!args.text.trim()) { await this.append('reasoning.declined', { callId, ping }); return { ok: true, value: { saved: false, declined: true } }; }
    const part = { id: 'note_' + crypto.randomUUID(), source: 'agent_note', sourceIds: { callId }, text: args.text, receivedAt: this.wall(), status: 'complete', corrects: prior?.id ?? null, ping };
    this.parts.set(callId, part);
    await this.save(part);
    return { ok: true, value: { saved: Boolean(part.eventId), noteId: part.id, visibility: 'chair_log', ...(this.limited ? { limit: 'No further notes will be saved in this reply; work continues.' } : {}) } };
  }
  async receiveNow(value) {
    if (!this.enabled() || value?.source !== 'provider_summary' || typeof value.itemId !== 'string' || !Number.isSafeInteger(value.part) || value.part < 0) return;
    const key = JSON.stringify([value.threadId ?? null, value.turnId ?? null, value.itemId, value.part]);
    let part = this.parts.get(key);
    if (!part) {
      if (this.parts.size >= 32) { await this.limit(); return; }
      part = { id: 'note_' + crypto.randomUUID(), source: value.source, sourceIds: { threadId: value.threadId ?? null, turnId: value.turnId ?? null, itemId: value.itemId, part: value.part }, text: '', receivedAt: this.wall(), status: 'streaming' };
      this.parts.set(key, part);
    }
    if (typeof value.text !== 'string') return;
    // Final snapshots replace the in-memory assembly. Previously saved versions
    // remain immutable and are linked by previousEventId when they change.
    const combined = value.complete ? value.text : part.status !== 'complete' ? part.text + value.text : part.text;
    part.omitted = part.omitted || combined.length > 4000;
    part.text = combined.slice(0, 4000);
    if (value.complete) part.status = 'complete';
    part.receivedAt = this.wall();
    if (this.lastRelease === -Infinity && part.text.trim().length >= 32 || value.complete) await this.save(part);
  }
  async limit() {
    if (this.limited) return;
    this.limited = true; this.pending = null;
    await this.append('reasoning.limit', { message: 'Further note material omitted at this task’s storage limit. Ordinary work continues.' });
  }
  async save(part) {
    if (!part.text.trim()) return;
    const fingerprint = JSON.stringify([part.text, part.status, !!part.omitted]);
    if (fingerprint === part.saved || this.limited) return;
    const size = Buffer.byteLength(part.text);
    if (this.count >= 64 || this.bytes + size > 65536) { await this.limit(); return; }
    const event = await this.append('reasoning.note', { noteId: part.id, source: part.source, sourceIds: part.sourceIds,
      text: part.text, receivedAt: part.receivedAt, status: part.status, omitted: !!part.omitted,
      previousEventId: part.eventId ?? null, corrects: part.corrects ?? null, ping: part.ping ?? this.pending,
      model: { id: this.task.model.id, name: this.task.model.name, model: this.task.model.model }, settings: this.settings });
    part.eventId = event.id; part.saved = fingerprint; this.count++; this.bytes += size; this.lastRelease = this.clock();
    if (part.source === 'provider_summary') { this.pending = null; this.nextDue = this.clock() + this.current().cadenceSeconds * 1000; }
  }
  async flush() { for (const part of this.parts.values()) await this.save(part); }
  async closeNow(status = 'complete') {
    if (this.closed) { await this.queue; if (this.error) throw this.error; return; }
    this.closed = true; this.pending = null;
    for (const part of this.parts.values()) if (part.status === 'streaming') part.status = status;
    await this.flush(); await this.queue;
    if (this.error) throw this.error;
  }
}
