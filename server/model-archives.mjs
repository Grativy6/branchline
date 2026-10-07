import crypto from 'node:crypto';
import { digest } from './integrity.mjs';
import { archiveRecord, isModelArchived, modelFilesHeld } from '../public/model-archives.js';
const fail = (ok, message) => { if (!ok) throw new Error(message); };
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const ref = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(v);
const text = (v, max) => typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const date = v => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));
export const archiveRevision = state => digest({ archives: state.modelArchives ?? [], models: state.models, people: state.personalParticipants ?? [] });
export function assertModelAvailable(state, modelId) {
  fail(state.models.some(m => m.id === modelId), 'The saved model connection is unavailable.');
  fail(!isModelArchived(state, modelId), 'This model is archived. Choose an available model or return it to the active list. Your conversation and draft are kept.');
  fail(!modelFilesHeld(state, modelId), 'Files archived — restore the local model and confirm its files are available before use.');
}
function validateCopies(copies) {
  fail(Array.isArray(copies) && copies.length <= 4, 'Record up to four archive locations.');
  for (const c of copies) fail(exact(c, ['label','path','checkedAt','manifestSha256','logicalBytes']) && text(c.label, 80) && c.label.trim()
    && text(c.path, 1000) && c.path.trim() && (c.checkedAt === null || date(c.checkedAt))
    && (c.manifestSha256 === null || hash(c.manifestSha256)) && (c.logicalBytes === null || Number.isSafeInteger(c.logicalBytes) && c.logicalBytes >= 0), 'Invalid archive location record.');
}
export function archivePreview(state, modelId) {
  const model = state.models.find(m => m.id === modelId); fail(model, 'Model not found.');
  const people = (state.personalParticipants ?? []).filter(p => p.connections.at(-1).modelId === modelId);
  return { revision: archiveRevision(state), modelId, name: model.name, personalIds: people.map(p => p.id), people: people.map(p => ({ id: p.id, name: p.nickname || p.name })), archived: isModelArchived(state, modelId) };
}
export function applyArchiveCommand(state, type, p) {
  fail(hash(p.baseRevision) && p.baseRevision === archiveRevision(state), 'The model archive changed. Refresh before saving.');
  const preview = archivePreview(state, p.modelId), previous = archiveRecord(state, p.modelId);
  let archived, files, copies, personalIds;
  if (type === 'modelArchive.archive') {
    fail(exact(p, ['modelId','personalIds','baseRevision','files','copies']) && !preview.archived, 'Choose an active saved model to archive.');
    fail(Array.isArray(p.personalIds) && digest([...p.personalIds].sort()) === digest([...preview.personalIds].sort()), 'Review every personal entry sharing this connection before archiving.');
    fail(['retained','elsewhere','unknown'].includes(p.files), 'Record whether the original model files are retained.');
    validateCopies(p.copies); archived = true; files = p.files; copies = p.copies; personalIds = p.personalIds;
  } else {
    fail(exact(p, ['modelId','baseRevision']) && previous, 'Choose a recorded archive entry.');
    fail(type === 'modelArchive.restore' || type === 'modelArchive.filesReady', 'Unknown model archive action.');
    fail(type === 'modelArchive.restore' ? previous.archived : !previous.archived && previous.files !== 'retained', 'Refresh this archive entry before changing it.');
    archived = false; files = type === 'modelArchive.filesReady' ? 'retained' : previous.files; copies = previous.copies; personalIds = preview.personalIds;
  }
  (state.modelArchives ??= []).push({ id: 'modelarchive_' + crypto.randomUUID(), at: new Date().toISOString(), modelId: p.modelId,
    modelSnapshot: structuredClone(state.models.find(m => m.id === p.modelId)), personalIds: [...personalIds], archived, files, copies: structuredClone(copies), actor: 'user', standing: 'recorded_maintenance', action: type });
  return state;
}
export function validateModelArchives(state) {
  const rows = state.modelArchives ?? []; fail(Array.isArray(rows) && rows.length <= 50000, 'Invalid model archive history.');
  const ids = new Set();
  for (const r of rows) {
    fail(exact(r,['id','at','modelId','modelSnapshot','personalIds','archived','files','copies','actor','standing','action']) && ref(r.id) && !ids.has(r.id) && date(r.at)
      && state.models.some(m => m.id === r.modelId) && Array.isArray(r.personalIds) && r.personalIds.length <= 5000 && new Set(r.personalIds).size === r.personalIds.length
      && r.personalIds.every(id => state.personalParticipants?.some(p => p.id === id && p.connections.some(c => c.modelId === r.modelId)))
      && typeof r.archived === 'boolean' && ['retained','elsewhere','unknown'].includes(r.files) && r.actor === 'user' && r.standing === 'recorded_maintenance'
      && ['modelArchive.archive','modelArchive.restore','modelArchive.filesReady'].includes(r.action), 'Invalid model archive record.');
    fail(r.modelSnapshot?.id === r.modelId && text(r.modelSnapshot.name,200) && text(r.modelSnapshot.model,200) && text(r.modelSnapshot.baseUrl,500)
      && Object.keys(r.modelSnapshot).every(k => ['id','name','model','baseUrl','thinking','runtime','inputFormat'].includes(k)), 'Invalid archived connection snapshot.');
    fail(r.archived === (r.action === 'modelArchive.archive') && (r.action !== 'modelArchive.filesReady' || r.files === 'retained'), 'Archive action and state disagree.');
    ids.add(r.id); validateCopies(r.copies);
  }
}
export function preserveModelArchives(before, after) {
  const old = before.modelArchives ?? [], next = after.modelArchives ?? [];
  fail(next.length >= old.length && old.every((r,i) => digest(r) === digest(next[i])), 'Earlier model archive history cannot be rewritten.');
}
