import crypto from 'node:crypto';
import { digest } from './integrity.mjs';
import { SKETCH_PROFILE, SKETCH_STAGES, checkSketchContent, checkSketchDraft, sketchHead, sketchExcerpt, sketchDestination, sameSketchDestination } from '../public/sketch-format.js';

export { sketchDestination, sketchHead };
const uid = p => `${p}_${crypto.randomUUID()}`, now = () => new Date().toISOString();
const copy = v => structuredClone(v), same = (a,b) => digest(a) === digest(b);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(v);
const date = v => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const exact = (v,keys) => object(v) && Object.keys(v).length === keys.length && keys.every(k=>Object.hasOwn(v,k));
const fail = (ok, why) => { if (!ok) throw new Error('Sketch Book: ' + why); };
const permits = new WeakMap();
export const emptySketchBook = () => ({ profile: SKETCH_PROFILE, records: [], grants: [], pending: {}, transfers: [], exposures: [] });
const book = state => state.sketchBook ??= emptySketchBook();
export const findSketch = (state, sketchId) => state.sketchBook?.records.find(s=>s.id===sketchId) ?? null;
export function liveSketch(state, sketchId, revisionId = null, { archived = false } = {}) {
  const s = findSketch(state,sketchId);
  fail(s && !s.deletedAt && (archived || !s.archivedAt), 'That sketch is unavailable.');
  fail(revisionId === null || sketchHead(s).id === revisionId, 'This sketch changed. Reopen it; your edits are still available.');
  return s;
}
function origin(state, chatId) {
  if (chatId === null) return null;
  const chat = state.chats.find(c=>c.id===chatId), root = state.roots.find(r=>r.id===chat?.rootId);
  fail(chat && root, 'The originating conversation is unavailable.');
  return { rootId:root.id, chatId:chat.id, desk:root.name, branch:chat.title };
}
function source(state, messageId) {
  if (messageId === null) return [];
  const m = state.messages.find(m=>m.id===messageId);
  fail(m?.role === 'assistant', 'Choose a saved model reply.');
  const task = state.exchanges.find(e=>e.id===m.exchangeId) ?? state.parallel?.jobs.find(j=>j.id===m.parallelEpisodeId);
  fail(!task || task.status !== 'pending', 'Wait until the reply has been saved.');
  return [{ ...origin(state,m.chatId), messageId:m.id, exchangeId:m.exchangeId ?? m.parallelEpisodeId ?? null,
    sha256:digest(m.content), modelLabel:m.modelLabel, modelIdentifier:m.modelIdentifier, incomplete:!!m.incomplete || task?.status !== 'completed' }];
}
function revision(content, author) {
  checkSketchContent(content);
  const r = { id:uid('sketchrev'), at:now(), title:content.title.trim(), text:content.text, stage:content.stage, author };
  return { ...r, hash:digest(r) };
}
function save(state, p, author) {
  const l = book(state);
  const previous = p.id === null ? null : liveSketch(state,p.id,p.baseRevisionId);
  if (previous) {
    fail(id(p.baseRevisionId), 'An edit needs its saved revision.');
    previous.revisions.push(revision(p,author)); return previous;
  }
  fail(p.baseRevisionId === null, 'New sketches have no previous revision.');
  const sources = source(state,p.sourceMessageId ?? null);
  const location = sources[0] ? origin(state,sources[0].chatId) : origin(state,p.originChatId ?? null);
  const s = { id:uid('sketch'), createdAt:now(), origin:location, sources, revisions:[revision(p,author)], archivedAt:null, deletedAt:null, requestId:p.requestId };
  l.records.push(s); return s;
}
export function sketchCopy(state, sketchId, revisionId) {
  const s = liveSketch(state,sketchId,revisionId), r = sketchHead(s);
  return { sketchId:s.id, revisionId:r.id, title:r.title, text:r.text, stage:r.stage, origin:copy(s.origin), sources:copy(s.sources), hash:r.hash };
}
export function pendingSketchFile(state, chatId) {
  const p = state.sketchBook?.pending[chatId];
  if (!p) return null;
  return { name:`sketch-${p.sketchId}.md`, base64:Buffer.from(p.text,'utf8').toString('base64') };
}
export function sketchGrant(state, model, workspaceId) {
  return state.sketchBook?.grants.findLast(g=>g.workspaceId===workspaceId && sameSketchDestination(g.destination,sketchDestination(model))) ?? null;
}
export function assertSketchGrant(state, model, workspaceId, expectedId, mode='read') {
  const g = sketchGrant(state,model,workspaceId);
  fail(g && g.id===expectedId && (g.access==='edit' || mode==='read' && g.access==='read'), 'Sketch Book access is off or changed. Review Model access in Sketch Book.');
  return g;
}
export function applySketchCommand(state,type,p) {
  if (type==='sketch.save') {
    fail(exact(p,['id','baseRevisionId','originChatId','sourceMessageId','title','text','stage','requestId']), 'Invalid sketch fields.');
    checkSketchDraft(p);
    const duplicate=state.sketchBook?.records.find(s=>s.requestId===p.requestId);
    if (p.id===null && duplicate) { fail(same({title:sketchHead(duplicate).title,text:sketchHead(duplicate).text,stage:sketchHead(duplicate).stage},{title:p.title.trim(),text:p.text,stage:p.stage}), 'That creation request was already used.'); return; }
    if(p.id!==null)fail(p.originChatId===null&&p.sourceMessageId===null,'An edit cannot replace its original sources.');
    save(state,p,{kind:'user'}); return;
  }
  if (['sketch.archive','sketch.restore','sketch.delete'].includes(type)) {
    fail(exact(p,['id','baseRevisionId']), 'Choose one saved sketch.');
    const s=liveSketch(state,p.id,p.baseRevisionId,{archived:true});
    if(type==='sketch.delete')s.deletedAt=now();
    else {fail(type==='sketch.restore'?!!s.archivedAt:!s.archivedAt,'The archive state changed.');s.archivedAt=type==='sketch.restore'?null:now();}
    return;
  }
  if (type==='sketch.grant') {
    fail(exact(p,['modelId','destination','access','workspaceId']), 'Invalid Sketch Book permission.');
    const m=state.models.find(m=>m.id===p.modelId);
    fail(m && same(p.destination,sketchDestination(m)) && /^[a-f0-9]{32}$/.test(p.workspaceId) && ['off','read','edit'].includes(p.access),'Review the current model connection and permission.');
    book(state).grants.push({id:uid('sketchgrant'),at:now(),workspaceId:p.workspaceId,destination:sketchDestination(m),access:p.access});return;
  }
  if(type==='sketch.pending.remove') {
    fail(exact(p,['chatId','transferId']), 'Choose a selected sketch copy.');
    fail(state.sketchBook?.pending[p.chatId]?.transferId===p.transferId, 'The selected copy changed.');
    delete state.sketchBook.pending[p.chatId];return;
  }
  throw new Error('Unknown Sketch Book command.');
}
// Destination creation is supplied by the ordinary chat command in the API.
export function transferSketch(state,p,createChat) {
  fail(exact(p,['id','baseRevisionId','rootId','chatId','requestId']) && id(p.requestId), 'Invalid sketch destination.');
  let l=book(state); const prior=l.transfers.find(t=>t.id===p.requestId);
  if(prior) { fail(prior.requestHash===digest(p),'That transfer request was already used.');return prior.chatId; }
  const snapshot=sketchCopy(state,p.id,p.baseRevisionId);
  fail(snapshot.text.trim(), 'Write something in the sketch before bringing it to a conversation.');
  const root=state.roots.find(r=>r.id===p.rootId);
  fail(root && !root.archivedAt,'Choose an active desk.');
  let chat=p.chatId===null?null:state.chats.find(c=>c.id===p.chatId);
  if(p.chatId!==null)fail(chat && chat.rootId===root.id && !chat.archivedAt, 'Choose an active conversation on this desk.');
  fail(!chat || !l.pending[chat.id], 'This conversation already has a sketch attached. Remove it or choose another conversation.');
  fail(Buffer.byteLength(snapshot.text,'utf8') <= (root.resources?.fileBytes ?? 128*1024),'This desk accepts a smaller text file. Adjust Resources or choose another desk.');
  if(!chat){chat=createChat(root.id,snapshot.title);l=book(state);}
  l.pending[chat.id]={...snapshot,transferId:p.requestId};
  l.transfers.push({id:p.requestId,requestHash:digest(p),chatId:chat.id,at:now()});
  state.ui.mode=root.mode;state.ui.selected[root.mode]={rootId:root.id,chatId:chat.id};
  return chat.id;
}
export function listSketches(state,{query,archived,offset}) {
  fail(typeof query==='string'&&query.length<=200&&typeof archived==='boolean'&&Number.isSafeInteger(offset)&&offset>=0,'Invalid sketch search.');
  const q=query.toLocaleLowerCase(), matches=(state.sketchBook?.records??[]).filter(s=>!s.deletedAt && (archived||!s.archivedAt))
    .filter(s=>!q||(sketchHead(s).title+'\n'+sketchHead(s).text).toLocaleLowerCase().includes(q)).sort((a,b)=>sketchHead(b).at.localeCompare(sketchHead(a).at)||a.id.localeCompare(b.id));
  const items=matches.slice(offset,offset+12).map(s=>{const r=sketchHead(s);return{id:s.id,revision:r.id,title:r.title,stage:r.stage,archived:!!s.archivedAt,description:sketchExcerpt(r.text)};});
  return {items,nextOffset:offset+items.length<matches.length?offset+items.length:null};
}
export function readSketch(state,{id:sketchId,revision:revisionId,offset}) {
  const s=liveSketch(state,sketchId,revisionId,{archived:true}),r=sketchHead(s);
  fail(Number.isSafeInteger(offset)&&offset>=0&&offset<=r.text.length,'Invalid reading offset.');
  fail(!(offset>0&&/[\uDC00-\uDFFF]/.test(r.text[offset]??'')&&/[\uD800-\uDBFF]/.test(r.text[offset-1])),'Start at a complete Unicode character.');
  let end=Math.min(r.text.length,offset+4000);if(end<r.text.length&&/[\uD800-\uDBFF]/.test(r.text[end-1]))end--;
  return {id:s.id,revision:r.id,title:r.title,stage:r.stage,text:r.text.slice(offset,end),offset,end,nextOffset:end<r.text.length?end:null,totalCharacters:r.text.length,origin:s.origin,sources:s.sources,author:r.author,sourceRole:'project_memory_not_permission'};
}
export function writeSketchTool(state,name,p,author) {
  fail(author.kind==='model'&&id(author.exchangeId)&&id(author.chatId),'A live chat author is required.');
  if(name==='create_sketch') {
    fail(exact(p,['title','text','stage']), 'Supply title, text and stage.');
    return save(state,{...p,id:null,baseRevisionId:null,sourceMessageId:null,originChatId:author.chatId,requestId:uid('toolsketch')},author);
  }
  fail(name==='edit_sketch'&&exact(p,['id','revision','title','stage','old_text','new_text']), 'Supply the exact saved revision and text replacement.');
  const s=liveSketch(state,p.id,p.revision),r=sketchHead(s);
  fail(typeof p.old_text==='string'&&typeof p.new_text==='string','Use a text replacement.');
  let text;
  if(p.old_text==='') {fail(r.text==='','Choose a nonempty, unique passage to replace.');text=p.new_text;}
  else {const i=r.text.indexOf(p.old_text);fail(i>=0&&r.text.indexOf(p.old_text,i+1)<0,'The old passage must match exactly once. Reopen the sketch.');text=r.text.slice(0,i)+p.new_text+r.text.slice(i+p.old_text.length);}
  return save(state,{id:s.id,baseRevisionId:r.id,title:p.title,text,stage:p.stage},author);
}
export function sealSketchToolWrite(before,after,targetId) {
  const expected=copy(before);expected.sketchBook??=emptySketchBook();
  const next=after.sketchBook.records.find(s=>s.id===targetId),idx=expected.sketchBook.records.findIndex(s=>s.id===targetId);
  fail(next,'Saved sketch missing.');
  if(idx<0)expected.sketchBook.records.push(copy(next));else expected.sketchBook.records[idx]=copy(next);
  expected.handoffs=copy(after.handoffs);expected.sketchBook.exposures=copy(after.sketchBook.exposures);
  fail(same(expected,after),'Sketch write changed unrelated state.');
  permits.set(after,{before:digest(before),after:digest(after)});
}
export function recordSketchExposure(state,chatId,model,taskId) {
  const l=book(state),rootId=state.chats.find(c=>c.id===chatId)?.rootId,destination=sketchDestination(model);
  fail(rootId,'Missing source conversation.');
  if(!l.exposures.some(e=>e.rootId===rootId&&same(e.destination,destination)))l.exposures.push({id:uid('sketchexposure'),at:now(),chatId,rootId,taskId,destination});
}
export function assertSketchDisclosure(state,chatId,model,workspaceId) {
  const rootId=state.chats.find(c=>c.id===chatId)?.rootId,exposures=state.sketchBook?.exposures.filter(e=>e.rootId===rootId)??[];
  if(!exposures.length)return false;
  const destination=sketchDestination(model),g=sketchGrant(state,model,workspaceId);
  const delivered=exposures.some(e=>same(e.destination,destination)) || (state.handoffs?.records??[]).some(r=>r.kind==='context.to_model'&&r.scope.rootId===rootId&&r.detail.sketchDestination&&same(r.detail.sketchDestination,destination));
  fail(delivered||g&&g.access!=='off','This desk carries Sketch Book material. Review this model in Sketch Book → Model access before sharing it.');
  return true;
}
export function preserveSketchBook(before,after) {
  const a=before.sketchBook,b=after.sketchBook;
  if(!a&&!b)return;
  fail(b,'Saved Sketch Book was removed.');
  for(const old of a?.records??[]) {
    const current=b.records.find(s=>s.id===old.id);
    fail(current&&same({...old,revisions:[],archivedAt:null,deletedAt:null},{...current,revisions:[],archivedAt:null,deletedAt:null}),'A sketch lost its original identity.');
    fail(current.revisions.length>=old.revisions.length&&old.revisions.every((r,i)=>same(r,current.revisions[i])),'A saved sketch revision changed.');
    fail(!old.deletedAt||current.deletedAt===old.deletedAt,'A deleted sketch cannot be resurrected.');
  }
  for(const key of ['grants','transfers','exposures'])fail(b[key].length>=(a?.[key].length??0)&&(a?.[key]??[]).every((r,i)=>same(r,b[key][i])),'Saved sketch records changed.');
  for(const e of before.exchanges.filter(e=>e.sketchSource))fail(same(e.sketchSource,after.exchanges.find(n=>n.id===e.id)?.sketchSource),'A conversation lost its selected sketch version.');
  const modelRevisions=l=>(l?.records??[]).flatMap(s=>s.revisions.filter(r=>r.author.kind==='model').map(r=>({sketchId:s.id,revision:r})));
  if(!same(modelRevisions(a),modelRevisions(b))) {
    const permit=permits.get(after);fail(permit&&permit.before===digest(before)&&permit.after===digest(after),'Model edits need a live exact Sketch Book write.');permits.delete(after);
  }
}
export function validateSketchBook(state) {
  if(state.ui?.sketchDraft!==undefined)checkSketchDraft(state.ui.sketchDraft);
  const l=state.sketchBook;if(l===undefined)return;
  fail(exact(l,['profile','records','grants','pending','transfers','exposures'])&&l.profile===SKETCH_PROFILE,'Invalid saved book.');
  for(const k of ['records','grants','transfers','exposures'])fail(Array.isArray(l[k])&&new Set(l[k].map(x=>x.id)).size===l[k].length,'Duplicate sketch record.');
  fail(object(l.pending),'Invalid pending sketches.');
  for(const s of l.records) {
    fail(exact(s,['id','createdAt','origin','sources','revisions','archivedAt','deletedAt','requestId'])&&id(s.id)&&id(s.requestId)&&date(s.createdAt)&&Array.isArray(s.sources)&&Array.isArray(s.revisions)&&s.revisions.length>0,'Invalid sketch.');
    fail(s.origin===null||validOrigin(s.origin,state),'Invalid sketch origin.');
    fail(s.sources.length<=1,'Invalid sketch sources.');
    for(const src of s.sources){const m=state.messages.find(m=>m.id===src.messageId);fail(exact(src,['rootId','chatId','desk','branch','messageId','exchangeId','sha256','modelLabel','modelIdentifier','incomplete'])&&validOrigin(Object.fromEntries(['rootId','chatId','desk','branch'].map(k=>[k,src[k]])),state)&&m?.role==='assistant'&&m.chatId===src.chatId&&src.exchangeId===(m.exchangeId??m.parallelEpisodeId??null)&&src.sha256===digest(m.content)&&src.modelLabel===m.modelLabel&&src.modelIdentifier===m.modelIdentifier&&typeof src.incomplete==='boolean','Invalid saved reply source.');}
    for(const r of s.revisions) {
      fail(exact(r,['id','at','title','text','stage','author','hash'])&&id(r.id)&&date(r.at)&&r.hash===digest(Object.fromEntries(Object.entries(r).filter(([k])=>k!=='hash'))),'Invalid sketch revision.');checkSketchContent(r);
      fail(exact(r.author,['kind'])&&r.author.kind==='user'||exact(r.author,['kind','modelId','modelLabel','modelIdentifier','destination','chatId','exchangeId','callId'])&&r.author.kind==='model'&&id(r.author.modelId)&&validDestination(r.author.destination)&&r.author.destination.id===r.author.modelId&&r.author.destination.model===r.author.modelIdentifier&&typeof r.author.modelLabel==='string'&&r.author.modelLabel.length<=200&&id(r.author.chatId)&&id(r.author.exchangeId)&&typeof r.author.callId==='string'&&r.author.callId.length>0&&r.author.callId.length<=200,'Invalid sketch author.');
    }
    fail(new Set(s.revisions.map(r=>r.id)).size===s.revisions.length&&[s.archivedAt,s.deletedAt].every(d=>d===null||date(d)),'Invalid sketch status.');
  }
  for(const g of l.grants)fail(exact(g,['id','at','workspaceId','destination','access'])&&id(g.id)&&date(g.at)&&/^[a-f0-9]{32}$/.test(g.workspaceId)&&['off','read','edit'].includes(g.access)&&validDestination(g.destination),'Invalid sketch permission.');
  for(const e of l.exposures)fail(exact(e,['id','at','chatId','rootId','taskId','destination'])&&id(e.id)&&id(e.chatId)&&id(e.rootId)&&id(e.taskId)&&date(e.at)&&validDestination(e.destination)&&state.chats.some(c=>c.id===e.chatId&&c.rootId===e.rootId),'Invalid sketch disclosure.');
  for(const t of l.transfers)fail(exact(t,['id','requestHash','chatId','at'])&&id(t.id)&&/^[a-f0-9]{64}$/.test(t.requestHash)&&id(t.chatId)&&date(t.at)&&state.chats.some(c=>c.id===t.chatId),'Invalid sketch transfer.');
  for(const [chatId,p] of [...Object.entries(l.pending),...state.exchanges.filter(e=>e.sketchSource).map(e=>[e.chatId,e.sketchSource])]) {
    fail(exact(p,['sketchId','revisionId','title','text','stage','origin','sources','hash','transferId'])&&state.chats.some(c=>c.id===chatId)&&l.transfers.some(t=>t.id===p.transferId&&t.chatId===chatId),'Invalid pending sketch copy.');
    const s=findSketch(state,p.sketchId),r=s?.revisions.find(r=>r.id===p.revisionId);
    fail(r&&same({sketchId:s.id,revisionId:r.id,title:r.title,text:r.text,stage:r.stage,origin:s.origin,sources:s.sources,hash:r.hash},Object.fromEntries(Object.entries(p).filter(([k])=>k!=='transferId'))),'Selected sketch copy changed.');
  }
  for(const e of state.exchanges.filter(e=>e.sketchSource))fail(e.selectedFile?.text===e.sketchSource.text&&e.selectedFile?.name===`sketch-${e.sketchSource.sketchId}.md`,'The sent sketch and attached text differ.');
}
function validOrigin(o,state){return exact(o,['rootId','chatId','desk','branch'])&&id(o.rootId)&&id(o.chatId)&&state.chats.some(c=>c.id===o.chatId&&c.rootId===o.rootId)&&typeof o.desk==='string'&&o.desk.length<=200&&typeof o.branch==='string'&&o.branch.length<=200;}
function validDestination(d){return exact(d,['id','runtime','baseUrl','model'])&&id(d.id)&&['codex','compatible','lmstudio','bundled'].includes(d.runtime)&&typeof d.baseUrl==='string'&&d.baseUrl.length<=500&&typeof d.model==='string'&&d.model.length<=200;}
