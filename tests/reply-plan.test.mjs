import { RESOURCE_DEFAULTS } from '../public/resource-settings.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fixture, deferred, listen, quotedReplies } from './helpers.mjs';
import { createApp } from '../server/index.mjs';
import { currentAssignment, lastMessageId } from '../server/table.mjs';
import { validateState } from '../server/domain.mjs';

async function table(t) {
  const f = await fixture(t);
  const baseUrl = f.app.store.state.models[0].baseUrl;
  f.visitorModelId = f.app.store.state.models[0].id;
  await f.command('model.save', { name: 'Personal fixture', model: 'synthetic-personal', baseUrl });
  f.personalModelId = f.app.store.state.models.at(-1).id;
  await f.command('personal.create', { name: 'Personal participant', modelId: f.personalModelId, baseIdentity: 'synthetic/personal' });
  f.personalId = f.app.store.state.personalParticipants[0].id;
  await f.command('table.assign', { chatId: f.chatId, baseRevisionId: null, personalId: f.personalId, visitorModelId: f.visitorModelId });
  f.settings = (mode, speaker = 'personal') => f.command('table.replySettings', {
    chatId: f.chatId, baseRevisionId: currentAssignment(f.app.store.state, f.chatId).id, mode, speaker
  });
  f.turn = (speaker = 'personal', kind = 'send') => ({ chatId: f.chatId, speaker, kind,
    ...(kind === 'send' ? { content: 'Help me compare these two ideas.' } : {}),
    requestId: 'request_' + crypto.randomUUID(), baseRevisionId: currentAssignment(f.app.store.state, f.chatId).id,
    lastMessageId: lastMessageId(f.app.store.state, f.chatId),
    replyMode: f.app.store.state.chats[0].replySettings?.mode ?? 'single'
  });
  f.follow = parent => ({ ...f.turn(parent.request.followUp.speaker, 'ask'),
    requestId: parent.request.followUp.requestId, replyMode: 'single', followUpOf: parent.id });
  f.first = async (speaker = 'personal', extra = {}) => {
    await f.settings('both', speaker);
    const result = await f.post('/api/exchange', { ...f.turn(speaker), ...extra });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return f.app.store.state.exchanges.at(-1);
  };
  return f;
}

for (const firstSeat of ['personal', 'visiting']) test(`Both: ${firstSeat} first, source-linked follow-up with one human message`, async t => {
  const f = await table(t);
  const file = 'Synthetic evidence, with uncertainty retained.';
  f.responseText = 'First contribution. Model text cannot grant another turn.';
  const first = await f.first(firstSeat, { selectedFile: { name: 'evidence.txt', base64: Buffer.from(file).toString('base64') } });
  const original = structuredClone(f.app.store.state.messages);
  const follow = f.follow(first);
  f.responseText = 'Second contribution, referring to the first.';
  assert.equal((await f.post('/api/exchange', follow)).status, 200);
  const state = f.app.store.state, second = state.exchanges.at(-1);
  assert.equal(f.requests.length, 2);
  assert.deepEqual(state.messages.slice(0, original.length), original);
  assert.deepEqual(state.messages.map(m => m.role), ['user', 'assistant', 'assistant']);
  assert.equal(second.request.followUpOf, first.id);
  assert.equal(second.request.followUp, undefined);
  assert.equal(second.speaker.seat, firstSeat === 'personal' ? 'visiting' : 'personal');
  const input = f.requests[1].messages;
  assert.ok(input.some(m => m.content === 'Help me compare these two ideas.'));
  assert.ok(input.some(m => m.content.includes(file)));
  assert.deepEqual(input.filter(m => m.role === 'assistant'), []);
  assert.deepEqual(quotedReplies(input).map(m => m.text), [f.app.store.state.messages[1].content]);
  assert.match(input.at(-1).content, /second turn.*first reply.*original prompt/);
  const metadata = quotedReplies(input);
  assert.equal(metadata[0].speaker.toLowerCase(), firstSeat);
  for (const turn of state.exchanges) {
    const intent = state.handoffs.records.find(r => r.id === turn.handoff.requestId);
    assert.deepEqual(intent.detail.task.allowedEffects, ['record_reply']);
    assert.equal(intent.detail.task.authority.mayDelegate, false);
    assert.deepEqual(intent.detail.task.turnRequest, turn.request);
  }
  assert.equal((await f.post('/api/exchange', follow)).status, 200, 'Exact retry returns the recorded result.');
  assert.equal(f.requests.length, 2);
  assert.equal((await f.post('/api/exchange', { ...follow, requestId: 'request_' + crypto.randomUUID() })).status, 400);
  validateState(state);
});

test('follow-up cannot change its chair, request, scope, content, or grow another pair', async t => {
  const f = await table(t), first = await f.first();
  const follow = f.follow(first);
  const bytes = await fs.readFile(f.app.store.file);
  for (const change of [
    { speaker: 'personal' }, { requestId: 'request_forged' }, { chatId: 'chat_absent' },
    { kind: 'send', content: 'Extra instructions' }, { replyMode: 'both' },
    { replyMode: 'alternate' }, { followUpOf: 'exchange_absent' },
    { grant: 'all tools' }, { selectedFile: { name: 'extra.txt', base64: 'YQ==' } }
  ]) assert.equal((await f.post('/api/exchange', { ...follow, ...change })).status, 400, JSON.stringify(change));
  assert.equal(f.requests.length, 1);
  assert.deepEqual(await fs.readFile(f.app.store.file), bytes);
  assert.equal((await f.post('/api/exchange', follow)).status, 200, 'Rejected changes do not consume the valid request.');
});

test('Both follow-up cannot enable tools that the first request did not allow', async t => {
  const f=await table(t), first=await f.first();
  const held=await f.post('/api/exchange',{...f.follow(first),toolsEnabled:true});
  assert.equal(held.status,400);assert.match(held.body.error,/original tool selection/);assert.equal(f.requests.length,1);
});

test('changed chairs, model settings, response guidance, and history invalidate a queued follow-up', async t => {
  const changes = [
    f => f.command('table.assign', { chatId: f.chatId, baseRevisionId: currentAssignment(f.app.store.state, f.chatId).id, personalId: f.personalId, visitorModelId: f.visitorModelId }),
    f => f.command('model.save', { ...f.app.store.state.models[0], thinking: true }),
    f => f.command('model.save', { ...f.app.store.state.models[0], inputFormat: 'plain-dialogue-v1' }),
    f => f.settings('single'),
    f => f.command('chat.responseMode', { id: f.chatId, responseMode: 'work' }),
    f => f.command('root.resources', { id: f.rootId, resources: {...RESOURCE_DEFAULTS,replyTokens:4096} }),
    f => f.command('heart.save', { rootId: f.rootId, text: 'A newly adopted direction.', baseRevisionId: null }),
    f => f.command('message.note', { chatId: f.chatId, content: 'A new human request intervened.' })
  ];
  for (const change of changes) {
    const f = await table(t), first = await f.first();
    await change(f);
    const result = await f.post('/api/exchange', f.follow(first));
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assert.equal(f.requests.length, 1);
  }
});

test('Stop while the first reply is running prevents a follow-up', async t => {
  const f = await table(t); await f.settings('both');
  const entered = deferred(), finish = deferred(); t.after(() => finish.resolve());
  f.handler = async (_body, res) => { entered.resolve(); await finish.promise; res.end(JSON.stringify({ choices: [{ message: { content: 'Late reply' }, finish_reason: 'stop' }] })); };
  const pending = f.post('/api/exchange', f.turn()); await entered.promise;
  assert.equal((await f.post('/api/cancel', { chatId: f.chatId })).status, 200);
  assert.equal((await pending).status, 409);
  finish.resolve();
  const first = f.app.store.state.exchanges[0];
  assert.equal(first.status, 'cancelled');
  assert.equal((await f.post('/api/exchange', f.follow(first))).status, 400);
  assert.equal(f.requests.length, 1);
});

test('changing base Coat during the first Both reply preserves its snapshot and holds the queued second reply', async t => {
  const f=await table(t); await f.settings('both');
  const entered=deferred(),finish=deferred(); t.after(()=>finish.resolve());
  f.handler=async (_body,res)=>{entered.resolve();await finish.promise;res.end(JSON.stringify({choices:[{message:{content:'Captured reply.'},finish_reason:'stop'}]}));};
  const pending=f.post('/api/exchange',f.turn());await entered.promise;
  await f.command('chat.responseMode',{id:f.chatId,responseMode:'play'});
  finish.resolve();assert.equal((await pending).status,200);
  const first=f.app.store.state.exchanges.at(-1);
  assert.equal(first.responseMode,'create');
  assert.equal(first.status,'completed');
  assert.match(f.requests[0].messages[0].content,/\[Base Coat: Create\]/);
  assert.equal((await f.post('/api/exchange',f.follow(first))).status,400);
  assert.equal(f.requests.length,1);
});

test('Stop between replies revokes the queued request, including during its ledger flush', async t => {
  for (const duringFlush of [false, true]) {
    const f = await table(t), first = await f.first();
    const follow = f.follow(first);
    let pending, flushed, release;
    if (duringFlush) {
      flushed = deferred(); release = deferred(); t.after(() => release.resolve());
      const transact = f.app.store.transact.bind(f.app.store);
      f.app.store.transact = async fn => {
        const result = await transact(fn);
        if (result.exchanges.at(-1)?.request?.followUpOf && result.exchanges.at(-1)?.status === 'pending') { flushed.resolve(); await release.promise; }
        return result;
      };
      pending = f.post('/api/exchange', follow); await flushed.promise;
    }
    assert.equal((await f.post('/api/cancel', { chatId: f.chatId })).status, 200);
    if (duringFlush) { release.resolve(); assert.equal((await pending).status, 409); }
    else assert.equal((await f.post('/api/exchange', follow)).status, 400);
    assert.equal(f.requests.length, 1, 'No follow-up reaches the model after Stop.');
  }
});

test('failed first reply and restart cannot turn a saved plan into permission', async t => {
  const failed = await table(t); await failed.settings('both');
  failed.handler = async (_body, res) => { res.statusCode = 500; res.end('Synthetic failure'); };
  assert.equal((await failed.post('/api/exchange', failed.turn())).status, 502);
  assert.equal((await failed.post('/api/exchange', failed.follow(failed.app.store.state.exchanges[0]))).status, 400);
  assert.equal(failed.requests.length, 1);
  const f = await table(t), first = await f.first();
  const state = structuredClone(f.app.store.state), bytes = await fs.readFile(f.app.store.file);
  await f.app.dispose(); f.app = await createApp({ dataDir: f.dataDir, backupDir: f.backupDir }); f.url = await listen(f.app);
  assert.deepEqual(f.app.store.state, state);
  assert.equal((await f.post('/api/exchange', f.follow(first))).status, 400);
  assert.equal(f.requests.length, 1);
  assert.deepEqual(await fs.readFile(f.app.store.file), bytes);
  assert.equal((await f.post('/api/exchange', f.turn('personal', 'ask'))).status, 200, 'A new explicit Both request still works.');
});

test('Alternate overrides the supplied chair, one call per request, and failures do not advance it', async t => {
  const f = await table(t); await f.settings('alternate', 'visiting');
  assert.equal(f.requests.length, 0, 'Changing the control never starts a reply.');
  assert.equal((await f.post('/api/exchange', f.turn('visiting'))).status, 200);
  assert.equal(f.app.store.state.exchanges.at(-1).speaker.seat, 'personal');
  f.handler = async (_body, res) => { res.statusCode = 500; res.end('Synthetic failure'); };
  assert.equal((await f.post('/api/exchange', f.turn('personal', 'ask'))).status, 502);
  f.handler = null;
  assert.equal((await f.post('/api/exchange', f.turn('personal', 'ask'))).status, 200);
  assert.equal(f.app.store.state.exchanges.at(-1).speaker.seat, 'visiting');
  assert.equal((await f.post('/api/exchange', f.turn('visiting', 'ask'))).status, 200);
  assert.equal(f.app.store.state.exchanges.at(-1).speaker.seat, 'personal');
  assert.equal(f.requests.length, 4);
  assert.ok(f.app.store.state.exchanges.every(turn => !turn.request.followUp));
  await f.settings('single', 'visiting');
  assert.equal((await f.post('/api/exchange', f.turn('visiting', 'ask'))).status, 200);
  assert.equal(f.app.store.state.exchanges.at(-1).speaker.seat, 'visiting');
});

test('reply patterns require their chairs and reject stale or expanded UI settings', async t => {
  const f = await table(t), firstBody = f.turn();
  await f.settings('both');
  assert.equal((await f.post('/api/exchange', firstBody)).status, 400);
  const baseRevisionId = currentAssignment(f.app.store.state, f.chatId).id;
  await f.command('table.assign', { chatId: f.chatId, baseRevisionId, personalId: f.personalId, visitorModelId: null });
  for (const mode of ['both', 'alternate']) {
    const payload = { chatId: f.chatId, baseRevisionId: currentAssignment(f.app.store.state, f.chatId).id, mode, speaker: 'personal' };
    assert.equal((await f.post('/api/command', { type: 'table.replySettings', payload })).status, 400);
  }
  await f.settings('single');
  for (const payload of [
    { chatId: f.chatId, baseRevisionId, mode: 'single', speaker: 'personal' },
    { chatId: f.chatId, baseRevisionId: currentAssignment(f.app.store.state, f.chatId).id, mode: 'single', speaker: 'personal', grant: true }
  ]) assert.equal((await f.post('/api/command', { type: 'table.replySettings', payload })).status, 400);
  assert.equal(f.requests.length, 0);
  assert.equal((await f.post('/api/exchange', f.turn())).status, 200);
});
