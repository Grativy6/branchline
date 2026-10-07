import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';

export function publicCodexError(error) {
  return String(error?.message || error || 'Codex connection failed.').slice(0, 2000)
    .replace(/(?:Bearer\s+|sk-)[A-Za-z0-9._-]+/gi, '[credential omitted]')
    .replace(/https?:\/\/\S+/g, '[provider link omitted]');
}

// This RPC client exposes no generic execution route to the renderer or model.
export class CodexRpc extends EventEmitter {
  constructor(binary, args, { cwd, env, spawnProcess = spawn } = {}) {
    super();
    this.pending = new Map(); this.nextId = 1; this.closed = false; this.buffer = '';
    this.child = spawnProcess(binary, args, { cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', text => this.consume(text));
    // Provider stderr can contain account information or input. Never return or log it.
    this.child.stderr.resume();
    this.child.stdin.on('error', () => this.fail(new Error('The Codex connection closed.')));
    this.child.once('error', () => this.fail(new Error('Could not start the verified Codex runtime.')));
    this.child.once('exit', () => this.fail(new Error('The Codex connection ended. Reconnect in model settings.')));
  }
  consume(text) {
    if (this.closed) return;
    this.buffer += text;
    if (this.buffer.length > 8 * 1024 * 1024) return this.fail(new Error('Codex returned an oversized protocol message.'));
    let split;
    while ((split = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, split).trim(); this.buffer = this.buffer.slice(split + 1);
      if (!line) continue;
      let value;
      try { value = JSON.parse(line); } catch { return this.fail(new Error('Codex returned an unreadable protocol message.')); }
      if (value.method && value.id !== undefined) {
        if (value.method === 'item/tool/call' && this.toolHandler) {
          const handler = this.toolHandler;
          Promise.resolve().then(() => handler(value.params)).then(result => {
            if (!this.closed) this.write({ id: value.id, result });
          }).catch(() => {
            if (!this.closed) this.write({ id: value.id, error: { code: -32601, message: 'Branchline held this tool request.' } });
            this.emit('blockedRequest', { method: value.method });
          });
          continue;
        }
        // An approval or tool request cannot acquire capability through this bridge.
        this.write({ id: value.id, error: { code: -32601, message: 'Branchline conversation connection does not execute tools or grant permissions.' } });
        this.emit('blockedRequest', { method: value.method, params: value.params });
      } else if (value.method) this.emit('notification', value);
      else {
        const request = this.pending.get(value.id);
        if (!request) continue;
        this.pending.delete(value.id); clearTimeout(request.timer);
        if (value.error) request.reject(new Error(publicCodexError(value.error)));
        else request.resolve(value.result);
      }
    }
  }
  write(value) {
    if (this.closed) throw new Error('Codex is disconnected.');
    this.child.stdin.write(JSON.stringify(value) + '\n');
  }
  request(method, params = {}, timeoutMs = 20000) {
    if (this.closed) return Promise.reject(new Error('Codex is disconnected.'));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Codex did not answer in time. Reconnect and try again.')); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); } catch (error) { this.pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }
  notify(method, params = {}) { this.write({ method, params }); }
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear(); this.emit('disconnected', error);
    if (!this.child.killed) this.child.kill();
  }
  close() { this.fail(new Error('Codex connection closed.')); }
}
