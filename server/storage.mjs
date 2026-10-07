import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { verifyJournal } from './journal-verification.mjs';
import { ImageStore } from './image-store.mjs';
import { imageObjects } from './images.mjs';

const HEX = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9-]{20,80}$/;
const FIXED = ['events.jsonl', 'workspace.json'];

function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function safeId(id) { if (typeof id !== 'string' || !ID.test(id)) throw Object.assign(new Error('Invalid backup id.'), { status: 400 }); return id; }
async function fingerprint(file) {
  const hash = crypto.createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(file)) { hash.update(chunk); bytes += chunk.length; }
  return { bytes, sha256: hash.digest('hex') };
}
async function durableCopy(source, destination, allowMissing = false) {
  try { await fs.copyFile(source, destination, constants.COPYFILE_EXCL); }
  catch (error) {
    if (!allowMissing || error.code !== 'ENOENT') throw error;
    await fs.writeFile(destination, '', { flag: 'wx' });
  }
  const handle = await fs.open(destination, 'r+');
  try { await handle.sync(); } finally { await handle.close(); }
  return fingerprint(destination);
}
function parseIdentity(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error('The backup identity metadata is malformed.'); }
  if (!value || value.version !== 1 || typeof value.workspaceId !== 'string' || !/^[a-f0-9]{32}$/.test(value.workspaceId)) throw new Error('The backup identity metadata is malformed.');
  return value;
}

export class StorageManager {
  constructor(store, backupDir = path.resolve(store.dataDir, '..', 'backups')) {
    this.store = store;
    this.backupDir = path.resolve(backupDir);
    this.recoveredDir = path.join(this.backupDir, 'recovered-workspaces');
    this.verificationChain = Promise.resolve();
  }

  async list() {
    await fs.mkdir(this.backupDir, { recursive: true });
    const entries = await fs.readdir(this.backupDir, { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'recovered-workspaces' || !ID.test(entry.name)) continue;
      try {
        const manifest = JSON.parse(await fs.readFile(path.join(this.backupDir, entry.name, 'manifest.json'), 'utf8'));
        if (manifest.workspaceId !== this.store.workspaceId) continue;
        result.push({ id: entry.name, createdAt: manifest.createdAt, bytes: manifest.journalBytes, recordCount: manifest.recordCount });
      } catch { /* incomplete directories are not advertised */ }
    }
    return result.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async backup() {
    const captured = await this.store.atQueueBoundary(async () => {
      await fs.mkdir(this.backupDir, { recursive: true });
      const id = crypto.randomUUID();
      const target = path.join(this.backupDir, id);
      const temporary = path.join(this.backupDir, '.tmp-' + id);
      await fs.mkdir(temporary, { recursive: true });
      try {
        const identity = await fs.readFile(this.store.workspaceMetadataFile);
        const metadata = parseIdentity(identity.toString('utf8'));
        if (metadata.workspaceId !== this.store.workspaceId) throw new Error('Workspace identity changed while backing up.');
        const journal = await durableCopy(this.store.file, path.join(temporary, 'events.jsonl'), true);
        const sourceHash = (this.store.storedJournalHasher ?? this.store.journalHasher).copy().digest('hex');
        if (journal.sha256 !== sourceHash || journal.bytes !== this.store.storedJournalBytes) throw new Error('Workspace journal changed outside its writer.');
        const identityCopy = await durableCopy(this.store.workspaceMetadataFile, path.join(temporary, 'workspace.json'));
        if (identityCopy.sha256 !== digest(identity)) throw new Error('Workspace identity changed while backing up.');
        const manifest = {
          version: 2, id, createdAt: new Date().toISOString(), workspaceId: metadata.workspaceId,
          journalBytes: journal.bytes, unpackedJournalBytes: this.store.journalBytes, recordCount: this.store.sequence,
          files: { 'events.jsonl': journal, 'workspace.json': identityCopy },
        };
        const images = imageObjects(this.store.state);
        if (images.length) { manifest.version = 3; manifest.images = images; }
        return { id, temporary, target, manifest };
      } catch (error) {
        // Retain partial copies for inspection. Failure is not a cleanup grant.
        error.message += ` Partial backup files, if any, remain at ${temporary} or ${target}.`;
        throw error;
      }
    });
    const { id, temporary, target, manifest } = captured;
    try {
      // Immutable objects are copied after releasing the journal writer queue.
      const sourceImages = new ImageStore(this.store.dataDir), targetImages = new ImageStore(temporary);
      for (const ref of manifest.images ?? []) {
        const bytes = await sourceImages.read(ref);
        const copy = await targetImages.put(bytes, ref.mimeType.split('/')[1], { width: ref.width, height: ref.height });
        if (copy.sha256 !== ref.sha256) throw new Error('Image backup differs from its source.');
      }
      // New messages can commit while this immutable copy is checked in full.
      const parsed = await this.replayCopy(path.join(temporary, 'events.jsonl'));
      if (parsed.recordCount !== manifest.recordCount || parsed.bytes !== manifest.unpackedJournalBytes) throw new Error('Backup contents did not match their captured boundary.');
      const manifestHandle = await fs.open(path.join(temporary, 'manifest.json'), 'wx');
      try { await manifestHandle.writeFile(JSON.stringify(manifest, null, 2) + '\n'); await manifestHandle.sync(); } finally { await manifestHandle.close(); }
      await fs.rename(temporary, target);
      await this.verifyPublished(id, manifest);
      return { id, createdAt: manifest.createdAt, bytes: manifest.journalBytes, recordCount: manifest.recordCount };
    } catch (error) {
      error.message += ` Partial backup files, if any, remain at ${temporary} or ${target}.`; throw error;
    }
  }

  replayCopy(file) {
    const work = this.verificationChain.then(() => verifyJournal(file));
    this.verificationChain = work.catch(() => {}); return work;
  }

  async verifyPublished(id, expected) {
    const root = path.join(this.backupDir, safeId(id));
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
    if (JSON.stringify(manifest) !== JSON.stringify(expected)) throw new Error('Backup manifest changed during publication.');
    for (const name of FIXED) {
      const actual = await fingerprint(path.join(root, name));
      if (actual.bytes !== expected.files[name].bytes || actual.sha256 !== expected.files[name].sha256) throw new Error('Backup file changed during publication.');
    }
    const images = new ImageStore(root);
    for (const ref of expected.images ?? []) await images.read(ref);
  }

  async verify(id) {
    const checked = await this.readVerified(id);
    return { valid: true, id, workspaceId: checked.manifest.workspaceId, recordCount: checked.parsed.recordCount, bytes: checked.manifest.journalBytes, createdAt: checked.manifest.createdAt };
  }

  async readVerified(id) {
    const root = path.join(this.backupDir, safeId(id));
    let manifest;
    try { manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8')); }
    catch { throw Object.assign(new Error('Backup was not found or its manifest is unreadable.'), { status: 404 }); }
    if (![1, 2, 3].includes(manifest.version) || manifest.id !== id || manifest.workspaceId !== this.store.workspaceId || !manifest.files) throw new Error('Backup manifest is invalid.');
    const files = {};
    for (const name of FIXED) {
      const expected = manifest.files[name];
      if (!expected || !Number.isSafeInteger(expected.bytes) || !HEX.test(expected.sha256)) throw new Error('Backup manifest is invalid.');
      files[name] = path.join(root, name);
      const actual = await fingerprint(files[name]);
      if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) throw new Error('Backup file failed its integrity check.');
    }
    const parsed = await this.replayCopy(files['events.jsonl']);
    const identity = parseIdentity(await fs.readFile(files['workspace.json'], 'utf8'));
    if (identity.workspaceId !== manifest.workspaceId) throw new Error('Backup identity does not match its manifest.');
    const logicalBytes = manifest.version >= 2 ? manifest.unpackedJournalBytes : manifest.journalBytes;
    if (JSON.stringify(parsed.images ?? []) !== JSON.stringify(manifest.images ?? [])) throw new Error('Backup image references do not match its journal.');
    const images = new ImageStore(root);
    for (const ref of manifest.images ?? []) await images.read(ref);
    if (parsed.recordCount !== manifest.recordCount || parsed.bytes !== logicalBytes || manifest.journalBytes !== manifest.files['events.jsonl'].bytes) throw new Error('Backup manifest counts do not match its contents.');
    return { id, manifest, files, parsed };
  }

  async restoreCopy(id) {
    const checked = await this.readVerified(id);
    await fs.mkdir(this.recoveredDir, { recursive: true });
    const recoveredId = `${id}-${crypto.randomUUID()}`;
    const target = path.join(this.recoveredDir, recoveredId);
    await fs.mkdir(target, { recursive: true });
    try {
      for (const name of FIXED) {
        const written = await durableCopy(checked.files[name], path.join(target, name));
        if (written.bytes !== checked.manifest.files[name].bytes || written.sha256 !== checked.manifest.files[name].sha256) throw new Error('Recovered copy failed its integrity check.');
      }
      const sourceImages = new ImageStore(path.join(this.backupDir, id)), targetImages = new ImageStore(target);
      for (const ref of checked.manifest.images ?? []) {
        const bytes = await sourceImages.read(ref);
        await targetImages.put(bytes, ref.mimeType.split('/')[1], { width: ref.width, height: ref.height });
      }
      const restored = { dataDir: target, ...(await this.verifyRestored(target)) };
      return { restoredPath: target, workspaceId: restored.workspaceId, recordCount: restored.recordCount };
    } catch (error) {
      error.message += ` Partial copy retained at ${target}; the active workspace was not replaced.`;
      throw error;
    }
  }

  async verifyRestored(root) {
    const identity = parseIdentity(await fs.readFile(path.join(root, 'workspace.json'), 'utf8'));
    const parsed = await this.replayCopy(path.join(root, 'events.jsonl'));
    const images = new ImageStore(root);
    for (const ref of parsed.images ?? []) await images.read(ref);
    return { workspaceId: identity.workspaceId, recordCount: parsed.recordCount };
  }

  async info() {
    return this.store.atQueueBoundary(async () => {
      const journal = await fs.stat(this.store.file).catch(error => error.code === 'ENOENT' ? { size: 0 } : Promise.reject(error));
      let checkpointBytes = 0;
      for (const slot of ['startup-checkpoint-a.json', 'startup-checkpoint-b.json']) checkpointBytes += await fs.stat(path.join(this.store.dataDir, slot)).then(s => s.size, error => error.code === 'ENOENT' ? 0 : Promise.reject(error));
      return { workspacePath: this.store.dataDir, backupPath: this.backupDir, workspaceId: this.store.workspaceId,
        imageBytes: imageObjects(this.store.state).reduce((n, ref) => n + ref.byteLength, 0), imageObjects: imageObjects(this.store.state).length,
        journalBytes: journal.size, expandedJournalBytes: this.store.journalBytes, compressed: this.store.compressedJournal,
        checkpointBytes, checkpointFailure: this.store.checkpointFailure, checkpointSequence: this.store.checkpointSequence,
        recordCount: this.store.sequence, backups: await this.list() };
    });
  }
}
