import {deskWork} from './desk-work.mjs';
import { digest } from './integrity.mjs';

export const MAIL_PROFILE = 'branchline.pony-mail/1';
export const MAIL_TOOLS = ['list_pony_desks', 'send_pony', 'read_pony'];
export const mailSettings = (s, rootId) => s.ponyMail?.settings.findLast(r => r.rootId === rootId) ?? null;
export const mailEvents = (s, id) => s.ponyMail?.events.filter(e => e.parcelId === id) ?? [];
export const mailEvent = (s, id, kind) => s.ponyMail?.events.findLast(e => e.parcelId === id && e.kind === kind) ?? null;
export const mailAddress = (s, p) => mailEvent(s, p.id, 'address')?.address ?? p.destination;
export const mailFiles = s => [...new Set((s.ponyMail?.parcels ?? []).map(p => `pony-mail/objects/${p.payloadHash}.json`))];
export const validMailFile = name => /^pony-mail\/objects\/[a-f0-9]{64}\.json$/.test(name);
export function postalState(s) { deskWork(s); return s.ponyMail ??= { profile: MAIL_PROFILE, settings: [], parcels: [], events: [] }; }
const fail = (ok, why) => { if (!ok) throw new Error('Pony Post: ' + why); };
const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(v);
const address = (s, a) => a && s.chats.some(c => c.id === a.chatId && c.rootId === a.rootId) && id(a.chairId) && id(a.revision) && /^[a-f0-9]{64}$/.test(a.identity);
export function validateMail(s) {
  const w = s.ponyMail; if (!w) return;
  fail(w.profile === MAIL_PROFILE && ['settings','parcels','events'].every(k => Array.isArray(w[k])), 'invalid postal home.');
  const ids = new Set(), requests = new Set(), parcels = new Set();
  for (const row of [...w.settings, ...w.parcels, ...w.events]) { fail(id(row.id) && !ids.has(row.id) && Number.isFinite(Date.parse(row.at)), 'invalid record identity.'); ids.add(row.id); }
  for (const r of w.settings) fail(typeof r.enabled === 'boolean' && s.roots.some(root => root.id === r.rootId) && address(s, r.address) && r.address.rootId === r.rootId, 'invalid desk address.');
  for (const [i, p] of w.parcels.entries()) {
    fail(p.sequence === i + 1 && id(p.requestId) && !requests.has(p.requestId) && /^[a-f0-9]{64}$/.test(p.fingerprint) && /^[a-f0-9]{64}$/.test(p.payloadHash), 'invalid parcel identity.'); requests.add(p.requestId);
    fail(address(s, p.source) && address(s, p.destination) && address(s, p.returnAddress) && p.source.rootId !== p.destination.rootId && ['notice','request','reply'].includes(p.kind), 'invalid parcel route.');
    fail(typeof p.author?.name === 'string' && ['human','chair','host'].includes(p.author.role) && Array.isArray(p.parents) && p.parents.every(parent => parcels.has(parent)), 'invalid parcel provenance.');
    fail(p.replyTo === null || parcels.has(p.replyTo), 'reply lost its original parcel.');
    parcels.add(p.id);
  }
  for (const e of w.events) {
    fail(parcels.has(e.parcelId) && ['held','delivered','admitted','included','returned','cancelled','attention','address','retry'].includes(e.kind), 'invalid delivery record.');
    if (e.kind === 'address') fail(address(s, e.address), 'invalid corrected address.');
    if (e.kind === 'delivered') fail(s.messages.some(m => m.id === e.messageId && m.ponyParcelId === e.parcelId), 'delivery lost its message.');
    if (e.kind === 'admitted' || e.kind === 'included') fail(s.deskWork?.tasks.some(t => t.id === e.taskId && t.ponyParcelId === e.parcelId), 'delivery lost its chair task.');
  }
  for (const p of w.parcels) fail(w.events.filter(e => e.parcelId === p.id && e.kind === 'delivered').length <= 1, 'duplicate delivery.');
  for (const m of s.messages.filter(m => m.kind === 'pony')) fail(w.parcels.some(p => p.id === m.ponyParcelId) && w.events.some(e => e.parcelId === m.ponyParcelId && e.kind === 'delivered' && e.messageId === m.id), 'orphan postal message.');
}
export function preserveMail(before, after) {
  if (!before.ponyMail) return;
  for (const key of ['settings','parcels','events']) fail(after.ponyMail?.[key]?.length >= before.ponyMail[key].length && before.ponyMail[key].every((r, i) => digest(r) === digest(after.ponyMail[key][i])), 'saved mail cannot be rewritten.');
}
