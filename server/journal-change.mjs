import { digest } from './integrity.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const unsafe = key => ['__proto__', 'constructor', 'prototype'].includes(key);
const fail = message => { throw new Error('Journal change: ' + message); };

// A local storage encoding, never a command or a grant. Existing snapshots stay
// byte-for-byte intact. Every later change binds its complete before/after state.
export function journalChange(before, after, sequence, at = new Date().toISOString()) {
  const changes = [];
  function diff(a, b, path) {
    // State is validated finite JSON. Walk once instead of reserializing every
    // ancestor of a changed leaf; retain the same version-1 operations/hashes.
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b) && b.length >= a.length) {
      let same = a.length === b.length;
      for (let i = 0; i < a.length; i++) if (!diff(a[i], b[i], [...path, i])) same = false;
      if (b.length > a.length) changes.push({ op: 'append', path, length: a.length, values: b.slice(a.length) });
      return same;
    } else if (object(a) && object(b)) {
      const beforeKeys = Object.keys(a), afterKeys = Object.keys(b);
      let same = beforeKeys.length === afterKeys.length && beforeKeys.every((key, i) => key === afterKeys[i]);
      for (const key of beforeKeys) {
        if (!Object.hasOwn(b, key)) changes.push({ op: 'remove', path: [...path, key] });
      }
      for (const key of afterKeys) {
        if (Object.hasOwn(a, key)) { if (!diff(a[key], b[key], [...path, key])) same = false; }
        else { changes.push({ op: 'set', path: [...path, key], value: b[key] }); same = false; }
      }
      // Preserve the old distinction: an unchanged quoted object may contain
      // these names, but a diff must not turn them into writable paths.
      if (!same && afterKeys.some(unsafe)) fail('unsafe property.');
      return same;
    } else changes.push({ op: 'set', path, value: b });
    return false;
  }
  diff(before, after, []);
  return { type: 'change', version: 1, sequence, at, beforeHash: digest(before), afterHash: digest(after), changes };
}

export function applyJournalChange(before, event) {
  if (event.version !== 1 || !Array.isArray(event.changes) || event.beforeHash !== digest(before)) fail('base state does not match.');
  let state = structuredClone(before);
  for (const change of event.changes) {
    if (!change || !['set', 'remove', 'append'].includes(change.op) || !Array.isArray(change.path)
        || change.path.some(key => !(typeof key === 'string' || Number.isSafeInteger(key) && key >= 0) || unsafe(key))) fail('invalid operation.');
    let parent = null, key = null, current = state;
    for (let i = 0; i < change.path.length; i++) {
      key = change.path[i]; parent = current;
      if (!Array.isArray(parent) && !object(parent)) fail('path has no container.');
      if (Array.isArray(parent) && (!Number.isSafeInteger(key) || key < 0 || key >= parent.length)) fail('invalid array position.');
      if (!Object.hasOwn(parent, key) && !(i === change.path.length - 1 && change.op === 'set' && object(parent))) fail('path does not exist.');
      current = parent[key];
    }
    if (change.op === 'append') {
      if (!Array.isArray(current) || current.length !== change.length || !Array.isArray(change.values)) fail('array boundary changed.');
      for (const value of change.values) current.push(structuredClone(value));
    } else if (change.op === 'remove') {
      if (!object(parent) || !Object.hasOwn(parent, key)) fail('invalid removal.');
      delete parent[key];
    } else {
      if (!Object.hasOwn(change, 'value')) fail('missing value.');
      const value = structuredClone(change.value);
      if (parent === null) state = value;
      else Object.defineProperty(parent, key, { value, writable: true, enumerable: true, configurable: true });
    }
  }
  if (event.afterHash !== digest(state)) fail('result state does not match.');
  return state;
}
