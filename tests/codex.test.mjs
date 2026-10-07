import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { CodexProvider, codexEnvironment, validAuthUrl } from '../server/codex-provider.mjs';
import { CodexRpc } from '../server/codex-rpc.mjs';
import { CODEX_ADDRESS, codexInput } from '../server/codex-policy.mjs';
import { FakeCodexRpc } from './codex-fixture.mjs';
import { fixture, quotedReplies } from './helpers.mjs';
import { currentAssignment, lastMessageId } from '../server/table.mjs';

const model = { name: 'Synthetic Codex', model: 'synthetic-codex', runtime: 'codex', baseUrl: CODEX_ADDRESS, inputFormat: 'chat', thinking: false };
const messages = [{ role: 'system', content: 'Branchline episode guidance.' }, { role: 'user', content: 'Earlier user' }, { role: 'assistant', content: 'Earlier visitor' }, { role: 'user', content: 'Current human request.' }];
test('reopening the provider reuses the saved account on a reply without starting login', async t => {
  const { p, rpc, dir } = await provider(t);
  assert.equal(rpc.calls.length, 0, 'construction makes no account requests');
  await consume(p); p.close();
  const reopenedRpc = new FakeCodexRpc();
  const reopened = new CodexProvider({accountDir:dir,binaryResolver:async()=> 'synthetic.exe',rpcFactory:()=>reopenedRpc});
  t.after(()=>reopened.close());
  await consume(reopened);
  assert(![...rpc.calls,...reopenedRpc.calls].some(c=>c.method==='account/login/start'||c.method==='account/logout'));
  assert.deepEqual(reopenedRpc.calls.find(c=>c.method==='account/read').params,{refreshToken:false});
});
test('a temporary catalogue failure preserves connected status and can retry without login', async t => {
  const {p,rpc}=await provider(t), request=rpc.request.bind(rpc);let fail=true;
  rpc.request=async(method,params)=> {if(method==='model/list'&&fail)throw Error('Temporary fixture outage');return request(method,params);};
  const status=await p.status();assert.equal(status.connected,true);assert.match(status.error,/temporarily unavailable/);
  fail=false;const retried=await p.status();assert.equal(retried.connected,true);assert.equal(retried.error,null);assert(retried.models.length);
  assert(!rpc.calls.some(c=>c.method==='account/login/start'));
});
async function provider(t) {
  await fs.mkdir('.test-data', { recursive: true });
  const dir = await fs.mkdtemp(path.resolve('.test-data/codex-'));
  const rpc = new FakeCodexRpc();
  const p = new CodexProvider({ accountDir: dir, binaryResolver: async () => 'synthetic.exe', rpcFactory: () => rpc });
  t.after(() => p.close()); return { p, rpc, dir };
}
async function consume(p, signal = new AbortController().signal) { const stream = p.stream(model, messages, signal); let text = ''; while (true) { const next = await stream.next(); if (next.done) return { text, finish: next.value }; text += next.value.text; } }

test('Codex episodes preserve input and attribution, stream once, and start fresh without tools', async t => {
  const { p, rpc } = await provider(t);
  for (let i = 0; i < 2; i++) assert.deepEqual(await consume(p), { text: 'A synthetic visitor reply.', finish: 'stop' });
  const starts = rpc.calls.filter(c => c.method === 'thread/start'); assert.equal(starts.length, 2);
  for (const { params } of starts) { assert.deepEqual(params.environments, []); assert.deepEqual(params.dynamicTools, []); assert.deepEqual(params.selectedCapabilityRoots, []); assert.equal(params.ephemeral, true); assert.equal(params.baseInstructions, messages[0].content); }
  assert.deepEqual(rpc.calls.find(c => c.method === 'thread/inject_items').params.items, codexInput(messages).history);
  assert.deepEqual(rpc.calls.filter(c => c.method === 'turn/start').map(c => c.params.environments), [[], []]);
  assert.equal(rpc.calls.filter(c => c.method === 'thread/unsubscribe').length, 2);
});

test('API-key accounts, widened configuration and wrong models fail before dispatch', async t => {
  for (const scenario of ['api', 'config', 'model']) {
    const { p, rpc } = await provider(t);
    if (scenario === 'api') rpc.accountType = 'apiKey'; if (scenario === 'config') rpc.badConfig = true; if (scenario === 'model') rpc.mode = 'wrong-model';
    await assert.rejects(consume(p), /ChatGPT sign-in|settings do not match|different model/);
    assert(!rpc.calls.some(c => c.method === 'turn/start'));
  }
});

test('tool requests and cancellation stop the owned runtime; partial failures stay incomplete', async t => {
  for (const mode of ['tool', 'failure']) {
    const { p, rpc } = await provider(t); rpc.mode = mode;
    await assert.rejects(consume(p), /tool or permission|Disconnected|account limit/);
    if (mode === 'tool') assert.equal(rpc.closed, true);
  }
  const { p, rpc } = await provider(t); rpc.mode = 'wait'; const controller = new AbortController();
  const stream = p.stream(model, messages, controller.signal);
  assert.equal((await stream.next()).value.text, 'A synthetic ');
  controller.abort(); await assert.rejects(stream.next(), /Reply stopped|Disconnected/); assert.equal(rpc.closed, true);
});

test('RPC rejects a server approval request without exposing a generic tool route', async () => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => { child.killed = true; };
  let sent = ''; child.stdin.on('data', c => { sent += c; });
  const rpc = new CodexRpc('synthetic.exe', [], { spawnProcess: () => child });
  rpc.consume(JSON.stringify({ id: 9, method: 'item/commandExecution/requestApproval', params: { command: 'must not execute' } }) + '\n');
  assert.equal(JSON.parse(sent).error.code, -32601); assert(!sent.includes('must not execute')); rpc.close();
});

test('auth destinations and child environment are bounded; no API credential inheritance', () => {
  assert(validAuthUrl('https://auth.openai.com/authorize?a=b'));
  for (const url of ['https://auth.openai.com.evil.invalid', 'http://auth.openai.com', 'https://x@auth.openai.com', 'file:///C:/test', 'https://auth.openai.com:444']) assert(!validAuthUrl(url));
  const env = codexEnvironment('C:/synthetic/home', 'C:/synthetic/empty');
  assert(!Object.keys(env).some(k => /API_KEY|TOKEN|PROXY|CONFIG|NODE_OPTIONS/i.test(k)));
});

test('subscription visitor shares Branchline history with local Personal; receipts bind the new transport', async t => {
  const { p, rpc } = await provider(t), f = await fixture(t, { modelOptions: { codex: p } });
  const local = f.app.store.state.models[0];
  await f.command('personal.create', { name: 'Baby', modelId: local.id, baseIdentity: 'synthetic/base' });
  await f.command('model.save', model); const visitor = f.app.store.state.models.at(-1);
  await f.command('table.assign', { chatId: f.chatId, baseRevisionId: null, personalId: f.app.store.state.personalParticipants[0].id, visitorModelId: visitor.id });
  const body = (speaker, kind = 'send') => ({ chatId: f.chatId, speaker, kind, requestId: 'request_' + crypto.randomUUID(), ...(kind === 'send' ? { content: 'Synthetic hello' } : {}), baseRevisionId: currentAssignment(f.app.store.state, f.chatId).id, lastMessageId: lastMessageId(f.app.store.state, f.chatId) });
  const sent = await f.post('/api/exchange', body('visiting')); assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(f.app.store.state.exchanges.at(-1).status, 'completed');
  const receipt = f.app.store.state.handoffs.records.find(r => r.kind === 'context.to_model');
  assert.equal(receipt.detail.transport.format, 'codex-app-server-v1'); assert.deepEqual(receipt.detail.capability.codex.environments, []);
  assert.equal((await f.post('/api/exchange', body('personal', 'ask'))).status, 200);
  assert.equal(quotedReplies(f.requests.at(-1).messages)[0].text, 'A synthetic visitor reply.');
  assert.equal((await f.post('/api/exchange', body('visiting', 'ask'))).status, 200);
  const injected = rpc.calls.filter(c => c.method === 'thread/inject_items').at(-1).params.items;
  assert(injected.some(m => m.role === 'user' && JSON.stringify(m).includes('Synthetic response.')));
  assert(injected.some(m => m.role === 'assistant' && JSON.stringify(m).includes('A synthetic visitor reply.')));
  assert.equal((await f.post('/api/command', { type: 'personal.create', payload: { name: 'Forbidden', modelId: visitor.id, baseIdentity: 'cloud' } })).status, 400);
});

test('sign-in is paired, fixed, and never writes the OAuth URL to the ledger or export', async t => {
  const { p, rpc } = await provider(t), f = await fixture(t, { modelOptions: { codex: p } }); rpc.accountType = null;
  const unpaired = await fetch(f.url + '/api/codex/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); assert.equal(unpaired.status, 401);
  assert.equal((await f.post('/api/codex/login', { command: 'no' })).status, 400);
  const result = await f.post('/api/codex/login'); assert.equal(result.status, 200); assert.match(result.body.authUrl, /auth.openai.com/);
  assert(!JSON.stringify(f.app.store.state).includes('synthetic-private-state'));
  assert(!JSON.stringify(f.app.store.state).includes('auth.openai.com'));
  const status = await fetch(f.url + '/api/codex/status', { headers: f.headers }).then(r => r.json()); assert.equal(status.connected, false);
});
