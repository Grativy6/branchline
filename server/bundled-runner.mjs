import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { BUNDLED_PROFILE, BUNDLED_CONTEXT, BUNDLED_IMAGE_TOKENS, assertBundledProfile, isBundledContext } from './bundled-profile.mjs';

const modelFile = 'Qwen3.5-4B-Q4_K_M.gguf', projectorFile = 'mmproj-Qwen3.5-4B-BF16.gguf';
const expected = { [modelFile]: '25082a7dd3776cc3c741c6347d3bd04523f05796607b3fbc32fa3a25dfa1418c',
  [projectorFile]: 'ae08d9d7eceb8f2d0672d61b5e6aa78b611f2942b55ed71d21414980cc454b91' };
const fail = message => new Error(message + ' Open Settings → Models for recovery.');
const execFileAsync = promisify(execFile);
export function parseRuntimeVersion(text) {
  const match = /version:\s+(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)\s+\(build\s+(\d+),\s+commit\s+([a-f0-9]{7,40})\)/i.exec(text);
  if (!match) throw fail('The local engine could not identify its version.');
  return {version: match[1], build: Number(match[2]), commit: match[3].toLowerCase()};
}
async function runtimeVersion(exe, {env, signal}) {
  const result = await execFileAsync(exe, ['--version'], {cwd: path.dirname(exe), env, signal, windowsHide: true, shell: false, maxBuffer: 65536});
  return parseRuntimeVersion(result.stdout + result.stderr);
}

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
  constructor(root, { startTimeoutMs = 180000, spawnProcess = spawn, readVersion = runtimeVersion, allocatePort = freePort, platform = process.platform, architecture = process.arch, contextTokens = BUNDLED_CONTEXT, validateContext = isBundledContext } = {}) {
    if (!validateContext(contextTokens)) throw new Error('Choose a supported local-model window.');
    this.readVersion = readVersion; this.versionChecks = new Map();
    this.root = path.resolve(root); this.startTimeoutMs = startTimeoutMs; this.spawnProcess = spawnProcess; this.allocatePort = allocatePort;
    this.label = 'Qwen'; this.alias = BUNDLED_PROFILE.model; this.modelPath = path.join(this.root, modelFile); this.projectorPath = path.join(this.root, projectorFile); this.extraArgs = [];
    this.contextTokens = contextTokens; this.loadedContextTokens = null; this.changing = false;
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
    if (!/^b\d+$/.test(manifest.runtimeTag ?? '') || !/^[a-f0-9]{40}$/.test(manifest.runtimeCommit ?? '') || !/^\d+\.\d+\.\d+$/.test(manifest.runtimeVersion ?? '')) throw fail('The local engine version record needs repair.');
    this.manifest = manifest;
    this.state = { available: true, phase: 'idle', message: 'Ready to load when you send a message. Replies stay on this device.', backend: null };
    return this;
  }
  status() { return { ...this.state, preference: this.preference, busy: this.requests > 0 || !!this.loading || this.changing,
    engine: this.manifest ? {name: 'llama.cpp', version: this.manifest.runtimeVersion, tag: this.manifest.runtimeTag, commit: this.manifest.runtimeCommit, reported: this.versionChecks.get(this.state.backend) ?? null} : null,
    changing: this.changing, contextTokens: this.contextTokens, loadedContextTokens: this.loadedContextTokens }; }
  restoreContext(contextTokens) {
    if (!isBundledContext(contextTokens) || this.child || this.loading || this.requests || this.changing) throw new Error('The included-model window cannot be restored.');
    this.contextTokens = contextTokens;
  }
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
  assertModel(model) { assertBundledProfile(model); }
  launchArguments(backend) {
    const args = ['-m', this.modelPath, '--alias', this.alias, '--host', '127.0.0.1', '--port', String(this.port),
      '--ctx-size', String(this.contextTokens), '--parallel', '1', '--threads', String(Math.max(1, Math.min(6, Math.floor(os.availableParallelism() / 2)))),
      '--offline', '--no-webui', '--no-mmproj-auto', '--no-context-shift', '--gpu-layers', backend === 'cpu' ? '0' : 'auto', ...this.extraArgs];
    if (this.projectorPath) { args.push('--mmproj', this.projectorPath, '--image-max-tokens', String(BUNDLED_IMAGE_TOKENS)); if (backend === 'cpu') args.push('--no-mmproj-offload'); }
    return args;
  }
  async imageCapability(model) {
    assertBundledProfile(model);
    if (!this.state.available) throw fail('The included vision model is not installed.');
    const row = this.manifest.files.find(f => f.path === projectorFile);
    const file = await regular(this.root, projectorFile);
    if ((await fs.stat(file)).size !== row.bytes) throw fail('The included vision file is incomplete.');
    return { profile: 'branchline.direct-image-input/1', route: 'bundled-chat-image-data-url', source: 'pinned_model_and_qualified_runtime',
      loadedTokens: this.loadedContextTokens ?? this.contextTokens, contextVerified: this.loadedContextTokens !== null, imageTokensEach: BUNDLED_IMAGE_TOKENS,
      budgetBasis: 'enforced_image_max_tokens_plus_separate_text_margin', destination: 'Included Qwen on this device', remote: false };
  }
  async ensure(signal, onStatus) {
    signal?.throwIfAborted();
    if (this.changing) throw fail('The included Qwen window is changing. Try again shortly.');
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
  async checkVersion(exe, backend, env, signal) {
    if (this.versionChecks.has(backend)) return this.versionChecks.get(backend);
    const actual = await this.readVersion(exe, {env, signal});
    const expected = this.manifest;
    // Upstream's tagged v1 archive reports 1.0.0-dev; its exact build and commit identify the release.
    if (actual.version.replace(/-dev$/, '') !== expected.runtimeVersion || actual.build !== Number(expected.runtimeTag.slice(1)) || !expected.runtimeCommit.startsWith(actual.commit)) {
      throw fail(`Local engine mismatch: expected ${expected.runtimeVersion} / ${expected.runtimeTag}, received ${actual.version} / b${actual.build} (${actual.commit}).`);
    }
    this.versionChecks.set(backend, actual);
    return actual;
  }
  async load(signal, onStatus) {
    if (this.platform !== 'win32' || this.architecture !== 'x64') throw fail('This included runtime supports Windows x64.');
    if (os.freemem() < 4 * 1024 ** 3) throw fail(`${this.label} needs more free memory. Close another large app and try again.`);
    await this.verify(signal, onStatus);
    const requestedContext = this.contextTokens;
    const backends = this.preference === 'cpu' ? ['cpu'] : ['vulkan', 'cpu'];
    for (const backend of backends) {
      signal.throwIfAborted();
      try {
        this.update('loading', backend === 'vulkan' ? `Loading ${this.label} with graphics acceleration…` : `Loading ${this.label} on the CPU…`, onStatus, { backend });
        const exe = await regular(this.root, `${backend}/llama-server.exe`);
        this.port = await this.allocatePort(); this.token = crypto.randomBytes(32).toString('hex');
        const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(LLAMA_|GGML_|HF_|CUDA_|VK_|NODE_OPTIONS$)/i.test(key)));
        await this.checkVersion(exe, backend, env, signal);
        env.LLAMA_API_KEY = this.token;
        const args = this.launchArguments(backend);
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
          if (this.child === child && this.state.phase === 'ready') { this.loadedContextTokens = null; this.update('error', `${this.label} stopped unexpectedly. Send again to restart it, or try CPU mode.`); }
        });
        for (;;) {
          signal.throwIfAborted();
          if (failed) throw failed;
          if (child.exitCode !== null || child.signalCode) throw fail(`The local runtime could not load ${this.label} with this backend. ${diagnosticTail.split(/\r?\n/).filter(line => /error|failed|unsupported|unknown/i.test(line)).slice(-2).join(' ').slice(-600)}`);
          if (!listening) { await delay(250, undefined, { signal }); continue; }
          try {
            const response = await fetch(`http://127.0.0.1:${this.port}/v1/models`, { headers: { authorization: `Bearer ${this.token}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]), redirect: 'error' });
            if (response.ok) {
              const body = await response.text();
              if (body.length > 16384 || !JSON.parse(body).data?.some(m => m.id === this.alias)) throw fail('The local model endpoint did not match this session.');
              const propsResponse = await fetch(`http://127.0.0.1:${this.port}/props`, { headers: { authorization: `Bearer ${this.token}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]), redirect: 'error' });
              if (!propsResponse.ok) { await propsResponse.body?.cancel(); throw fail('The local runtime could not report its loaded context.'); }
              const propsText = await propsResponse.text();
              if (propsText.length > 65536) throw fail('The local runtime context report was too large.');
              let actual;
              try { actual = JSON.parse(propsText).default_generation_settings?.n_ctx; }
              catch { throw fail('The local runtime context report was unreadable.'); }
              if (!Number.isSafeInteger(actual) || actual !== requestedContext) throw fail(`${this.label} did not load the requested ${requestedContext.toLocaleString()}-token window. Choose a smaller window and try again.`);
              this.loadedContextTokens = actual;
              this.update('ready', `${this.label} is ready · ${backend === 'cpu' ? 'CPU' : 'graphics acceleration'}.`, onStatus); return;
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
    this.assertModel(model);
    if (this.changing) throw fail('The included Qwen window is changing. Try again shortly.');
    const route = new URL(url);
    if (route.origin !== new URL(BUNDLED_PROFILE.baseUrl).origin || !['/v1/chat/completions', ...(model.runtime === 'gguf' ? ['/v1/completions'] : [])].includes(route.pathname) || route.search || route.hash || options.method !== 'POST') throw fail('Unsupported local-model request.');
    await this.ensure(options.signal, onStatus);
    if (this.changing) throw fail('The included Qwen window is changing. Try again shortly.');
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
    if (this.requests || this.loading || this.changing) throw fail('The included Qwen is busy. Stop its reply before starting another local model.');
    await this.unload();
  }
  async stopChild() {
    const child = this.child; this.child = null; this.port = null; this.token = null; this.loadedContextTokens = null;
    if (child && child.exitCode === null && !child.signalCode) {
      const exited = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
      child.kill(); await Promise.race([exited, delay(5000)]);
      if (child.exitCode === null && !child.signalCode) { child.kill('SIGKILL'); await Promise.race([exited, delay(2000)]); }
    }
  }
  async unload() {
    if (this.changing) throw fail('The included Qwen window is changing. Try again shortly.');
    if (this.requests) throw fail('Stop the current Qwen reply before unloading it.');
    this.loadAbort?.abort(); await this.loading?.catch(() => {}); await this.stopChild();
    if (this.state.available) this.update('idle', `${this.label} is unloaded. It will load when you send a message.`, null, { backend: null });
  }
  async setPreference(preference) {
    if (!['auto', 'cpu'].includes(preference)) throw new Error('Choose automatic or CPU mode.');
    if (this.changing) throw fail('The included Qwen window is changing. Try again shortly.');
    await this.unload(); this.preference = preference; return this.status();
  }
  async setContextTokens(contextTokens, expectedTokens, persist) {
    if (!isBundledContext(contextTokens) || !isBundledContext(expectedTokens)) throw new Error('Choose a supported included-model window.');
    if (expectedTokens !== this.contextTokens) throw new Error('The included-model window changed. Reopen Context and try again.');
    if (this.closed) throw fail('The local runner is closing.');
    if (this.requests || this.loading || this.changing) throw fail('The included Qwen is busy. Finish its work before changing the window.');
    if (contextTokens === this.contextTokens) return this.status();
    this.changing = true;
    try {
      await this.stopChild();
      if (this.state.available) this.update('idle', 'Qwen is unloaded. The previous window remains selected until the change is saved.', null, { backend: null });
      await persist();
      this.contextTokens = contextTokens;
      if (this.state.available) this.update('idle', `Qwen will load with the selected ${contextTokens.toLocaleString()}-token window when needed.`, null, { backend: null });
    } finally { this.changing = false; }
    return this.status();
  }
  async close() { this.closed = true; this.loadAbort?.abort(); await this.loading?.catch(() => {}); await this.stopChild(); }
}
