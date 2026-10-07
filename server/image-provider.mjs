import crypto from 'node:crypto';
import { digest } from './integrity.mjs';

export const IMAGE_CONNECTION_PROFILE = 'branchline.image-connection/1';
export const INVOKE_PROVIDER = 'invokeai.local/1';
const fail = (ok, message) => { if (!ok) throw new Error('Image tools: ' + message); };
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);

// One local Invoke connection. No credentials, path, query, arbitrary hostname,
// remote fallback, or executable workflow can be carried in this setup record.
export function invokeOrigin(value) {
  fail(typeof value === 'string' && value.length <= 200 && /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::[1-9][0-9]{0,4})?\/?$/i.test(value.trim()), 'use a local address such as http://127.0.0.1:9090, without a path or sign-in details.');
  let url; try { url = new URL(value.trim()); } catch { throw new Error('Image tools: use a valid local port.'); }
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url.origin;
}
export const imageConnection = state => state.imageConnection?.revisions.at(-1) ?? null;

export function validateImageConnection(state) {
  const value = state.imageConnection;
  if (value === undefined) return;
  fail(exact(value, ['profile', 'revisions']) && value.profile === IMAGE_CONNECTION_PROFILE && Array.isArray(value.revisions) && value.revisions.length > 0, 'invalid saved connection.');
  const ids = new Set();
  for (const r of value.revisions) {
    fail(exact(r, ['id', 'createdAt', 'provider', 'endpoint']) && typeof r.id === 'string' && /^image_connection_[a-f0-9-]{36}$/.test(r.id) && !ids.has(r.id), 'invalid connection revision.');
    ids.add(r.id);
    fail(r.provider === INVOKE_PROVIDER && typeof r.createdAt === 'string' && Number.isFinite(Date.parse(r.createdAt)), 'invalid connection provider or date.');
    fail(r.endpoint === null || invokeOrigin(r.endpoint) === r.endpoint, 'invalid saved local address.');
  }
}

export function applyImageConnection(state, type, input) {
  fail(['image-provider.save', 'image-provider.disconnect'].includes(type), 'unknown setup action.');
  const save = type === 'image-provider.save';
  fail(exact(input, save ? ['baseRevisionId', 'endpoint'] : ['baseRevisionId']), 'use only the connection address and current revision.');
  fail(input.baseRevisionId === (imageConnection(state)?.id ?? null), 'this connection changed. Reopen Image tools before saving.');
  const endpoint = save ? invokeOrigin(input.endpoint) : null;
  state.imageConnection ??= { profile: IMAGE_CONNECTION_PROFILE, revisions: [] };
  state.imageConnection.revisions.push({ id: 'image_connection_' + crypto.randomUUID(), createdAt: new Date().toISOString(), provider: INVOKE_PROVIDER, endpoint });
}

export function preserveImageConnection(before, after) {
  const old = before.imageConnection?.revisions ?? [];
  fail(old.every((r, i) => digest(r) === digest(after.imageConnection?.revisions[i] ?? null)), 'earlier connection revisions must stay intact.');
}

async function readJson(fetcher, url, signal, maxBytes) {
  const response = await fetcher(url, { method: 'GET', redirect: 'error', credentials: 'omit', signal, headers: { accept: 'application/json' } });
  if ([401, 403].includes(response.status)) { await response.body?.cancel(); throw new Error('Invoke needs sign-in. This first connection supports local single-user setups; authentication is not connected yet.'); }
  if (!response.ok) { await response.body?.cancel(); throw new Error('Invoke returned HTTP ' + response.status + '. Check its address and version.'); }
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) { await response.body?.cancel(); throw new Error('Invoke did not return a JSON API response.'); }
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('Invoke returned too much setup data.'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Invoke returned no setup data.');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > maxBytes) throw new Error('Invoke returned too much setup data.');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}

// Setup inspection only. These two GET routes neither load models nor enqueue
// images. Catalogue fields are untrusted observations, never tool definitions.
export async function checkInvokeConnection(endpoint, { signal, fetcher = fetch, timeoutMs = 8000 } = {}) {
  const origin = invokeOrigin(endpoint);
  const bounded = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  try {
    const version = await readJson(fetcher, origin + '/api/v1/app/version', bounded, 4096);
    fail(text(version?.version, 80), 'the service did not report an Invoke version.');
    const catalog = await readJson(fetcher, origin + '/api/v2/models/?model_type=main', bounded, 1024 * 1024);
    fail(Array.isArray(catalog?.models) && catalog.models.length <= 512, 'the model list has an unsupported shape or size.');
    const models = catalog.models.filter(m => m?.type === 'main').map(m => {
      fail(text(m.key, 160) && text(m.name, 200) && text(m.base, 80), 'a model record is incomplete.');
      return { key: m.key, name: m.name, family: m.base };
    });
    fail(new Set(models.map(m => m.key)).size === models.length, 'the model list contains duplicate identifiers.');
    return { provider: INVOKE_PROVIDER, endpoint: origin, checkedAt: new Date().toISOString(), status: 'reachable', reportedVersion: version.version,
      models, generation: 'not_connected', compute: 'not_measured', sourceRole: 'provider_setup_observation', authority: 'NONE' };
  } catch (error) {
    if (bounded.aborted) throw new Error('Image tools: the connection check stopped or timed out. No generation was requested.');
    if (error instanceof SyntaxError) throw new Error('Image tools: Invoke returned unreadable setup data.');
    if (error instanceof TypeError) throw new Error('Image tools: could not reach the local Invoke API. Start Invoke and check its address. Redirects are not followed.');
    throw error;
  }
}
