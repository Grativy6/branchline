import crypto from 'node:crypto';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  if (!(value === null || ['string', 'boolean', 'number'].includes(typeof value))) throw new Error('PPP handoff: non-JSON payload');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('PPP handoff: non-finite number');
  return JSON.stringify(value);
}
// Keep the original 0.1 canonicalization so historical receipt hashes are stable.
export const digest = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
