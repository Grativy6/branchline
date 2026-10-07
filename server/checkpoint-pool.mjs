// Lossless encoding of a derived save point. Repeated text shares storage, but
// every occurrence, ordering, role and record still reconstructs independently.
export const EXPANDED_CHECKPOINT_LIMIT = 128 * 1024 * 1024;
const NODE_LIMIT = 2_000_000, DEPTH_LIMIT = 128;
const fail = reason => { throw Object.assign(new Error(reason), { code: reason }); };
const size = value => Buffer.byteLength(JSON.stringify(value));
function budget() {
  let bytes = 0, nodes = 0;
  return {
    visit(depth) { if (++nodes > NODE_LIMIT || depth > DEPTH_LIMIT) fail('checkpoint-complexity'); },
    add(n) { bytes += n; if (bytes > EXPANDED_CHECKPOINT_LIMIT) fail('checkpoint-expanded-size'); },
    get bytes() { return bytes; },
  };
}

export function poolCheckpoint(value) {
  const strings = [], ids = new Map(), lengths = [], bound = budget();
  function walk(item, depth = 0) {
    bound.visit(depth);
    if (typeof item === 'string' && item.length >= 128) {
      let id = ids.get(item);
      if (id === undefined) { id = strings.length; ids.set(item, id); strings.push(item); lengths.push(size(item)); }
      bound.add(lengths[id]); return ['s', id];
    }
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) {
      bound.add(size(item)); return item;
    }
    if (Array.isArray(item)) {
      bound.add(2 + Math.max(0, item.length - 1)); return ['a', item.map(v => walk(v, depth + 1))];
    }
    if (!item || typeof item !== 'object') fail('checkpoint-value');
    const keys = Object.keys(item);
    bound.add(2 + Math.max(0, keys.length - 1));
    return ['o', keys.map(key => { bound.add(size(key) + 1); return [key, walk(item[key], depth + 1)]; })];
  }
  const root = walk(value);
  return { expandedBytes: bound.bytes, strings, root };
}

export function unpoolCheckpoint(pooled) {
  if (!pooled || !Number.isSafeInteger(pooled.expandedBytes) || pooled.expandedBytes < 1
    || pooled.expandedBytes > EXPANDED_CHECKPOINT_LIMIT || !Array.isArray(pooled.strings)
    || pooled.strings.length > NODE_LIMIT || pooled.strings.some(s => typeof s !== 'string')) fail('checkpoint-pool');
  const bound = budget(), lengths = pooled.strings.map(size);
  function walk(item, depth = 0) {
    bound.visit(depth);
    if (!Array.isArray(item)) {
      if (!(item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item))) fail('checkpoint-pool');
      bound.add(size(item)); return item;
    }
    if (item.length !== 2) fail('checkpoint-pool');
    const [tag, content] = item;
    if (tag === 's') {
      if (!Number.isSafeInteger(content) || content < 0 || content >= pooled.strings.length) fail('checkpoint-pool');
      bound.add(lengths[content]); return pooled.strings[content];
    }
    if (!['a', 'o'].includes(tag) || !Array.isArray(content)) fail('checkpoint-pool');
    bound.add(2 + Math.max(0, content.length - 1));
    if (tag === 'a') return content.map(v => walk(v, depth + 1));
    const object = {};
    for (const entry of content) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || Object.hasOwn(object, entry[0])) fail('checkpoint-pool');
      bound.add(size(entry[0]) + 1);
      Object.defineProperty(object, entry[0], { value: walk(entry[1], depth + 1), enumerable: true, writable: true, configurable: true });
    }
    return object;
  }
  const value = walk(pooled.root);
  if (bound.bytes !== pooled.expandedBytes) fail('checkpoint-expanded-size');
  return value;
}
