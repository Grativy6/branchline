import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { poolCheckpoint, unpoolCheckpoint, EXPANDED_CHECKPOINT_LIMIT } from './checkpoint-pool.mjs';
import { validateState } from './domain.mjs';
import { digest } from './integrity.mjs';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import { journalInfo, journalChunks, hashStoredJournal } from './journal-codec.mjs';

export const CHECKPOINT_PROFILE = 'branchline.startup-checkpoint/1';
export const PACKED_CHECKPOINT_PROFILE = 'branchline.startup-checkpoint/2';
// Bump when historical replay or state validation rules change incompatibly.
export const REPLAY_RULES_VERSION = 3;
export const CHECKPOINT_LIMIT = 32 * 1024 * 1024;
export const CHECKPOINT_FILES = ['startup-checkpoint-a.json', 'startup-checkpoint-b.json'];
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const invalid = message => { throw Object.assign(new Error(message), { code: message }); };

const COMPRESSED_PROFILE = 'branchline.compressed-checkpoint/1';
const POOLED_PROFILE = 'branchline.compressed-checkpoint/2';
export function decodeCheckpoint(bytes) {
  const envelope = JSON.parse(bytes.toString('utf8'));
  if (![COMPRESSED_PROFILE, POOLED_PROFILE].includes(envelope?.profile)) return envelope;
  if (envelope.codec !== 'brotli' || !integer(envelope.bytes) || !envelope.bytes || envelope.bytes > CHECKPOINT_LIMIT
    || !hex(envelope.sha256) || typeof envelope.body !== 'string') invalid('checkpoint-compression');
  const packed = Buffer.from(envelope.body, 'base64');
  if (packed.toString('base64') !== envelope.body) invalid('checkpoint-encoding');
  const decoded = brotliDecompressSync(packed, { maxOutputLength: envelope.bytes, info: true });
  if (decoded.buffer.length !== envelope.bytes || decoded.engine.bytesWritten !== packed.length || sha(decoded.buffer) !== envelope.sha256) invalid('checkpoint-compression-integrity');
  const value = JSON.parse(decoded.buffer.toString('utf8'));
  return envelope.profile === POOLED_PROFILE ? unpoolCheckpoint(value) : value;
}

export function encodeCheckpoint(checkpoint) {
  return compressCheckpointBytes(Buffer.from(JSON.stringify(poolCheckpoint(checkpoint)) + '\n'), POOLED_PROFILE);
}

function compressCheckpointBytes(bytes, profile = COMPRESSED_PROFILE) {
  if (bytes.length > CHECKPOINT_LIMIT) invalid('checkpoint-size');
  const packed = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } });
  return Buffer.from(JSON.stringify({ profile, codec: 'brotli', bytes: bytes.length, sha256: sha(bytes), body: packed.toString('base64') }) + '\n');
}

// Existing derived files keep their exact decoded bytes and older generation.
// Called only during startup, before the checkpoint writer can begin.
export async function compressLegacyCheckpoints(dataDir) {
  for (const slot of CHECKPOINT_FILES) {
    const file = path.join(dataDir, slot);
    try {
      const before = await fs.lstat(file);
      if (!before.isFile() || before.isSymbolicLink()) continue;
      const raw = await boundedRead(file);
      if (![CHECKPOINT_PROFILE, PACKED_CHECKPOINT_PROFILE].includes(JSON.parse(raw.toString('utf8'))?.profile)) continue;
      const packed = compressCheckpointBytes(raw), temporary = file + '.tmp-' + crypto.randomUUID();
      const handle = await fs.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(packed); await handle.sync(); } finally { await handle.close(); }
      if (!(await boundedRead(temporary)).equals(packed) || !sameJournal(before, await fs.stat(file))) continue;
      if (digest(decodeCheckpoint(packed)) !== digest(JSON.parse(raw.toString('utf8')))) continue;
      await fs.rename(temporary, file);
    } catch { /* An unavailable derived-file optimization cannot block history. */ }
  }
}

export function sameJournal(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
}

async function boundedRead(file) {
  const handle = await fs.open(file, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > CHECKPOINT_LIMIT) invalid('checkpoint-size');
    const bytes = Buffer.alloc(before.size + 1);
    let read = 0;
    while (read < bytes.length) {
      const part = await handle.read(bytes, read, bytes.length - read, read);
      if (!part.bytesRead) break;
      read += part.bytesRead;
    }
    if (read !== before.size || !sameJournal(before, await handle.stat())) invalid('checkpoint-changed');
    return bytes.subarray(0, read);
  } finally { await handle.close(); }
}

function validateEnvelope(value, workspaceId, info) {
  if (!value || ![CHECKPOINT_PROFILE, PACKED_CHECKPOINT_PROFILE].includes(value.profile) || value.replayRulesVersion !== REPLAY_RULES_VERSION) invalid('checkpoint-version');
  if (value.workspaceId !== workspaceId) invalid('checkpoint-workspace');
  if (!integer(value.throughSequence) || !value.throughSequence || !integer(value.throughByte)
    || !value.throughByte || value.throughByte > info.bytes || value.throughSequence > value.throughByte) invalid('checkpoint-position');
  const b = value.boundary;
  if (!b || !integer(b.start) || !integer(b.length) || !b.length || b.length > EXPANDED_CHECKPOINT_LIMIT
    || b.start + b.length !== value.throughByte || !hex(b.sha256)) invalid('checkpoint-boundary');
  if (!hex(value.stateHash) || typeof value.createdAt !== 'string') invalid('checkpoint-digests');
  if (value.profile === CHECKPOINT_PROFILE) {
    if (!hex(value.prefixSha256)) invalid('checkpoint-digests');
  } else {
    const s = value.storage;
    if (!info.compressed || !s || s.encoding !== 'BLJBR001' || !integer(s.throughByte) || !s.throughByte
      || s.throughByte > info.storedBytes || !hex(s.prefixSha256)) invalid('checkpoint-storage');
    if (value.prefixSha256 !== null && !hex(value.prefixSha256)) invalid('checkpoint-digests');
  }
}

function readBoundary(suffix, checkpoint, frameAligned = false) {
  const { start, length, sha256 } = checkpoint.boundary;
  const bytes = suffix.subarray(suffix.length - length);
  if (bytes.length !== length) invalid('boundary-incomplete');
  if (bytes.at(-1) !== 10 || bytes.indexOf(10) !== length - 1 || sha(bytes) !== sha256) invalid('boundary-bytes');
  if (start > 0 && !frameAligned) {
    if (suffix.length <= length || suffix[suffix.length - length - 1] !== 10) invalid('boundary-start');
  }
  const event = JSON.parse(bytes.toString('utf8'));
  if (!['snapshot', 'change'].includes(event?.type) || event.sequence !== checkpoint.throughSequence || typeof event.at !== 'string') invalid('boundary-envelope');
  if (event.type === 'change' && (event.version !== 1 || !Array.isArray(event.changes) || !hex(event.beforeHash) || !hex(event.afterHash))) invalid('boundary-change');
  const recordedHash = event.type === 'snapshot' ? digest(event.state) : event.afterHash;
  if (recordedHash !== checkpoint.stateHash || digest(checkpoint.state) !== recordedHash) invalid('boundary-state');
}

// A cache is only usable with its actual journal bytes. No cache field supplies
// a path, an action, or a live grant. Full backup verification does not use this.
export async function findStartupCheckpoint(dataDir, workspaceId, file, { onProgress } = {}) {
  const candidates = [], rejections = [];
  for (const slot of CHECKPOINT_FILES) {
    try { candidates.push({ slot, value: decodeCheckpoint(await boundedRead(path.join(dataDir, slot))) }); }
    catch (error) { if (error.code !== 'ENOENT') rejections.push({ slot, reason: error.code ?? 'unreadable-checkpoint' }); }
  }
  candidates.sort((a, b) => (Number.isSafeInteger(b.value?.throughSequence) ? b.value.throughSequence : 0)
    - (Number.isSafeInteger(a.value?.throughSequence) ? a.value.throughSequence : 0)
    || Number(b.value?.profile === PACKED_CHECKPOINT_PROFILE) - Number(a.value?.profile === PACKED_CHECKPOINT_PROFILE)
    || String(b.value?.createdAt ?? '').localeCompare(String(a.value?.createdAt ?? '')));
  if (!candidates.length) return { seed: null, rejections };
  {
    const info = await journalInfo(file), journalStat = info.stat;
    if (!info.bytes) invalid('Saved checkpoints exist but the journal is empty.');
    for (const { slot, value } of candidates) {
      try {
        validateEnvelope(value, workspaceId, info);
        const started = performance.now();
        onProgress?.({ phase: 'integrity', bytes: 0, recordCount: value.throughSequence });
        if (value.profile === PACKED_CHECKPOINT_PROFILE) {
          // The packed representation was fully round-trip checked at creation.
          // Recheck its exact bytes now, then independently bind cached state to
          // the actual terminal record. Earlier blocks need not be inflated.
          const frame = info.frames.find(f => f.start + f.length === value.throughByte);
          if (!frame || frame.position + frame.stored !== value.storage.throughByte
            || value.boundary.start < frame.start) invalid('checkpoint-storage-boundary');
          const stored = await hashStoredJournal(file, value.storage.throughByte);
          if (stored.hasher.copy().digest('hex') !== value.storage.prefixSha256) invalid('prefix-mismatch');
          const integrityReadMs = performance.now() - started, validationStart = performance.now();
          const frameAligned = value.boundary.start === frame.start;
          const chunks = [];
          for await (const chunk of journalChunks(file, {
            start: value.boundary.start - (frameAligned || !value.boundary.start ? 0 : 1), end: value.throughByte - 1,
          })) chunks.push(chunk);
          readBoundary(Buffer.concat(chunks), value, frameAligned);
          validateState(value.state);
          if (!sameJournal(journalStat, await fs.stat(file))) invalid('journal-changed');
          return { seed: { state: value.state, recordCount: value.throughSequence, bytes: value.throughByte,
            boundary: value.boundary, hasher: null }, slot, rejections, journalInfo: journalStat,
            binding: 'stored-bytes', verifiedStoredBytes: stored.bytes, boundaryDecodedBytes: frame.length,
            integrityReadMs, stateValidationMs: performance.now() - validationStart };
        }
        const prefixHasher = crypto.createHash('sha256'); let bytes = 0, lastProgress = performance.now();
        // Retain only the boundary suffix while hashing the prefix. This avoids
        // unfolding a large packed block twice just to check its last record.
        const retain = value.boundary.length + 1, ring = Buffer.alloc(retain);
        let ringPosition = 0, retained = 0;
        for await (const chunk of journalChunks(file, { end: value.throughByte - 1 })) {
          prefixHasher.update(chunk); bytes += chunk.length;
          if (chunk.length >= retain) { chunk.copy(ring, 0, chunk.length - retain); ringPosition = 0; retained = retain; }
          else {
            const first = Math.min(chunk.length, retain - ringPosition);
            chunk.copy(ring, ringPosition, 0, first); chunk.copy(ring, 0, first);
            ringPosition = (ringPosition + chunk.length) % retain; retained = Math.min(retain, retained + chunk.length);
          }
          if (performance.now() - lastProgress >= 500) {
            onProgress?.({ phase: 'integrity', bytes, recordCount: value.throughSequence }); lastProgress = performance.now();
          }
        }
        if (bytes !== value.throughByte || prefixHasher.copy().digest('hex') !== value.prefixSha256) invalid('prefix-mismatch');
        const integrityReadMs = performance.now() - started, validationStart = performance.now();
        const suffix = retained < retain ? ring.subarray(0, retained)
          : Buffer.concat([ring.subarray(ringPosition), ring.subarray(0, ringPosition)]);
        readBoundary(suffix, value);
        validateState(value.state);
        if (!sameJournal(journalStat, await fs.stat(file))) invalid('journal-changed');
        return { seed: { state: value.state, recordCount: value.throughSequence, bytes: value.throughByte,
          boundary: value.boundary, hasher: prefixHasher }, slot, rejections, journalInfo: journalStat,
          binding: 'logical-bytes', integrityReadMs, stateValidationMs: performance.now() - validationStart };
      } catch (error) {
        // Diagnostic categories only, never parser excerpts of conversation data.
        const safe = /^(checkpoint|boundary|prefix|journal)-[a-z-]+$/;
        rejections.push({ slot, reason: safe.test(error.message) ? error.message : error.code ?? 'invalid-checkpoint' });
      }
    }
    return { seed: null, rejections };
  }
}

export function makeStartupCheckpoint(workspaceId, captured, { deferStateHash = false } = {}) {
  return { profile: captured.storage ? PACKED_CHECKPOINT_PROFILE : CHECKPOINT_PROFILE, workspaceId, replayRulesVersion: REPLAY_RULES_VERSION,
    createdAt: new Date().toISOString(), throughSequence: captured.recordCount, throughByte: captured.bytes,
    prefixSha256: captured.hasher?.copy().digest('hex') ?? null, boundary: captured.boundary,
    ...(captured.storage ? { storage: captured.storage } : {}),
    stateHash: deferStateHash ? null : digest(captured.state), state: captured.state };
}

function encodeInBackground(checkpoint) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./checkpoint-encoder.mjs', import.meta.url), { workerData: checkpoint, execArgv: [] });
    worker.once('message', result => result.error ? reject(Object.assign(new Error(result.error), { code: result.error })) : resolve(Buffer.from(result.bytes)));
    worker.once('error', reject);
    worker.once('exit', code => { if (code !== 0) reject(new Error('checkpoint-worker-exit')); });
  });
}

export async function publishStartupCheckpoint(dataDir, slot, checkpoint) {
  if (!CHECKPOINT_FILES.includes(slot)) invalid('checkpoint-slot');
  // Copying into the worker is bounded by the snapshot. Hashing, pooling,
  // compression and the independent round trip happen away from live chat.
  const bytes = await encodeInBackground(checkpoint);
  if (bytes.length > CHECKPOINT_LIMIT) invalid('checkpoint-size');
  const target = path.join(dataDir, slot), temporary = target + '.tmp-' + crypto.randomUUID();
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  if (!(await boundedRead(temporary)).equals(bytes)) invalid('checkpoint-write-verification');
  // Same-directory replacement, with the other generation retained. Never
  // pre-delete a slot; interrupted temp files are deliberately left alone.
  await fs.rename(temporary, target);
  return { slot, sequence: checkpoint.throughSequence, bytes: checkpoint.throughByte };
}
