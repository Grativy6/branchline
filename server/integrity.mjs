import crypto from 'node:crypto';
import {isImmutable} from './immutable-json.mjs';
const canonicalCache=new WeakMap(),digestCache=new WeakMap();

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function canonical(value) {
  if(isImmutable(value)&&canonicalCache.has(value))return canonicalCache.get(value);
  const result=canonicalUncached(value);if(isImmutable(value))canonicalCache.set(value,result);return result;
}
function canonicalUncached(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  if (!(value === null || ['string', 'boolean', 'number'].includes(typeof value))) throw new Error('PPP handoff: non-JSON payload');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('PPP handoff: non-finite number');
  return JSON.stringify(value);
}
// Keep the original 0.1 canonicalization so historical receipt hashes are stable.
export const digest = value => {if(isImmutable(value)&&digestCache.has(value))return digestCache.get(value);const hash=crypto.createHash('sha256').update(canonical(value)).digest('hex');if(isImmutable(value))digestCache.set(value,hash);return hash;};
