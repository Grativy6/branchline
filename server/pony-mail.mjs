import {captureMaterialScope as capture,checkMaterialScope as checkCapture} from './material-scope.mjs';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { digest } from './integrity.mjs';
import { chairRoster } from '../public/chair-roster.js';
import { resolveSpeaker, lastMessageId } from './table.mjs';
import { deskEvent, liveDeskTask } from './desk-work.mjs';
import { recordImageSelection, selectedImages } from './images.mjs';
import { mailSettings, mailEvent, mailEvents, mailAddress, postalState } from './pony-mail-state.mjs';

const uid = prefix => prefix + '_' + crypto.randomUUID();
const now = () => new Date().toISOString();
const fail = (ok, why) => { if (!ok) throw new Error('Pony Post: ' + why); };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const identity = chair => digest([chair.id, chair.modelId, chair.personalId ?? null]);
function chairAt(s, a) {
  const chat = s.chats.find(c => c.id === a.chatId && c.rootId === a.rootId && !c.archivedAt);
  if (!chat || !s.roots.some(r => r.id === a.rootId && !r.archivedAt)) return null;
  const roster = chairRoster(s, chat);
  return [roster.desk, ...roster.visitors].find(c => c.id === a.chairId && c.modelId && identity(c) === a.identity) ?? null;
}
function event(s, p, kind, detail = {}) {
  const row = { id: uid('mailrecord'), at: now(), parcelId: p.id, kind, ...detail };
  postalState(s).events.push(row); return row;
}

export class PonyMail {
  constructor(store, { changed = () => {}, interval = 500 } = {}) {
    this.store = store; this.changed = changed; this.cache = new Map(); this.closed = false; this.pumping = null;
    this.timer = interval ? setInterval(() => this.kick(), interval) : null; this.timer?.unref?.();
  }
  attach(tasks, images) { this.tasks = tasks; this.images = images; }
  address(s, rootId, chatId, chairId, revision = uid('address')) {
    const chat = s.chats.find(c => c.id === chatId && c.rootId === rootId && !c.archivedAt);
    fail(chat && s.roots.some(r => r.id === rootId && !r.archivedAt), 'choose an active receiving conversation.');
    const roster = chairRoster(s, chat), chair = [roster.desk, ...roster.visitors].find(c => c.id === (chairId ?? roster.desk.id) && c.modelId);
    fail(chair, 'choose an occupied receiving chair.');
    return { rootId, chatId, chairId: chair.id, identity: identity(chair), revision };
  }
  async configure({ rootId, chatId, chairId, enabled }) {
    fail(typeof enabled === 'boolean', 'choose On or Off.');
    await this.store.transact(s => {
      const old = mailSettings(s, rootId), next = !enabled&&old?structuredClone(old.address):this.address(s, rootId, chatId ?? old?.address.chatId, chairId ?? old?.address.chairId);
      if (old && digest({ ...old.address, revision: null }) === digest({ ...next, revision: null })) next.revision = old.address.revision;
      if (old?.enabled === enabled && digest(old.address) === digest(next)) return s;
      postalState(s).settings.push({ id: uid('mailsetting'), at: now(), rootId, enabled, address: next }); return s;
    }); this.changed(); this.kick(); return { saved: true };
  }
  payload(s, id) {
    const p = s.ponyMail?.parcels.find(p => p.id === id); fail(p, 'parcel not found.');
    if (!this.cache.has(p.payloadHash)) {
      const bytes = readFileSync(path.join(this.store.dataDir, 'pony-mail', 'objects', p.payloadHash + '.json'));
      fail(bytes.length <= 2 * 1024 * 1024 && hash(bytes) === p.payloadHash, 'saved parcel failed its content check.');
      const value = JSON.parse(bytes); fail(value.profile === 'branchline.pony-payload/1' && typeof value.text === 'string' && Array.isArray(value.sources), 'invalid saved parcel.');
      if (this.cache.size >= 32) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(p.payloadHash, value);
    }
    return structuredClone(this.cache.get(p.payloadHash));
  }
  async savePayload(value) {
    const bytes = Buffer.from(JSON.stringify({ profile: 'branchline.pony-payload/1', ...value }));
    fail(bytes.length <= 2 * 1024 * 1024, 'this parcel is too large.');
    const sha = hash(bytes), folder = path.join(this.store.dataDir, 'pony-mail', 'objects');
    await fs.mkdir(folder, { recursive: true });
    let handle;
    try { handle = await fs.open(path.join(folder, sha + '.json'), 'wx'); await handle.writeFile(bytes); await handle.sync(); }
    catch (error) { if (error.code !== 'EEXIST') throw error; fail(hash(await fs.readFile(path.join(folder, sha + '.json'))) === sha, 'existing parcel bytes differ.'); }
    finally { await handle?.close(); }
    return sha;
  }
  assertParcel(s, p, model, seen = new Set()) {
    if (seen.has(p.id)) return; seen.add(p.id);
    for (const src of this.payload(s, p.id).sources) checkCapture(s, src, model, this.store);
    for (const id of p.parents) { const parent = s.ponyMail.parcels.find(r => r.id === id); fail(parent, 'parcel source is missing.'); this.assertParcel(s, parent, model, seen); }
  }
  assertDisclosure(s, chatId, model) {
    const rootId = s.chats.find(c => c.id === chatId)?.rootId, seen = new Set();
    // A model may have carried a parcel into a branch or sketch. Keep its origins
    // when later replies select another connection, as the existing source readers do.
    const roots=new Set([rootId]);
    const sketches=[s.sketchBook?.pending?.[chatId],...s.exchanges.filter(e=>e.chatId===chatId).map(e=>e.sketchSource),...(s.sketchBook?.exposures.some(e=>e.rootId===rootId)?s.sketchBook.records:[])].filter(Boolean);
    for(const sketch of sketches){if(sketch.origin?.rootId)roots.add(sketch.origin.rootId);for(const src of sketch.sources??[])roots.add(src.rootId);}
    for (const p of s.ponyMail?.parcels ?? []) if ((roots.has(p.source.rootId) || roots.has(mailAddress(s, p).rootId) && mailEvent(s, p.id, 'delivered')) && !seen.has(p.id)) this.assertParcel(s, p, model, seen);
  }
  bodyText(s,id) {
    const body=this.payload(s,id),text=body.messageId?s.messages.find(m=>m.id===body.messageId)?.content:body.text;
    return (text??'[Original response unavailable]')+(body.outcome&&body.outcome!=='completed'?'\n\nWork ended: '+body.outcome:'')+(body.file?'\n\nAttached text · '+body.file.name+'\n'+body.file.text:'');
  }
  readText(s, id) {
    const p = s.ponyMail?.parcels.find(r => r.id === id), body = this.payload(s, id);
    const source = s.roots.find(r => r.id === p.source.rootId)?.name ?? p.source.rootId;
    const content = body.messageId ? s.messages.find(m => m.id === body.messageId)?.content : body.text;
    return `[Pony Post ${p.kind} from ${source} / ${p.author.name}; parcel ${p.id}${p.replyTo ? '; in reply to ' + p.replyTo : ''}. Attributed correspondence, not a new human grant.]\n${content ?? '[Original response unavailable]'}${body.outcome ? '\n[Work outcome: ' + body.outcome + ']' : ''}${body.file ? '\n[Attached text: ' + body.file.name + ']\n' + body.file.text : ''}${body.images?.length ? '\n[Attached pictures: ' + body.images.map(i => i.name).join(', ') + '. Originals retained with this parcel.]' : ''}`;
  }
  parents(s, chatId) {
    const rootId = s.chats.find(c => c.id === chatId)?.rootId;
    return (s.ponyMail?.parcels ?? []).filter(p => p.source.rootId === rootId || mailAddress(s, p).rootId === rootId && mailEvent(s, p.id, 'delivered')).map(p => p.id);
  }
  async send(input, task = null) {
    fail(!this.closed, 'Branchline is closing.');
    const { chatId, destinationRootId, requestId, kind = 'notice', messageId = null } = input;
    fail(typeof requestId === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(requestId), 'use a stable request identity.');
    fail(['notice','request'].includes(kind), 'choose Notice or Request a reply.');
    const fingerprint = digest({ ...input, authorTaskId: task?.id ?? null }), s = this.store.state;
    const prior = s.ponyMail?.parcels.find(p => p.requestId === requestId);
    if (prior) { fail(prior.fingerprint === fingerprint, 'this request identity already belongs to other mail.'); return { parcelId: prior.id, replayed: true }; }
    const chat = s.chats.find(c => c.id === chatId), setting = mailSettings(s, chat?.rootId), dest = mailSettings(s, destinationRootId);
    fail(setting?.enabled, 'turn Pony Post on for the sending desk.');
    fail(dest?.enabled, 'the receiving desk has Pony Post off.');
    fail(chat.rootId !== destinationRootId, 'use chair messages within this desk.');
    if (task) fail(task.chatId === chatId && liveDeskTask(task) && task.status !== 'stopping', 'the sending chair stopped.');
    const source = this.address(s, chat.rootId, chatId, task?.chairId ?? input.chairId, setting.address.revision);
    const original = messageId ? s.messages.find(m => m.id === messageId && m.chatId === chatId) ?? s.deskWork?.batches.filter(b=>b.chatId===chatId).map(b=>({id:b.id,chatId:b.chatId,content:b.original,selectedImages:b.selectedImages})).find(b=>b.id===messageId) : null;
    fail(!messageId || original, 'the selected original is unavailable.');
    const text = input.text ?? (original?.kind === 'pony' ? this.readText(s, original.ponyParcelId) : original?.content);
    fail(typeof text === 'string' && text.trim() && text.length <= 100000, 'write a message of at most 100,000 characters.');
    const turn = original?.exchangeId && s.exchanges.find(e => e.id === original.exchangeId);
    const images = input.attachPictures === true ? selectedImages(s,chatId,turn?.selectedImages ?? original?.selectedImages ?? []).map(({id,chatId,createdAt,receiptId,...snapshot})=>structuredClone(snapshot)) : [];
    const file = input.attachText === true && turn?.selectedFile ? structuredClone(turn.selectedFile) : null;
    const payloadHash = await this.savePayload({ text, sources: task || original || input.derived === true ? [capture(s, chatId)] : [], images, file, originalMessageId: messageId });
    let parcel;
    await this.store.transact(next => {
      const duplicate = next.ponyMail?.parcels.find(p => p.requestId === requestId);
      if (duplicate) { fail(duplicate.fingerprint === fingerprint, 'request identity changed.'); parcel = duplicate; return next; }
      if(task)fail(next.deskWork?.tasks.some(t=>t.id===task.id&&liveDeskTask(t)&&t.status!=='stopping'),'the sending chair stopped before Send.');
      fail(!this.closed && mailSettings(next, source.rootId)?.enabled && mailSettings(next, destinationRootId)?.enabled, 'one of these desks switched off before Send.');
      fail(digest(mailSettings(next, destinationRootId).address) === digest(dest.address) && chairAt(next, source), 'an address changed before Send.');
      const w = postalState(next);
      parcel = { id: uid('parcel'), at: now(), sequence: w.parcels.length + 1, requestId, fingerprint, source, destination: structuredClone(dest.address), returnAddress: source,
        author: task ? { role: 'chair', name: task.label, taskId: task.id, model: task.model.model } : { role: 'human', name: 'You' }, kind, replyTo: null, parents: task || original || input.derived === true ? this.parents(s, chatId) : [], payloadHash };
      w.parcels.push(parcel); return next;
    }); this.changed(); this.kick(); return { parcelId: parcel.id, queued: true, delivered: false };
  }
  reason(s, p) {
    const a = mailAddress(s, p), source = mailSettings(s, p.source.rootId), dest = mailSettings(s, a.rootId);
    if (!source?.enabled) return 'Sending desk has Pony Post off';
    if (!dest?.enabled) return 'Receiving desk has Pony Post off';
    if (dest.address.revision !== a.revision || !chairAt(s, a)) return 'Receiving address changed; choose where this parcel should go';
    if (!s.roots.some(r => r.id === p.source.rootId && !r.archivedAt)) return 'Sending desk is archived';
    return null;
  }
  busy(task) {
    if (!task.ponyParcelId) return null;
    const s = this.store.state, p = s.ponyMail?.parcels.find(p => p.id === task.ponyParcelId);
    if (!p || mailEvent(s, p.id, 'cancelled')) return 'Pony request cancelled';
    const why = this.reason(s, p); if (why) return why;
    try { this.assertParcel(s, p, task.model); } catch (error) { return error.message; }
    return null;
  }
  async mark(p, kind, detail) {
    await this.store.transact(s => { const last = mailEvents(s, p.id).at(-1); if (!last || last.kind !== kind || digest(Object.fromEntries(Object.entries(last).filter(([k]) => !['id','at','parcelId','kind'].includes(k)))) !== digest(detail ?? {})) event(s, p, kind, detail); return s; });
    this.changed();
  }
  async cancel(id) {
    const p = this.store.state.ponyMail?.parcels.find(p => p.id === id); fail(p, 'parcel not found.');
    if (!mailEvent(this.store.state, id, 'cancelled')) await this.mark(p, 'cancelled', { reason: 'Stopped by the human' });
    for (const task of this.store.state.deskWork?.tasks ?? []) if (task.ponyParcelId === id && liveDeskTask(task)) await this.tasks.cancel(task.id, { pauseChair: false });
    return { cancelled: true };
  }
  async stopAll(chatId = null) {
    for (const p of this.store.state.ponyMail?.parcels ?? []) if (p.kind === 'request' && (!chatId || p.source.chatId === chatId || mailAddress(this.store.state, p).chatId === chatId) && !mailEvent(this.store.state, p.id, 'returned') && !mailEvent(this.store.state, p.id, 'cancelled')) await this.cancel(p.id);
  }
  async correct(id) {
    const s=this.store.state,p=s.ponyMail?.parcels.find(p=>p.id===id);fail(p&&!mailEvent(s,id,'cancelled'),'choose waiting mail.');
    const address=mailSettings(s,p.destination.rootId)?.address;fail(address&&chairAt(s,address),'save the receiving desk’s address first.');
    const tasks=s.deskWork?.tasks.filter(t=>t.ponyParcelId===id)??[];
    fail(!tasks.some(t=>t.startedAt),'Work already began at the recorded address; send a new parcel to redirect it.');
    if(mailEvent(s,id,'delivered'))fail(p.kind==='request','This notice was already delivered.');
    for(const task of tasks)if(liveDeskTask(task))await this.tasks.cancel(task.id,{pauseChair:false});
    await this.store.transact(next=>{event(next,p,'address',{address:structuredClone(address)});if(tasks.length)event(next,p,'retry',{attempt:tasks.length+1,reason:'Explicit receiving-address correction'});return next;});
    this.changed();this.kick();return {saved:true};
  }
  async retry(id) {
    const s = this.store.state, p = s.ponyMail?.parcels.find(p => p.id === id), tasks = s.deskWork?.tasks.filter(t => t.ponyParcelId === id) ?? [];
    fail(p?.kind === 'request' && !mailEvent(s, id, 'cancelled') && tasks.length && tasks.every(t => !liveDeskTask(t)), 'choose a finished request to retry explicitly.');
    await this.mark(p, 'retry', { attempt: tasks.length + 1 }); this.kick(); return { queued: true };
  }
  async returnTask(p, task) {
    const requestId = 'return_' + task.id;
    if (this.store.state.ponyMail.parcels.some(p => p.requestId === requestId)) return;
    const s = this.store.state, message = s.messages.findLast(m => m.exchangeId === task.exchangeId && m.role === 'assistant');
    const payloadHash = await this.savePayload({ text: message ? '' : task.error ?? 'No saved reply was produced.', messageId: message?.id ?? null, outcome: task.status, sources: [capture(s, task.chatId)], images: [], file: null });
    await this.store.transact(next => {
      if (next.ponyMail.parcels.some(p => p.requestId === requestId)) return next;
      const w = postalState(next), destination = structuredClone(p.returnAddress), source = structuredClone(mailAddress(next, p));
      const reply = { id: uid('parcel'), at: now(), sequence: w.parcels.length + 1, requestId, fingerprint: digest([p.id, task.id]), source, destination, returnAddress: source,
        author: { role: message ? 'chair' : 'host', name: task.label, taskId: task.id, model: task.model.model }, kind: 'reply', replyTo: p.id, parents: [...new Set([p.id, ...this.parents(next, task.chatId)])], payloadHash };
      w.parcels.push(reply); event(next, p, 'returned', { taskId: task.id, replyId: reply.id, outcome: task.status, late: !!mailEvent(next, p.id, 'cancelled') }); return next;
    }); this.changed();
  }
  async deliver(p) {
    await this.store.transact(s => {
      if (mailEvent(s, p.id, 'delivered') || mailEvent(s, p.id, 'cancelled')) return s;
      fail(!this.closed && !this.reason(s, p), this.reason(s, p) ?? 'Branchline is closing.');
      const a = mailAddress(s, p), roster = chairRoster(s, s.chats.find(c => c.id === a.chatId)), resolved = resolveSpeaker(s, a.chatId, a.chairId === roster.desk.id ? 'personal' : 'visiting', a.chairId);
      this.assertParcel(s, p, resolved.model); const payload=this.payload(s,p.id);
      const pictureIds=(payload.images??[]).map(snapshot=>recordImageSelection(s,a.chatId,snapshot,{activate:false,parcelId:p.id}).id);
      const messageId = uid('message');
      s.messages.push({ id: messageId, chatId: a.chatId, role: 'user', kind: 'pony', exchangeId:null, modelId:null,modelLabel:null,modelIdentifier:null,modelBaseUrl:null,instructionRevisionId:null, ponyParcelId: p.id, content: `Pony Post · ${s.roots.find(r=>r.id===p.source.rootId)?.name??'Desk'} · ${p.author.name}`, createdAt: now() });
      event(s, p, 'delivered', { messageId, chatId: a.chatId, chairId: a.chairId, pictureIds });
      if (p.replyTo) {
        const origin = s.ponyMail.parcels.find(r => r.id === p.replyTo), authorTask = s.deskWork?.tasks.find(t => t.id === origin.author.taskId);
        if (authorTask) deskEvent(s, authorTask, 'pony.returned', { parcelId: origin.id, replyId: p.id, messageId });
      }
      return s;
    }); this.changed();
  }
  kick() {
    if (this.closed || this.pumping || !this.tasks) return;
    this.pumping = this.pump().catch(error => { this.lastError = error.message; }).finally(() => { this.pumping = null; });
  }
  async pump() {
    for (const p of [...(this.store.state.ponyMail?.parcels ?? [])]) {
      if (this.closed) return;
      const tasks = this.store.state.deskWork?.tasks.filter(t => t.ponyParcelId === p.id) ?? [];
      for (const t of tasks) {
        if (t.exchangeId && !mailEvents(this.store.state, p.id).some(e => e.kind === 'included' && e.taskId === t.id)) await this.mark(p, 'included', { taskId: t.id, exchangeId: t.exchangeId });
        if (!liveDeskTask(t)) await this.returnTask(p, t);
      }
      if (mailEvent(this.store.state, p.id, 'cancelled')) continue;
      try {
        if (!mailEvent(this.store.state, p.id, 'delivered')) {
          const reason = this.reason(this.store.state, p);
          if (reason) { if (mailEvents(this.store.state, p.id).at(-1)?.reason !== reason) await this.mark(p, 'held', { reason }); continue; }
          await this.deliver(p);
        }
        if (p.kind !== 'request') continue;
        const attempt = mailEvent(this.store.state, p.id, 'retry')?.attempt ?? 1;
        if (tasks.length >= attempt) continue;
        const why = this.reason(this.store.state, p); if (why) { if (mailEvents(this.store.state, p.id).at(-1)?.reason !== why) await this.mark(p, 'held', { reason: why }); continue; }
        const s = this.store.state, a = mailAddress(s, p), chat = s.chats.find(c => c.id === a.chatId), roster = chairRoster(s, chat);
        const resolved=resolveSpeaker(s,a.chatId,a.chairId===roster.desk.id?'personal':'visiting',a.chairId);
        const ids=mailEvent(s,p.id,'delivered')?.pictureIds??[];
        const media=ids.length?await this.images.postal(s,a.chatId,ids,resolved):null;
        const toolsEnabled=s.deskWork?.tasks.findLast(t=>t.chatId===a.chatId&&t.chairId===a.chairId&&!t.ponyParcelId)?.input.toolsEnabled??true;
        const result = await this.tasks.admit({ chatId: a.chatId, chairId: a.chairId, content: `Respond to Pony Post parcel ${p.id} using your own chair and capabilities.`, kind: 'ask', requestId: `pony_${p.id}_${attempt}`, baseRevisionId: roster.revisionId, lastMessageId: lastMessageId(s, a.chatId), toolsEnabled }, null, { literal: true, postal: { parcelId: p.id, attempt, media } });
        await this.mark(p, 'admitted', { taskId: result.taskIds[0], attempt });
      } catch (error) {
        if (this.store.writeFault || this.closed) throw error;
        if (mailEvents(this.store.state, p.id).at(-1)?.reason !== error.message) await this.mark(p, 'held', { reason: error.message });
      }
    }
  }
  async call(task, name, args, callId) {
    const s = this.store.state;
    if (name === 'list_pony_desks') return { desks: s.roots.filter(r => !r.archivedAt && r.id !== task.rootId).map(r => ({ id: r.id, name: r.name, enabled: mailSettings(s, r.id)?.enabled === true })), yourDeskEnabled: mailSettings(s, task.rootId)?.enabled === true };
    if (name === 'send_pony') return this.send({ chatId: task.chatId, destinationRootId: args.desk_id, text: args.text, kind: args.request_reply ? 'request' : 'notice', requestId: 'ponycall_' + digest([task.id, callId ?? args]).slice(0,48) }, task);
    const visible = (s.ponyMail?.parcels ?? []).filter(p => p.source.rootId === task.rootId || mailAddress(s, p).rootId === task.rootId && mailEvent(s, p.id, 'delivered'));
    if (!args.parcel_id) { const offset=Number.isSafeInteger(args.offset)&&args.offset>=0?args.offset:0;return {parcels:visible.reverse().slice(offset,offset+40).map(p=>({id:p.id,kind:p.kind,replyTo:p.replyTo,status:this.status(s,p)})),nextOffset:offset+40<visible.length?offset+40:null}; }
    const p = visible.find(p => p.id === args.parcel_id); fail(p, 'this parcel is not in your desk’s sent or delivered mail.'); this.assertParcel(s, p, task.model);
    const text = this.readText(s, p.id), offset = Number.isSafeInteger(args.offset) && args.offset >= 0 ? args.offset : 0;
    return { parcelId: p.id, status: this.status(s, p), text: text.slice(offset, offset + 16000), nextOffset: offset + 16000 < text.length ? offset + 16000 : null, records: mailEvents(s, p.id) };
  }
  status(s, p) {
    if (mailEvent(s, p.id, 'cancelled')) return 'cancelled';
    const tasks = s.deskWork?.tasks.filter(t => t.ponyParcelId === p.id) ?? [], live = tasks.find(liveDeskTask);
    if (live) return live.phase;
    if (tasks.length && tasks.at(-1).status !== 'completed') return 'needs attention';
    if (mailEvent(s, p.id, 'returned')) return 'replied';
    const last = mailEvents(s, p.id).at(-1);
    return last?.kind === 'held' ? 'held · ' + last.reason : mailEvent(s, p.id, 'included') ? 'included in a model turn' : mailEvent(s, p.id, 'delivered') ? 'delivered' : 'queued';
  }
  activity() {
    const s=this.store.state;
    return (s.ponyMail?.parcels??[]).filter(p=>!mailEvent(s,p.id,'cancelled')&&!mailEvent(s,p.id,'delivered')).map(p=>({id:'pony:'+p.id,sourceId:p.id,type:'pony',chatId:p.source.chatId,rootId:p.source.rootId,desk:'Pony Post',title:`${p.kind} · ${s.roots.find(r=>r.id===p.source.rootId)?.name} → ${s.roots.find(r=>r.id===p.destination.rootId)?.name}`,chair:p.author.name,status:'waiting',phase:this.status(s,p),createdAt:p.at,active:true}));
  }
  view() {
    const s = this.store.state;
    return { desks: s.roots.filter(r => !r.archivedAt).map(r => ({ id: r.id, name: r.name, setting: mailSettings(s, r.id) })),
      parcels: (s.ponyMail?.parcels ?? []).map(p => ({ ...p, status: this.status(s, p), events: mailEvents(s, p.id) })), error: this.lastError ?? null, legacy: s.ponyPost ?? null };
  }
  async close() { this.closed = true; clearInterval(this.timer); await this.pumping; this.cache.clear(); }
}
