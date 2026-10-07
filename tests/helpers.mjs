import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
export const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port)); });
export const quotedReplies = messages => messages.filter(m => m.role === 'user' && m.content.startsWith('[App context: another participant\'s reply]'))
  .map(m => JSON.parse(m.content.split('\n').at(-1)));

// All model responses and workspace contents are synthetic. Test directories
// remain available for inspection; this helper performs no recursive cleanup.
export async function fixture(t, { modelOptions = {} } = {}) {
  const base = process.env.BRANCHLINE_TEST_ROOT || path.join(project, '.test-data');
  await fs.mkdir(base, { recursive: true });
  const dir = await fs.mkdtemp(path.join(base, 'handoff-'));
  const f = { dir, requests: [], responseText: 'Synthetic response.', finishReason: 'stop', handler: null };
  const model = http.createServer(async (req, res) => {
    try {
      if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'synthetic-model' }] })); return; }
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      f.requests.push(body);
      if (f.handler) return await f.handler(body, res, req);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: f.responseText }, finish_reason: f.finishReason }] }));
    } catch (error) { if (!res.destroyed) { res.statusCode = 500; res.end(error.message); } }
  });
  const modelUrl = await listen(model);
  f.dataDir = path.join(dir, 'workspace'); f.backupDir = path.join(dir, 'backups');
  f.app = await createApp({ dataDir: f.dataDir, backupDir: f.backupDir, modelOptions: { timeoutMs: 10000, ...modelOptions } });
  f.url = await listen(f.app);
  Object.defineProperty(f, 'headers', { get: () => ({ 'x-branchline-session': f.app.sessionToken }) });
  Object.defineProperty(f, 'uiUrl', { get: () => f.url + '/#session=' + f.app.sessionToken });
  t.after(async () => { await f.app.dispose(); model.closeAllConnections(); await new Promise(resolve => model.close(resolve)); });
  f.post = async (url, data = {}) => {
    const response = await fetch(f.url + url, { method: 'POST', headers: { ...f.headers, 'content-type': 'application/json' }, body: JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  };
  f.command = async (type, payload) => { const result = await f.post('/api/command', { type, payload }); assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body; };
  await f.command('root.create', { name: 'Synthetic branch', mode: 'personal' });
  f.rootId = f.app.store.state.roots[0].id; f.chatId = f.app.store.state.chats[0].id;
  await f.command('model.save', { name: 'Synthetic model', model: 'synthetic-model', baseUrl: modelUrl + '/v1' });
  await f.command('root.model', { id: f.rootId, modelId: f.app.store.state.models[0].id });
  f.exchange = async (content = 'Synthetic user request') => { const r = await f.post('/api/exchange', { chatId: f.chatId, content }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.exchanges.at(-1).id; };
  f.reflect = (exchangeId, target) => f.post('/api/continuity/reflect', { chatId: f.chatId, exchangeId, target });
  return f;
}
