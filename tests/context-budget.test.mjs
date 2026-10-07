import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { contextBudget } from '../server/context-budget.mjs';
import { listen, fixture } from './helpers.mjs';

test('local budget reads the selected loaded instance, reserves output, caches metadata and never loads a model', async t => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push([req.method, req.url]);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ models: [{ loaded_instances: [
      { id: 'another-model', config: { context_length: 32768 } },
      { id: 'selected', config: { context_length: 8192 } },
    ] }] }));
  });
  const baseUrl = await listen(server);
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const model = { runtime: 'lmstudio', baseUrl: baseUrl + '/v1', model: 'selected' };
  const reply = await contextBudget(model, { maxTokens: 512 });
  assert.equal(reply.loadedTokens, 8192); assert.equal(reply.characters, 19968);
  assert.equal((await contextBudget(model, { maxTokens: 2048 })).characters, 15360);
  assert.equal((await contextBudget(model, { maxContextCharacters: 7000 })).characters, 7000);
  assert.deepEqual(requests, [['GET', '/api/v1/models']]);
});

test('unavailable metadata is explicit; compatible connections and non-loopback addresses do not get a model-report request', async () => {
  const fallback = await contextBudget({ runtime: 'lmstudio', baseUrl: 'https://example.invalid/v1', model: 'unknown' });
  assert.equal(fallback.loadedTokens, null); assert.equal(fallback.characters, 16000);
  assert.equal(fallback.basis, 'local_window_unknown_conservative_estimate');
  for (const runtime of ['codex', 'compatible']) {
    const report = await contextBudget({ runtime, baseUrl: 'https://example.invalid', model: 'synthetic' });
    assert.equal(report.characters, 60000); assert.equal(report.basis, 'application_character_ceiling');
  }
});

test('a retrieved source that fills the local window remains recorded and stops before another inference request', async t => {
  const f = await fixture(t, { modelOptions: { maxContextCharacters: 8000 } });
  await f.command('message.note', { chatId: f.chatId, content: 'Exact original. ' + 'x'.repeat(4500) });
  let calls = 0;
  f.handler = (_body, res) => {
    calls++;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'source', type: 'function', function: {
      name: 'read_chat_source', arguments: JSON.stringify({ source_id: 'M1', offset: 0 }),
    } }] }, finish_reason: 'tool_calls' }] }) + '\n\ndata: [DONE]\n\n');
  };
  const answer = await f.post('/api/exchange', { chatId: f.chatId, content: 'Open the original.', toolsEnabled: true });
  assert.equal(answer.status, 502, JSON.stringify(answer.body));
  assert.match(answer.body.error, /working context/); assert.equal(calls, 1);
  const result = f.app.store.state.handoffs.records.find(r => r.kind === 'operation.result' && r.detail.tool === 'read_chat_source');
  assert.match(result.detail.result.value.text, /Exact original/);
  assert.equal(f.app.store.state.exchanges.at(-1).status, 'failed');
});
