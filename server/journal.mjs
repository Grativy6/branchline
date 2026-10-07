import { journalChunks } from './journal-codec.mjs';
import { preserveImages } from './images.mjs';
import { constants } from 'node:buffer';
import crypto from 'node:crypto';
import { initialState, validateState } from './domain.mjs';
import { preserveHandoffHistory } from './handoff.mjs';
import { preserveTableHistory } from './table.mjs';
import { preserveMindHistory } from './mind.mjs';
import { preserveHarnessHistory } from './harnesses.mjs';
import { preserveAgentProfiles } from './agent-profiles.mjs';
import { preserveCarryHistory } from './context-carry.mjs';
import { preserveParallelHistory } from './parallel-state.mjs';
import { applyJournalChange } from './journal-change.mjs';

// Only one record is assembled at a time. A large history must never become
// one JavaScript string. Newlines remain commit boundaries, including at EOF.
export async function* journalRecords(file, { highWaterMark = 64 * 1024, start = 0, startSequence = 0, hasher } = {}) {
  const stream = journalChunks(file, { highWaterMark, start });
  let parts = [], length = 0, sequence = startSequence, bytes = start;
  for await (const chunk of stream) {
    hasher?.update(chunk);
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline < 0 ? chunk.length : newline;
      const part = chunk.subarray(start, end);
      parts.push(part); length += part.length;
      if (length > constants.MAX_STRING_LENGTH) throw new Error('An individual journal record exceeds the runtime string limit.');
      if (newline < 0) break;
      const recordStart = bytes;
      bytes += length + 1;
      const line = parts.length === 1 ? parts[0] : Buffer.concat(parts, length);
      let event;
      try { event = JSON.parse(line.toString('utf8')); }
      catch { throw new Error('Invalid journal JSON at record ' + (sequence + 1) + '.'); }
      parts = []; length = 0;
      yield { event, sequence: ++sequence, bytes, boundary: {
        start: recordStart, length: line.length + 1,
        sha256: crypto.createHash('sha256').update(line).update('\n').digest('hex'),
      } };
      start = newline + 1;
    }
  }
  if (length || parts.length) throw new Error('The last journal record is incomplete.');
}

export async function replayJournal(file, { onProgress, seed, ...readerOptions } = {}) {
  // Only the startup-checkpoint reader supplies a seed after validating its
  // journal binding. Backups always call this with no seed for a full replay.
  let state = seed?.state ?? initialState(), recordCount = seed?.recordCount ?? 0;
  let bytes = seed?.bytes ?? 0, boundary = seed?.boundary ?? null, lastProgress = Date.now();
  // A packed-byte checkpoint deliberately has no claimed flat unpacked hash.
  // Full replay/export computes that hash; ordinary startup carries its storage binding.
  const hasher = seed ? seed.hasher : crypto.createHash('sha256');
  for await (const record of journalRecords(file, { ...readerOptions, start: bytes, startSequence: recordCount, hasher })) {
    const { event, sequence } = record;
    if (!['snapshot', 'change'].includes(event?.type) || event.sequence !== sequence || typeof event.at !== 'string') {
      throw new Error('Invalid journal envelope at record ' + sequence + '.');
    }
    const next = event.type === 'snapshot' ? event.state : applyJournalChange(state, event);
    validateState(next);
    preserveImages(state, next);
    preserveHandoffHistory(state, next);
    preserveTableHistory(state, next);
    preserveMindHistory(state, next);
    preserveHarnessHistory(state, next);
    preserveAgentProfiles(state, next);
    preserveCarryHistory(state, next);
    preserveParallelHistory(state, next);
    state = next; recordCount = sequence; bytes = record.bytes; boundary = record.boundary;
    if (onProgress && Date.now() - lastProgress >= 500) {
      onProgress({ phase: seed ? 'tail' : 'replay', recordCount, bytes }); lastProgress = Date.now();
    }
  }
  return { state, recordCount, bytes, boundary, hasher };
}
