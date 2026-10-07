import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { initialState } from '../server/domain.mjs';
import { journalChange } from '../server/journal-change.mjs';
import { replayJournal } from '../server/journal.mjs';
import { fixture } from './helpers.mjs';

test('a valid final state cannot conceal an invalid intermediate state or hash', async () => {
  await fs.mkdir('.test-data', { recursive: true });
  const directory = await fs.mkdtemp(path.resolve('.test-data/replay-integrity-'));
  for (const kind of ['state', 'hash']) {
    const before = initialState(), middle = structuredClone(before);
    if (kind === 'state') middle.ui.mode = 'not-a-mode';
    else middle.ui.sidebarCollapsed = true;
    const records = [{ type: 'snapshot', sequence: 1, at: 'synthetic', state: before }, journalChange(before, middle, 2), journalChange(middle, before, 3)];
    if (kind === 'hash') { records[1].afterHash = 'f'.repeat(64); records[2].beforeHash = records[1].afterHash; }
    const file = path.join(directory, kind + '.jsonl'), bytes = records.map(record => JSON.stringify(record)).join('\n') + '\n';
    await fs.writeFile(file, bytes, { flag: 'wx' });
    await assert.rejects(replayJournal(file));
    assert.equal(await fs.readFile(file, 'utf8'), bytes);
  }
});

test('transaction captures and returned snapshots cannot mutate committed state', async t => {
  const f = await fixture(t); let captured;
  const result = await f.app.store.transact(state => { captured = state; state.ui.sidebarCollapsed = true; return state; });
  captured.ui.sidebarCollapsed = false; result.ui.sidebarCollapsed = false;
  assert.equal(f.app.store.state.ui.sidebarCollapsed, true);
  const none = await f.app.store.transact(state => { captured = state; return state; }, { returnState: false });
  assert.equal(none, undefined); captured.ui.sidebarCollapsed = false;
  assert.equal(f.app.store.state.ui.sidebarCollapsed, true);
});
