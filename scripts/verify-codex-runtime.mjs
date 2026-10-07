// Synthetic loopback provider only. No account, real chat, or OpenAI request.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { CodexRpc } from '../server/codex-rpc.mjs';
import { verifiedCodexBinary, codexEnvironment } from '../server/codex-provider.mjs';
import { codexArgs, codexThreadParams, verifyCodexConfig, CODEX_SHA256 } from '../server/codex-policy.mjs';

const dir = path.resolve(process.env.BRANCHLINE_TEST_ROOT || '.test-data', 'codex-runtime-' + Date.now());
await fs.mkdir(dir, { recursive: true });
const home = path.join(dir, 'home'), empty = path.join(dir, 'empty');
await fs.mkdir(home); await fs.mkdir(empty);
const requests = []; let responseMode = 'text';
const picture='data:image/png;base64,'+(await sharp({create:{width:32,height:32,channels:3,background:'#347a58'}}).png().toBuffer()).toString('base64');
let cancelClosed;
const cancelConnectionClosed=new Promise(resolve=>{cancelClosed=resolve;});
const server = http.createServer(async (req, res) => {
  let text = ''; for await (const chunk of req) text += chunk;
  if (!text) { res.writeHead(404); res.end(); return; }
  const body = JSON.parse(text); requests.push(body);
  const call = responseMode === 'attack' && !body.input.some(i => i.type === 'custom_tool_call_output');
  const item = call ? { type: 'custom_tool_call', id: 'attack', call_id: 'attack', name: 'apply_patch', input: '*** Begin Patch\n*** Add File: forbidden.txt\n+This must not be written.\n*** End Patch' }
    : { type: 'message', id: 'answer', role: 'assistant', content: [{ type: 'output_text', text: 'Synthetic visitor reply.' }] };
  res.writeHead(200, { 'content-type': 'text/event-stream', 'connection': 'close' });
  res.write(`event: response.created\ndata: ${JSON.stringify({ type: 'response.created', response: { id: 'r' + requests.length } })}\n\n`);
  if(responseMode==='cancel') {
    res.on('close',cancelClosed);
    res.write(`event: response.output_item.added\ndata: ${JSON.stringify({type:'response.output_item.added',output_index:0,item:{type:'message',id:'streaming-answer',role:'assistant',content:[]}})}\n\n`);
    res.write(`event: response.output_text.delta\ndata: ${JSON.stringify({type:'response.output_text.delta',item_id:'streaming-answer',output_index:0,content_index:0,delta:'Synthetic partial reply.'})}\n\n`);
    return;
  }
  res.write(`event: response.output_item.done\ndata: ${JSON.stringify({ type: 'response.output_item.done', output_index: 0, item })}\n\n`);
  res.end(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: 'r' + requests.length, output: [item], usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } } })}\n\n`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const binary = await verifiedCodexBinary();
let rpc;
try {
  // First inspect the production profile without starting any model or signing in.
  rpc = new CodexRpc(binary, codexArgs(), { cwd: empty, env: codexEnvironment(home, empty) });
  await rpc.request('initialize', { clientInfo: { name: 'branchline_test', version: '1' }, capabilities: { experimentalApi: true } }); rpc.notify('initialized');
  verifyCodexConfig(await rpc.request('config/read', { includeLayers: true })); rpc.close();
  // The only test override is a no-auth loopback model transport. Capability flags stay identical.
  const args = [...codexArgs(), '-c', 'model_provider="fixture"', '-c', `model_providers.fixture={ name="Fixture", base_url="http://127.0.0.1:${server.address().port}/v1", wire_api="responses", requires_openai_auth=false, supports_websockets=false }`];
  rpc = new CodexRpc(binary, args, { cwd: empty, env: codexEnvironment(home, empty) });
  await rpc.request('initialize', { clientInfo: { name: 'branchline_test', version: '1' }, capabilities: { experimentalApi: true } }); rpc.notify('initialized');
  for (const mode of ['text', 'attack', 'image', 'cancel']) {
    responseMode = mode;
    const params = codexThreadParams({ model: 'gpt-6-astra' }, [{ role: 'system', content: 'Synthetic system guidance.' }, { role: 'user', content: 'Synthetic request.' }], empty);
    const thread = await rpc.request('thread/start', { ...params, modelProvider: 'fixture' });
    assert.equal(thread.sandbox.type, 'readOnly');
    console.log('thread', mode, thread.instructionSources);
    const complete = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { rpc.off('notification', onEvent); reject(new Error('Synthetic runtime turn timed out')); }, 30000);
      const onEvent = event => { if (event.params?.threadId === thread.thread.id && event.method === (mode==='cancel'?'item/agentMessage/delta':'turn/completed')) { clearTimeout(timer); rpc.off('notification', onEvent); resolve(event.params); } };
      rpc.on('notification', onEvent);
    });
    await rpc.request('thread/inject_items', { threadId: thread.thread.id, items: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Synthetic previous user.' }] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Synthetic previous visitor.' }] }] });
    await rpc.request('turn/start', { threadId: thread.thread.id, input: [{ type: 'text', text: 'Synthetic request.' },...(mode==='image'?[{type:'image',url:picture,detail:'original'}]:[])], environments: [], runtimeWorkspaceRoots: [], approvalPolicy: 'never', approvalsReviewer: 'user', sandboxPolicy: { type: 'readOnly' }, summary: 'none' });
    const result = await complete;
    if(mode==='cancel') {
      assert.equal(result.delta,'Synthetic partial reply.');
      // Production cancellation closes this private ephemeral connection.
      rpc.close();
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Canceled transport stayed open')),5000);cancelConnectionClosed.then(()=>{clearTimeout(timer);resolve();});});
      continue;
    }
    assert.equal(result.turn.status, 'completed', JSON.stringify(result.turn.error));
    await rpc.request('thread/unsubscribe', { threadId: thread.thread.id });
  }
  assert(requests.length >= 3, 'Attack should return an unavailable-tool result and continue.');
  assert(requests.some(r=>r.input.some(i=>i.content?.some(c=>c.type==='input_image'&&c.image_url===picture))),'Selected image bytes did not reach the synthetic provider.');
  for (const r of requests) {
    const tools=[...(r.tools||[]),...r.input.filter(i=>i.type==='additional_tools').flatMap(i=>i.tools)];
    assert.equal(tools.length,0);
    assert(!JSON.stringify(tools).match(/apply_patch|exec_command|shell|browser|web_search|spawn_agent|functions|mcp/i), 'Consequential tool unexpectedly advertised');
    assert(r.input.some(i=>i.role==='developer'&&i.content?.some(c=>c.text==='Synthetic system guidance.')));
    assert(!JSON.stringify(r.input).includes('<skills_instructions>'));
  }
  assert(requests.some(r => r.input.some(i => i.type === 'custom_tool_call_output' && /unsupported|not found|unknown|not available|unrecognized/i.test(JSON.stringify(i.output)))));
  assert.equal(await fs.stat(path.join(empty, 'forbidden.txt')).then(() => true).catch(() => false), false);
  const report = { status: 'PASS', executableSha256: CODEX_SHA256, requests: requests.length, tools: [],
    facts: ['production effective config verified', 'empty environments accepted', 'history injection accepted', 'system guidance preserved', 'apply_patch not available', 'forbidden file absent','selected image bytes preserved','reply delta streamed','cancellation closes provider transport'], syntheticOnly: true };
  await fs.mkdir('test-results', { recursive: true }); await fs.writeFile('test-results/codex-runtime.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { rpc?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
