import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { Transform, Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createBrotliCompress, createBrotliDecompress, brotliCompressSync, constants } from 'node:zlib';

// Container only: the unpacked bytes remain the original append-only JSONL.
// Old readers reject the magic instead of mistaking this for an empty journal.
export const JOURNAL_MAGIC = Buffer.from('BLJBR001');
export const FRAME_HEADER_BYTES = 80;
export const PACK_THRESHOLD = 8 * 1024 * 1024;
const options = { params: { [constants.BROTLI_PARAM_QUALITY]: 4, [constants.BROTLI_PARAM_LGWIN]: 22 } };
const hash = () => crypto.createHash('sha256');
const sha = bytes => hash().update(bytes).digest('hex');
const fail = reason => { throw new Error('Packed journal: ' + reason); };
export const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;

async function exact(handle, length, position) {
  const buffer = Buffer.alloc(length); let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
    if (!bytesRead) fail('incomplete block header.');
    offset += bytesRead;
  }
  return buffer;
}

// One FileHandle for the entire read. Per-frame FileHandle streams retained
// close listeners after EOF; bounded positional reads have no such lifecycle.
async function* rangeChunks(handle, start, end, highWaterMark = 256 * 1024) {
  for (let position = start; position <= end;) {
    const buffer = Buffer.allocUnsafe(Math.min(highWaterMark, end - position + 1));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (!bytesRead) fail('incomplete read range.');
    position += bytesRead; yield buffer.subarray(0, bytesRead);
  }
}

async function layout(handle) {
  const stat = await handle.stat();
  if (!stat.isFile()) fail('not a regular file.');
  const magic = await exact(handle, Math.min(stat.size, JOURNAL_MAGIC.length), 0);
  if (!magic.equals(JOURNAL_MAGIC)) return { compressed: false, bytes: stat.size, storedBytes: stat.size, stat, frames: [] };
  const frames = []; let position = JOURNAL_MAGIC.length, bytes = 0;
  while (position < stat.size) {
    if (stat.size - position < FRAME_HEADER_BYTES) fail('incomplete block header.');
    const header = await exact(handle, FRAME_HEADER_BYTES, position);
    const length = Number(header.readBigUInt64LE(0)), stored = Number(header.readBigUInt64LE(8));
    if (!Number.isSafeInteger(length) || length <= 0 || !Number.isSafeInteger(stored) || stored <= 0
      || !Number.isSafeInteger(bytes + length) || stored > stat.size - position - FRAME_HEADER_BYTES) fail('invalid or incomplete block length.');
    frames.push({ start: bytes, length, stored, position: position + FRAME_HEADER_BYTES,
      sha256: header.subarray(16, 48).toString('hex'), storedSha256: header.subarray(48, 80).toString('hex') });
    bytes += length; position += FRAME_HEADER_BYTES + stored;
  }
  if (!frames.length) fail('empty container.');
  return { compressed: true, bytes, storedBytes: stat.size, stat, frames };
}

export async function journalInfo(file) {
  const handle = await fs.open(file, 'r');
  try { return await layout(handle); } finally { await handle.close(); }
}

// Physical-byte binding for an already verified packed representation. The
// returned hasher can continue with appended frames without unfolding the past.
export async function hashStoredJournal(file, throughByte) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat(), limit = throughByte ?? stat.size;
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > stat.size) fail('invalid stored prefix.');
    const hasher = hash(); let bytes = 0;
    if (limit) for await (const chunk of rangeChunks(handle, 0, limit - 1)) {
      hasher.update(chunk); bytes += chunk.length;
    }
    if (bytes !== limit || !sameFile(stat, await handle.stat()) || !sameFile(stat, await fs.stat(file))) fail('stored bytes changed while checking.');
    return { bytes, hasher, stat };
  } finally { await handle.close(); }
}

// Ranges use original JSONL offsets, never compressed-file offsets. A touched
// frame is checked in full, even when the caller requests only part of it.
export async function* journalChunks(file, { start = 0, end = Infinity, highWaterMark = 256 * 1024 } = {}) {
  const handle = await fs.open(file, 'r');
  try {
    const info = await layout(handle);
    if (!Number.isSafeInteger(start) || start < 0 || start > info.bytes || !(end === Infinity || Number.isSafeInteger(end)) || end < start - 1) fail('invalid read range.');
    const stop = Math.min(info.bytes, end === Infinity ? info.bytes : end + 1);
    if (!info.compressed) {
      if (start < stop) yield* rangeChunks(handle, start, stop - 1, highWaterMark);
    } else for (const frame of info.frames) {
      if (frame.start >= stop || frame.start + frame.length <= start) continue;
      const rawHash = hash(), packedHash = hash(); let expanded = 0, packed = 0;
      const source = Readable.from(rangeChunks(handle, frame.position, frame.position + frame.stored - 1, highWaterMark));
      const meter = new Transform({ transform(chunk, _encoding, cb) { packedHash.update(chunk); packed += chunk.length; cb(null, chunk); } });
      const decoder = createBrotliDecompress({ chunkSize: 256 * 1024 });
      const done = pipeline(source, meter, decoder); done.catch(() => {});
      try {
        for await (const chunk of decoder) {
          const chunkStart = frame.start + expanded;
          expanded += chunk.length; rawHash.update(chunk);
          if (expanded > frame.length) fail('expanded data exceeds its declared length.');
          const lo = Math.max(0, start - chunkStart), hi = Math.min(chunk.length, stop - chunkStart);
          if (hi > lo) yield chunk.subarray(lo, hi);
        }
        await done;
        if (expanded !== frame.length || packed !== frame.stored || decoder.bytesWritten !== frame.stored
          || rawHash.digest('hex') !== frame.sha256 || packedHash.digest('hex') !== frame.storedSha256) fail('block integrity check failed.');
      } finally {
        source.destroy();
        meter.destroy(); decoder.destroy(); await done.catch(() => {});
      }
    }
    if (!sameFile(info.stat, await handle.stat()) || !sameFile(info.stat, await fs.stat(file))) fail('file changed while reading.');
  } finally { await handle.close(); }
}

function headerFor(length, stored, rawHash, storedHash) {
  const header = Buffer.alloc(FRAME_HEADER_BYTES);
  header.writeBigUInt64LE(BigInt(length), 0); header.writeBigUInt64LE(BigInt(stored), 8);
  Buffer.from(rawHash, 'hex').copy(header, 16); Buffer.from(storedHash, 'hex').copy(header, 48);
  return header;
}

export function encodeJournalFrame(raw) {
  const packed = brotliCompressSync(raw, options);
  return Buffer.concat([headerFor(raw.length, packed.length, sha(raw), sha(packed)), packed]);
}

export async function journalFingerprint(file, { onProgress = () => {} } = {}) {
  const hasher = hash(); let bytes = 0, progressAt = performance.now();
  for await (const chunk of journalChunks(file)) {
    bytes += chunk.length; hasher.update(chunk);
    if (performance.now() - progressAt > 500) { onProgress(bytes); progressAt = performance.now(); }
  }
  return { bytes, sha256: hasher.digest('hex') };
}

// The Store holds the sole writer lock and its queue throughout this operation.
// A failed/abandoned temporary file is never used automatically or removed here.
export async function packJournal(file, { expectedBytes, expectedSha256, expectedStoredSha256, boundary, threshold = PACK_THRESHOLD, beforeReplace = async () => {}, onStage = () => {}, onProgress = () => {} } = {}) {
  const info = await journalInfo(file);
  const storedTailBytes = info.compressed ? info.storedBytes - info.frames[0].position - info.frames[0].stored : info.storedBytes;
  if (storedTailBytes < threshold || !info.bytes) return { status: 'unchanged', ...info };
  if ((await fs.lstat(file)).isSymbolicLink()) fail('refusing to replace a linked journal.');
  if (expectedBytes !== info.bytes || !/^[a-f0-9]{64}$/.test(expectedSha256 ?? expectedStoredSha256 ?? '')) fail('missing or changed source binding.');
  if (expectedStoredSha256 && (await hashStoredJournal(file)).hasher.digest('hex') !== expectedStoredSha256) fail('stored source binding changed.');
  if (boundary && (!Number.isSafeInteger(boundary.start) || boundary.start < 0 || !Number.isSafeInteger(boundary.length)
    || boundary.length <= 0 || boundary.start + boundary.length !== info.bytes)) fail('invalid source boundary.');
  const temporary = file + '.tmp-compress-' + crypto.randomUUID();
  const handle = await fs.open(temporary, 'wx', 0o600);
  let rawBytes = 0, position = JOURNAL_MAGIC.length, progressAt = performance.now(); const rawHash = hash();
  let sourceDigest;
  try {
    await handle.writeFile(JOURNAL_MAGIC);
    // Keep the terminal record in its own block. Startup can bind the cache to
    // that actual record without expanding the historical prefix.
    const ranges = boundary?.start > 0 ? [[0, boundary.start - 1], [boundary.start, info.bytes - 1]] : [[0, info.bytes - 1]];
    for (const [start, end] of ranges) {
      const frameStart = position, frameHash = hash(), storedHash = hash(); let frameBytes = 0, storedBytes = 0;
      const inspect = new Transform({ transform(chunk, _encoding, cb) {
        rawBytes += chunk.length; frameBytes += chunk.length; rawHash.update(chunk); frameHash.update(chunk);
        if (performance.now() - progressAt > 500) { onProgress(rawBytes); progressAt = performance.now(); }
        cb(null, chunk);
      } });
      const output = new Writable({ write(chunk, _encoding, cb) {
        storedHash.update(chunk);
        const target = frameStart + FRAME_HEADER_BYTES + storedBytes; storedBytes += chunk.length;
        (async () => { let offset = 0; while (offset < chunk.length) {
          const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset, target + offset);
          if (!bytesWritten) fail('incomplete packed write.'); offset += bytesWritten;
        } })().then(() => cb(), cb);
      } });
      await pipeline(Readable.from(journalChunks(file, { start, end })), inspect, createBrotliCompress(options), output);
      const header = headerFor(frameBytes, storedBytes, frameHash.digest('hex'), storedHash.digest('hex'));
      let offset = 0;
      while (offset < header.length) {
        const { bytesWritten } = await handle.write(header, offset, header.length - offset, frameStart + offset);
        if (!bytesWritten) fail('incomplete header write.'); offset += bytesWritten;
      }
      position += FRAME_HEADER_BYTES + storedBytes;
    }
    sourceDigest = rawHash.digest('hex');
    if (rawBytes !== expectedBytes || (expectedSha256 && sourceDigest !== expectedSha256)) fail('source did not match the loaded history.');
    await handle.sync();
  } finally { await handle.close(); }
  const verified = await journalFingerprint(temporary, { onProgress });
  if (verified.bytes !== expectedBytes || verified.sha256 !== sourceDigest) fail('round-trip verification failed.');
  await onStage('verified', { temporary });
  await beforeReplace(temporary);
  if (!sameFile(info.stat, await fs.stat(file))) fail('source changed before replacement.');
  await fs.rename(temporary, file);
  await onStage('published', { temporary });
  return { status: 'packed', ...await journalInfo(file) };
}
