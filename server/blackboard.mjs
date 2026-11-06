import { digest } from './integrity.mjs';

export const BLACKBOARD_PROFILE = 'branchline.blackboard/1';
export const BLACKBOARD_HEARTH_PROFILE = 'branchline.continuing-hearth/3';
export const BOARD_LIMITS = Object.freeze({ items: 32, bytes: 32768, excerptBytes: 4096 });
export const BLACKBOARD_SEED_SCHEMA = {
  type:'object',description:'Optional prepared board. Use only work items and empty source lists; the host binds the original request. Omit to let the first admitted episode prepare it.',
  properties:{baseRevision:{type:'integer',const:0},upserts:{type:'array',minItems:1,maxItems:32,items:{type:'object',properties:{id:{type:'string'},question:{type:'string'},doneWhen:{type:'string'},owner:{type:'string',enum:['peer-a','peer-b']},dependsOn:{type:'array',items:{type:'string'}},status:{type:'string',enum:['open','returned','blocked']},note:{type:'string'},sources:{type:'array',maxItems:0,items:{type:'string'}}},required:['id','question','doneWhen','owner','dependsOn','status','note','sources'],additionalProperties:false}},invalidates:{type:'array',maxItems:0,items:{type:'string'}},note:{type:'string'}},
  required:['baseRevision','upserts','invalidates','note'],additionalProperties:false
};
const names = ['peer-a', 'peer-b'];
const check = (ok, message) => { if (!ok) throw new Error('Blackboard: ' + message); };
const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k));
const text = (s, max) => typeof s === 'string' && !!s.trim() && s.length <= max;
const itemId = s => typeof s === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(s);
export const boardEnabled = r => r.blackboardProfile === BLACKBOARD_PROFILE;
export const currentBoard = r => r.blackboard?.revisions.at(-1) ?? null;
const seal = value => ({ ...value, hash: digest(value) });

export function createBlackboard(run) {
  if(run.blackboardSeed){
    const seed=run.blackboardSeed,delta=validateBoardDelta(seed.delta);
    check(delta.baseRevision===0&&delta.invalidates.length===0&&delta.upserts.every(i=>i.sources.length===0),'A starting plan cannot cite unavailable peer history or invalidate work.');
    const items=delta.upserts.map(item=>({...structuredClone(item),author:{peer:'initiating-agent',model:run.peers[0].model.name,jobId:run.sourceExchangeId},needsReview:false,reviewSource:null}));
    validateGraph(items);
    const first=seal({number:0,previousHash:null,source:{kind:'request',id:seed.receiptId},note:delta.note,items,amendments:[]});
    check(Buffer.byteLength(JSON.stringify(first))<=BOARD_LIMITS.bytes,'The prepared board exceeds 32 KiB.');
    return {revisions:[first]};
  }
  return { revisions: [seal({ number: 0, previousHash: null, source: { kind: 'task', id: run.id }, note: 'Waiting for the first board plan.', items: [], amendments: [] })] };
}

export function validateBoardDelta(value) {
  check(exact(value, ['baseRevision', 'upserts', 'invalidates', 'note']) && Number.isSafeInteger(value.baseRevision) && value.baseRevision >= 0
    && Array.isArray(value.upserts) && value.upserts.length <= BOARD_LIMITS.items && Array.isArray(value.invalidates) && value.invalidates.length <= BOARD_LIMITS.items
    && value.invalidates.every(itemId) && new Set(value.invalidates).size === value.invalidates.length && text(value.note, 1000), 'Return a revision, bounded item changes, invalidations and a short note.');
  const ids = new Set();
  for (const item of value.upserts) {
    check(exact(item, ['id', 'question', 'doneWhen', 'owner', 'dependsOn', 'status', 'note', 'sources']) && itemId(item.id) && !ids.has(item.id)
      && text(item.question, 400) && text(item.doneWhen, 400) && names.includes(item.owner) && Array.isArray(item.dependsOn) && item.dependsOn.every(itemId)
      && item.dependsOn.length <= BOARD_LIMITS.items && new Set(item.dependsOn).size === item.dependsOn.length
      && ['open', 'returned', 'blocked'].includes(item.status) && typeof item.note === 'string' && item.note.length <= 1500
      && Array.isArray(item.sources) && item.sources.length <= 8 && item.sources.every(s => /^(H[1-9][0-9]{0,8}|B[0-9]+\.[a-z][a-z0-9_-]{0,39}\.[0-9]+)$/.test(s)), 'Use bounded work items and supplied H or B source handles.');
    ids.add(item.id);
  }
  return value;
}

function validateGraph(items) {
  check(items.length > 0 && items.length <= BOARD_LIMITS.items, 'A prepared board needs between 1 and 32 work items.');
  const byId = new Map(items.map(i => [i.id, i])), visited = new Set(), active = new Set();
  function visit(id) {
    check(byId.has(id), 'A dependency is missing.');
    check(!active.has(id), 'The dependency graph contains a cycle.');
    if (visited.has(id)) return;
    active.add(id); for (const dep of byId.get(id).dependsOn) visit(dep); active.delete(id); visited.add(id);
  }
  for (const item of items) visit(item.id);
}

function invalidateDependents(items, changed, sourceId, excluded = new Set()) {
  const affected = new Set(changed);
  for (let pass = 0; pass < items.length; pass++) {
    let grew = false;
    for (const item of items) if (!affected.has(item.id) && item.dependsOn.some(id => affected.has(id))) { affected.add(item.id); grew = true; }
    if (!grew) break;
  }
  for (const item of items) if (affected.has(item.id) && !excluded.has(item.id)) {
    item.status = 'open'; item.needsReview = true; item.reviewSource = sourceId;
  }
}

export function boardAfterResult(previous, delta, job, sourceCatalog) {
  validateBoardDelta(delta);
  check(delta.baseRevision === previous.number && job.boardAssignment?.revision === previous.number, 'The board changed during this assignment. The returned text is saved for reconciliation.');
  const planning = job.boardAssignment.phase === 'prepare';
  check(planning ? previous.items.length === 0 : previous.items.some(i => i.id === job.boardAssignment.itemId && i.owner === job.peerName), 'The return has no matching assignment.');
  const items = structuredClone(previous.items), changed = new Set(), touched = new Set();
  for (const proposed of delta.upserts) {
    const index = items.findIndex(i => i.id === proposed.id), old = items[index];
    check(planning || !old || old.id === job.boardAssignment.itemId && old.owner === job.peerName, 'Revise your assigned item; use an invalidation to question another contribution.');
    check(!old || old.owner === proposed.owner, 'An existing assignment cannot be reassigned by a returned claim.');
    const sources = [...new Set(proposed.sources)].map(handle => {
      if (handle.startsWith('B')) {
        const [revision, id, index] = handle.slice(1).split('.');
        const source = previous.items.find(i => i.id === id)?.sources[Number(index)];
        check(Number(revision) === previous.number && job.boardAssignment.itemIds.includes(id) && source, 'That board source was outside this assignment.');
        return structuredClone(source);
      }
      const source = sourceCatalog.find(s => s.sourceId === handle);
      check(source, 'A source handle was not in this assignment.');
      return { handle, peerId: job.peerId, eventCount: job.eventCount, hash: source.hash };
    });
    const item = { ...structuredClone(proposed), sources, author: { peer: job.peerName, model: job.model.name, jobId: job.id }, needsReview: false, reviewSource: null };
    if (!old || digest({ ...old, author: null }) !== digest({ ...item, author: null })) changed.add(item.id);
    if (old) items[index] = item; else items.push(item);
    touched.add(item.id);
  }
  for (const id of delta.invalidates) check(items.some(i => i.id === id), 'The invalidated item is missing.');
  check(!delta.invalidates.some(id => touched.has(id)), 'Do not return and invalidate the same item at once.');
  invalidateDependents(items, changed, job.id, touched);
  invalidateDependents(items, delta.invalidates, job.id);
  validateGraph(items);
  const next = seal({ number: previous.number + 1, previousHash: previous.hash, source: { kind: 'contribution', id: job.id, peer: job.peerName }, note: delta.note, items, amendments: [...previous.amendments] });
  check(Buffer.byteLength(JSON.stringify(next)) <= BOARD_LIMITS.bytes, 'The current board exceeds 32 KiB. The previous board and returned text remain saved.');
  return next;
}

export function boardAfterAmendment(previous, mail) {
  const items = structuredClone(previous.items);
  if (mail.scopeChange) invalidateDependents(items, items.map(i => i.id), mail.id);
  else for(const item of items)if(item.status==='blocked'&&(mail.to==='all'||mail.to===item.owner))item.status='open';
  const next = seal({ number: previous.number + 1, previousHash: previous.hash, source: { kind: 'human', id: mail.id }, note: mail.scopeChange ? 'The shared task changed; earlier findings need review.' : 'A human message changed the available context.', items,
    amendments: [...previous.amendments, { id: mail.id, to: mail.to, scopeChange: !!mail.scopeChange }] });
  check(Buffer.byteLength(JSON.stringify(next)) <= BOARD_LIMITS.bytes, 'The board is full. This message was not saved; keep it in the editor.');
  return next;
}

function relevantItems(board, item) {
  const ids = new Set();
  const visit = id => { if (ids.has(id)) return; ids.add(id); for (const dep of board.items.find(i => i.id === id)?.dependsOn ?? []) visit(dep); };
  if (item) visit(item.id);
  return board.items.filter(i => ids.has(i.id));
}

export function nextBoardAssignment(run, jobs) {
  const board = currentBoard(run);
  const eligiblePeer = name => !['rest', 'stopped', 'held', 'needs-human'].includes(run.positions[name].mode);
  if (!board.items.length) return eligiblePeer('peer-a') ? { phase: 'prepare', peer: 'peer-a', itemId: null, revision: board.number, inputHash: digest(board), itemIds: [] } : null;
  for (const item of board.items) {
    if (item.status !== 'open' || !eligiblePeer(item.owner) || item.dependsOn.some(id => board.items.find(i => i.id === id)?.status !== 'returned')) continue;
    const selected = relevantItems(board, item), inputHash = digest({ items: selected, amendments: board.amendments.filter(m=>m.to==='all'||m.to===item.owner) });
    if (jobs.some(j => j.runId === run.id && j.epoch === run.epoch && j.boardAssignment?.itemId === item.id && j.boardAssignment.inputHash === inputHash)) continue;
    return { phase: 'work', peer: item.owner, itemId: item.id, revision: board.number, inputHash, itemIds: selected.map(i => i.id) };
  }
  return null;
}

export function boardExcerpt(run, assignment) {
  const board = run.blackboard.revisions[assignment.revision];
  check(board, 'The assigned revision is missing.');
  const view = { board: run.id, revision: board.number, phase: assignment.phase, assignment: assignment.itemId, cooperative: true,
    items: board.items.filter(i => assignment.itemIds.includes(i.id)).map(item => ({ ...item, sources: item.sources.map((s, i) => ({ handle: `B${board.number}.${item.id}.${i}`, authorPeer: s.peerId, hash: s.hash })) })),
    reviewNotes: [...new Set(board.items.filter(i=>assignment.itemIds.includes(i.id)&&i.reviewSource).map(i=>i.reviewSource))].map(id=>({source:id,note:run.blackboard.revisions.find(r=>r.source.id===id)?.note??'Reopen the source before treating this as settled.'})),
    amendments: board.amendments, omittedItemIds: board.items.filter(i => !assignment.itemIds.includes(i.id)).map(i => i.id) };
  const json = JSON.stringify(view);
  check(Buffer.byteLength(json) <= BOARD_LIMITS.excerptBytes, 'The relevant board excerpt exceeds 4 KiB. No correction was clipped and no model was called.');
  return json;
}

export function boardSourceReference(run, grant, handle) {
  const match = /^B(0|[1-9][0-9]*)\.([a-z][a-z0-9_-]{0,39})\.(0|[1-9][0-9]*)$/.exec(handle);
  check(match && grant && Number(match[1]) === grant.revision && grant.itemIds.includes(match[2]), 'This source is outside the assigned board excerpt.');
  const source = run.blackboard?.revisions[grant.revision]?.items.find(i => i.id === match[2])?.sources[Number(match[3])];
  check(source, 'That board source does not exist.');
  return source;
}

export function boardInstructions() {
  return 'This is cooperative blackboard work. The saved board controls which assignment runs next. During prepare, propose a small dependency graph before helpers run. During work, update only your assigned existing item; you may add bounded follow-up items for the two existing peers. A returned item is a model finding, not verification. Use invalidates to question an earlier item without rewriting its note. Sources in an upsert must be supplied H handles from your own history or B handles from the assigned board. Reopen exact evidence with read_chat_source when that tool is available. Return JSON with outcome, message, replies (empty for board work), and blackboard: {"baseRevision":0,"upserts":[{"id":"route","question":"Find a route","doneWhen":"A valid route is returned","owner":"peer-a","dependsOn":[],"status":"open|returned|blocked","note":"","sources":[]}],"invalidates":[],"note":"What changed"}. Use the supplied revision. The host retains authorship and validates changes. No additional agents, tools, permissions or allowance are granted.';
}

export function validateBlackboard(state, run, parseOutput, getSources) {
  if (!boardEnabled(run)) { check(run.blackboard === undefined, 'A legacy task cannot acquire an unadmitted board.'); return; }
  check(exact(run.blackboard, ['revisions']) && Array.isArray(run.blackboard.revisions) && run.blackboard.revisions.length > 0, 'Missing saved revisions.');
  if(run.blackboardSeed){const seed=run.blackboardSeed,source=state.handoffs.records.find(r=>r.id===seed.receiptId&&r.hash===seed.receiptHash);check(run.origin==='model'&&source?.kind==='operation.request'&&source.taskId===run.sourceExchangeId&&source.detail.tool==='request_hearth'&&digest(source.detail.arguments.blackboard)===digest(seed.delta),'The starting plan lost its original model request.');}
  let expected = createBlackboard(run).revisions[0];
  check(digest(expected) === digest(run.blackboard.revisions[0]), 'The original board changed.');
  const seen = new Set();
  for (const revision of run.blackboard.revisions.slice(1)) {
    check(!seen.has(revision.source.id), 'A source was applied twice.'); seen.add(revision.source.id);
    if (revision.source.kind === 'contribution') {
      const job = state.parallel.jobs.find(j => j.id === revision.source.id && j.runId === run.id);
      check(job?.status === 'completed' && job.boardAssignment && !job.recordKind, 'The board result has no completed source.');
      const peer = run.peers.find(p => p.id === job.peerId), result = parseOutput(job.output, true);
      expected = boardAfterResult(expected, result.blackboard, job, getSources(state, run, peer, job.eventCount));
    } else {
      const mail = run.mail.find(m => m.id === revision.source.id && m.from === 'user');
      check(revision.source.kind === 'human' && mail, 'A board amendment has no human source.'); expected = boardAfterAmendment(expected, mail);
    }
    check(digest(expected) === digest(revision), 'The board differs from its attributed source.');
  }
}

export function preserveBlackboard(before, after) {
  if (!boardEnabled(before)) return;
  check(after.blackboard?.revisions.length >= before.blackboard.revisions.length && before.blackboard.revisions.every((r, i) => digest(r) === digest(after.blackboard.revisions[i])), 'Saved board history was rewritten.');
}
