import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { initialState, applyCommand } from '../server/domain.mjs';
import { Store } from '../server/store.mjs';
import { journalRecords, replayJournal } from '../server/journal.mjs';
import { journalChange, applyJournalChange } from '../server/journal-change.mjs';
import { fixture } from './helpers.mjs';

async function workspace() {
  await fs.mkdir('.test-data', { recursive: true });
  return fs.mkdtemp(path.resolve('.test-data/journal-'));
}
const snapshot = (state, sequence = 1) => ({ type: 'snapshot', sequence, at: new Date().toISOString(), state });

test('stream replay handles UTF-8, CRLF and arbitrary chunk boundaries', async () => {
  const dir = await workspace(), file = path.join(dir, 'events.jsonl');
  const state = applyCommand(initialState(), { type: 'root.create', payload: { name: 'Garden 💛 é — 🌱', mode: 'personal' } });
  await fs.writeFile(file, JSON.stringify(snapshot(state)) + '\r\n' + JSON.stringify(snapshot(state, 2)) + '\n');
  for (const highWaterMark of [1, 7, 64, 65536]) {
    const result = await replayJournal(file, { highWaterMark });
    assert.deepEqual(result.state, state); assert.equal(result.recordCount, 2);
    assert.equal(result.bytes, (await fs.stat(file)).size);
  }
});

test('stream replay rejects malformed middle records and incomplete final records without rewriting files', async () => {
  const dir = await workspace(), file = path.join(dir, 'events.jsonl');
  const good = JSON.stringify(snapshot(initialState()));
  for (const raw of [good, good + '\n{', good + '\n\n', good + '\ninvalid\n' + JSON.stringify(snapshot(initialState(), 3)) + '\n', good + '\n' + good + '\n']) {
    await fs.writeFile(file, raw);
    const store = new Store(dir);
    await assert.rejects(store.open(), /No history was reset/);
    assert.equal(await fs.readFile(file, 'utf8'), raw);
    await assert.rejects(fs.access(store.lockFile), { code: 'ENOENT' });
  }
  await fs.writeFile(file, '');
  assert.equal((await replayJournal(file)).recordCount, 0);
});

test('change records replay exact JSON mutations and reject tampering and unsafe paths', () => {
  const before = { untouched: 'large history '.repeat(1000), list: [{ value: 'before' }, 2], gone: 1, nested: { keep: true } };
  const cases = [
    before,
    { ...before, list: [{ value: 'after' }, 2, 'new'] },
    { untouched: before.untouched, list: [], nested: { add: '🌱', keep: false } },
    { ...before, list: ['replace array member', null], extra: { data: [1, 2] } },
  ];
  for (const after of cases) {
    const event = journalChange(before, after, 2);
    assert.deepEqual(applyJournalChange(before, event), after);
    assert.deepEqual(before.list, [{ value: 'before' }, 2]);
    assert.throws(() => applyJournalChange(before, { ...event, beforeHash: '0'.repeat(64) }), /base state/);
    assert.throws(() => applyJournalChange(before, { ...event, afterHash: '0'.repeat(64) }), /result state/);
  }
  const valid = journalChange(before, before, 2);
  for (const change of [
    { op: 'set', path: ['__proto__', 'polluted'], value: true },
    { op: 'set', path: ['list', 9], value: 'hole' },
    { op: 'append', path: ['list'], length: 5, values: ['x'] },
    { op: 'remove', path: ['list', 0] },
    { op: 'set', path: ['missing', 'child'], value: 1 },
  ]) assert.throws(() => applyJournalChange(before, { ...valid, changes: [change] }), /Journal change/);
  assert.equal({}.polluted, undefined);
});

test('new saves append small changes to legacy snapshots; originals survive restart and backup', async t => {
  const f = await fixture(t);
  await f.command('message.note', { chatId: f.chatId, content: 'Synthetic retained history. '.repeat(5000) });
  const dir = await workspace(), file = path.join(dir, 'events.jsonl');
  const original = JSON.stringify(snapshot(f.app.store.state)) + '\n';
  await fs.writeFile(file, original);
  const store = new Store(dir); await store.open();
  await store.command({ type: 'draft.save', payload: { chatId: f.chatId, text: 'A small new draft 💛' } });
  const expected = structuredClone(store.state);
  await store.close();
  const raw = await fs.readFile(file, 'utf8');
  assert(raw.startsWith(original));
  assert(raw.length - original.length < original.length / 10, 'A draft does not duplicate the transcript and receipts.');
  const records = []; for await (const record of journalRecords(file)) records.push(record.event);
  assert.equal(records[1].type, 'change');
  assert.deepEqual((await replayJournal(file)).state, expected);
  const reopened = new Store(dir); await reopened.open();
  assert.deepEqual(reopened.state, expected); await reopened.close();
});

test('a failed completion save ends its stream cleanly and leaves the server reachable', async t => {
  const f = await fixture(t);
  f.handler = async (_body, res) => {
    f.app.store.writeFault = new Error('Synthetic save failure');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Keep this visible.' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  };
  const response = await fetch(f.url + '/api/exchange', { method: 'POST', headers: { ...f.headers, 'content-type': 'application/json' }, body: JSON.stringify({ chatId: f.chatId, content: 'A synthetic interrupted save.', stream: true }) });
  const stream = await response.text();
  assert.match(stream, /Keep this visible/); assert.doesNotMatch(stream, /event: done/);
  assert.equal(f.app.store.state.exchanges.at(-1).status, 'pending');
  assert.equal((await fetch(f.url + '/api/state', { headers: f.headers })).status, 200);
});
