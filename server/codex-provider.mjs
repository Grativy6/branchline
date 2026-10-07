import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CodexRpc, publicCodexError } from './codex-rpc.mjs';
import { codexToolContent } from './tool-images.mjs';
import { CODEX_SHA256, CODEX_PROFILE, CODEX_VERSION, CODEX_CATALOG, CODEX_CATALOG_SHA256, codexArgs, codexInput, codexThreadParams, verifyCodexConfig, verifyCodexThread } from './codex-policy.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appVersion = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8')).version;
const localPath = p => path.resolve(p);
export async function verifiedCodexBinary() {
  if (crypto.createHash('sha256').update(await fs.readFile(CODEX_CATALOG)).digest('hex') !== CODEX_CATALOG_SHA256)
    throw new Error('The reviewed model capability catalogue changed. This connection is held.');
  // Packaged runtime, or the same verified public download in a developer's
  // local cache. An unrelated desktop installation is never a release input.
  const candidates = [path.join(packageRoot, 'codex-runtime', 'codex.exe'),
    path.join(packageRoot, '.local', 'runtime-cache', 'codex.exe')];
  for (const candidate of candidates) {
    try {
      const real = localPath(await fs.realpath(candidate));
      const hash = crypto.createHash('sha256');
      for await (const bytes of createReadStream(real)) hash.update(bytes);
      if (hash.digest('hex') === CODEX_SHA256) return real;
    } catch { /* Only the pinned executable is eligible. */ }
  }
  throw new Error('The verified ChatGPT connection runtime is missing. Use a complete Branchline v0.8 package.');
}

export function codexEnvironment(home, cwd) {
  // Deliberate allowlist: no API keys, global Codex config, proxies, or CLI hooks.
  const env = {};
  for (const name of ['SYSTEMROOT', 'WINDIR', 'SystemDrive', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'USERNAME']) {
    const key = Object.keys(process.env).find(key => key.toLowerCase() === name.toLowerCase());
    if (key) env[key] = process.env[key];
  }
  return { ...env, CODEX_HOME: home, PWD: cwd, TERM: 'dumb', NO_COLOR: '1',
    PATH: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32') };
}

export function validAuthUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'auth.openai.com' && !u.username && !u.password && (!u.port || u.port === '443'); } catch { return false; }
}

// One private account session, fresh ephemeral model thread for every reply.
// No RPC pass-through is exposed to the browser or generated text.
export class CodexProvider {
  constructor({ accountDir, rpcFactory = (binary, args, options) => new CodexRpc(binary, args, options), binaryResolver = verifiedCodexBinary } = {}) {
    this.accountDir = localPath(accountDir); this.rpcFactory = rpcFactory; this.binaryResolver = binaryResolver;
    this.rpc = null; this.starting = null; this.busy = false; this.disposed = false;
    this.models = []; this.login = null; this.loginError = null; this.rates = null;
  }
  async start() {
    if (this.disposed) throw new Error('Branchline is closing.');
    if (this.rpc && !this.rpc.closed) return this.rpc;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const binary = await this.binaryResolver();
      const home = path.join(this.accountDir, 'home'); this.cwd = path.join(this.accountDir, 'empty');
      await fs.mkdir(home, { recursive: true }); await fs.mkdir(this.cwd, { recursive: true });
      await fs.realpath(home); await fs.realpath(this.cwd);
      if (this.disposed) throw new Error('Branchline is closing.');
      const rpc = this.rpcFactory(binary, codexArgs(), { cwd: this.cwd, env: codexEnvironment(home, this.cwd) });
      this.rpc = rpc;
      rpc.on('disconnected', () => { if (this.rpc === rpc) { this.login = null; this.models = []; this.rates = null; } });
      rpc.on('notification', ({ method, params }) => {
        if (method === 'account/login/completed' && params.loginId === this.login?.loginId) {
          this.login = null; this.models = []; this.loginError = params.success ? null : publicCodexError(params.error || 'Sign-in did not complete.');
        }
        if (method === 'account/updated') this.models = [];
        if (method === 'account/rateLimits/updated') this.rates = params;
      });
      try {
        const hello = await rpc.request('initialize', { clientInfo: { name: 'branchline', title: 'Branchline', version: appVersion }, capabilities: { experimentalApi: true } });
        if (!hello.userAgent?.includes(CODEX_VERSION)) throw new Error('Unexpected Codex runtime version.');
        rpc.notify('initialized');
        verifyCodexConfig(await rpc.request('config/read', { includeLayers: true }));
        return rpc;
      } catch (error) { rpc.close(); throw error; }
    })();
    try { return await this.starting; } finally { this.starting = null; }
  }
  async account() {
    const rpc = await this.start();
    const { account } = await rpc.request('account/read', { refreshToken: false });
    if (account && account.type !== 'chatgpt') throw new Error('This connection requires ChatGPT sign-in; API billing is not enabled.');
    return account;
  }
  async catalogue() {
    const rpc = await this.start(); let cursor = null; const models = [];
    for (let page = 0; page < 10; page++) {
      const result = await rpc.request('model/list', { limit: 100, ...(cursor ? { cursor } : {}) });
      for (const m of result.data || []) if (!m.hidden && typeof m.model === 'string') models.push({ id: m.model, name: m.displayName || m.model, description: m.description || '', isDefault: m.isDefault === true });
      cursor = result.nextCursor; if (!cursor) { this.models = models; return models; }
    }
    throw new Error('Codex model list was too large.');
  }
  async status() {
    const account = await this.account();
    let catalogueError = null;
    if (!account) { this.models = []; this.rates = null; }
    if (account && !this.models.length) {
      try {
        await this.catalogue();
        this.rates = await this.rpc.request('account/rateLimits/read').catch(() => null);
      } catch { catalogueError = 'Your account is connected, but the model list is temporarily unavailable. Retry the model list.'; }
    }
    return { connected: Boolean(account), account: account ? { email: account.email, plan: account.planType } : null,
      models: this.models, rates: this.rates, pending: Boolean(this.login), error: catalogueError ?? this.loginError,
      profile: CODEX_PROFILE, mode: 'conversation_only' };
  }
  async loginStart() {
    if (this.busy) throw new Error('Finish or stop the current reply before signing in.');
    const rpc = await this.start();
    if (this.login) return { authUrl: this.login.authUrl };
    const result = await rpc.request('account/login/start', { type: 'chatgpt' });
    if (result.type !== 'chatgpt' || !validAuthUrl(result.authUrl)) throw new Error('Codex returned an unexpected sign-in destination.');
    this.login = result; this.loginError = null;
    return { authUrl: result.authUrl };
  }
  async logout() {
    if (this.busy) throw new Error('Finish or stop the current reply before signing out.');
    const rpc = await this.start();
    if (this.login) await rpc.request('account/login/cancel', { loginId: this.login.loginId });
    await rpc.request('account/logout'); this.login = null; this.models = []; this.rates = null;
    return { connected: false };
  }
  async *stream(model, messages, signal, { maxTokens = null, maxResponseBytes = 2 * 1024 * 1024, tools = null, imageData } = {}) {
    if (this.busy) throw new Error('Codex is already replying.');
    signal?.throwIfAborted(); this.busy = true;
    let rpc, threadId, turnId, done = false, problem = null, notifyWait = null, total = 0;
    const queue = [], seen = new Map(); let observedTurnId = null, lastItemId = null;
    const wake = () => { notifyWait?.(); notifyWait = null; };
    const fail = error => { problem ??= error; done = true; wake(); };
    const abort = () => { fail(new Error('Reply stopped.')); rpc?.close(); };
    const disconnected = error => fail(error);
    const blocked = () => { fail(new Error('Codex requested a tool or permission. Branchline held this reply.')); rpc?.close(); };
    const emit = (id, text, complete = false) => {
      const previous = seen.get(id) || '';
      if (complete) { if (!text.startsWith(previous)) return fail(new Error('Codex changed text already streamed.')); text = text.slice(previous.length); }
      if (!text) return;
      const originalDelta = text;
      if (lastItemId && lastItemId !== id && !previous) text = '\n\n' + text;
      lastItemId = id;
      total += Buffer.byteLength(text); if (total > maxResponseBytes) { fail(new Error('Codex reply exceeded the response limit.')); rpc.close(); return; }
      seen.set(id, previous + originalDelta); queue.push({ text }); wake();
    };
    const notification = ({ method, params: p }) => {
      if (!threadId || p?.threadId !== threadId || (turnId && p.turnId && p.turnId !== turnId)) return;
      if (p.turnId) { if (observedTurnId && observedTurnId !== p.turnId) return blocked(); observedTurnId = p.turnId; }
      if (method === 'item/agentMessage/delta') emit(p.itemId, p.delta);
      if (method === 'item/completed' && p.item?.type === 'agentMessage') emit(p.item.id, p.item.text, true);
      if (method === 'item/started' && !['userMessage', 'agentMessage', 'reasoning'].includes(p.item?.type)) {
        if (!(tools && p.item?.type === 'dynamicToolCall' && tools.definitions.some(d => d.name === p.item.tool))) blocked();
      }
      if (method === 'model/rerouted') { fail(new Error('Codex changed models during this reply. The result is held.')); rpc.close(); }
      if (method === 'turn/completed') {
        if (p.turn?.status !== 'completed') problem = new Error(publicCodexError(p.turn?.error || 'Codex did not complete this reply.'));
        done = true; wake();
      }
      if (method === 'error' && !p.willRetry) fail(new Error(publicCodexError(p.error)));
    };
    try {
      rpc = await this.start(); signal?.throwIfAborted();
      signal?.addEventListener('abort', abort, { once: true });
      rpc.on('disconnected', disconnected); rpc.on('blockedRequest', blocked); rpc.on('notification', notification);
      if (!await this.account()) throw new Error('Connect your ChatGPT account in Models first.');
      if (!this.models.length) await this.catalogue();
      if (!this.models.some(m => m.id === model.model)) throw new Error('This model is no longer in your Codex model list. Choose an available visitor.');
      verifyCodexConfig(await rpc.request('config/read', { includeLayers: true }));
      const started = await rpc.request('thread/start', codexThreadParams(model, messages, this.cwd, maxTokens, tools?.definitions));
      threadId = started.thread?.id; verifyCodexThread(started, model);
      if (tools) rpc.toolHandler = async p => {
        if (done || signal?.aborted || p.threadId !== threadId || !p.turnId || (p.namespace != null)
          || (turnId && p.turnId !== turnId) || (observedTurnId && p.turnId !== observedTurnId)) throw new Error('Tool request escaped its episode.');
        observedTurnId = p.turnId;
        const result = await tools.invoke(p.tool, p.arguments, p.callId);
        return { contentItems: codexToolContent(result,signal), success: result.ok };
      };
      const input = codexInput(messages, imageData);
      if (input.history.length) await rpc.request('thread/inject_items', { threadId, items: input.history });
      signal?.throwIfAborted();
      const startedTurn = await rpc.request('turn/start', { threadId, input: input.input, model: model.model,
        environments: [], runtimeWorkspaceRoots: [], approvalPolicy: 'never', approvalsReviewer: 'user',
        sandboxPolicy: { type: 'readOnly' },
        summary: 'none' });
      turnId = startedTurn.turn.id;
      if (observedTurnId && observedTurnId !== turnId) blocked();
      while (!done || queue.length) {
        while (queue.length) yield queue.shift();
        if (!done) await new Promise(resolve => { notifyWait = resolve; });
      }
      if (problem) throw problem;
      if (!total) throw new Error('Codex returned no text reply.');
      return 'stop';
    } finally {
      if (rpc) rpc.toolHandler = null;
      signal?.removeEventListener('abort', abort);
      rpc?.off('disconnected', disconnected); rpc?.off('blockedRequest', blocked); rpc?.off('notification', notification);
      if (rpc && !done) rpc.close();
      // A private ephemeral episode cannot carry hidden history into the next call.
      if (rpc && threadId && !rpc.closed) await rpc.request('thread/unsubscribe', { threadId }, 3000).catch(() => rpc.close());
      this.busy = false;
    }
  }
  close() { this.disposed = true; this.rpc?.close(); }
}
