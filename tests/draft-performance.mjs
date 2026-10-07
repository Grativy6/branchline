// Comparative performance check derived from Claude review F5. Synthetic only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const source = path.resolve(process.env.BRANCHLINE_BENCH_SOURCE || path.join(import.meta.dirname, '..'));
const { fixture } = await import(pathToFileURL(path.join(source, 'tests/helpers.mjs')).href);
const report = path.join(process.env.BRANCHLINE_REPORT_ROOT, process.env.BRANCHLINE_BENCH_REPORT || 'attachment-draft-save.json');
const MiB = 1024 * 1024;
const line = 'Plain synthetic document line with ordinary words and numbers 0123456789.\n';

const results = {};
for (const [label, size, counts] of [['default 128 KiB intake', 128 * 1024, [0, 5, 10]], ['raised 1 MiB intake', MiB, [0, 2, 5, 10]]])
test(`draft autosave time with retained attachments (${label})`, async t => {
  const f = await fixture(t);
  await f.command('root.resources', { id: f.rootId, resources: { replyTokens: null, inputCharacters: 60000, fileBytes: Math.max(131072, size),
    toolCalls: 32, toolResultBytes: 160000, replySeconds: 300, handoffSeconds: 300 } });
  const draftSave = async i => {
    const t0 = performance.now();
    const r = await fetch(f.url + '/api/command', { method: 'POST', headers: { ...f.headers, 'content-type': 'application/json', prefer: 'return=minimal' },
      body: JSON.stringify({ type: 'draft.save', payload: { chatId: f.chatId, text: 'Draft being typed ' + i } }) });
    assert.equal(r.status, 200); await r.json();
    return performance.now() - t0;
  };
  const rows = []; let attached = 0;
  for (const target of counts) {
    while (attached < target) {
      const text = (`Attachment ${attached}. ` + line.repeat(Math.ceil(size / line.length))).slice(0, size);
      const r = await f.post('/api/exchange', { chatId: f.chatId, content: 'Please keep this file in view.',
        selectedFile: { name: `doc-${attached}.txt`, base64: Buffer.from(text, 'utf8').toString('base64') } });
      assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 400));
      attached++;
    }
    await draftSave(-1); // warm
    const times = []; for (let i = 0; i < 5; i++) times.push(await draftSave(i));
    times.sort((a, b) => a - b);
    const state = f.app.store.state;
    rows.push({ attachments: attached, stateMB: Math.round(Buffer.byteLength(JSON.stringify(state)) / MiB * 100) / 100,
      exchanges: state.exchanges.length, draftSaveMedianMs: Math.round(times[2] * 10) / 10, draftSaveMaxMs: Math.round(times[4] * 10) / 10 });
    console.log(JSON.stringify(rows.at(-1)));
  }
  results[label] = { attachmentBytes: size, rows };
  await fs.writeFile(report, JSON.stringify({ node: process.version, prefer: 'return=minimal', results,
    note: 'Synthetic. Exchanges are short; the growth is attributable to the retained attachments.' }, null, 2) + '\n');
});
