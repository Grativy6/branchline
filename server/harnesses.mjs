import crypto from 'node:crypto';
import { digest } from './integrity.mjs';
import { defaultHarnessRef, findHarness, harnessChoice, harnessDeleted, resolvedCoat, coatIdentity, resolvedHarnessChoice } from '../public/harness-catalog.js';
import { checkHarnessContent } from '../public/harness-format.js';
import { previewHarnessImport } from './harness-files.mjs';
import { pocketContent } from '../public/coat-pockets.js';
import { retiredCoat } from '../public/legacy-coats.js';

const fail = (ok, message) => { if (!ok) throw new Error(message); };
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => keys.includes(k));
const validRef = (ref, state) => exact(ref, ['id', 'version']) && !!findHarness(ref, state);
const revision = (shared, personal, visiting, sourceDefaultId = null) => ({ id: 'harness_' + crypto.randomUUID(), createdAt: new Date().toISOString(), shared, personal: structuredClone(personal), visiting: structuredClone(visiting), sourceDefaultId });

export function inheritHarness(root, chat) {
  const saved = root.harnessDefaults?.at(-1);
  if (saved) { chat.harnessSelections = [revision(saved.shared, saved.personal, saved.visiting, saved.id)]; chat.coatDefault={personal:structuredClone(saved.personal),visiting:structuredClone(saved.visiting),selectionId:chat.harnessSelections[0].id}; }
  if(saved && (root.mode==='fs'||root.workspaceKind==='tend')) { chat.coatStarter=true; }
}

export function harnessSnapshot(state, chatId, seat = 'visiting') {
  const chat = state.chats.find(c => c.id === chatId);
  if (chat?.coatPolicy) {
    const resolved = resolvedCoat(state, chat, seat);
    const preset = findHarness(resolved.ref, state);
    fail(preset, 'The selected Coat version is unavailable.');
    return { profile:'branchline.coat-selection/2', selectionId:resolved.source, shared:false, seat, key:resolved.key, mode:resolved.mode, preset:structuredClone(preset), hash:digest(preset), role:'response_guidance_only' };
  }
  const choice = harnessChoice(chat);
  const preset = findHarness(choice[seat === 'personal' ? 'personal' : 'visiting'], state);
  fail(preset, 'The selected Coat version is unavailable.');
  return { selectionId: choice.id, shared: choice.shared, seat, preset: structuredClone(preset), hash: digest(preset), role: 'response_guidance_only' };
}

export function applyHarnessCommand(state, type, p) {
  migrateCoats(state);
  if (type === 'harness.usual' || type === 'harness.branch') return selectCoat(state,type,p);
  if (type === 'harness.create' || type === 'harness.revise') return saveCustomHarness(state, type, p);
  if (type === 'harness.delete' || type === 'harness.restore') {
    fail(exact(p, ['id', 'baseVersion', 'baseDeletedAt']), 'Choose one custom Coat to delete or restore.');
    const h = state.customHarnesses?.find(h => h.id === p.id);
    fail(h && h.versions.at(-1).version === p.baseVersion && (h.deletedAt ?? null) === p.baseDeletedAt, 'This Coat changed. Reopen My Coats before trying again.');
    fail(type === 'harness.delete' ? !h.deletedAt : Boolean(h.deletedAt), 'This Coat is already in that state.');
    h.deletedAt = type === 'harness.delete' ? new Date().toISOString() : null;
    return;
  }
  fail(type === 'harness.select' && exact(p, ['chatId', 'baseRevisionId', 'baseDefaultId', 'shared', 'personal', 'visiting', 'saveAsDefault']), 'Coat selection accepts only saved Coat choices. Tools and permissions retain their own controls.');
  fail(!state.exchanges.some(e=>e.chatId===p.chatId&&e.status==='pending'), 'This branch is replying; apply its override after the reply.');
  const chat = state.chats.find(c => c.id === p.chatId), root = state.roots.find(r => r.id === chat?.rootId);
  fail(chat && root && !chat.archivedAt && !root.archivedAt, 'Choose an active branch.');
  fail((harnessChoice(chat).id ?? null) === p.baseRevisionId, 'The harness changed. Reopen its settings before saving.');
  fail(typeof p.shared === 'boolean' && validRef(p.personal, state) && validRef(p.visiting, state), 'Choose available harness versions.');
  const current = resolvedHarnessChoice(state, chat);
  for (const seat of ['personal', 'visiting']) fail(!retiredCoat(p[seat]) || digest(p[seat]) === digest(current[seat]), 'This starter Coat is retired. Existing choices stay available in their own branches.');
  for (const seat of ['personal', 'visiting']) fail(!harnessDeleted(p[seat], state) || digest(p[seat]) === digest(harnessChoice(chat)[seat]), 'Restore a deleted harness before choosing it for another chair.');
  fail(!p.shared || digest(p.personal) === digest(p.visiting), 'A shared harness must use the same version for both chairs.');
  fail(typeof p.saveAsDefault === 'boolean', 'Choose whether to save the desk default.');
  if (p.saveAsDefault) {
    fail(!harnessDeleted(p.personal, state) && !harnessDeleted(p.visiting, state), 'Restore the deleted harness before saving it as a desk default.');
    fail((root.harnessDefaults?.at(-1)?.id ?? null) === p.baseDefaultId, 'The desk default changed. Reopen the harness settings.');
    (root.harnessDefaults ??= []).push(revision(p.shared, p.personal, p.visiting));
  }
  (chat.harnessSelections ??= []).push(revision(p.shared, p.personal, p.visiting));
  for (const seat of ['personal','visiting']) (chat.coatChoices ??= []).push(coatRecord(coatIdentity(state,chat,seat),'override',p[seat]));
}

function saveCustomHarness(state, type, p) {
  const editing = type === 'harness.revise';
  fail(exact(p, editing ? ['id', 'baseVersion', 'content', 'use'] : ['content', 'importFile', 'use']), 'Harness saves accept only instructions and an explicit branch selection.');
  checkHarnessContent(p.content);
  const library = state.customHarnesses ??= [];
  let harness = editing ? library.find(h => h.id === p.id) : null;
  if (editing) fail(harness && harness.versions.at(-1).version === p.baseVersion, 'This Coat changed. Keep your draft and reopen the latest version before saving.');
  if (editing) fail(!harness.deletedAt, 'This Coat was deleted. Restore it before saving an edit. Your draft can be kept.');
  let source = null;
  if (p.importFile !== undefined) {
    const imported = previewHarnessImport(p.importFile);
    source = { ...imported.source, editedSinceImport: digest(imported.content) !== digest(p.content) };
  }
  const createdAt = new Date().toISOString();
  if (!editing) {
    harness = { id: 'custom_' + crypto.randomUUID(), createdAt, versions: [] };
    library.push(harness);
  }
  const version = harness.versions.length + 1;
  harness.versions.push({ ...structuredClone(p.content), version, createdAt, source });
  if (p.use !== undefined) {
    fail(exact(p.use, ['chatId', 'baseRevisionId', 'seat']) && ['shared', 'personal', 'visiting'].includes(p.use.seat), 'Choose the chairs that should use this version.');
    const chat = state.chats.find(c => c.id === p.use.chatId), choice = resolvedHarnessChoice(state,chat), ref = { id: harness.id, version };
    const priorCount=chat.coatChoices?.length??0;
    applyHarnessCommand(state, 'harness.select', {
      chatId: p.use.chatId, baseRevisionId: p.use.baseRevisionId, baseDefaultId: null,
      shared: p.use.seat === 'shared',
      personal: p.use.seat === 'visiting' ? choice.personal : ref,
      visiting: p.use.seat === 'personal' ? choice.visiting : ref,
      saveAsDefault: false,
    });
    if(p.use.seat!=='shared')chat.coatChoices=chat.coatChoices.filter((r,i)=>i<priorCount||r.key===coatIdentity(state,chat,p.use.seat));
  }
}

function validateCustomHarnesses(state) {
  if (state.customHarnesses === undefined) return;
  fail(Array.isArray(state.customHarnesses), 'Invalid custom Coat library.');
  const ids = new Set();
  for (const h of state.customHarnesses) {
    fail(exact(h, ['id', 'createdAt', 'versions', 'deletedAt']) && /^custom_[a-f0-9-]{36}$/.test(h.id) && !ids.has(h.id) && !Number.isNaN(Date.parse(h.createdAt)), 'Invalid custom Coat.'); ids.add(h.id);
    fail(h.deletedAt === undefined || h.deletedAt === null || typeof h.deletedAt === 'string' && !Number.isNaN(Date.parse(h.deletedAt)), 'Invalid Coat deletion marker.');
    fail(Array.isArray(h.versions) && h.versions.length > 0 && h.createdAt === h.versions[0].createdAt, 'Invalid custom Coat versions.');
    for (const [i, v] of h.versions.entries()) {
      fail(exact(v, ['version', 'createdAt', 'name', 'description', 'instructions', 'source', 'pockets']) && v.version === i + 1 && !Number.isNaN(Date.parse(v.createdAt)), 'Invalid custom Coat version.');
      checkHarnessContent({ name: v.name, description: v.description, instructions: v.instructions, ...pocketContent(v) });
      fail(v.source === null || (exact(v.source, ['kind', 'filename', 'sha256', 'editedSinceImport']) && v.source.kind === 'selected_local_file' && typeof v.source.filename === 'string' && v.source.filename.length <= 200 && !/[\\/\u0000-\u001f]/u.test(v.source.filename) && /^[a-f0-9]{64}$/.test(v.source.sha256) && typeof v.source.editedSinceImport === 'boolean'), 'Invalid Coat import source.');
    }
  }
}

export function validateHarnesses(state) {
  validateCustomHarnesses(state);
  const coatIds=new Set();
  for(const r of [...(state.coatUsuals??[]),...state.chats.flatMap(c=>c.coatChoices??[])]) {
    fail(exact(r,['id','at','key','mode','ref']) && /^coat_[a-f0-9-]{36}$/.test(r.id) && !coatIds.has(r.id) && Number.isFinite(Date.parse(r.at)) && /^(personal:|model:|unbound:)/.test(r.key) && ['override','follow'].includes(r.mode) && (r.mode==='follow' ? r.ref===null : validRef(r.ref,state)), 'Invalid model Coat history.'); coatIds.add(r.id);
  }
  for(const chat of state.chats){
    fail(chat.coatPolicy===undefined||chat.coatPolicy===2,'Unsupported Coat policy.');
    if(chat.coatDefault){const c=chat.coatDefault;fail(exact(c,['personal','visiting','selectionId'])&&validRef(c.personal,state)&&validRef(c.visiting,state)&&chat.harnessSelections?.some(r=>r.id===c.selectionId&&digest(r.personal)===digest(c.personal)&&digest(r.visiting)===digest(c.visiting)),'Invalid copied desk Coat default.');}
  }
  const ids = new Set();
  for (const item of [...state.roots.map(r => ({ records: r.harnessDefaults, root: r })), ...state.chats.map(c => ({ records: c.harnessSelections, root: state.roots.find(r => r.id === c.rootId) }))]) {
    if (item.records === undefined) continue;
    fail(Array.isArray(item.records) && item.records.length > 0, 'Invalid Coat history.');
    for (const r of item.records) {
      fail(exact(r, ['id', 'createdAt', 'shared', 'personal', 'visiting', 'sourceDefaultId']) && /^harness_[a-f0-9-]+$/.test(r.id) && !ids.has(r.id) && !Number.isNaN(Date.parse(r.createdAt)), 'Invalid Coat revision.'); ids.add(r.id);
      fail(typeof r.shared === 'boolean' && validRef(r.personal, state) && validRef(r.visiting, state) && (!r.shared || digest(r.personal) === digest(r.visiting)), 'Invalid Coat choice.');
      if (r.sourceDefaultId !== null) {
        const source = item.root.harnessDefaults?.find(d => d.id === r.sourceDefaultId);
        fail(source && source.shared === r.shared && digest(source.personal) === digest(r.personal) && digest(source.visiting) === digest(r.visiting), 'Coat default ancestry changed.');
      }
    }
  }
  for (const turn of state.exchanges) {
    if (turn.harness === undefined) continue; // Old history has no retroactive selection.
    const h = turn.harness, chat = state.chats.find(c => c.id === turn.chatId);
    if(h.profile === 'branchline.coat-selection/2') {
      const record = [...(state.coatUsuals??[]),...(chat?.coatChoices??[])].find(r=>r.id===h.selectionId);
      const legacy=chat?.harnessSelections?.find(r=>r.id===h.selectionId);
      const ref=record?.mode==='override'?record.ref:legacy?.[h.seat]??(h.selectionId===null?defaultHarnessRef():null);
      fail(h.seat===(turn.speaker?.seat??'visiting') && ['follow','override','preserved','starter'].includes(h.mode) && h.role==='response_guidance_only' && digest(h.preset)===h.hash && ref && digest(findHarness(ref,state))===h.hash && (!record||record.key===h.key), 'Recorded model Coat changed.');
      continue;
    }
    const choice = h.selectionId === null ? { shared: true, personal: defaultHarnessRef(), visiting: defaultHarnessRef() } : chat?.harnessSelections?.find(r => r.id === h.selectionId);
    fail(choice && h.seat === (turn.speaker?.seat ?? 'visiting') && h.shared === choice.shared && h.role === 'response_guidance_only' && digest(findHarness(choice[h.seat], state)) === h.hash && digest(h.preset) === h.hash, 'Recorded Coat changed.');
  }
}

export function preserveHarnessHistory(before, after) {
  for(const c of before.chats)if(c.coatPolicy===2){const n=after.chats.find(x=>x.id===c.id);fail(n&&n.coatPolicy===2&&digest(c.coatDefault??null)===digest(n.coatDefault??null)&&c.coatStarter===n.coatStarter,'The original branch Coat policy cannot be rewritten.');}
  for(const [a,b] of [[before.coatUsuals??[],after.coatUsuals??[]],...before.chats.map(c=>[c.coatChoices??[],after.chats.find(n=>n.id===c.id)?.coatChoices??[]])]) fail(b.length>=a.length && a.every((r,i)=>digest(r)===digest(b[i])), 'Model Coat history cannot be rewritten.');
  const priorLibrary = before.customHarnesses ?? [], nextLibrary = after.customHarnesses ?? [];
  fail(nextLibrary.length >= priorLibrary.length, 'Saved Coats cannot be removed.');
  for (const [i, h] of priorLibrary.entries()) {
    const next = nextLibrary[i];
    fail(next?.id === h.id && next.createdAt === h.createdAt && next.versions.length >= h.versions.length && h.versions.every((v, j) => digest(v) === digest(next.versions[j])), 'Saved Coat versions cannot be rewritten.');
  }
  for (const [collection, key] of [['roots', 'harnessDefaults'], ['chats', 'harnessSelections']]) {
    for (const item of before[collection]) {
      const prior = item[key] ?? [], next = after[collection].find(n => n.id === item.id)?.[key] ?? [];
      fail(next.length >= prior.length && prior.every((r, i) => digest(r) === digest(next[i])), 'Prior Coat history cannot be rewritten.');
    }
  }
  for (const turn of before.exchanges) fail(digest(turn.harness ?? null) === digest(after.exchanges.find(t => t.id === turn.id)?.harness ?? null), 'Earlier replies retain their original Coat.');
}

const coatRecord = (key,mode,ref) => ({id:'coat_'+crypto.randomUUID(),at:new Date().toISOString(),key,mode,ref:ref?structuredClone(ref):null});
export function migrateCoats(state) {
  for(const chat of state.chats) if(!chat.coatPolicy) {
    chat.coatPolicy=2; chat.coatChoices=[];
    const old=harnessChoice(chat);
    for(const seat of ['personal','visiting']) chat.coatChoices.push(coatRecord(coatIdentity(state,chat,seat),'override',old[seat]));
  }
}
function selectCoat(state,type,p) {
  fail(exact(p,type==='harness.usual'?['key','ref','baseId']:['chatId','key','ref','mode','baseId']), 'Unexpected Coat selection fields.');
  fail(typeof p.key==='string' && /^(personal:|model:|unbound:)/.test(p.key),'Choose a saved identity.');
  const chat=state.chats.find(c=>c.id===p.chatId);
  if(type==='harness.branch') fail(chat && !chat.archivedAt && !state.roots.find(r=>r.id===chat.rootId)?.archivedAt,'Choose an active branch.');
  else fail(p.key.startsWith('personal:') ? state.personalParticipants?.some(x=>'personal:'+x.id===p.key) : state.models.some(x=>'model:'+x.id===p.key),'Choose a saved model.');
  const mode=type==='harness.usual'?'override':p.mode;
  fail(['override','follow'].includes(mode) && (mode==='follow'?p.ref===null:validRef(p.ref,state)&&!harnessDeleted(p.ref,state)),'Choose an available exact Coat version.');
  const rows=type==='harness.usual'?(state.coatUsuals??=[]):(chat.coatChoices??=[]);
  if (mode === 'override' && retiredCoat(p.ref)) {
    const seat = chat && ['personal','visiting'].find(seat => coatIdentity(state,chat,seat) === p.key);
    const current = type === 'harness.usual' ? rows.filter(r=>r.key===p.key).at(-1)?.ref : seat && resolvedCoat(state,chat,seat).ref;
    fail(current && digest(current) === digest(p.ref), 'This starter Coat is retired. Keep an existing choice or choose an active Coat.');
  }
  fail((rows.filter(r=>r.key===p.key).at(-1)?.id??null)===p.baseId,'This selection changed. Your draft is retained; reopen its choices.');
  rows.push(coatRecord(p.key,mode,p.ref));
}
