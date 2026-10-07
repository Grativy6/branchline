import { assertModelAvailable } from './model-archives.mjs';
import crypto from 'node:crypto';
import { digest } from './integrity.mjs';
import { resolvedCoat } from '../public/harness-catalog.js';
import { dreamHistory, emptyDreamHistory, dreamOwner, personalDreams, dreamNote } from '../public/dream-records.js';

const fail = (ok, why) => { if (!ok) throw new Error('Dream history: ' + why); };
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys) => object(v) && Object.keys(v).every(k => keys.includes(k));
const text = (v, max = 200) => typeof v === 'string' && v.length <= max && !v.includes('\0');
const ref = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(v);
const date = v => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const uid = prefix => prefix + '_' + crypto.randomUUID();
const at = () => new Date().toISOString();
const person = (s, id) => { const p = s.personalParticipants?.find(p => p.id === id); fail(p, 'Personal model not found.'); return p; };
const log = s => s.dreamHistory ??= emptyDreamHistory();
const current = p => p.generations.find(g => g.id === p.currentGenerationId);
const profile = (s, id) => {
  const sel = s.agentProfiles?.selections.findLast(x => x.personalId === id);
  return sel ? { profileId: sel.profileId, paths: sel.paths } : null;
};
export const dreamRevision = s => digest({ history: dreamHistory(s), personal: s.personalParticipants ?? [], models: s.models,
  assignments: s.chats.map(c => [c.id, c.table?.assignments, c.coatChoices,c.coatPolicy,c.coatStarter,c.coatDefault,c.harnessSelections].map(v=>v??null)), profiles: s.agentProfiles ?? null, coats: s.coatUsuals ?? [] });
function revision(s, p) { fail(hash(p.baseRevision) && p.baseRevision === dreamRevision(s), 'The model or history changed. Refresh before saving; your text can be kept.'); }
function owner(s, id) { const p = person(s, id); fail(dreamOwner(s, id) === id, 'Open this entry through its continuing personal model.'); return p; }

export function originFor(s, id) {
  const p = person(s, id), saved = dreamHistory(s).origins.findLast(r => r.personalId === id);
  if (saved) return saved;
  const g = p.generations[0];
  return { id: null, personalId: id, baseModel: g.baseIdentity, baseRevision: g.baseRevision ?? '', adapterStatus: 'unknown',
    adapterIdentifier: '', adapterDigest: null, evidence: 'Original Personal registration. Earlier training was not recorded.',
    claimedStartedAt: null, at: p.createdAt, standing: 'user_declared' };
}
function sourceRecord(s, value) {
  fail(exact(value, ['chatId', 'messageId']) && ref(value.chatId) && ref(value.messageId), 'Choose a recorded conversation and its cutoff message.');
  const chat = s.chats.find(c => c.id === value.chatId), message = s.messages.find(m => m.id === value.messageId && m.chatId === value.chatId);
  fail(chat && message, 'Conversation source unavailable.');
  return { chatId: chat.id, messageId: message.id, messageHash: digest(message), title: chat.title,
    desk: s.roots.find(r => r.id === chat.rootId)?.name ?? 'Desk', scope: 'conversation_through_cutoff' };
}
function newGeneration(s, p, modelId) {
  if (modelId === null) return null;
  const model = s.models.find(m => m.id === modelId);
  fail(model && model.runtime !== 'codex', 'Choose an existing local model connection.');
  const baseline = current(p);
  const generation = { id: uid('generation'), createdAt: at(), baseIdentity: model.model === baseline.modelIdentifier ? baseline.baseIdentity : model.model, baseRevision: model.model === baseline.modelIdentifier ? baseline.baseRevision ?? null : null,
    manifestHash: null, adapter: null, sourceStanding: 'user_declared', modelIdentifier: model.model };
  p.generations.push(generation);
  return generation.id;
}
export function organizationPreview(s, p) {
  fail(exact(p, ['personalId', 'members', 'evidence', 'baseRevision']), 'Unexpected organization fields.');
  revision(s, p); const target = owner(s, p.personalId);
  fail(Array.isArray(p.members) && p.members.length > 0 && p.members.length <= 40 && new Set(p.members).size === p.members.length, 'Select up to 40 distinct existing entries.');
  fail(text(p.evidence, 8000) && p.evidence.trim(), 'Describe why these entries belong to the same personal model.');
  const members = p.members.map(id => owner(s, id));
  fail(!p.members.includes(target.id), 'The continuing model cannot also be an earlier entry.');
  const conflicts = [];
  for (const m of members) {
    if (dreamHistory(s).links.some(l => l.ownerId === m.id && dreamOwner(s, l.memberId) === m.id)) conflicts.push(`${m.nickname || m.name} already has organized entries. Unlink them first.`);
    if (digest(profile(s, m.id)) !== digest(profile(s, target.id))) conflicts.push(`${m.nickname || m.name} has a different Agent profile. Align that choice before organizing.`);
    if (personalDreams(s, m.id).length) conflicts.push(`${m.nickname || m.name} already has its own Dream journal. Keep it separate or export and review those records first.`);
  }
  const chats = s.chats.filter(c => p.members.includes(c.table?.assignments.at(-1)?.personalId));
  return { personalId: target.id, members: members.map(m => ({ id: m.id, name: m.nickname || m.name })),
    currentModel: s.models.find(m => m.id === target.connections.at(-1).modelId)?.name, affected: chats.map(c => ({ id: c.id, title: c.title })), conflicts, revision: dreamRevision(s) };
}
export function applyDreamCommand(s, type, p) {
  revision(s, p);
  const who = owner(s, p.personalId);
  if (type === 'dream.origin') {
    fail(exact(p, ['personalId', 'baseRevision', 'origin']), 'Unexpected origin fields.');
    const o = p.origin;
    fail(exact(o, ['baseModel','baseRevision','adapterStatus','adapterIdentifier','adapterDigest','evidence','claimedStartedAt']), 'Unexpected origin detail.');
    fail(text(o.baseModel,500) && o.baseModel.trim() && text(o.baseRevision,200) && ['unknown','none','recorded'].includes(o.adapterStatus)
      && text(o.adapterIdentifier,500) && (o.adapterDigest === null || hash(o.adapterDigest)) && text(o.evidence,8000)
      && (o.claimedStartedAt === null || date(o.claimedStartedAt)), 'Invalid starting-point information.');
    fail(o.adapterStatus === 'recorded' ? !!o.adapterIdentifier.trim() : o.adapterIdentifier === '' && o.adapterDigest === null, 'Only a recorded adapter can have an identifier or digest.');
    log(s).origins.push({ ...structuredClone(o), id: uid('origin'), personalId: who.id, at: at(), standing:'user_declared' });
  } else if (type === 'dream.record') {
    fail(exact(p, ['personalId','baseRevision','topic','occurredAt','summary','observations','outcome','modelId','sources']), 'Unexpected Dream fields.');
    fail(text(p.topic,200) && text(p.summary,16000) && text(p.observations,16000) && (p.occurredAt === null || date(p.occurredAt))
      && ['applied','kept','failed','unadopted','unrecorded'].includes(p.outcome) && (p.modelId === null || ref(p.modelId))
      && Array.isArray(p.sources) && p.sources.length <= 32, 'Invalid Dream account.');
    const generationId = newGeneration(s, who, p.modelId);
    log(s).records.push({ id:uid('dream'), personalId:who.id, at:at(), occurredAt:p.occurredAt, topic:p.topic.trim(), summary:p.summary,
      observations:p.observations, outcome:p.outcome, standing:'user_declared', generationId, modelId:p.modelId,
      modelSnapshot:p.modelId ? structuredClone(s.models.find(m=>m.id===p.modelId)) : null,
      sources:p.sources.map(v=>sourceRecord(s,v)), legacyPersonalId:null });
  } else if (type === 'dream.note') {
    fail(exact(p,['personalId','baseRevision','dreamId','text','baseNoteId']) && text(p.text,64000), 'Invalid personal note.');
    fail(personalDreams(s,who.id).some(r=>r.id===p.dreamId), 'Dream does not belong to this personal model.');
    fail((dreamNote(s,p.dreamId)?.id ?? null) === p.baseNoteId, 'This note changed. Keep your text and refresh.');
    log(s).notes.push({id:uid('dreamnote'),dreamId:p.dreamId,personalId:who.id,at:at(),text:p.text,author:'user'});
  } else if (type === 'dream.organize') {
    const preview=organizationPreview(s,p); fail(!preview.conflicts.length,preview.conflicts.join(' '));
    for(const memberId of p.members) {
      const member=person(s,memberId), old=current(member), model=s.models.find(m=>m.id===member.connections.at(-1).modelId);
      const generation={...structuredClone(old),id:uid('generation'),createdAt:at()}; who.generations.push(generation);
      log(s).records.push({id:uid('dream'),personalId:who.id,at:at(),occurredAt:null,topic:member.nickname||member.name,
        summary:'Earlier registered model connection, organized by you. Training details were not recorded.',observations:p.evidence,
        outcome:'unrecorded',standing:'user_declared',generationId:generation.id,modelId:model.id,modelSnapshot:structuredClone(model),sources:[],legacyPersonalId:memberId});
      const bindings=[];
      for(const chat of s.chats.filter(c=>c.table?.assignments.at(-1)?.personalId===memberId)) {
        const prior=chat.table.assignments.at(-1), coat=resolvedCoat(s,chat,'personal').ref;
        const assignment={...prior,id:uid('seats'),createdAt:at(),personalId:who.id};chat.table.assignments.push(assignment);
        if(chat.coatPolicy===2) (chat.coatChoices??=[]).push({id:uid('coat'),at:at(),key:'personal:'+who.id,mode:'override',ref:structuredClone(coat)});
        bindings.push({chatId:chat.id,beforeId:prior.id,afterId:assignment.id});
      }
      log(s).links.push({id:uid('dreamlink'),at:at(),ownerId:who.id,memberId,evidence:p.evidence,bindings});
    }
  } else if (type === 'dream.unlink') {
    fail(exact(p,['personalId','baseRevision','memberId','evidence']) && text(p.evidence,8000) && p.evidence.trim(), 'Give a reason for correcting this association.');
    const prior=dreamHistory(s).links.findLast(l=>l.memberId===p.memberId);
    fail(prior?.ownerId===who.id, 'This entry is not linked to that personal model.');
    // Correct membership prospectively. Later user chair choices are never undone.
    const bindings=[];
    for(const b of prior.bindings) {
      const chat=s.chats.find(c=>c.id===b.chatId), active=chat?.table?.assignments.at(-1);
      if(active?.id!==b.afterId) continue;
      const assignment={...active,id:uid('seats'),createdAt:at(),personalId:p.memberId};chat.table.assignments.push(assignment);
      bindings.push({chatId:chat.id,beforeId:active.id,afterId:assignment.id});
    }
    log(s).links.push({id:uid('dreamlink'),at:at(),ownerId:null,memberId:p.memberId,evidence:p.evidence,bindings});
  } else throw new Error('Unknown Dream command.');
  return s;
}

export function restoreTarget(s, p) {
  fail(exact(p,['personalId','dreamId','baseRevision']), 'Unexpected restore request.'); revision(s,p);
  const who=owner(s,p.personalId), record=personalDreams(s,who.id).find(r=>r.id===p.dreamId);
  fail(record?.generationId && record.modelId, 'This is a history record without a saved model connection.');
  const model=s.models.find(m=>m.id===record.modelId);
  fail(model && digest(model)===digest(record.modelSnapshot), 'The saved model connection has changed or is unavailable.');
  assertModelAvailable(s,model.id);
  const generation=who.generations.find(g=>g.id===record.generationId);
  fail(generation && generation.modelIdentifier===model.model, 'The saved state and connection disagree.');
  return {who,record,model,generation};
}
export function applyDreamRestore(s, p, checked) {
  const {who,record,model,generation}=restoreTarget(s,p);
  fail(checked?.kind==='bundled_files_checked' && hash(checked.manifestHash) && model.runtime==='bundled', 'This checkpoint has no supported verified restore route.');
  const fromGenerationId=who.currentGenerationId,fromConnectionId=who.connections.at(-1).id;
  const connection={id:uid('connection'),modelId:model.id,createdAt:at()};who.connections.push(connection);who.currentGenerationId=generation.id;
  log(s).transitions.push({id:uid('dreamrestore'),at:at(),personalId:who.id,dreamId:record.id,fromGenerationId,fromConnectionId,
    toGenerationId:generation.id,toConnectionId:connection.id,modelSnapshot:structuredClone(model),checked:structuredClone(checked)});
  return s;
}
export function permitsDreamTransition(before, after, p) {
  const changes=dreamHistory(after).transitions.slice(dreamHistory(before).transitions.length);
  const n=after.personalParticipants.find(n=>n.id===p.id),r=changes.find(t=>t.personalId===p.id);
  return changes.length===1 && r && r.fromGenerationId===p.currentGenerationId && r.fromConnectionId===p.connections.at(-1).id
    && r.toGenerationId===n.currentGenerationId && r.toConnectionId===n.connections.at(-1).id
    && r.checked.kind==='bundled_files_checked' && r.modelSnapshot.runtime==='bundled'
    && digest(after.models.find(m=>m.id===n.connections.at(-1).modelId))===digest(r.modelSnapshot);
}
export function validateDreamHistory(s) {
  if(s.dreamHistory===undefined)return;
  const h=s.dreamHistory;fail(exact(h,['version','origins','records','notes','links','transitions'])&&h.version===1,'Unsupported history format.');
  const ids=new Set();
  for(const key of ['origins','records','notes','links','transitions']) {
    fail(Array.isArray(h[key])&&h[key].length<=50000,'Invalid or oversized history collection.');
    for(const r of h[key]) { fail(object(r)&&ref(r.id)&&!ids.has(r.id)&&date(r.at),'Invalid history record.');ids.add(r.id); }
  }
  for(const r of h.origins) {
    person(s,r.personalId);fail(r.standing==='user_declared'&&text(r.baseModel,500)&&r.baseModel.trim()&&text(r.baseRevision,200)
      &&['none','unknown','recorded'].includes(r.adapterStatus)&&text(r.adapterIdentifier,500)&&(r.adapterDigest===null||hash(r.adapterDigest))
      &&text(r.evidence,8000)&&(r.claimedStartedAt===null||date(r.claimedStartedAt)), 'Invalid origin record.');
    fail(r.adapterStatus==='recorded'?!!r.adapterIdentifier.trim():r.adapterIdentifier===''&&r.adapterDigest===null,'Origin adapter information is inconsistent.');
  }
  for(const r of h.records) {
    const who=person(s,r.personalId);
    fail(text(r.topic,200)&&text(r.summary,16000)&&text(r.observations,16000)&&r.standing==='user_declared'
      &&['applied','kept','failed','unadopted','unrecorded'].includes(r.outcome)&&(r.occurredAt===null||date(r.occurredAt))
      &&Array.isArray(r.sources)&&r.sources.length<=32&&(r.legacyPersonalId===null||s.personalParticipants.some(p=>p.id===r.legacyPersonalId)), 'Invalid Dream record.');
    fail(r.generationId===null ? r.modelId===null&&r.modelSnapshot===null : who.generations.some(g=>g.id===r.generationId&&g.modelIdentifier===r.modelSnapshot?.model)&&r.modelSnapshot.id===r.modelId,'Dream checkpoint binding is missing.');
    for(const source of r.sources)fail(ref(source.chatId)&&ref(source.messageId)&&hash(source.messageHash)&&text(source.title,200)&&text(source.desk,200)&&source.scope==='conversation_through_cutoff','Invalid Dream source.');
  }
  for(const r of h.notes) fail(h.records.some(d=>d.id===r.dreamId&&d.personalId===r.personalId)&&r.author==='user'&&text(r.text,64000),'Invalid Dream note.');
  for(const r of h.links) {
    person(s,r.memberId);if(r.ownerId!==null)person(s,r.ownerId);
    fail(r.ownerId!==r.memberId&&text(r.evidence,8000)&&Array.isArray(r.bindings),'Invalid organization record.');
    for(const b of r.bindings)fail(s.chats.some(c=>c.id===b.chatId&&c.table?.assignments.some(a=>a.id===b.beforeId)&&c.table.assignments.some(a=>a.id===b.afterId)),'Missing organization chair history.');
  }
  for(const p of s.personalParticipants??[]) { const id=dreamOwner(s,p.id);fail(dreamOwner(s,id)===id,'Nested or cyclic personal grouping.'); }
  for(const r of h.transitions) {
    const who=person(s,r.personalId),d=h.records.find(d=>d.id===r.dreamId&&d.personalId===who.id);
    fail(d&&d.generationId===r.toGenerationId&&[r.fromGenerationId,r.toGenerationId].every(id=>who.generations.some(g=>g.id===id))
      &&who.connections.some(c=>c.id===r.fromConnectionId)&&who.connections.some(c=>c.id===r.toConnectionId&&c.modelId===r.modelSnapshot?.id)
      &&r.checked?.kind==='bundled_files_checked'&&hash(r.checked.manifestHash)&&date(r.checked.at)&&r.modelSnapshot.runtime==='bundled','Invalid restore transition.');
  }
}
export function preserveDreamHistory(before, after) {
  const a=dreamHistory(before),b=dreamHistory(after);
  for(const key of ['origins','records','notes','links','transitions'])fail(b[key].length>=a[key].length&&a[key].every((r,i)=>digest(r)===digest(b[key][i])),'Earlier '+key+' cannot be rewritten.');
}
export function dreamView(s, id) {
  const who=owner(s,id), origin=originFor(s,id), records=personalDreams(s,id);
  return {personalId:id,name:who.nickname||who.name,revision:dreamRevision(s),origin,records,
    originRevisions:dreamHistory(s).origins.filter(o=>o.personalId===id),
    organizationHistory:dreamHistory(s).links.filter(l=>l.ownerId===id||records.some(r=>r.legacyPersonalId===l.memberId)),
    notes:dreamHistory(s).notes.filter(n=>n.personalId===id),transitions:dreamHistory(s).transitions.filter(t=>t.personalId===id),
    members:dreamHistory(s).links.filter(l=>l.ownerId===id&&dreamOwner(s,l.memberId)===id).filter((l,i,a)=>a.findLastIndex(v=>v.memberId===l.memberId)===i),
    currentGenerationId:who.currentGenerationId,startingGenerationId:who.generations[0].id,
    sources:records.flatMap(r=>r.sources.map(source=>{const m=s.messages.find(m=>m.id===source.messageId&&m.chatId===source.chatId),c=s.chats.find(c=>c.id===source.chatId);return {...source,available:!!m&&digest(m)===source.messageHash,archived:!!c?.archivedAt||!!s.roots.find(root=>root.id===c?.rootId)?.archivedAt};}))};
}
