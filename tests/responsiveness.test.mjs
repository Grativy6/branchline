import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { eventStreamParser } from '../public/event-stream.js';
import { journalChange, applyJournalChange } from '../server/journal-change.mjs';
import { digest } from '../server/integrity.mjs';
import { fixture } from './helpers.mjs';
import { replayJournal } from '../server/journal.mjs';

test('stream parser handles every byte boundary, UTF-8, CRLF, multiline data and comments', () => {
  const wire = Buffer.from(': heartbeat\r\nevent: delta\r\ndata: {"text":\r\ndata: "Hello 🌱 你好"}\r\n\r\nevent: done\ndata: {"saved":true}\n\n');
  for (let size = 1; size <= wire.length; size++) {
    const events = [], parser = eventStreamParser(event => events.push(event));
    for (let i = 0; i < wire.length; i += size) parser.push(wire.subarray(i, i + size));
    parser.finish();
    assert.deepEqual(events, [{ text: 'Hello 🌱 你好', type: 'delta' }, { saved: true, type: 'done' }]);
  }
  const events = [], parser = eventStreamParser(e => events.push(e));
  parser.push(Buffer.from('event: done\ndata: {"saved":true}')); parser.finish();
  assert.deepEqual(events, [], 'An unterminated event must not claim completion.');
  assert.throws(() => eventStreamParser(() => {}).push(Buffer.from('data: nope\n\n')), /malformed/);
});

test('large legacy state events and many small reply events arrive exactly once', () => {
  const events = [], parser = eventStreamParser(e => events.push(e));
  const text = '🌱'.repeat(2 * 1024 * 1024);
  const wire = Buffer.from('event: done\ndata: ' + JSON.stringify({ state: { text } }) + '\n\n');
  for (let i = 0; i < wire.length; i += 16384) parser.push(wire.subarray(i, i + 16384));
  parser.finish(); assert.equal(events.length, 1); assert.equal(events[0].state.text, text);
  for (let i = 0; i < 1000; i++) parser.push(Buffer.from(`event: delta\ndata: {"text":"${i}"}\n\n`));
  assert.equal(events.length, 1001); assert.equal(events.at(-1).text, '999');
});

test('journal diff retains version-1 encoding and both complete state hashes', () => {
  const before = { a: [{ same: 'held', change: 1 }], b: { gone: true, held: null }, c: [1, 2], d: 0 };
  const after = { a: [{ same: 'held', change: 2 }, { new: true }], b: { held: null, added: false }, c: [1], d: -0 };
  const event = journalChange(before, after, 8, 'synthetic');
  assert.deepEqual(event.changes, [
    { op: 'set', path: ['a', 0, 'change'], value: 2 },
    { op: 'append', path: ['a'], length: 1, values: [{ new: true }] },
    { op: 'remove', path: ['b', 'gone'] }, { op: 'set', path: ['b', 'added'], value: false },
    { op: 'set', path: ['c'], value: [1] },
  ]);
  assert.equal(event.beforeHash, digest(before)); assert.equal(event.afterHash, digest(after));
  assert.deepEqual(applyJournalChange(before, event), { ...after, d: 0 });
  assert.deepEqual(journalChange(after, structuredClone(after), 9).changes, []);
  assert.throws(() => applyJournalChange(before, { ...event, afterHash: '0'.repeat(64) }), /result state/);
  const quoted = JSON.parse('{"quoted":{"constructor":"ordinary quoted data"},"draft":"old"}');
  const updated = structuredClone(quoted); updated.draft = 'new';
  assert.deepEqual(journalChange(quoted, updated, 10).changes, [{ op: 'set', path: ['draft'], value: 'new' }]);
  updated.quoted.constructor = 'changed';
  assert.throws(() => journalChange(quoted, updated, 11), /unsafe/);
});

test('draft acknowledgement is small, remains durable, and state polls are conditional', async t => {
  const f = await fixture(t);
  await f.command('message.note', { chatId: f.chatId, content: 'Synthetic history '.repeat(1000) });
  const initial = await fetch(f.url + '/api/state', { headers: f.headers });
  const revision = initial.headers.get('etag'); assert.ok(revision);
  const unchanged = await fetch(f.url + '/api/state', { headers: { ...f.headers, 'If-None-Match': revision } });
  assert.equal(unchanged.status, 304); assert.equal(await unchanged.text(), '');
  const saved = await fetch(f.url + '/api/command', { method: 'POST', headers: { ...f.headers, 'content-type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ type: 'draft.save', payload: { chatId: f.chatId, text: 'hi' } }) });
  const raw = await saved.text(); assert.equal(saved.status, 200); assert.ok(raw.length < 200);
  assert.equal(JSON.parse(raw).saved, true); assert.equal((await replayJournal(f.app.store.file)).state.drafts[f.chatId], 'hi');
  const changed = await fetch(f.url + '/api/state', { headers: { ...f.headers, 'If-None-Match': revision } });
  assert.equal(changed.status, 200); assert.notEqual(changed.headers.get('etag'), revision);
  assert.equal((await changed.json()).drafts[f.chatId], 'hi');
  const unauthorized = await fetch(f.url + '/api/state', { headers: { 'If-None-Match': changed.headers.get('etag') } });
  assert.equal(unauthorized.status, 401, 'A cache validator cannot bypass the session boundary.');
  const ui = await fetch(f.url + '/api/command', { method: 'POST', headers: { ...f.headers, 'content-type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ type: 'ui.update', payload: { sidebarCollapsed: true } }) });
  const uiText = await ui.text(); assert.ok(uiText.length < 1000); assert.equal(JSON.parse(uiText).ui.sidebarCollapsed, true);
});

test('exact receipt cache retains its bounded prefix instead of thrashing; claimed hashes never suffice', async () => {
  const source = await fs.readFile(new URL('../server/handoff.mjs', import.meta.url), 'utf8');
  const fragment = source.slice(source.indexOf('const checkedReceiptBytes ='), source.indexOf('const sameRecord ='));
  let calls = 0;
  const context = vm.createContext({ digest: value => { calls++; return digest(value); }, withoutHash: ({ hash, ...body }) => body });
  vm.runInContext(fragment + '\nglobalThis.check = receiptHashMatches;', context);
  const records = Array.from({ length: 250 }, (_, id) => { const body = { id, text: 'x'.repeat(20000) }; return { ...body, hash: digest(body) }; });
  for (const record of records) assert.equal(context.check(record), true);
  assert.equal(calls, 250); calls = 0;
  for (const record of records) assert.equal(context.check(record), true);
  assert.ok(calls < 50, 'Previously all 250 records were hashed again on every scan.');
  assert.equal(context.check({ ...records[0], text: 'altered bytes, same claimed hash' }), false);
});

test('compact streaming completion carries a durable reference and legacy callers still receive state', async t => {
  const f = await fixture(t);
  f.handler = async (_body, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end('data: ' + JSON.stringify({ choices: [{ delta: { content: f.responseText }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  };
  for (const compact of [true, false]) {
    const response = await fetch(f.url + '/api/exchange', { method: 'POST', headers: { ...f.headers, 'content-type': 'application/json', ...(compact ? { 'x-branchline-stream': 'events-v2' } : {}) },
      body: JSON.stringify({ chatId: f.chatId, content: 'Synthetic streaming question.', stream: true }) });
    assert.equal(response.status, 200);
    const events = [], parser = eventStreamParser(e => events.push(e)); parser.push(new Uint8Array(await response.arrayBuffer())); parser.finish();
    const done = events.at(-1); assert.equal(done.type, 'done');
    if (compact) { assert.equal(done.state, undefined); assert.ok(JSON.stringify(done).length < 200); assert.equal(done.saved, true); assert.equal(done.exchangeId, f.app.store.state.exchanges.at(-1).id); }
    else assert.equal(done.state.messages.at(-1).content, f.responseText);
    const saved = await replayJournal(f.app.store.file);
    assert.equal(saved.state.messages.at(-1).content, f.responseText);
  }
});
