import { digest } from './integrity.mjs';

const FORMAT = 'branchline.learning-packet/1';
const MAX_BYTES = 2 * 1024 * 1024;
const copy = value => structuredClone(value);
const fail = (ok, message) => { if (!ok) throw new Error('Learning packet: ' + message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

// Read-only preparation. Nodes are content addressed; no grants or executable
// invocation handles are exported, and nothing imports this packet as authority.
export function learningPacket(state, input) {
  fail(object(input) && Object.keys(input).every(k => ['chatId', 'wakeIds'].includes(k)), 'select a table and wake IDs only.');
  const chat = state.chats.find(c => c.id === input.chatId);
  fail(chat && Array.isArray(input.wakeIds) && input.wakeIds.length > 0 && input.wakeIds.length <= 16 && new Set(input.wakeIds).size === input.wakeIds.length, 'select one to sixteen distinct wakes.');
  const mind = state.mind;
  const wakes = input.wakeIds.map(id => mind?.wakes.find(w => w.id === id && w.chatId === chat.id));
  fail(wakes.every(Boolean), 'a selected wake is missing or belongs to another table.');
  const excludedWakeIds = new Set(mind.exclusions.map(item => item.wakeId));
  fail(wakes.every(wake => !excludedWakeIds.has(wake.id)), 'an excluded wake cannot enter a new selection.');
  const blocked = new Set(mind.exclusions.filter(e => e.chatId === chat.id).flatMap(e => e.blockedRelationIds));
  const accounts = new Map(mind.accounts.filter(a => a.chatId === chat.id).map(a => [a.id, a]));
  const relations = new Map([...accounts.values()].flatMap(a => a.relations).map(r => [r.id, r]));
  const sources = new Map(mind.jobs.filter(j => j.chatId === chat.id).flatMap(j => j.sources).map(s => [s.ref, s]));
  const nodes = {}, items = [], missing = [];
  const node = (kind, value) => { const entry = { kind, value: copy(value) }; const key = digest(entry); nodes[key] = entry; return key; };
  const authorNode = job => node('author', { chatId: chat.id, reflectionId: job.id, model: job.modelSnapshot, speaker: job.speaker, inputDigest: digest(job.inputMessages),
    inputIncluded: false, inputLimit: 'Full reflection input remains in the local ledger. This packet carries selected sources and relation dependencies, not unrelated guidance or the full prompt.', standing: 'model_interpretation' });
  for (const wake of wakes) {
    const job = mind.jobs.find(j => j.id === wake.jobId);
    const before = accounts.get(wake.beforeRef), after = accounts.get(wake.afterRef);
    fail(job && before && after, 'the selected wake has missing endpoints or author.');
    const wanted = new Set([...wake.preservedRefs, ...wake.difference.changes.flatMap(c => [c.beforeRelationId, c.afterRelationId]).filter(Boolean)]);
    // Only the selected change, deliberately preserved relations, and their
    // declared ancestry/dependencies are carried, not the whole table account.
    const queue = [...wanted];
    for (let index = 0; index < queue.length; index++) {
      const relation = relations.get(queue[index]);
      if (!relation || blocked.has(relation.id)) { missing.push({ wakeId: wake.id, ref: queue[index], reason: 'Required relation unavailable or excluded.' }); continue; }
      for (const ref of [...relation.dependsOn, relation.priorRef].filter(Boolean)) if (!wanted.has(ref)) { wanted.add(ref); queue.push(ref); }
    }
    const selectedRelations = [...wanted].map(id => relations.get(id)).filter(r => r && !blocked.has(r.id));
    const questionIds = new Set([...(wake.difference.openedQuestionIds ?? []), ...(wake.difference.closedQuestionIds ?? [])]);
    const selectedQuestions = [...before.unresolved, ...after.unresolved].filter(q => questionIds.has(q.id));
    const contributorIds = new Set([job.id, ...selectedRelations.map(r => r.sourceJobId), ...selectedQuestions.map(q => q.sourceJobId)]);
    const contributors = [...contributorIds].map(id => mind.jobs.find(j => j.id === id && j.chatId === chat.id));
    fail(contributors.every(Boolean), 'a selected relation or question has no attributable author.');
    const sourceRefs = new Set([...contributors.flatMap(j => j.sources.map(s => s.ref)), ...selectedRelations.flatMap(r => r.evidenceRefs)]);
    const sourceHashes = [];
    for (const ref of sourceRefs) {
      const source = sources.get(ref);
      if (source) sourceHashes.push(node('source', source));
      else missing.push({ wakeId: wake.id, ref, reason: 'Required source bytes are unavailable.' });
    }
    const accountView = account => ({ id: account.id, chatId: chat.id, sourceAccountHash: digest(account),
      relationIds: account.relations.filter(r => wanted.has(r.id) && !blocked.has(r.id)).map(r => r.id),
      omittedRelationIds: account.relations.filter(r => !wanted.has(r.id) || blocked.has(r.id)).map(r => r.id),
      unresolved: account.unresolved.filter(q => questionIds.has(q.id)), selectionRule: 'wake_changes_preserved_and_declared_dependencies_v1' });
    items.push({ wake: node('wake', wake), before: node('account_view', accountView(before)), after: node('account_view', accountView(after)),
      relations: selectedRelations.map(r => node('relation', { chatId: chat.id, relation: r })), sources: sourceHashes,
      author: authorNode(job), contributors: contributors.map(authorNode) });
  }
  const packet = { format: FORMAT, status: missing.length ? 'PARTIAL_MISSING_CONTEXT' : 'PREPARED_NOT_TRAINED', scope: { rootId: chat.rootId, chatId: chat.id },
    selectedWakeIds: [...input.wakeIds], items, nodes, missing, training: 'NOT_RUN', authorityCreated: false };
  packet.hash = digest(packet);
  fail(Buffer.byteLength(JSON.stringify(packet)) <= MAX_BYTES, 'selection exceeds 2 MiB; choose fewer wakes.');
  verifyLearningPacket(packet);
  return packet;
}

export function verifyLearningPacket(packet) {
  fail(object(packet) && Object.keys(packet).sort().join(',') === 'authorityCreated,format,hash,items,missing,nodes,scope,selectedWakeIds,status,training', 'invalid envelope.');
  fail(packet.format === FORMAT && packet.training === 'NOT_RUN' && packet.authorityCreated === false, 'unknown format or claimed authority/training.');
  fail(Buffer.byteLength(JSON.stringify(packet)) <= MAX_BYTES && object(packet.nodes) && object(packet.scope), 'invalid size or scope.');
  fail(['PREPARED_NOT_TRAINED', 'PARTIAL_MISSING_CONTEXT'].includes(packet.status) && Array.isArray(packet.missing), 'invalid preparation status.');
  fail(packet.status === (packet.missing.length ? 'PARTIAL_MISSING_CONTEXT' : 'PREPARED_NOT_TRAINED'), 'missing context was concealed.');
  const { hash: supplied, ...value } = packet; fail(hash(supplied) && digest(value) === supplied, 'packet content changed.');
  fail(Array.isArray(packet.items) && packet.items.length > 0 && packet.items.length <= 16 && Array.isArray(packet.selectedWakeIds) && packet.selectedWakeIds.length === packet.items.length && new Set(packet.selectedWakeIds).size === packet.selectedWakeIds.length, 'invalid selection.');
  const kinds = ['wake', 'source', 'account_view', 'relation', 'author'];
  for (const [key, entry] of Object.entries(packet.nodes)) {
    fail(hash(key) && object(entry) && Object.keys(entry).sort().join(',') === 'kind,value' && kinds.includes(entry.kind) && digest(entry) === key, 'node content changed.');
    fail(entry.value?.chatId === packet.scope.chatId, 'node crossed the table scope.');
  }
  const get = (key, kind) => { const n = packet.nodes[key]; fail(n?.kind === kind, 'a required node is missing or has the wrong type.'); return n.value; };
  packet.items.forEach((item, index) => {
    fail(object(item) && Object.keys(item).sort().join(',') === 'after,author,before,contributors,relations,sources,wake' && Array.isArray(item.relations) && Array.isArray(item.sources) && Array.isArray(item.contributors), 'invalid item.');
    const wake = get(item.wake, 'wake'), before = get(item.before, 'account_view'), after = get(item.after, 'account_view'), author = get(item.author, 'author');
    fail(wake.id === packet.selectedWakeIds[index] && wake.beforeRef === before.id && wake.afterRef === after.id && wake.jobId === author.reflectionId, 'wake endpoints or author changed.');
    const relations = item.relations.map(key => get(key, 'relation').relation);
    const sourceRefs = new Set(item.sources.map(key => get(key, 'source').ref));
    const contributors = new Set(item.contributors.map(key => get(key, 'author').reflectionId));
    const relationIds = new Set(relations.map(r => r.id));
    const missingRefs = new Set(packet.missing.filter(m => m.wakeId === wake.id).map(m => m.ref));
    fail([...before.relationIds, ...after.relationIds].every(id => relationIds.has(id)), 'account view lacks a required relation.');
    for (const relation of relations) {
      fail(relation.standing === 'model_interpretation', 'a relation claimed stronger standing.');
      fail(contributors.has(relation.sourceJobId), 'relation author missing.');
      fail(relation.evidenceRefs.every(ref => sourceRefs.has(ref) || missingRefs.has(ref)), 'source gap not declared.');
      fail([...relation.dependsOn, relation.priorRef].filter(Boolean).every(ref => relationIds.has(ref) || missingRefs.has(ref)), 'relation gap not declared.');
    }
  });
  return { valid: true, status: packet.status, authorityCreated: false, weightsChanged: false };
}
