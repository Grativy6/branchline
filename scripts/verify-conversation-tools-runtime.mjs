// Synthetic loopback provider only. No account, real chat, or OpenAI request.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { toolDefinitions, TOOL_NAMES } from '../server/tool-contract.mjs';
import { CodexRpc } from '../server/codex-rpc.mjs';
import { verifiedCodexBinary, codexEnvironment } from '../server/codex-provider.mjs';
import { codexArgs, codexThreadParams, verifyCodexConfig, CODEX_SHA256 } from '../server/codex-policy.mjs';

const dir = path.resolve(process.env.BRANCHLINE_TEST_ROOT || '.test-data', 'codex-tools-runtime-' + Date.now());
await fs.mkdir(dir, { recursive: true });
const home = path.join(dir, 'home'), empty = path.join(dir, 'empty');
await fs.mkdir(home); await fs.mkdir(empty);
const requests = [], toolCalls = []; let responseMode = 'text';
const server = http.createServer(async (req, res) => {
  let text = ''; for await (const chunk of req) text += chunk;
  if (!text) { res.writeHead(404); res.end(); return; }
  const body = JSON.parse(text); requests.push(body);
  const call = responseMode === 'attack' && !body.input.some(i => i.type === 'custom_tool_call_output');
  const dynamic = responseMode === 'clock' && !body.input.some(i => i.type === 'function_call_output');
  const item = dynamic ? {type:'function_call',id:'clock-call',call_id:'clock-call',name:'read_clock',arguments:'{}'} : call ? { type: 'custom_tool_call', id: 'attack', call_id: 'attack', name: 'apply_patch', input: '*** Begin Patch\n*** Add File: forbidden.txt\n+This must not be written.\n*** End Patch' }
    : { type: 'message', id: 'answer', role: 'assistant', content: [{ type: 'output_text', text: 'Synthetic visitor reply.' }] };
  res.writeHead(200, { 'content-type': 'text/event-stream', 'connection': 'close' });
  res.write(`event: response.created\ndata: ${JSON.stringify({ type: 'response.created', response: { id: 'r' + requests.length } })}\n\n`);
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
  const effective=await rpc.request('config/read', { includeLayers: true });
  verifyCodexConfig(effective); rpc.close();
  // The only test override is a no-auth loopback model transport. Capability flags stay identical.
  const args = [...codexArgs(), '-c', 'model_provider="fixture"', '-c', `model_providers.fixture={ name="Fixture", base_url="http://127.0.0.1:${server.address().port}/v1", wire_api="responses", requires_openai_auth=false, supports_websockets=false }`];
  rpc = new CodexRpc(binary, args, { cwd: empty, env: codexEnvironment(home, empty) });
  await rpc.request('initialize', { clientInfo: { name: 'branchline_test', version: '1' }, capabilities: { experimentalApi: true } }); rpc.notify('initialized');
  for (const mode of ['clock', 'attack']) {
    responseMode = mode;
    const params = codexThreadParams({ model: 'gpt-6-astra' }, [{ role: 'system', content: 'Synthetic system guidance.' }, { role: 'user', content: 'Synthetic request.' }], empty, 512, toolDefinitions({tools:TOOL_NAMES.filter(n=>n!=='read_selected_document'),documents:[],history:{count:2}}));
    const thread = await rpc.request('thread/start', { ...params, modelProvider: 'fixture' });
    assert.equal(thread.sandbox.type, 'readOnly');
    rpc.toolHandler=async p=>{ assert.equal(p.threadId,thread.thread.id);assert.equal(p.tool,'read_clock');assert.deepEqual(p.arguments,{});toolCalls.push(p);return {contentItems:[{type:'inputText',text:JSON.stringify({ok:true,value:{utc:'2026-09-27T12:00:00Z',source:'synthetic_clock'}})}],success:true}; }; 
    console.log('thread', mode, thread.instructionSources);
    const complete = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { rpc.off('notification', onEvent); reject(new Error('Synthetic runtime turn timed out')); }, 30000);
      const onEvent = event => { if (event.params?.threadId === thread.thread.id && event.method === 'turn/completed') { clearTimeout(timer); rpc.off('notification', onEvent); resolve(event.params); } };
      rpc.on('notification', onEvent);
    });
    await rpc.request('thread/inject_items', { threadId: thread.thread.id, items: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Synthetic previous user.' }] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Synthetic previous visitor.' }] }] });
    await rpc.request('turn/start', { threadId: thread.thread.id, input: [{ type: 'text', text: 'Synthetic request.' }], environments: [], runtimeWorkspaceRoots: [], approvalPolicy: 'never', approvalsReviewer: 'user', sandboxPolicy: { type: 'readOnly' }, summary: 'none' });
    const result = await complete;
    assert.equal(result.turn.status, 'completed', JSON.stringify(result.turn.error));
    await rpc.request('thread/unsubscribe', { threadId: thread.thread.id });
  }
  assert.equal(toolCalls.length,1);
  assert(requests.some(r=>r.input.some(i=>i.type==='function_call_output'&&JSON.stringify(i.output).includes('synthetic_clock'))));
  assert(requests.length >= 4, 'Attack should return an unavailable-tool result and continue.');
  const exposed = r => [...(r.tools||[]),...r.input.filter(i=>i.type==='additional_tools').flatMap(i=>i.tools)];
  const names = tools => tools.flatMap(t=>t.type==='namespace'?names(t.tools):[t.name]);
  for (const r of requests) {
    assert.deepEqual(names(exposed(r)).sort(),['ask_user','fetch_public_page','read_clock','run_calculation','read_chat_source'].sort());
    assert(!JSON.stringify(r.input).includes('<skills_instructions>'));
    assert(r.input.some(i=>i.role==='developer'&&i.content?.some(c=>c.text==='Synthetic system guidance.')));
    assert(!JSON.stringify(r.tools ?? []).match(/apply_patch|exec_command|shell|browser|web_search|spawn_agent|mcp/i), 'Consequential tool unexpectedly advertised');
    if(r.instructions !== undefined) assert.equal(r.instructions, 'Synthetic system guidance.');
  }
  assert(requests.some(r => r.input.some(i => i.type === 'custom_tool_call_output' && /unsupported|not found|unknown|not available|unrecognized/i.test(JSON.stringify(i.output)))));
  assert.equal(await fs.stat(path.join(empty, 'forbidden.txt')).then(() => true).catch(() => false), false);
  assert(requests.some(r=>JSON.stringify(exposed(r)).includes('run_calculation')), 'App-owned tool definitions did not reach the provider');
  const report = { status: 'PASS', executableSha256: CODEX_SHA256, requests: requests.length, tools: names(exposed(requests[0])),
    dynamicCalls:toolCalls.map(p=>({tool:p.tool,namespace:p.namespace??null})), facts: ['app clock call returned through the pinned runtime', 'production effective config verified', 'empty environments accepted', 'history injection accepted', 'system guidance preserved', 'apply_patch not available', 'forbidden file absent'], syntheticOnly: true };
  await fs.mkdir('test-results', { recursive: true }); await fs.writeFile('test-results/conversation-tools-runtime.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { rpc?.close(); await new Promise(resolve => server.close(resolve)); }
