import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { Store } from '../server/store.mjs';
import { validateState } from '../server/domain.mjs';
import { shelfPreferences, validToyShelf, toyShelf, shelfSettings } from '../public/toy-shelf.js';

test('legacy shelf defaults and bounded preference updates preserve unrelated data', async t => {
  const f = await fixture(t);
  assert.equal(f.app.store.state.ui.toyShelf, undefined);
  assert.deepEqual(shelfPreferences(undefined), { height: null, order: ['desk','peaches'], hidden: [] });
  await f.command('draft.save', { chatId: f.chatId, text: 'UNSENT 🌱' });
  await f.command('ui.update', { settingsSize: { width: 930, height: 510 }, sketchSize: { width: 880, height: 580 } });
  const before = structuredClone(f.app.store.state);
  const prefs = { height: 432, order: ['fs','desk','tend'], hidden: ['desk','tend','fs'] };
  assert.deepEqual(shelfPreferences(prefs), {height:432,order:['desk','peaches'],hidden:['desk']});
  const markup=toyShelf(prefs);
  assert.equal((markup.match(/class="toy-slot"/g)||[]).length,1);
  assert.doesNotMatch(markup,/toy-shelf-size|Tend Something|Finis Solutus/);
  assert.doesNotMatch(shelfSettings(prefs),/Tend Something|Finis Solutus/);
  await f.command('ui.update', { toyShelf: prefs });
  for (const key of ['roots','chats','messages','drafts','models','sketchBook','harnesses']) assert.deepEqual(f.app.store.state[key], before[key], key);
  assert.deepEqual(f.app.store.state.ui.settingsSize, before.ui.settingsSize);
  assert.deepEqual(f.app.store.state.ui.sketchSize, before.ui.sketchSize);
  assert.deepEqual(f.app.store.state.ui.toyShelf, prefs);
  assert.equal(f.requests.length, 0);
  const backup = await f.post('/api/storage/backup'); assert.equal(backup.status, 201);
  assert.equal((await f.post('/api/storage/verify', { id: backup.body.backup.id })).status, 200);
  await f.app.dispose(); const reopened = new Store(f.dataDir); await reopened.open(); t.after(() => reopened.close());
  assert.deepEqual(reopened.state.ui.toyShelf, prefs);
  assert.deepEqual(reopened.state.drafts, before.drafts);
  await reopened.command({ type: 'ui.update', payload: { toyShelf: null } });
  assert.deepEqual(shelfPreferences(reopened.state.ui.toyShelf), shelfPreferences(undefined));
});

test('malformed shelf settings are rejected atomically and never become actions', async t => {
  const f = await fixture(t), base = shelfPreferences(undefined);
  for (const value of [false, [], {}, {...base,height:179}, {...base,height:1201}, {...base,height:240.5}, {...base,width:900}, {...base,order:['desk','tend','script']}, {...base,order:['desk','desk','fs']}, {...base,hidden:['unknown']}, {...base,hidden:['desk','desk']}, {...base,command:'start.exe'}]) {
    const before = structuredClone(f.app.store.state);
    assert.equal(validToyShelf(value), false);
    const response = await f.post('/api/command', { type: 'ui.update', payload: { toyShelf:value, sidebarCollapsed:true } });
    assert.equal(response.status, 400); assert.deepEqual(f.app.store.state, before);
    const invalid = structuredClone(before); invalid.ui.toyShelf = value; assert.throws(() => validateState(invalid), /Toy Shelf/);
  }
  assert.equal(f.requests.length, 0);
});
