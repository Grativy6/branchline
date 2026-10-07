import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { BUNDLED_PROFILE, BUNDLED_CONTEXT, BUNDLED_IMAGE_TOKENS, assertBundledProfile } from './bundled-profile.mjs';

const modelFile = 'Qwen3.5-4B-Q4_K_M.gguf', projectorFile = 'mmproj-Qwen3.5-4B-BF16.gguf';
const expected = { [modelFile]: '25082a7dd3776cc3c741c6347d3bd04523f05796607b3fbc32fa3a25dfa1418c',
  [projectorFile]: 'ae08d9d7eceb8f2d0672d61b5e6aa78b611f2942b55ed71d21414980cc454b91' };
const fail = message => new Error(message + ' Open Settings → Models → Included Qwen for recovery.');
export async function hashFile(file, signal) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file, { highWaterMark: 4 * 1024 * 1024, signal })) hash.update(chunk);
  return hash.digest('hex');
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
async function regular(root, relative) {
  if (!/^[a-zA-Z0-9._/-]+$/.test(relative) || relative.split('/').some(p => !p || p === '..')) throw fail('The included-model manifest has an invalid path.');
  const file = path.join(root, relative);
  if ((await fs.realpath(file)).toLowerCase() !== file.toLowerCase() || !(await fs.lstat(file)).isFile()) throw fail('An included-model file is missing or is a link.');
  return file;
}

export class BundledRunner {
  constructor(root, { startTimeoutMs = 180000, spawnProcess = spawn, allocatePort = freePort, platform = process.platform, architecture = process.arch } = {}) {
    this.root = path.resolve(root); this.startTimeoutMs = startTimeoutMs; this.spawnProcess = spawnProcess; this.allocatePort = allocatePort;
    this.platform = platform; this.architecture = architecture; this.child = null; this.port = null; this.token = null;
    this.loading = null; this.loadAbort = null; this.requests = 0; this.closed = false; this.preference = 'auto'; this.verified = false;
    this.state = { available: false, phase: 'unavailable', message: 'The included Qwen files are not installed.', backend: null };
  }
  async open() {
    const file = path.join(this.root, 'manifest.json');
    const stat = await fs.stat(file).catch(e => e.code === 'ENOENT' ? null : Promise.reject(e));
    if (!stat) return this;
    if (stat.size > 1024 * 1024) throw fail('The included-model manifest is too large.');
    const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
    if (manifest.profile !== 'branchline.bundled-qwen/1' || !Array.isArray(manifest.files) || manifest.files.length > 160) throw fail('The included-model manifest is invalid.');
    const seen = new Set();
    for (const row of manifest.files) {
      if (seen.has(row.path) || !/^[a-f0-9]{64}$/.test(row.sha256) || !Number.isSafeInteger(row.bytes) || row.bytes <= 0) throw fail('The included-model file record is invalid.');
      seen.add(row.path);
      const allowed = Object.hasOwn(expected, row.path) || /^(cpu|vulkan)\/(?:[a-zA-Z0-9._-]+\.dll|llama-server\.exe)$/.test(row.path);
      if (!allowed || (expected[row.path] && expected[row.path] !== row.sha256)) throw fail('The included-model manifest does not match the reviewed model.');
    }
    for (const file of [...Object.keys(expected), 'cpu/llama-server.exe', 'vulkan/llama-server.exe']) if (!seen.has(file)) throw fail('The included-model manifest is incomplete.');
    this.manifest = manifest;
    this.state = { available: true, phase: 'idle', message: 'Ready to load when you send a message. Replies stay on this device.', backend: null };
    return this;
  }
  status() { return { ...this.state, preference: this.preference, busy: this.requests > 0 || !!this.loading, contextTokens: BUNDLED_CONTEXT }; }
  update(phase, message, onStatus, extra = {}) { this.state = { ...this.state, phase, message, ...extra }; onStatus?.(this.status()); }
  async verify(signal, onStatus) {
    if (this.verified) return;
    const prior = this.state;
    try {
    for (let i = 0; i < this.manifest.files.length; i++) {
      signal.throwIfAborted(); const row = this.manifest.files[i];
      this.update('checking', `Checking included model files (${i + 1}/${this.manifest.files.length})…`, onStatus);
      const file = await regular(this.root, row.path);
      if ((await fs.stat(file)).size !== row.bytes || await hashFile(file, signal) !== row.sha256) throw fail('An included-model file is damaged. Run Setup again to repair it.');
    }
    this.verified = true;
    } finally {
      // Rechecking disk bytes must not hide a live owned runner and cause ensure()
      // to launch a second process. A failed check still rejects the caller.
      if (prior.phase === 'ready' && this.child?.exitCode === null) this.state = prior;
    }
  }
  async imageCapability(model) {
    assertBundledProfile(model);
    if (!this.state.available) throw fail('The included vision model is not installed.');
    const row = this.manifest.files.find(f => f.path === projectorFile);
    const file = await regular(this.root, projectorFile);
    if ((await fs.stat(file)).size !== row.bytes) throw fail('The included vision file is incomplete.');
    return { profile: 'branchline.direct-image-input/1', route: 'bundled-chat-image-data-url', source: 'pinned_model_and_qualified_runtime',
      loadedTokens: BUNDLED_CONTEXT, imageTokensEach: BUNDLED_IMAGE_TOKENS,
      budgetBasis: 'enforced_image_max_tokens_plus_separate_text_margin', destination: 'Included Qwen on this device', remote: false };
  }
  async ensure(signal, onStatus) {
    signal?.throwIfAborted();
    if (this.closed) throw fail('The local runner is closing.');
    if (!this.state.available) throw fail('The included Qwen files are not installed. Run the full Setup to add them.');
    if (this.state.phase === 'ready' && this.child?.exitCode === null) return;
    if (this.loading) { await this.loading; signal?.throwIfAborted(); return; }
    this.loadAbort = new AbortController();
    const abort = () => this.loadAbort?.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const combined = AbortSignal.any([this.loadAbort.signal, AbortSignal.timeout(this.startTimeoutMs)]);
    this.loading = this.load(combined, onStatus).catch(async error => {
      await this.stopChild();
      this.update(signal?.aborted ? 'idle' : 'error', signal?.aborted ? 'Loading stopped. Send again when ready.' : error.name === 'TimeoutError' ? 'Loading took too long. Try CPU mode or close other large apps.' : error.message, onStatus);
      throw error;
    }).finally(() => { signal?.removeEventListener('abort', abort); this.loading = null; this.loadAbort = null; });
    await this.loading;
  }
  async load(signal, onStatus) {
    if (this.platform !== 'win32' || this.architecture !== 'x64') throw fail('This included runtime supports Windows x64.');
    if (os.freemem() < 4 * 1024 ** 3) throw fail('Qwen needs more free memory. Close another large app and try again.');
    await this.verify(signal, onStatus);
    const backends = this.preference === 'cpu' ? ['cpu'] : ['vulkan', 'cpu'];
    for (const backend of backends) {
      signal.throwIfAborted();
      try {
        this.update('loading', backend === 'vulkan' ? 'Loading Qwen with graphics acceleration…' : 'Loading Qwen on the CPU…', onStatus, { backend });
        const exe = await regular(this.root, `${backend}/llama-server.exe`);
        this.port = await this.allocatePort(); this.token = crypto.randomBytes(32).toString('hex');
        const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(LLAMA_|GGML_|HF_|CUDA_|VK_|NODE_OPTIONS$)/i.test(key)));
        env.LLAMA_API_KEY = this.token;
        const args = ['-m', path.join(this.root, modelFile), '--mmproj', path.join(this.root, projectorFile), '--alias', BUNDLED_PROFILE.model,
          '--host', '127.0.0.1', '--port', String(this.port), '--ctx-size', String(BUNDLED_CONTEXT), '--parallel', '1',
          '--threads', String(Math.max(1, Math.min(6, Math.floor(os.availableParallelism() / 2)))), '--image-max-tokens', String(BUNDLED_IMAGE_TOKENS),
          '--offline', '--no-webui', '--no-mmproj-auto', '--gpu-layers', backend === 'cpu' ? '0' : 'auto'];
        if (backend === 'cpu') args.push('--no-mmproj-offload');
        const child = this.spawnProcess(exe, args, { cwd: path.dirname(exe), env, windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
        this.child = child; let failed = null, listening = false, diagnosticTail = '';
        child.on('error', () => { failed = fail('The local runtime could not start. Run Setup to repair its prerequisites.'); });
        // Do not send our session key to a pre-existing service on a raced port.
        // Wait for this exact owned process to report its successful bind.
        child.stderr?.on('data', chunk => {
          diagnosticTail = (diagnosticTail + chunk.toString()).slice(-4096);
          if (diagnosticTail.includes(`listening on http://127.0.0.1:${this.port}`)) listening = true;
        });
        child.once('exit', () => {
          if (this.child === child && this.state.phase === 'ready') this.update('error', 'Qwen stopped unexpectedly. Send again to restart it, or try CPU mode.');
        });
        for (;;) {
          signal.throwIfAborted();
          if (failed) throw failed;
          if (child.exitCode !== null || child.signalCode) throw fail('The local runtime could not load Qwen with this backend.');
          if (!listening) { await delay(250, undefined, { signal }); continue; }
          try {
            const response = await fetch(`http://127.0.0.1:${this.port}/v1/models`, { headers: { authorization: `Bearer ${this.token}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]), redirect: 'error' });
            if (response.ok) {
              const body = await response.text();
              if (body.length > 16384 || !JSON.parse(body).data?.some(m => m.id === BUNDLED_PROFILE.model)) throw fail('The local model endpoint did not match this session.');
              this.update('ready', `Qwen is ready · ${backend === 'cpu' ? 'CPU' : 'graphics acceleration'}.`, onStatus); return;
            }
            await response.body?.cancel();
            if (response.status === 401) throw fail('The selected local port is occupied. Try again.');
          } catch (error) { if (error.message?.includes('Open Settings')) throw error; signal.throwIfAborted(); }
          await delay(250, undefined, { signal });
        }
      } catch (error) {
        await this.stopChild(); signal.throwIfAborted();
        if (backend === backends.at(-1)) throw error;
        this.update('loading', 'Graphics acceleration is unavailable. Trying the included CPU runtime…', onStatus);
      }
    }
  }
  async fetch(model, url, options, onStatus) {
    assertBundledProfile(model);
    const route = new URL(url);
    if (route.origin !== new URL(BUNDLED_PROFILE.baseUrl).origin || route.pathname !== '/v1/chat/completions' || route.search || route.hash || options.method !== 'POST') throw fail('Unsupported included-model request.');
    await this.ensure(options.signal, onStatus);
    this.requests++;
    let released = false;
    const release = () => { if (!released) { released = true; this.requests--; } };
    try {
      const response = await fetch(`http://127.0.0.1:${this.port}${route.pathname}`, { ...options, redirect: 'error', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` } });
      if (!response.body) { release(); return response; }
      const reader = response.body.getReader();
      return new Response(new ReadableStream({
        async pull(controller) { try { const item = await reader.read(); if (item.done) { release(); controller.close(); } else controller.enqueue(item.value); } catch (e) { release(); controller.error(e); } },
        async cancel(reason) { release(); await reader.cancel(reason); },
      }), { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) { release(); throw error; }
  }
  async beforeOtherLocal() {
    if (this.requests || this.loading) throw fail('The included Qwen is busy. Stop its reply before starting another local model.');
    await this.unload();
  }
  async stopChild() {
    const child = this.child; this.child = null; this.port = null; this.token = null;
    if (child && child.exitCode === null && !child.signalCode) {
      const exited = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
      child.kill(); await Promise.race([exited, delay(5000)]);
      if (child.exitCode === null && !child.signalCode) { child.kill('SIGKILL'); await Promise.race([exited, delay(2000)]); }
    }
  }
  async unload() {
    if (this.requests) throw fail('Stop the current Qwen reply before unloading it.');
    this.loadAbort?.abort(); await this.loading?.catch(() => {}); await this.stopChild();
    if (this.state.available) this.update('idle', 'Qwen is unloaded. It will load when you send a message.', null, { backend: null });
  }
  async setPreference(preference) {
    if (!['auto', 'cpu'].includes(preference)) throw new Error('Choose automatic or CPU mode.');
    await this.unload(); this.preference = preference; return this.status();
  }
  async close() { this.closed = true; this.loadAbort?.abort(); await this.loading?.catch(() => {}); await this.stopChild(); }
}
