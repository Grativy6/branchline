import {returnMap,readReturnSource} from '../server/return-map.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ReasoningNotes, NOTE_TOOL, noteSource } from '../server/reasoning-notes.mjs';
import { noteSettings, checkNoteSettings } from '../public/reasoning-notes-settings.js';
import { inspectChairLog } from '../server/desk-work.mjs';
import { validToolContract } from '../server/tool-contract.mjs';
import { replayJournal } from '../server/journal.mjs';
import { DeskTasks } from '../server/desk-tasks.mjs';
import { CodexProvider } from '../server/codex-provider.mjs';
import { CODEX_CONFIG, CODEX_VERSION } from '../server/codex-policy.mjs';
import { OpenAIProvider } from '../server/openai-provider.mjs';
import { fixture, finish, callTool, until, input } from './desk-helpers.mjs';

function clockFixture(cadenceSeconds = 30, runtime = 'compatible') {
  let time = 0;
  const settings = { enabled: true, cadenceSeconds, revision: 1, offRevision: 0 };
  const task = { id: 'task', chatId: 'chat', chairId: 'chair', label: 'Astra', selection: { displayName: 'Astra' }, model: { id: 'm', model: 'gpt-6-astra', name: 'Astra', runtime } };
  const store = { state: { chats: [{ id: 'chat', reasoningNotes: settings }] }, async transact(fn) { this.state = fn(this.state); } };
  const notes = new ReasoningNotes({ store, task, exchangeId: 'exchange', settings, clock: () => time, wall: () => new Date(1700000000000 + time).toISOString() });
  return { notes, store, task, advance: ms => { time += ms; }, events: () => store.state.deskWork?.events ?? [] };
}
const summary = (text, complete = false, itemId = 'item') => ({ source: 'provider_summary', threadId: 'thread', turnId: 'turn', itemId, part: 0, text, complete });

test('fixed defaults and all three cadences queue one ping behind work, never a new call', async () => {
  assert.deepEqual(noteSettings(null), { enabled: false, cadenceSeconds: 30, revision: 0, offRevision: 0 });
  assert.throws(() => checkNoteSettings({ enabled: true, cadenceSeconds: 22 }), /10, 30 or 60/);
  for (const seconds of [10, 30, 60]) {
    const f = clockFixture(seconds); f.notes.work = 1;
    f.advance(seconds * 1000 - 1); await f.notes.tick(); assert.equal(f.notes.pending, null);
    f.advance(1); await f.notes.tick(); const ping = structuredClone(f.notes.pending);
    for (let i = 0; i < 5; i++) { f.advance(seconds * 1000); await f.notes.tick(); }
    assert.deepEqual(f.notes.pending, ping); assert.equal(f.events().length, 0);
    assert.deepEqual(await f.notes.checkpoint({ ok: true, value: 'still working' }), { ok: true, value: 'still working' });
    f.notes.work = 0;
    const result = await f.notes.checkpoint({ ok: true, value: 'work finished' });
    assert.equal(result.reasoningNote.id, ping.id); assert(result.reasoningNote.offeredAt > ping.dueAt);
    assert.deepEqual(await f.notes.checkpoint({ ok: true }), { ok: true });
    assert.equal(f.events().length, 1);
    await f.notes.close(); assert.equal(f.notes.pending, null); assert.equal(f.events().length, 1);
  }
});

test('off, Stop and completion clear unserved pings without manufacturing notes', async () => {
  for (const reason of ['off', 'stop', 'complete']) {
    const f = clockFixture(10); f.advance(120000); await f.notes.tick(); assert(f.notes.pending);
    if (reason === 'off') { f.store.state.chats[0].reasoningNotes = { enabled: false, cadenceSeconds: 10, revision: 2, offRevision: 2 }; await f.notes.tick(); }
    else await f.notes.close(reason === 'stop' ? 'interrupted' : 'complete');
    assert.equal(f.notes.pending, null); assert.equal(f.events().length, 0);
    await f.notes.receive(summary('A late summary that must not be captured.', true)); assert.equal(f.events().length, 0);
  }
});

test('provider parts retain assembly, cadence, finalization and corrections without duplicate finals', async () => {
  const f = clockFixture(30, 'codex');
  await f.notes.receive(summary('First interpretation with enough detail. '));
  assert.equal(f.events().length, 1);
  await f.notes.receive(summary('A second observation.')); assert.equal(f.events().length, 1);
  f.advance(29999); await f.notes.tick(); assert.equal(f.events().length, 1);
  f.advance(1); await f.notes.tick(); assert.equal(f.events().length, 2);
  const final = 'A corrected final interpretation.';
  await Promise.all([f.notes.receive(summary(final, true)), f.notes.receive(summary(final, true)), f.notes.tick()]);
  assert.equal(f.events().length, 3);
  const records = f.events().filter(e => e.kind === 'reasoning.note');
  assert.equal(new Set(records.map(e => e.detail.noteId)).size, 1);
  assert.equal(records[2].detail.previousEventId, records[1].id); assert.equal(records[2].detail.text, final);
  assert.equal(records[0].detail.status, 'streaming'); assert.equal(records[2].detail.status, 'complete');
  await f.notes.close(); assert.equal(f.events().length, 3);
});

test('interrupted material and authored corrections retain evidence and actual received times', async () => {
  const f = clockFixture(10);
  const first = await f.notes.authored({ text: 'First choice.', ping_id: '', corrects: '' }, 'call1');
  f.advance(12000); await f.notes.tick(); const ping = f.notes.pending; await f.notes.checkpoint({ ok: true });
  f.advance(4000);
  await f.notes.authored({ text: 'Correction after checking the result.', ping_id: ping.id, corrects: first.value.noteId }, 'call2');
  const notes = f.events().filter(e => e.kind === 'reasoning.note');
  assert.equal(notes[1].detail.corrects, notes[0].detail.noteId); assert(notes[1].detail.receivedAt > notes[1].detail.ping.dueAt);
  assert(notes.every(e => e.visibility === 'drawer' && e.chairId === 'chair' && e.detail.source === 'agent_note'));
  const g = clockFixture(30, 'codex'); await g.notes.receive(summary('Incomplete summary from the provider.')); await g.notes.close('interrupted');
  assert.equal(g.events().at(-1).detail.status, 'interrupted'); assert.equal(g.events()[0].detail.status, 'streaming');
});

test('a quick off/on cannot revive an old call, and storage limits do not fail work', async () => {
  const f = clockFixture(); f.store.state.chats[0].reasoningNotes = { enabled: true, cadenceSeconds: 30, revision: 3, offRevision: 2 };
  assert.equal((await f.notes.authored({ text: 'Late', ping_id: '', corrects: '' }, 'late')).value.saved, false);
  const g = clockFixture(10, 'codex');
  for (let i = 0; i < 50; i++) await g.notes.receive(summary('x'.repeat(4000), true, 'item-' + i));
  assert(g.notes.limited); assert.equal(g.events().filter(e => e.kind === 'reasoning.limit').length, 1);
  await g.notes.close();
});

test('startup retains the earlier streaming record and closes it as interrupted without new work', async () => {
  const f = clockFixture(10, 'codex');
  await f.notes.receive(summary('A saved summary before an unexpected close.'));
  f.task.status = 'running'; f.store.state.deskWork.tasks.push(f.task);
  const tasks = new DeskTasks(f.store, { execute() { assert.fail('Recovery must not call a model'); } });
  try {
    await tasks.recover();
    assert.equal(f.task.status, 'interrupted');
    const records = f.events();
    assert.equal(records.length, 2); assert.equal(records[0].detail.status, 'streaming');
    assert.equal(records[1].detail.status, 'interrupted'); assert.equal(records[1].detail.previousEventId, records[0].id);
    await tasks.recover(); assert.equal(f.events().length, 2);
  } finally { await tasks.close(); }
});

test('enabled tool uses the existing continuation, remains private, survives journal replay, and off preserves the answer', { timeout: 20000 }, async () => {
  const f = await fixture();
  try {
    await f.command('chat.reasoningNotes', { id: f.chatId, settings: { enabled: true, cadenceSeconds: 10 } });
    const batch = await f.app.deskTasks.admit({ ...input(f, 'Inspect the work and answer.', 'notes_tool'), toolsEnabled: true });
    await until(() => f.requests.length === 1, 'first request');
    assert(f.requests[0].body.tools.some(t => t.function.name === NOTE_TOOL));
    const task = f.app.store.state.deskWork.tasks.find(t => t.id === batch.taskIds[0]);
    const entry = f.app.deskTasks.entries.get(task.id), session = entry.notes;
    const contract = f.app.store.state.handoffs.records.find(r => r.detail.task?.capability?.tools?.reasoningNotes)?.detail.task.capability.tools;
    assert(validToolContract(contract, task.model));
    session.nextDue = -1; await session.tick(); const pingId = session.pending.id;
    // The held inference is still the only request despite repeated ticks.
    for (let i = 0; i < 5; i++) await session.tick(); assert.equal(f.requests.length, 1);
    callTool(f.requests[0], 'read_clock', {}, 'clock');
    await until(() => f.requests.length === 2, 'natural continuation');
    assert(f.requests[1].body.messages.some(m => m.role === 'tool' && m.content.includes(pingId)));
    callTool(f.requests[1], NOTE_TOOL, { text: 'A deliberate checkpoint interpretation.', ping_id: pingId, corrects: '' }, 'note');
    await until(() => f.requests.length === 3, 'continuation after note');
    const event = f.app.store.state.deskWork.events.find(e => e.kind === 'reasoning.note'); assert(event);
    assert.equal(event.taskId, task.id); assert.equal(event.detail.exchangeId, entry.notes.exchangeId);
    assert(!JSON.stringify(returnMap(f.app.store.state, f.chatId, task.selection)).includes('deliberate checkpoint interpretation'));
    assert(inspectChairLog(f.app.store.state, task, { chair_id: task.chairId, query: 'deliberate checkpoint', offset: 0 }).text.includes('deliberate checkpoint'));
    await f.command('chat.reasoningNotes', { id: f.chatId, settings: { enabled: false, cadenceSeconds: 60 } });
    callTool(f.requests[2], NOTE_TOOL, { text: 'UNSAVED_AFTER_OFF', ping_id: '', corrects: '' }, 'late');
    await until(() => f.requests.length === 4, 'off did not cancel main work'); finish(f.requests[3], 'The ordinary answer stays intact.');
    await until(() => f.app.store.state.deskWork.tasks.every(t => t.status === 'completed'), () => JSON.stringify(f.app.store.state.deskWork.tasks));
    assert.equal(f.app.store.state.messages.at(-1).content, 'The ordinary answer stays intact.');
    assert(!JSON.stringify(f.app.store.state).includes('UNSAVED_AFTER_OFF'));
    const recovered = await replayJournal(f.app.store.file);
    assert.deepEqual(recovered.state.deskWork.events, f.app.store.state.deskWork.events);
    assert.deepEqual(recovered.state.chats[0].reasoningNotes, f.app.store.state.chats[0].reasoningNotes);
    assert.equal(recovered.state.deskWork.events.filter(e => e.kind === 'reasoning.note').length, 1);
    const next = await f.app.deskTasks.admit({ ...input(f, 'A plain reply.', 'notes_off'), toolsEnabled: true });
    await until(() => f.requests.length === 5, 'off request'); assert(!f.requests[4].body.tools.some(t => t.function.name === NOTE_TOOL));
    finish(f.requests[4]); await f.app.deskTasks.waitForTask(next.taskIds[0]);
  } finally { await f.close(); }
});

class NotesRpc extends EventEmitter {
  closed = false; next = 0; handlers = new Map(); turns = new Map(); interrupts = [];
  notify() {} registerToolHandler(id, fn) { this.handlers.set(id, fn); return () => this.handlers.delete(id); }
  async request(method, p) {
    if (method === 'initialize') return { userAgent: 'codex/' + CODEX_VERSION };
    if (method === 'config/read') return { config: { ...structuredClone(CODEX_CONFIG), chatgpt_base_url: 'https://chatgpt.com/backend-api/' }, layers: [{ name: { type: 'sessionFlags' }, config: structuredClone(CODEX_CONFIG) }] };
    if (method === 'account/read') return { account: { type: 'chatgpt', email: 'fixture@example.test', planType: 'plus' } };
    if (method === 'model/list') return { data: ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna'].map(model => ({ model, displayName: model })) };
    if (method === 'thread/start') return { thread: { id: 'thread-' + (++this.next) }, model: p.model, modelProvider: 'openai', approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: { type: 'readOnly' }, instructionSources: [], runtimeWorkspaceRoots: [] };
    if (method === 'turn/start') { const turnId = p.threadId + '-turn'; this.turns.set(p.threadId, { ...p, turnId }); return { turn: { id: turnId } }; }
    if (method === 'turn/interrupt') { this.interrupts.push(p); this.emit('notification', { method: 'turn/completed', params: { ...p, turn: { status: 'interrupted' } } }); }
    return {};
  }
  emitFor(id, method, params) { this.emit('notification', { method, params: { threadId: id, turnId: this.turns.get(id).turnId, ...params } }); }
  finish(id) { this.emitFor(id, 'item/completed', { item: { type: 'agentMessage', id: id + '-answer', text: 'Ordinary ' + id, phase: 'unknown_future_phase' } }); this.emitFor(id, 'turn/completed', { turn: { status: 'completed' } }); }
  close() { this.closed = true; this.emit('disconnected', new Error('Closed')); }
}

test('three Codex chairs route summaries by item and turn; independent Stop and unknown phases preserve ordinary output', async () => {
  const rpc = new NotesRpc(), provider = new CodexProvider({ accountDir: process.cwd(), binaryResolver: async () => '/fixture', rpcFactory: () => rpc });
  const controllers = [0, 1, 2].map(() => new AbortController()), output = [[], [], []];
  const jobs = ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna'].map((model, index) => (async () => {
    for await (const value of provider.stream({ model }, [{ role: 'user', content: 'Hi' }], controllers[index].signal, { notes: { enabled: () => index !== 2, source: 'provider_summary' } })) output[index].push(value);
  })());
  const stopped = assert.rejects(jobs[0], /stopped|interrupted/i);
  await until(() => rpc.turns.size === 3, 'three summary streams');
  assert.deepEqual([...rpc.turns.values()].map(t => t.summary), ['auto', 'auto', 'none']);
  for (const id of ['thread-2', 'thread-1', 'thread-3']) {
    rpc.emitFor(id, 'item/reasoning/summaryTextDelta', { itemId: id + '-note', summaryIndex: 0, delta: 'Summary for ' + id });
    rpc.emitFor(id, 'item/reasoning/textDelta', { itemId: 'private', delta: 'DO_NOT_CAPTURE' });
    rpc.emitFor(id, 'item/completed', { item: { type: 'reasoning', id: id + '-note', summary: ['Summary for ' + id], content: ['DO_NOT_CAPTURE'] } });
  }
  controllers[0].abort(); await stopped; rpc.finish('thread-2'); rpc.finish('thread-3'); await Promise.all(jobs.slice(1));
  assert.equal(rpc.interrupts.length, 1); assert(!JSON.stringify(output).includes('DO_NOT_CAPTURE'));
  assert(output[1].filter(p => p.note).every(p => p.note.threadId === 'thread-2' && p.note.turnId === 'thread-2-turn'));
  assert.equal(output[1].filter(p => p.text).map(p => p.text).join(''), 'Ordinary thread-2');
  assert(!output[2].some(p => p.note)); provider.close();
  assert.equal(noteSource({ runtime: 'codex', model: 'gpt-6-astra' }), 'provider_summary');
});

test('Responses summaries are typed, opaque content stays private, and off keeps the original request', async () => {
  const bodies = [];
  const provider = new OpenAIProvider({ key: () => 'synthetic-only', fetcher: async (url, options) => {
    bodies.push(JSON.parse(options.body));
    const result = { id: 'response-fixture', status: 'completed', output: [{ type: 'reasoning', id: 'r1', summary: [{ type: 'summary_text', text: 'Exposed summary' }], encrypted_content: 'DO_NOT_CAPTURE' }, { type: 'message', content: [{ type: 'output_text', text: 'Answer' }] }], usage: { input_tokens: 10, output_tokens: 10 } };
    return new Response([{ type: 'response.reasoning_summary_text.delta', item_id: 'r1', summary_index: 0, delta: 'Exposed summary' }, { type: 'response.reasoning_summary_text.done', item_id: 'r1', summary_index: 0, text: 'Exposed summary' }, { type: 'response.output_text.delta', delta: 'Answer' }, { type: 'response.completed', response: result }].map(e => 'data: ' + JSON.stringify(e) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const model = { runtime: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-astra', thinking: false };
  for (const enabled of [false, true]) {
    const values = []; for await (const value of provider.stream(model, [{ role: 'user', content: 'Hi' }], new AbortController().signal, { notes: { enabled: () => enabled, source: 'provider_summary' } })) values.push(value);
    assert.equal(values.filter(v => v.text).map(v => v.text).join(''), 'Answer'); assert.equal(values.some(v => v.note), enabled);
    assert(!JSON.stringify(values).includes('DO_NOT_CAPTURE'));
  }
  assert.deepEqual(bodies[0].reasoning, { effort: 'low' }); assert.deepEqual(bodies[1].reasoning, { effort: 'low', summary: 'auto' });
});
