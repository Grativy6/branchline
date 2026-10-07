import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { ReplyMetrics, validateReplyMetrics } from '../server/reply-metrics.mjs';
import { initialState, applyCommand, validateState } from '../server/domain.mjs';
import { compileMessages } from '../server/model.mjs';
import { streamLocalTools } from '../server/local-tool-stream.mjs';
import { Store } from '../server/store.mjs';
import { messageInfoKeys, messageInfoPreferences, messageInfoFooter } from '../public/message-info.js';
import { escapeHtml } from '../public/views.js';

const event = value => 'data: ' + JSON.stringify(value) + '\n\n';
const usage = (input, output) => ({ prompt_tokens: input, completion_tokens: output });
async function streamed(f) {
  const response = await fetch(f.url + '/api/exchange', { method: 'POST', headers: { ...f.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ chatId: f.chatId, content: 'A synthetic measurement', stream: true }) });
  assert.equal(response.status, 200); await response.text();
  return f.app.store.state.exchanges.at(-1);
}

test('measurements distinguish first visible text, request time, and reported usage; bad metadata is ignored', () => {
  let now = 100; const metrics = new ReplyMetrics(() => now);
  now = 350; metrics.text('  '); metrics.observe({ usage: { prompt_tokens: '10', completion_tokens: -1 }, stats: { tokens_per_second: Infinity } });
  assert.equal(metrics.snapshot().inputTokens, null); assert.equal(metrics.snapshot().firstTextMs, null);
  now = 600; metrics.text('Hello'); now = 1100;
  metrics.observe({ usage: { ...usage(42, 20), completion_tokens_details: { reasoning_tokens: 5 } }, stats: { tokens_per_second: 40 } });
  metrics.observe({ usage: { ...usage(42, 20), completion_tokens_details: { reasoning_tokens: 5 } } });
  assert.deepEqual(metrics.snapshot(), { version: 1, elapsedMs: 1000, firstTextMs: 500, inputTokens: 42, outputTokens: 20, reasoningTokens: 5, rounds: 1, reportedTokensPerSecond: 40 });
  assert.equal(metrics.snapshot(false).outputTokens, null); assert.equal(metrics.snapshot(false).reportedTokensPerSecond, null);
  assert.throws(() => validateReplyMetrics({ ...metrics.snapshot(), command: 'injected metadata' }), /measurements/);
  assert.throws(() => validateReplyMetrics({ ...metrics.snapshot(), firstTextMs: 1001 }), /measurements/);
});

test('usage-only streaming events survive split chunks, are bound to the reply, and persist through reopen', async t => {
  const f = await fixture(t); const model = f.app.store.state.models[0];
  await f.command('model.save', { ...model, runtime: 'lmstudio' });
  f.handler = async (body, res) => {
    assert.deepEqual(body.stream_options, { include_usage: true });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(event({ choices: [{ delta: { content: 'Hello 🌱' }, finish_reason: null }] }));
    const ending = event({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + event({ choices: [], usage: usage(100, 12) }) + 'data: [DONE]\n\n';
    res.write(ending.slice(0, 29)); res.end(ending.slice(29));
  };
  const exchange = await streamed(f);
  assert.equal(exchange.status, 'completed'); assert.equal(exchange.metrics.outputTokens, 12); assert.equal(exchange.metrics.inputTokens, 100);
  assert.ok(exchange.metrics.firstTextMs >= 0); assert.ok(exchange.metrics.elapsedMs >= exchange.metrics.firstTextMs);
  const original = structuredClone(f.app.store.state);
  const forged = structuredClone(original); forged.exchanges.at(-1).metrics.outputTokens++;
  assert.throws(() => validateState(forged), /output binding/);
  await assert.rejects(f.app.store.transact(s => { s.exchanges.at(-1).metrics.outputTokens++; return s; }), /history|boundary|binding/);
  await f.app.store.requestCheckpoint(); await f.app.dispose();
  for (const checkpoints of [true, false]) {
    const reopened = new Store(f.dataDir, { checkpoints }); await reopened.open();
    try { assert.deepEqual(reopened.state, original); } finally { await reopened.close(); }
  }
});

test('plain completions retain usage and runtime generation speed; nonstreaming does not pretend to measure a first word', async t => {
  const f = await fixture(t); const model = f.app.store.state.models[0];
  await f.command('model.save', { ...model, inputFormat: 'plain-dialogue-v1', runtime: 'lmstudio' });
  f.handler = async (body, res) => {
    assert.equal(typeof body.prompt, 'string');
    if (body.stream) {
      assert.deepEqual(body.stream_options, { include_usage: true });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(event({ choices: [{ text: 'Plain answer', finish_reason: 'length' }], usage: usage(70, 10), stats: { tokens_per_second: 22.5 } }) + 'data: [DONE]\n\n');
    } else res.end(JSON.stringify({ choices: [{ text: 'Nonstreaming answer', finish_reason: 'stop' }], usage: usage(90, 14) }));
  };
  const streamedReply = await streamed(f);
  assert.equal(streamedReply.metrics.reportedTokensPerSecond, 22.5); assert.equal(streamedReply.truncated, true);
  await f.exchange(); const reply = f.app.store.state.exchanges.at(-1);
  assert.equal(reply.metrics.outputTokens, 14); assert.equal(reply.metrics.firstTextMs, null);
});

test('tool usage snapshots are counted once per request and incomplete rounds have no invented totals', async t => {
  const f = await fixture(t); let invoked = 0;
  f.handler = async (body, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (body.messages.length === 1) {
      res.end(event({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'clock_1', type: 'function', function: { name: 'clock', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] })
        + event({ choices: [], usage: usage(10, 4) }) + event({ choices: [], usage: usage(10, 4) }) + 'data: [DONE]\n\n');
    } else res.end(event({ choices: [{ delta: { content: 'The time is noon.' }, finish_reason: 'stop' }] }) + event({ choices: [], usage: usage(20, 6) }) + 'data: [DONE]\n\n');
  };
  const metrics = new ReplyMetrics();
  const stream = streamLocalTools(new URL(f.app.store.state.models[0].baseUrl + '/chat/completions'), { model: 'synthetic', messages: [{ role: 'user', content: 'Time?' }], stream: true },
    { definitions: [{ name: 'clock', parameters: { type: 'object' } }], invoke: async () => { invoked++; return { time: '12:00' }; } }, new AbortController().signal, 10000, 60000, metrics);
  let answer = ''; for await (const delta of stream) answer += delta.text;
  assert.equal(answer, 'The time is noon.'); assert.equal(invoked, 1);
  assert.equal(metrics.snapshot().inputTokens, 30); assert.equal(metrics.snapshot().outputTokens, 10); assert.equal(metrics.snapshot().rounds, 2);
  metrics.beginRound(2); assert.equal(metrics.snapshot().outputTokens, null);
});

test('failed and unsupported streams keep timing without manufacturing usage or adding unrecognized options', async t => {
  const f = await fixture(t);
  f.handler = async (body, res) => {
    assert.equal(body.stream_options, undefined, 'generic compatible connections are unchanged');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(event({ choices: [{ delta: { content: 'A partial reply' } }], usage: usage(10, 3) }) + event({ error: { message: 'Synthetic connection failed' } }));
  };
  const failed = await streamed(f);
  assert.equal(failed.status, 'failed'); assert.equal(failed.metrics.outputTokens, null); assert.ok(failed.metrics.firstTextMs >= 0);
  assert.equal(f.app.store.state.messages.at(-1).content, 'A partial reply');
  f.handler = async (_body, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(event({ choices: [{ delta: { content: 'A complete reply' }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n'); };
  const completed = await streamed(f); assert.equal(completed.status, 'completed'); assert.equal(completed.metrics.outputTokens, null);
});

test('message preferences default off, remain separate from model context, and render bounded escaped metadata', async t => {
  assert.equal(messageInfoFooter(undefined, null, null, escapeHtml), '');
  const all = Object.fromEntries(messageInfoKeys.map(key => [key, true]));
  assert.throws(() => applyCommand(initialState(), { type: 'ui.update', payload: { messageInfo: { ...all, unknown: true } } }), /message info/);
  assert.deepEqual(messageInfoPreferences(null), Object.fromEntries(messageInfoKeys.map(key => [key, false])));
  const f = await fixture(t); await f.exchange();
  const before = compileMessages(f.app.store.state, f.chatId, 'Continue');
  await f.command('ui.update', { messageInfo: all });
  assert.deepEqual(compileMessages(f.app.store.state, f.chatId, 'Continue'), before);
  const legacy = messageInfoFooter(all, { status: 'completed', modelLabel: '<script>fake</script>' }, null, escapeHtml);
  assert.match(legacy, /Time not recorded/); assert.match(legacy, /Token counts unavailable/); assert.ok(!legacy.includes('<script>'));
  const metrics = new ReplyMetrics(() => 0).snapshot(); metrics.elapsedMs = 2000; metrics.outputTokens = 40;
  const measured = messageInfoFooter(all, { metrics, status: 'completed' }, null, escapeHtml);
  assert.match(measured, /20\.0 tok\/s overall/); assert.doesNotMatch(measured, /tok\/s generation/);
});
