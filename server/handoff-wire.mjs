import { digest } from './integrity.mjs';
import { validateRecordedReview, validateReviewSources } from './review.mjs';

export const WIRE = 'branchline.handoff-wire/1';
export const PARALLEL_WIRE = 'branchline.handoff-wire/2';
export const HEARTH_WIRE = 'branchline.handoff-wire/3';
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const fail = (ok, message) => { if (!ok) throw new Error('Handoff packet: ' + message); };
const LIMITS = Object.freeze({ depth: 48, records: 64, nodes: 4096, expandedBytes: 4 * 1024 * 1024, packetBytes: 8 * 1024 * 1024, visits: 100000 });
const exactKeys = (value, keys) => object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

function verifyRecord(record) {
  fail(object(record) && hash(record.hash), 'invalid receipt');
  const { hash: expected, ...value } = record;
  fail(digest(value) === expected && record.authorityCreated === false, 'receipt changed or claimed authority');
  fail(record.profile === 'branchline.ppp-handoff/0.1', 'unknown source profile');
  fail(typeof record.taskId === 'string' && record.taskId.length > 0 && typeof record.id === 'string' && typeof record.kind === 'string' && object(record.scope) && Array.isArray(record.parents), 'missing receipt boundary');
  validateRecordedReview(record);
}

function verifySources(records) {
  const byHash = new Map(records.map(r => [r.hash, r]));
  const byId = new Map(records.map(r => [r.id, r]));
  for (const record of records) {
    fail(record.parents.every(id => byId.has(id)), 'required predecessor is missing');
    validateReviewSources(record, byHash);
  }
}

function verifyTaskBoundary(records, taskId, version) {
  if (version === WIRE) return fail(records.every(r=>r.taskId === taskId), 'mixed task or duplicate receipt');
  // The successor admits exactly one explicit shared-task predecessor. It does
  // not allow arbitrary neighbouring tasks or broaden the meaning of wire/1.
  const ancestors = records.filter(r=>r.taskId !== taskId), admission = ancestors[0];
  const own = records.filter(r=>r.taskId === taskId), request = own.find(r=>r.kind === 'ui.intent');
  const foundation = admission?.detail?.foundation, shared = request?.detail?.task?.parallel;
  if(version===HEARTH_WIRE) {
    const turn=own.find(r=>r.kind==='hearth.turn.admitted'),context=own.find(r=>r.kind==='context.to_model');
    fail(ancestors.length===1 && admission?.kind==='parallel.admitted' && foundation?.profile==='branchline.hearth-loop/1'
      && foundation.id===admission.taskId && digest(foundation)===admission.contentHash && shared?.profile===foundation.profile
      && shared.runId===admission.taskId && shared.admissionHash===admission.hash && request.parents.includes(admission.id)
      && turn && shared.turnAdmissionHash===turn.hash && turn.detail.runAdmissionHash===admission.hash && turn.detail.runId===admission.taskId
      && turn.detail.actor===shared.actor && ['hearth','peer-a','peer-b'].includes(shared.actor) && turn.parents.includes(admission.id)
      && digest(turn.detail)===turn.contentHash && request.parents.includes(turn.id) && context?.contentHash===turn.detail.contextHash
      && own.every(r=>digest(r.scope)===digest(admission.scope)), 'mixed task: hearth packet escaped its admitted episode');
    return;
  }
  fail(version === PARALLEL_WIRE && ancestors.length === 1 && admission.kind === 'parallel.admitted'
    && foundation?.profile === 'branchline.parallel-approaches/1' && foundation.id === admission.taskId
    && foundation.episodeIds?.includes(taskId) && digest(foundation) === admission.contentHash
    && request?.detail.task.kind === 'parallel' && shared?.runId === admission.taskId && shared.admissionHash === admission.hash
    && request.parents.includes(admission.id) && own.every(r=>digest(r.scope) === digest(admission.scope)), 'mixed task: parallel packet escaped its founded task');
}

// Wire-only, lossless structural sharing. The original journal is not migrated.
// A node is ['a', children], ['o', sorted key/token pairs], or ['v', a long string].
// A token is [0, inline JSON] or [1, SHA-256 node reference]. No summaries replace data.
export function packHandoffs(records, { known = [], taskId: requestedTaskId } = {}) {
  fail(Array.isArray(records) && records.length <= LIMITS.records, 'too many receipts');
  fail(Array.isArray(known) && known.length <= LIMITS.nodes && known.every(hash), 'invalid cache advertisement');
  fail(bytes(records) <= LIMITS.expandedBytes, 'expanded data exceeds limit');
  const taskId = requestedTaskId ?? records[0]?.taskId ?? null;
  const version = records.every(r=>r.taskId === taskId) ? WIRE : records.some(r=>r.kind==='parallel.admitted'&&r.detail.foundation?.profile==='branchline.hearth-loop/1') ? HEARTH_WIRE : PARALLEL_WIRE;
  verifyTaskBoundary(records,taskId,version);
  const advertised = new Set(known), all = new Map();
  function encode(value, depth = 0) {
    fail(depth <= LIMITS.depth, 'nesting exceeds limit');
    if (bytes(value) <= 96) return [0, value];
    let node;
    if (Array.isArray(value)) node = ['a', value.map(item => encode(item, depth + 1))];
    else if (object(value)) node = ['o', Object.keys(value).sort().map(key => [key, encode(value[key], depth + 1)])];
    else { fail(typeof value === 'string', 'invalid large scalar'); node = ['v', value]; }
    const key = digest(node); all.set(key, node);
    fail(all.size <= LIMITS.nodes, 'node count exceeds limit');
    return [1, key];
  }
  const seen = new Set();
  const headers = records.map(record => {
    verifyRecord(record);
    fail(!seen.has(record.id), 'mixed task or duplicate receipt'); seen.add(record.id);
    return { h: record.hash, k: record.kind, s: record.status, m: record.detail?.review ?? null, b: encode(record) };
  });
  verifySources(records);
  const nodes = Object.fromEntries([...all].filter(([key]) => !advertised.has(key)));
  const packet = { v: version, task: taskId, r: headers, n: nodes };
  fail(bytes(packet) <= LIMITS.packetBytes, 'packet exceeds limit');
  return packet;
}

export function unpackHandoffs(packet, { cache = new Map() } = {}) {
  fail(exactKeys(packet, ['v', 'task', 'r', 'n']) && [WIRE,PARALLEL_WIRE,HEARTH_WIRE].includes(packet.v), 'unknown schema or version');
  fail(Array.isArray(packet.r) && packet.r.length <= LIMITS.records && object(packet.n), 'invalid packet shape');
  fail(packet.task === null || typeof packet.task === 'string', 'invalid task');
  fail(bytes(packet) <= LIMITS.packetBytes && Object.keys(packet.n).length <= LIMITS.nodes, 'packet exceeds limit');
  fail(cache instanceof Map, 'invalid receiver cache');
  const staged = new Map(), memo = new Map(), visiting = new Set();
  for (const [key, node] of Object.entries(packet.n)) { fail(hash(key) && digest(node) === key, 'node hash differs'); staged.set(key, node); }
  let visits = 0;
  function decode(token, depth = 0) {
    fail(++visits <= LIMITS.visits && depth <= LIMITS.depth, 'expansion exceeds limit');
    fail(Array.isArray(token) && token.length === 2, 'invalid token');
    if (token[0] === 0) { fail(bytes(token[1]) <= 96, 'inline value exceeds limit'); return { value: structuredClone(token[1]), size: bytes(token[1]) }; }
    fail(token[0] === 1 && hash(token[1]), 'invalid reference');
    const key = token[1];
    if (memo.has(key)) return memo.get(key);
    fail(!visiting.has(key), 'cyclic reference');
    const node = staged.get(key) ?? cache.get(key);
    fail(node !== undefined, 'required context is missing: ' + key);
    fail(digest(node) === key && Array.isArray(node) && node.length === 2, 'cached or transmitted node changed');
    visiting.add(key);
    let value, size = 2;
    if (node[0] === 'v') { fail(typeof node[1] === 'string', 'invalid text node'); value = node[1]; size = bytes(value); }
    else if (node[0] === 'a') {
      fail(Array.isArray(node[1]) && node[1].length <= LIMITS.visits, 'invalid array node');
      value = [];
      for (const child of node[1]) { const decoded = decode(child, depth + 1); size += decoded.size + 1; fail(size <= LIMITS.expandedBytes, 'expanded data exceeds limit'); value.push(decoded.value); }
    } else {
      fail(node[0] === 'o' && Array.isArray(node[1]) && node[1].length <= LIMITS.nodes, 'unknown node type');
      value = Object.create(null); let previous = null;
      for (const pair of node[1]) {
        fail(Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && (previous === null || pair[0] > previous), 'duplicate or unordered object key');
        previous = pair[0]; const decoded = decode(pair[1], depth + 1);
        size += bytes(pair[0]) + decoded.size + 2; fail(size <= LIMITS.expandedBytes, 'expanded data exceeds limit'); value[pair[0]] = decoded.value;
      }
    }
    fail(size <= LIMITS.expandedBytes, 'expanded data exceeds limit');
    visiting.delete(key); const decoded = { value, size }; memo.set(key, decoded); return decoded;
  }
  let total = 0; const ids = new Set();
  const records = packet.r.map(header => {
    fail(exactKeys(header, ['h', 'k', 's', 'm', 'b']), 'unknown or missing header field');
    const decoded = decode(header.b); total += decoded.size; fail(total <= LIMITS.expandedBytes, 'expanded receipt set exceeds limit');
    const record = decoded.value; verifyRecord(record);
    fail(record.hash === header.h && record.kind === header.k && record.status === header.s && digest(record.detail?.review ?? null) === digest(header.m), 'compact header differs from its receipt');
    fail(!ids.has(record.id), 'duplicate receipt'); ids.add(record.id);
    return structuredClone(record);
  });
  verifyTaskBoundary(records,packet.task,packet.v);
  verifySources(records);
  // Do not admit an incomplete packet to the cache. No method here issues a grant.
  for (const [key, node] of staged) if (memo.has(key)) cache.set(key, structuredClone(node));
  return records;
}

export const packetBytes = bytes;
