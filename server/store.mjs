import fs from 'node:fs/promises';
import { preserveImages } from './images.mjs';
import { preserveImageConnection } from './image-provider.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import { initialState, clone, applyCommand, validateState, updateDraft } from './domain.mjs';
import { preserveHandoffHistory, recordUiCommand } from './handoff.mjs';
import { inferencePending, preserveTableHistory } from './table.mjs';
import { preserveMindHistory } from './mind.mjs';
import { preserveHarnessHistory } from './harnesses.mjs';
import { preserveAgentProfiles } from './agent-profiles.mjs';
import { enforceModelWrite, preserveContinuityHistory } from './effect-boundary.mjs';
import { enforceAdoptionWrite } from './actions.mjs';
import { preserveCarryHistory } from './context-carry.mjs';
import { preserveSketchBook } from './sketches.mjs';
import { preservePc } from './pc-permissions.mjs';
import { preserveParallelHistory } from './parallel-state.mjs';
import { replayJournal } from './journal.mjs';
import { journalChange } from './journal-change.mjs';
import { journalInfo, encodeJournalFrame, packJournal, hashStoredJournal, journalFingerprint, PACK_THRESHOLD } from './journal-codec.mjs';
import { findStartupCheckpoint, makeStartupCheckpoint, publishStartupCheckpoint, compressLegacyCheckpoints, CHECKPOINT_FILES, sameJournal } from './startup-checkpoint.mjs';

// Preserve legacy snapshots; append only the changed data from this version on.
// The storage hash binds bytes/state, not authority or public certification.
export class Store {
  constructor(dataDir, { checkpoints = true, checkpointWriter = publishStartupCheckpoint, checkpointPolicy = {}, compressionThreshold = PACK_THRESHOLD } = {}) {
    this.dataDir = path.resolve(dataDir);
    this.file = path.join(this.dataDir, 'events.jsonl');
    this.lockFile = path.join(this.dataDir, '.writer.lock');
    this.state = initialState();
    this.writeChain = Promise.resolve();
    this.owner = { pid: process.pid, token: crypto.randomUUID() };
    this.lockHandle = null;
    this.closed = false;
    this.sequence = 0;
    this.writeFault = null;
    this.workspaceId = null;
    this.workspaceMetadataFile = path.join(this.dataDir, 'workspace.json');
    this.checkpoints = checkpoints;
    this.checkpointWriter = checkpointWriter;
    this.checkpointPolicy = { events: 100, bytes: 8 * 1024 * 1024, quietMs: 60000, ...checkpointPolicy };
    this.journalBytes = 0;
    this.storedJournalBytes = 0;
    this.compressedJournal = false;
    this.compressionThreshold = compressionThreshold;
    this.journalHasher = crypto.createHash('sha256');
    this.storedJournalHasher = null;
    this.checkpointEncodingChanged = false;
    this.journalBoundary = null;
    this.checkpointSequence = 0;
    this.checkpointBytes = 0;
    this.checkpointSlot = null;
    this.checkpointPromise = null;
    this.checkpointAgain = false;
    this.checkpointTimer = null;
    this.checkpointFailure = null;
    this.loaded = false;
    this.closing = false;
    this.closePromise = null;
  }

  async acquireLock() {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        this.lockHandle = await fs.open(this.lockFile, 'wx');
        await this.lockHandle.writeFile(JSON.stringify(this.owner));
        await this.lockHandle.sync();
        return;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        let prior;
        try { prior = JSON.parse(await fs.readFile(this.lockFile, 'utf8')); }
        catch { throw new Error('The workspace has an unreadable writer lock. Preserve it and inspect the previous server before recovery.'); }
        if (!Number.isSafeInteger(prior.pid) || prior.pid <= 0 || typeof prior.token !== 'string') {
          throw new Error('The workspace writer lock is malformed. No history was changed.');
        }
        let alive = true;
        try { process.kill(prior.pid, 0); }
        catch (probe) { if (probe.code === 'ESRCH') alive = false; }
        if (alive) throw new Error('The workspace writer-lock process is still running. It may be another Branchline server or a reused process ID. Preserve the workspace and inspect its owner before recovery.');
        const current = JSON.parse(await fs.readFile(this.lockFile, 'utf8'));
        if (current.token !== prior.token) throw new Error('Workspace ownership changed during recovery. Try again.');
        await fs.unlink(this.lockFile);
      }
    }
    throw new Error('Could not acquire the workspace writer lock.');
  }

  async open({ onProgress } = {}) {
    await fs.mkdir(this.dataDir, { recursive: true });
    await this.acquireLock();
    try {
      this.freshWorkspace = (await fs.readdir(this.dataDir)).every(name => name === '.writer.lock');
      await this.loadWorkspaceIdentity();
      const started = performance.now();
      const info = await journalInfo(this.file).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
      const before = info?.stat;
      // A lost journal must not silently become a new empty workspace simply
      // because a derived file could not be used.
      if (!before || !before.size) {
        for (const slot of CHECKPOINT_FILES) {
          const exists = await fs.lstat(path.join(this.dataDir, slot)).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
          if (exists) throw new Error('Saved checkpoints exist but the journal is missing or empty.');
        }
      }
      const found = this.checkpoints && before?.size
        ? await findStartupCheckpoint(this.dataDir, this.workspaceId, this.file, { onProgress })
        : { seed: null, rejections: [] };
      const tailStarted = performance.now();
      onProgress?.({ phase: found.seed ? 'tail' : 'replay', recordCount: found.seed?.recordCount ?? 0, bytes: found.seed?.bytes ?? 0 });
      const replay = before ? await replayJournal(this.file, { onProgress, seed: found.seed })
        : { state: this.state, recordCount: 0, bytes: 0, boundary: null, hasher: this.journalHasher };
      if (before && (!sameJournal(before, await fs.stat(this.file)) || replay.bytes !== info.bytes)) throw new Error('Journal changed outside its writer during startup.');
      this.state = replay.state;
      this.sequence = replay.recordCount;
      this.journalBytes = replay.bytes;
      this.storedJournalBytes = info?.storedBytes ?? 0;
      this.compressedJournal = info?.compressed ?? false;
      this.journalHasher = replay.hasher;
      if (this.compressedJournal) {
        const stored = await hashStoredJournal(this.file);
        if (!sameJournal(before, stored.stat)) throw new Error('Journal changed outside its writer during startup.');
        this.storedJournalHasher = stored.hasher;
        this.checkpointEncodingChanged = found.binding !== 'stored-bytes';
      }
      this.journalBoundary = replay.boundary;
      this.checkpointSequence = found.seed?.recordCount ?? 0;
      this.checkpointBytes = found.seed?.bytes ?? 0;
      this.checkpointSlot = found.slot ?? null;
      this.loaded = true;
      if (this.sequence) await this.compressHistory(onProgress);
      if (this.checkpoints) await compressLegacyCheckpoints(this.dataDir);
      // Packing changes physical bytes, even when no logical record changed.
      // Publish that new binding before the next startup can use the fast path.
      if (this.checkpointEncodingChanged) await this.requestCheckpoint();
      this.startupDiagnostics = { path: found.seed ? 'checkpoint' : 'full-replay',
        coveredSequence: found.seed?.recordCount ?? 0, coveredBytes: found.seed?.bytes ?? 0,
        tailRecords: this.sequence - (found.seed?.recordCount ?? 0), journalBytes: this.journalBytes,
        storedJournalBytes: this.storedJournalBytes, compressedJournal: this.compressedJournal,
        checkpointBinding: found.binding ?? null, verifiedStoredBytes: found.verifiedStoredBytes ?? 0,
        boundaryDecodedBytes: found.boundaryDecodedBytes ?? 0,
        compression: this.compressionResult, integrityReadMs: found.integrityReadMs ?? 0, stateValidationMs: found.stateValidationMs ?? 0,
        replayMs: performance.now() - tailStarted, openMs: performance.now() - started, rejections: found.rejections };
      // This report is diagnostic only. Failure to save it cannot block chat.
      await fs.writeFile(path.join(this.dataDir, 'startup-diagnostics.json'), JSON.stringify(this.startupDiagnostics, null, 2) + '\n', { mode: 0o600 }).catch(() => {});
      if (this.sequence && !found.seed) void this.requestCheckpoint();
      else this.scheduleCheckpoint();
    } catch (err) {
      this.writeFault = err;
      await this.close().catch(() => {});
      throw new Error('Workspace journal could not be replayed: ' + err.message + ' No history was reset.');
    }
  }

  async loadWorkspaceIdentity() {
    let raw;
    try { raw = await fs.readFile(this.workspaceMetadataFile, 'utf8'); }
    catch (err) {
      if (err.code !== 'ENOENT') throw err;
      // Preserve the namespace used by the first beta for existing workspaces.
      this.workspaceId = crypto.createHash('sha256').update(this.dataDir).digest('hex').slice(0, 32);
      const metadata = JSON.stringify({ version: 1, workspaceId: this.workspaceId }) + '\n';
      const temporary = this.workspaceMetadataFile + '.tmp-' + this.owner.token;
      const handle = await fs.open(temporary, 'w');
      try { await handle.writeFile(metadata, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporary, this.workspaceMetadataFile);
      return;
    }
    let metadata;
    try { metadata = JSON.parse(raw); } catch { throw new Error('Workspace identity metadata is malformed. No history was reset.'); }
    if (!metadata || metadata.version !== 1 || typeof metadata.workspaceId !== 'string' || !/^[a-f0-9]{32}$/.test(metadata.workspaceId)) {
      throw new Error('Workspace identity metadata is malformed. No history was reset.');
    }
    this.workspaceId = metadata.workspaceId;
  }

  transact(update, { returnState = true } = {}) {
    return this.#transact(update, returnState);
  }

  #transact(update, returnState, draftCommand = null) {
    if (this.closing || this.closed) return Promise.reject(new Error('Workspace is closing.'));
    const transaction = this.writeChain.then(async () => {
      if (this.closed || !this.lockHandle) throw new Error('Workspace is closed.');
      if (this.writeFault) throw new Error('A prior save failed. Restart and inspect the journal before writing again.');
      const next = draftCommand ? updateDraft(this.state, draftCommand.payload ?? {}) : update(clone(this.state));
      if (next?.then) throw new Error('Store transactions must be synchronous.');
      if (this.dreamRecoveryPending && inferencePending(next)) throw new Error('A Dream recovery is preparing. Finish or cancel it before starting model work.');
      if (draftCommand) {
        // No caller-supplied update function can use this path. History and grants
        // retain their identities; only one checked composer string is replaced.
        recordUiCommand(this.state, next, draftCommand);
      } else {
        validateState(next);
        preserveImages(this.state, next);
        preserveImageConnection(this.state, next);
        preserveHandoffHistory(this.state, next);
        preserveTableHistory(this.state, next);
        preserveMindHistory(this.state, next);
        preserveHarnessHistory(this.state, next);
        preserveAgentProfiles(this.state, next);
        preserveCarryHistory(this.state, next);
        preserveSketchBook(this.state, next);
        preservePc(this.state, next);
        preserveParallelHistory(this.state, next);
        preserveContinuityHistory(this.state, next);
        enforceModelWrite(this.state, next);
        enforceAdoptionWrite(this.state, next);
      }
      const sequence = this.sequence + 1;
      const event = Buffer.from(JSON.stringify(this.sequence === 0
        ? { type: 'snapshot', sequence, at: new Date().toISOString(), state: next }
        : journalChange(this.state, next, sequence)) + '\n');
      const storedEvent = this.compressedJournal ? encodeJournalFrame(event) : event;
      let handle;
      try {
        handle = await fs.open(this.file, 'a');
        if ((await handle.stat()).size !== this.storedJournalBytes) throw new Error('Journal size changed outside its writer.');
        await handle.writeFile(storedEvent);
        await handle.sync();
        await handle.close(); handle = null;
      } catch (err) {
        this.writeFault = err;
        throw new Error('Local save failed: ' + err.message);
      } finally { await handle?.close(); }
      this.state = draftCommand ? next : clone(next);
      this.sequence = sequence;
      this.journalHasher?.update(event);
      this.storedJournalHasher?.update(storedEvent);
      this.journalBoundary = { start: this.journalBytes, length: event.length,
        sha256: crypto.createHash('sha256').update(event).digest('hex') };
      this.journalBytes += event.length;
      this.storedJournalBytes += storedEvent.length;
      this.scheduleCheckpoint();
      return returnState ? clone(this.state) : undefined;
    });
    // Validation errors do not poison the queue; partial filesystem writes do.
    this.writeChain = transaction.catch(() => {});
    return transaction;
  }

  command(command, options) {
    if (command?.type === 'draft.save') return this.#transact(null, options?.returnState !== false, clone(command));
    return this.transact(state => {
      if (command.type === 'continuity.proposal.accept') throw new Error('Open the proposal review before accepting guidance.');
      const next = applyCommand(state, command);
      recordUiCommand(state, next, command);
      return next;
    }, options);
  }

  // Storage operations use the same queue as writes, so a backup observes a
  // complete journal at a known boundary rather than racing an append.
  atQueueBoundary(operation) {
    if (this.closing || this.closed || !this.lockHandle) return Promise.reject(new Error('Workspace is closed.'));
    if (this.writeFault) return Promise.reject(new Error('A prior save failed. Restart and inspect the journal before writing again.'));
    const operationResult = this.writeChain.then(() => operation());
    // Keep the queue occupied for the full read/copy, so a later append
    // cannot slip between the boundary and the bytes being captured.
    this.writeChain = operationResult.catch(() => {});
    return operationResult;
  }

  async compressHistory(onProgress) {
    if (!this.loaded || !this.sequence || this.writeFault) return;
    if (['checkpoint-size', 'checkpoint-expanded-size', 'checkpoint-complexity'].includes(this.checkpointFailure?.code)) return;
    const started = performance.now();
    const logicalSha256 = this.journalHasher?.copy().digest('hex');
    const storedSha256 = this.storedJournalHasher?.copy().digest('hex') ?? logicalSha256;
    try {
      let packedCheckpoint = null;
      const result = await packJournal(this.file, { expectedBytes: this.journalBytes,
        expectedSha256: logicalSha256, expectedStoredSha256: this.compressedJournal ? storedSha256 : undefined,
        boundary: this.journalBoundary, threshold: this.compressionThreshold,
        beforeReplace: async candidate => {
          if (!this.checkpoints) return;
          const stored = await hashStoredJournal(candidate);
          const slot = CHECKPOINT_FILES[this.checkpointSlot === CHECKPOINT_FILES[0] ? 1 : 0];
          const captured = { state: this.state, recordCount: this.sequence, bytes: this.journalBytes,
            boundary: this.journalBoundary, hasher: this.journalHasher,
            storage: { encoding: 'BLJBR001', throughByte: stored.bytes, prefixSha256: stored.hasher.copy().digest('hex') } };
          // Keep the current slot bound to the old journal until its replacement
          // and the other slot are both verified. A crash can use either pair.
          await this.checkpointWriter(this.dataDir, slot, makeStartupCheckpoint(this.workspaceId, captured, { deferStateHash: true }));
          packedCheckpoint = { slot, sequence: this.sequence, bytes: this.journalBytes };
        },
        onProgress: bytes => onProgress?.({ phase: 'compress', bytes, recordCount: this.sequence }),
        onStage: stage => onProgress?.({ phase: 'compress', stage, bytes: this.journalBytes, recordCount: this.sequence }) });
      this.storedJournalBytes = result.storedBytes; this.compressedJournal = result.compressed;
      if (result.status === 'packed') {
        this.storedJournalHasher = (await hashStoredJournal(this.file)).hasher;
        this.checkpointEncodingChanged = !packedCheckpoint;
        if (packedCheckpoint) {
          this.checkpointSlot = packedCheckpoint.slot; this.checkpointSequence = packedCheckpoint.sequence;
          this.checkpointBytes = packedCheckpoint.bytes; this.checkpointFailure = null;
        }
      }
      this.compressionResult = { status: result.status, milliseconds: Math.round(performance.now() - started) };
    } catch (error) {
      if (/^checkpoint-[a-z-]+$/.test(error.message)) this.checkpointFailure = { at: new Date().toISOString(), code: error.message };
      // A packing failure must not change the logical source. Verify before
      // continuing, including the rare case replacement succeeded then failed.
      const info = await journalInfo(this.file);
      const stored = await hashStoredJournal(this.file);
      const unchanged = stored.hasher.copy().digest('hex') === storedSha256;
      if (!unchanged) {
        if (!logicalSha256) throw error;
        const fingerprint = await journalFingerprint(this.file);
        if (fingerprint.bytes !== this.journalBytes || fingerprint.sha256 !== logicalSha256) throw error;
        this.checkpointEncodingChanged = true;
      }
      this.storedJournalBytes = info.storedBytes; this.compressedJournal = info.compressed;
      this.storedJournalHasher = info.compressed ? stored.hasher : null;
      this.compressionResult = { status: 'unavailable', code: error.code ?? 'compression-failed' };
    }
  }

  scheduleCheckpoint() {
    if (!this.checkpoints || !this.loaded || this.closing || this.closed || this.writeFault
      || (this.sequence === this.checkpointSequence && !this.checkpointEncodingChanged)) return;
    // A failing cache is retried at a quiet opportunity or close, not on every
    // keystroke. It never poisons the journal's write chain.
    if (!this.checkpointFailure && (this.sequence - this.checkpointSequence >= this.checkpointPolicy.events
      || this.journalBytes - this.checkpointBytes >= this.checkpointPolicy.bytes)) void this.requestCheckpoint();
    clearTimeout(this.checkpointTimer);
    {
      this.checkpointTimer = setTimeout(() => {
        this.checkpointTimer = null; void this.requestCheckpoint();
      }, this.checkpointPolicy.quietMs);
      this.checkpointTimer.unref();
    }
  }

  requestCheckpoint() {
    if (!this.checkpoints || !this.loaded || this.closed || this.writeFault || !this.lockHandle || !this.sequence) return Promise.resolve({ status: 'skipped' });
    if (['checkpoint-size', 'checkpoint-expanded-size', 'checkpoint-complexity'].includes(this.checkpointFailure?.code)) {
      return Promise.resolve({ status: 'unavailable', ...this.checkpointFailure });
    }
    this.checkpointAgain = true;
    if (this.checkpointPromise) return this.checkpointPromise;
    this.checkpointPromise = (async () => {
      let result = { status: 'unchanged' };
      while (this.checkpointAgain) {
        this.checkpointAgain = false;
        const capture = this.writeChain.then(async () => {
          if (this.writeFault || !this.lockHandle) throw new Error('checkpoint-store-unavailable');
          if (this.sequence === this.checkpointSequence && !this.checkpointEncodingChanged) return null;
          if ((await fs.stat(this.file)).size !== this.storedJournalBytes) throw new Error('checkpoint-journal-changed');
          return { state: clone(this.state), recordCount: this.sequence, bytes: this.journalBytes,
            boundary: { ...this.journalBoundary }, hasher: this.journalHasher?.copy(),
            storage: this.compressedJournal ? { encoding: 'BLJBR001', throughByte: this.storedJournalBytes,
              prefixSha256: this.storedJournalHasher.copy().digest('hex') } : null };
        });
        this.writeChain = capture.catch(() => {});
        try {
          const captured = await capture;
          if (!captured) continue;
          const slot = CHECKPOINT_FILES[this.checkpointSlot === CHECKPOINT_FILES[0] ? 1 : 0];
          const written = await this.checkpointWriter(this.dataDir, slot, makeStartupCheckpoint(this.workspaceId, captured, { deferStateHash: true }));
          this.checkpointSequence = captured.recordCount; this.checkpointBytes = captured.bytes;
          this.checkpointSlot = slot; this.checkpointFailure = null;
          this.checkpointEncodingChanged = false;
          result = { status: 'saved', ...written };
        } catch (error) {
          const safe = /^checkpoint-[a-z-]+$/;
          this.checkpointFailure = { at: new Date().toISOString(), code: safe.test(error.message) ? error.message : error.code ?? 'checkpoint-unavailable' };
          result = { status: 'unavailable', ...this.checkpointFailure }; this.checkpointAgain = false;
        }
      }
      return result;
    })().finally(() => { this.checkpointPromise = null; });
    return this.checkpointPromise;
  }

  close() {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    clearTimeout(this.checkpointTimer); this.checkpointTimer = null;
    this.closePromise = (async () => {
      try {
        await this.writeChain;
        await this.checkpointPromise;
        await this.compressHistory();
        await this.requestCheckpoint();
      } finally {
        this.closed = true;
        const ownedHandle = this.lockHandle;
        this.lockHandle = null;
        if (ownedHandle) {
          await ownedHandle.close();
          try {
            const current = JSON.parse(await fs.readFile(this.lockFile, 'utf8'));
            if (current.token === this.owner.token) await fs.unlink(this.lockFile);
          } catch (err) { if (err.code !== 'ENOENT') throw err; }
        }
      }
    })();
    return this.closePromise;
  }
}
