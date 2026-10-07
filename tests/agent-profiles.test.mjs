import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred } from './helpers.mjs';
import { currentAssignment, lastMessageId, resolveSpeaker } from '../server/table.mjs';
import { compileMessages, measureContext } from '../server/model.mjs';
import { previewAgentProfile, exportAgentProfile, profileDestination, preserveAgentProfiles, assertAgentDisclosure } from '../server/agent-profiles.mjs';
import { validateState } from '../server/domain.mjs';
import { Store } from '../server/store.mjs';
import { configureHearthline, hearthlineConfigured } from '../server/hearthline-profile-setup.mjs';
import { profileSharingSelections, profileSharedWith } from '../public/agent-sharing.js';

const bundle = () => ({ schema: 'branchline.agent-profile/1', name: 'Garden agent', description: 'Synthetic source selection.', entries: [
  { path: 'AGENTS.md', role: 'guidance', scope: 'agent', text: 'Bring a seed 🌱.\r\nLeave room to grow.', source: null },
  { path: 'notes/garden.md', role: 'reference', scope: 'project', text: 'Only the blue flower opened. <script>no()</script>', source: null },
  { path: 'project/AGENTS.md', role: 'guidance', scope: 'project', text: 'Project-specific instructions.', source: null },
] });
const models = state => state.models.map(m => ({ id: m.id, destination: profileDestination(m) }));

test('human-launched Hearthline setup connects only the public seed once and honors a later disconnect', async t => {
  const f = await setup(t);
  const m = f.app.store.state.models[0]; await f.command('model.save', { ...m, runtime:'lmstudio', inputFormat:'plain-dialogue-v1' });
  const before = f.app.store.state, configured = configureHearthline(before);
  assert.equal(before.agentProfiles, undefined);
  assert.equal(hearthlineConfigured(configured), true);
  assert.deepEqual(configured.agentProfiles.selections[0].paths, ['FOUNDING-SEED.txt']);
  assert.equal(configured.agentProfiles.profiles.length, 1);
  assert.equal(configured.agentProfiles.profiles[0].entries.length, 2);
  assert.deepEqual(configured.models, before.models); assert.deepEqual(configured.messages, before.messages);
  assert.equal(configured.agentProfiles.sources[configured.agentProfiles.profiles[0].entries[0].sha256].length, 700);
  await f.app.store.transact(() => configured);
  await f.command('profile.disconnect', { personalId:f.personalId, baseSelectionId:configured.agentProfiles.selections[0].id });
  assert.deepEqual(configureHearthline(f.app.store.state), f.app.store.state);
  assert.equal(f.requests.length, 0);
});
async function setup(t) {
  const f = await fixture(t);
  await f.command('model.save', { name: 'Other model', model: 'other-model', baseUrl: f.app.store.state.models[0].baseUrl });
  await f.command('personal.create', { name: 'Garden', modelId: f.app.store.state.models[0].id, baseIdentity: 'synthetic/base' });
  f.personalId = f.app.store.state.personalParticipants[0].id;
  await f.command('table.assign', { chatId: f.chatId, baseRevisionId: null, personalId: f.personalId, visitorModelId: f.app.store.state.models[1].id });
  f.turn = (speaker = 'personal', content = 'How does the garden grow?') => f.post('/api/exchange', { chatId: f.chatId, speaker, kind: 'send', content,
    requestId: 'request_' + crypto.randomUUID(), baseRevisionId: currentAssignment(f.app.store.state, f.chatId).id, lastMessageId: lastMessageId(f.app.store.state, f.chatId) });
  f.import = async (b = bundle(), replaces = null) => { await f.command('profile.import', { bundle: b, replaces }); return f.app.store.state.agentProfiles.profiles.at(-1).id; };
  f.connectPayload = (id, paths = ['AGENTS.md']) => ({ personalId: f.personalId, baseSelectionId: f.app.store.state.agentProfiles?.selections.at(-1)?.id ?? null, profileId: id, paths, models: models(f.app.store.state) });
  f.connect = (id, paths) => f.command('profile.connect', f.connectPayload(id, paths));
  return f;
}

test('profile preview/export preserves UTF-8 and CRLF without writes, execution, or model calls', async t => {
  const f = await setup(t), before = structuredClone(f.app.store.state);
  const preview = await f.post('/api/agent-profiles/preview', bundle());
  assert.equal(preview.status, 200); assert.deepEqual(preview.body.bundle, bundle());
  assert.deepEqual(f.app.store.state, before); assert.equal(f.requests.length, 0);
  const id = await f.import(); assert.deepEqual(exportAgentProfile(f.app.store.state, id), bundle());
  const result = await fetch(f.url + '/api/agent-profiles/export?id=' + id, { headers: f.headers });
  assert.equal(result.status, 200); assert.deepEqual(await result.json(), bundle());
});

test('profile imports reject path escapes, executable fields, duplicates, oversized text and obvious secrets', () => {
  for (const path of ['../AGENTS.md', '/AGENTS.md', 'H:/AGENTS.md', 'a\\AGENTS.md', 'CON.txt', 'secret/api_key.txt', '.git/a.md', 'run.js', 'a./x.md']) {
    const b = bundle(); b.entries[0].path = path; assert.throws(() => previewAgentProfile(b), /Agent profile/);
  }
  const extra = bundle(); extra.commands = ['run']; assert.throws(() => previewAgentProfile(extra));
  const secret = bundle(); secret.entries[0].text = '-----BEGIN PRIVATE KEY-----'; assert.throws(() => previewAgentProfile(secret), /credential/);
  const duplicate = bundle(); duplicate.entries[1].path = 'agents.md'; assert.throws(() => previewAgentProfile(duplicate), /duplicate/);
  const huge = bundle(); huge.entries[0].text = 'x'.repeat(131073); assert.throws(() => previewAgentProfile(huge), /too large/);
});

test('Personal uses selected profile sources, Visitor does not; budget and receipts bind the exact version', async t => {
  const f = await setup(t), id = await f.import();
  const before = measureContext(f.app.store.state, f.chatId, 'Hi', { selection: resolveSpeaker(f.app.store.state, f.chatId, 'personal').selection }).fixedCharacters;
  await f.connect(id, ['AGENTS.md', 'notes/garden.md']);
  await f.command('root.update', { id: f.rootId, instructions: 'Current episode instructions.' });
  const selection = resolveSpeaker(f.app.store.state, f.chatId, 'personal').selection;
  const prompt = compileMessages(f.app.store.state, f.chatId, 'Hi', { selection });
  assert.match(prompt[0].content, /Bring a seed 🌱/);
  assert.ok(prompt[0].content.indexOf('Bring a seed') < prompt[0].content.indexOf('Current episode instructions.'));
  assert.ok(prompt.some(m => m.role === 'user' && m.content.includes('Only the blue flower')));
  assert.ok(!prompt.some(m => m.content.includes('Project-specific')));
  const visitor = compileMessages(f.app.store.state, f.chatId, 'Hi', { selection: resolveSpeaker(f.app.store.state, f.chatId, 'visiting').selection });
  assert.ok(!visitor.some(m => /Bring a seed|blue flower/.test(m.content)));
  assert.ok(measureContext(f.app.store.state, f.chatId, 'Hi', { selection }).fixedCharacters > before);
  assert.equal((await f.turn()).status, 200);
  const turn = f.app.store.state.exchanges.at(-1);
  assert.equal(turn.agentProfile.profileId, id); assert.equal(turn.agentProfile.entries.length, 2);
  const receipt = f.app.store.state.handoffs.records.find(r => r.id === turn.handoff.contextId);
  assert.deepEqual(receipt.detail.contextView.agentProfile, turn.agentProfile);
  assert.deepEqual(receipt.detail.effectCeiling, ['record_reply']);
});

test('profile versions, source deduplication, disconnect and replay preserve old reply attribution', async t => {
  const f = await setup(t), id = await f.import(); await f.connect(id); assert.equal((await f.turn()).status, 200);
  const old = structuredClone(f.app.store.state.exchanges[0]), b = bundle(); b.name = 'Next garden';
  const next = await f.import(b, id); assert.equal(Object.keys(f.app.store.state.agentProfiles.sources).length, 3);
  assert.equal(f.app.store.state.agentProfiles.selections.at(-1).profileId, id, 'import alone cannot update active selection');
  await f.connect(next);
  await f.command('profile.disconnect', { personalId: f.personalId, baseSelectionId: f.app.store.state.agentProfiles.selections.at(-1).id });
  const selection = resolveSpeaker(f.app.store.state, f.chatId, 'personal').selection;
  assert.ok(!compileMessages(f.app.store.state, f.chatId, 'Hi', { selection }).some(m => m.content.includes('Bring a seed')));
  assert.deepEqual(f.app.store.state.exchanges[0], old);
  const prior = f.app.store.state, changed = structuredClone(prior); changed.agentProfiles.sources[Object.keys(changed.agentProfiles.sources)[0]] = 'Changed';
  assert.throws(() => validateState(changed), /source bytes/); assert.throws(() => preserveAgentProfiles(prior, changed), /source history/);
  await f.app.store.close();
  const replayed = new Store(f.dataDir, { checkpoints: false }); await replayed.open();
  assert.deepEqual(replayed.state.agentProfiles, prior.agentProfiles); await replayed.close();
});

test('selected scope and context caps fail closed without partial connection or trimming', async t => {
  const f = await setup(t), id = await f.import();
  assert.equal((await f.post('/api/command', { type: 'profile.connect', payload: f.connectPayload(id, ['project/AGENTS.md']) })).status, 400);
  assert.equal(f.app.store.state.agentProfiles.selections.length, 0);
  const b = bundle(); b.entries[0].text = 'x'.repeat(24001); const huge = await f.import(b);
  assert.equal((await f.post('/api/command', { type: 'profile.connect', payload: f.connectPayload(huge) })).status, 400);
  assert.equal(f.app.store.state.agentProfiles.selections.length, 0);
});

test('new provider needs clearance even after disconnect; reflections, carry and parallels use the same boundary', async t => {
  const f = await setup(t), id = await f.import(); await f.connect(id); assert.equal((await f.turn()).status, 200);
  const s = f.app.store.state.agentProfiles.selections.at(-1);
  await f.command('profile.disconnect', { personalId: f.personalId, baseSelectionId: s.id });
  const m = f.app.store.state.models[1]; await f.command('model.save', { ...m, model: 'new-destination' });
  const changedModel = f.app.store.state.models[1];
  for (const kind of ['reply','parallel','carry','mind','journal','heart','agents']) assert.throws(() => assertAgentDisclosure(f.app.store.state, f.chatId, changedModel, null, kind), /not cleared/);
  const count = f.requests.length;
  assert.equal((await f.turn('visiting')).status, 400); assert.equal(f.requests.length, count);
  await f.command('profile.share', { selectionId: s.id, models: models(f.app.store.state) });
  assert.equal((await f.turn('visiting')).status, 200);
  await f.command('root.create', { name: 'Unrelated desk', mode: 'personal' });
  const unrelated = f.app.store.state.chats.at(-1);
  assert.doesNotThrow(() => assertAgentDisclosure(f.app.store.state, unrelated.id, { ...changedModel, model: 'anything' }, null, 'reply'));
});

test('first Personal call requires clearance for assigned visitor, and stale destinations cannot be approved', async t => {
  const f = await setup(t), id = await f.import(), payload = f.connectPayload(id); payload.models = payload.models.slice(0,1);
  await f.command('profile.connect', payload);
  assert.equal((await f.turn()).status, 400); assert.equal(f.requests.length, 0);
  const stale = f.connectPayload(id); const m = f.app.store.state.models[1]; await f.command('model.save', { ...m, model: 'changed' });
  assert.equal((await f.post('/api/command', { type:'profile.connect', payload:stale })).status, 400);
});

test('a successor can review carried selections from the previous chair without inheriting its clearance', async t => {
  const f = await setup(t), profileId = await f.import(); await f.connect(profileId);
  assert.equal((await f.turn()).status, 200);
  const oldSelection = f.app.store.state.agentProfiles.selections.at(-1);
  await f.command('model.save', { name:'Next garden', model:'next-garden', baseUrl:f.app.store.state.models[0].baseUrl });
  const nextModel = f.app.store.state.models.at(-1);
  await f.command('personal.create', { name:'Next garden', modelId:nextModel.id, baseIdentity:'synthetic/base' });
  const nextPersonal = f.app.store.state.personalParticipants.at(-1);
  await f.command('profile.connect', { personalId:nextPersonal.id, baseSelectionId:null, profileId, paths:['AGENTS.md'], models:models(f.app.store.state) });
  const newSelection = f.app.store.state.agentProfiles.selections.at(-1);
  await f.command('table.assign', { chatId:f.chatId, baseRevisionId:currentAssignment(f.app.store.state,f.chatId).id,
    personalId:nextPersonal.id, visitorModelId:f.app.store.state.models[1].id });
  const requestCount = f.requests.length;
  assert.equal((await f.turn()).status, 400); assert.equal(f.requests.length, requestCount);
  const before = structuredClone(f.app.store.state);
  assert.deepEqual(profileSharingSelections(before,nextPersonal.id).map(s=>s.id), [oldSelection.id,newSelection.id]);
  assert.equal(profileSharedWith(before,oldSelection.id,nextModel), false);
  assert.equal(profileSharedWith(before,newSelection.id,nextModel), true);
  await f.command('profile.share', { selectionId:oldSelection.id, models:[{ id:nextModel.id, destination:profileDestination(nextModel) }] });
  const after = f.app.store.state;
  assert.equal(profileSharedWith(after,oldSelection.id,nextModel), true);
  assert.deepEqual(after.agentProfiles.sharing.slice(0,-1), before.agentProfiles.sharing);
  assert.deepEqual(after.agentProfiles.selections, before.agentProfiles.selections);
  assert.deepEqual(after.messages, before.messages);
  assert.equal(profileSharedWith(after,oldSelection.id,{ ...nextModel, baseUrl:'http://127.0.0.1:32199/v1' }), false);
  assert.equal((await f.turn()).status, 200); assert.equal(f.requests.length, requestCount + 1);
});

test('sharing review follows desk exposure across branches and legacy receipts, excluding unrelated desks', () => {
  const selections = ['old','current','unrelated'].map(id=>({ id,profileId:'profile',personalId:id==='current'?'successor':'previous' }));
  const receipt = (rootId,contextView) => ({ kind:'context.to_model',scope:{ rootId },detail:{ contextView } });
  const state = {
    chats:[{ rootId:'desk',table:{ assignments:[{ personalId:'successor' }] } },{ rootId:'other',table:{ assignments:[{ personalId:'someone-else' }] } }],
    agentProfiles:{ selections },
    handoffs:{ records:[receipt('desk',{ agentProfile:{ selectionId:'old' } }),receipt('other',{ agentExposureIds:['unrelated'] })] },
  };
  assert.deepEqual(profileSharingSelections(state,'successor').map(s=>s.id), ['old','current']);
  state.handoffs.records[0].detail.contextView = { agentExposureIds:['old','old'] };
  assert.deepEqual(profileSharingSelections(state,'successor').map(s=>s.id), ['old','current']);
});

test('an active model call cannot change its own profile or sharing through durable writes', async t => {
  const f = await setup(t), id = await f.import(); await f.connect(id);
  const started = deferred(), finish = deferred();
  f.handler = async (_, res) => { started.resolve(); await finish.promise; res.end(JSON.stringify({ choices: [{ message: { content:'A reply.' }, finish_reason:'stop' }] })); };
  const running = f.turn(); await started.promise;
  try {
    const result = await f.post('/api/command', { type:'profile.disconnect', payload:{ personalId:f.personalId, baseSelectionId:f.app.store.state.agentProfiles.selections.at(-1).id } });
    assert.equal(result.status, 400);
  } finally { finish.resolve(); }
  assert.equal((await running).status, 200);
});
