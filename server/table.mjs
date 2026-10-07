import { assertModelAvailable, preserveModelArchives } from './model-archives.mjs';
import crypto from 'node:crypto';
import { digest } from './integrity.mjs';
import { responseModeFor } from './response-mode.mjs';
import { permitsDreamTransition, preserveDreamHistory } from './dream-history.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (ok, message) => { if (!ok) throw new Error(message); };
const uid = prefix => `${prefix}_${crypto.randomUUID()}`;
const timestamp = () => new Date().toISOString();
const ref = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const exact = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const validNickname = value => value === null || (text(value, 200) && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value));
export const isReplyMode = value => ['single', 'both', 'alternate'].includes(value);

export function alternatingSeat(state, chatId) {
  const previous = state.exchanges.filter(turn => turn.chatId === chatId && turn.status === 'completed' && turn.speaker).at(-1);
  return previous?.speaker.seat === 'personal' ? 'visiting' : 'personal';
}

export function ordinaryInferencePending(state) {
  return state.exchanges.some(item => item.status === 'pending') || state.roots.some(root => root.continuity?.jobs?.some(job => job.status === 'pending')) || (state.mind?.jobs || []).some(job => job.status === 'pending') || (state.contextCarry?.jobs || []).some(job => job.status === 'pending');
}

export function inferencePending(state) {
  return ordinaryInferencePending(state) || (state.parallel?.runs || []).some(r => ['queued', 'running'].includes(r.status));
}

export function assertInferenceIdle(state) {
  fail(!inferencePending(state), 'A model is already working. Finish or stop that reply or reflection first.');
}

// Only ordinary replies on compatible HTTP connections may overlap a recorder.
// Every other mutation retains the global inference guard.
export function assertReplyAvailable(state, model) {
  const writers = (state.contextCarry?.jobs ?? []).filter(j => j.status === 'pending');
  if (!writers.length) return assertInferenceIdle(state);
  const http = m => (m.runtime ?? 'compatible') === 'compatible';
  fail(writers.every(j => j.staged && http(j.modelSnapshot)) && http(model), 'Handoff preparation is using this connection. Wait for it to finish or stop preparation; your draft stays saved.');
  assertInferenceIdle({ ...state, contextCarry: { ...state.contextCarry, jobs: [] } });
}

export function currentAssignment(state, chatId) {
  return state.chats.find(chat => chat.id === chatId)?.table?.assignments.at(-1) ?? null;
}

export function lastMessageId(state, chatId) {
  return state.messages.filter(message => message.chatId === chatId).at(-1)?.id ?? null;
}

export function participantById(state, participantId) {
  return (state.personalParticipants || []).find(participant => participant.id === participantId) ?? null;
}

function activeChat(state, chatId) {
  const chat = state.chats.find(item => item.id === chatId);
  const root = state.roots.find(item => item.id === chat?.rootId);
  fail(chat && root && !chat.archivedAt && !root.archivedAt, 'Choose an active conversation.');
  return { chat, root };
}

export function applyTableCommand(state, type, payload) {
  assertInferenceIdle(state);
  if (type === 'personal.create') {
    fail(exact(payload, ['name', 'modelId', 'baseIdentity', 'baseRevision', 'manifestHash']), 'Personal setup accepts only its name, connection and declared base identity.');
    fail(text(payload.name, 200) && ref(payload.modelId), 'Give the personal participant a name and model connection.');
    const model = state.models.find(item => item.id === payload.modelId);
    fail(model, 'Model connection not found.'); assertModelAvailable(state,model.id);
    fail(model.runtime !== 'codex', 'Codex subscription models use the Visiting chair. Personal models remain local.');
    fail(text(payload.baseIdentity, 500), 'Declare the personal model base identity.');
    fail(payload.baseRevision === undefined || text(payload.baseRevision, 200), 'Invalid base revision.');
    fail(payload.manifestHash === undefined || /^[a-f0-9]{64}$/.test(payload.manifestHash), 'Invalid manifest digest.');
    const generation = { id: uid('generation'), createdAt: timestamp(), baseIdentity: payload.baseIdentity, baseRevision: payload.baseRevision ?? null,
      manifestHash: payload.manifestHash ?? null, adapter: null, sourceStanding: 'user_declared', modelIdentifier: model.model };
    const participant = { id: uid('personal'), name: payload.name.trim(), createdAt: timestamp(), generations: [generation], currentGenerationId: generation.id,
      connections: [{ id: uid('connection'), modelId: model.id, createdAt: timestamp() }] };
    (state.personalParticipants ??= []).push(participant);
    return state;
  }
  if (type === 'personal.connection') {
    fail(exact(payload, ['participantId', 'modelId', 'baseConnectionId']), 'Unexpected personal connection fields.');
    const participant = participantById(state, payload.participantId);
    const model = state.models.find(item => item.id === payload.modelId);
    fail(participant && model, 'Personal participant or model connection not found.'); assertModelAvailable(state,model.id);
    fail(model.runtime !== 'codex', 'Codex subscription models use the Visiting chair.');
    fail(participant.connections.at(-1).id === payload.baseConnectionId, 'Personal connection changed. Refresh before editing it.');
    const generation = participant.generations.find(item => item.id === participant.currentGenerationId);
    fail(model.model === generation.modelIdentifier, 'Changing the personal foundation needs a separate generation transition. This operation only repairs its connection.');
    participant.connections.push({ id: uid('connection'), modelId: model.id, createdAt: timestamp() });
    return state;
  }
  if (type === 'personal.nickname') {
    fail(exact(payload, ['participantId', 'nickname', 'baseNickname']), 'A nickname changes only the local display label.');
    const participant = participantById(state, payload.participantId);
    fail(participant, 'Personal participant not found.');
    fail(validNickname(payload.nickname), 'Use a nickname of 1–200 characters, or clear it to use the original name.');
    fail(payload.baseNickname === (participant.nickname ?? null), 'The nickname changed. Reopen Rename before saving.');
    participant.nickname = payload.nickname;
    return state;
  }
  if (type === 'table.assign') {
    fail(exact(payload, ['chatId', 'baseRevisionId', 'personalId', 'visitorModelId']), 'Unexpected table assignment fields.');
    const { chat } = activeChat(state, payload.chatId);
    const before = currentAssignment(state, chat.id);
    fail((before?.id ?? null) === (payload.baseRevisionId ?? null), 'The table changed. Refresh its chairs before saving.');
    fail(payload.personalId === null || participantById(state, payload.personalId), 'Personal participant not found.');
    fail(payload.visitorModelId === null || state.models.some(item => item.id === payload.visitorModelId), 'Visiting model not found.');
    if(payload.personalId && payload.personalId !== before?.personalId) assertModelAvailable(state,participantById(state,payload.personalId).connections.at(-1).modelId);
    if(payload.visitorModelId && payload.visitorModelId !== before?.visitorModelId) assertModelAvailable(state,payload.visitorModelId);
    const assignment = { id: uid('seats'), createdAt: timestamp(), personalId: payload.personalId, visitorModelId: payload.visitorModelId };
    (chat.table ??= { assignments: [] }).assignments.push(assignment);
    return state;
  }
  if (type === 'table.replySettings') {
    fail(exact(payload, ['chatId', 'baseRevisionId', 'mode', 'speaker']), 'Unexpected reply settings.');
    const { chat } = activeChat(state, payload.chatId);
    const assignment = currentAssignment(state, chat.id);
    fail(assignment && assignment.id === payload.baseRevisionId, 'The table changed. Review its chairs first.');
    fail(isReplyMode(payload.mode) && ['personal', 'visiting'].includes(payload.speaker), 'Choose a reply pattern and chair.');
    if (payload.mode !== 'single') { resolveSpeaker(state, chat.id, 'personal'); resolveSpeaker(state, chat.id, 'visiting'); }
    chat.replySettings = { mode: payload.mode, speaker: payload.speaker };
    return state;
  }
  throw new Error('Unknown table command.');
}

// Resolves only a seat explicitly selected by a local application request.
// A participant, receipt, or saved assignment has no ability to invoke a model.
export function resolveSpeaker(state, chatId, seat = null) {
  const { root } = activeChat(state, chatId);
  const assignment = currentAssignment(state, chatId);
  if (!assignment) {
    fail(seat === null || seat === 'legacy', 'Set up the table before choosing a chair.');
    const model = state.models.find(item => item.id === root.modelId);
    fail(model, 'Choose a local model for this branch first.');
    assertModelAvailable(state,model.id);
    return { model, selection: null };
  }
  fail(seat === 'personal' || seat === 'visiting', 'Choose Personal or Visiting for this reply.');
  const participant = seat === 'personal' ? participantById(state, assignment.personalId) : null;
  const connection = participant?.connections.at(-1);
  const generation = participant?.generations.find(item => item.id === participant.currentGenerationId);
  const modelId = seat === 'personal' ? connection?.modelId : assignment.visitorModelId;
  const model = state.models.find(item => item.id === modelId);
  fail(model && (seat !== 'personal' || generation), `${seat === 'personal' ? 'Personal' : 'Visiting'} has no available model connection. Choose that chair's model first.`);
  assertModelAvailable(state,model.id);
  if (generation) fail(model.model === generation.modelIdentifier, 'Personal model identity changed. Its foundation transition has not been recorded.');
  return { model, selection: { seat, assignmentId: assignment.id, participantId: participant?.id ?? null, generationId: generation?.id ?? null,
    connectionId: connection?.id ?? null, modelId: model.id, modelProfileHash: digest(model), modelSnapshot: structuredClone(model) } };
}

export function requestFingerprint(body) {
  return digest({ chatId: body.chatId, content: body.content ?? '', kind: body.kind ?? 'send', speaker: body.speaker ?? null,
    baseRevisionId: body.baseRevisionId ?? null, lastMessageId: body.lastMessageId ?? null, selectedFile: body.selectedFile ?? null,
    ...(body.imagePlanId !== undefined ? { imagePlanId: body.imagePlanId } : {}),
    ...(body.responseMode !== undefined ? { responseMode: body.responseMode } : {}),
    ...(body.harnessRevisionId !== undefined ? { harnessRevisionId: body.harnessRevisionId } : {}),
    ...(body.toolsEnabled !== undefined ? { toolsEnabled: body.toolsEnabled } : {}),
    ...(body.replyMode !== undefined ? { replyMode: body.replyMode } : {}),
    ...(body.followUpOf !== undefined ? { followUpOf: body.followUpOf } : {}) });
}

export function checkTurnRequest(state, body) {
  fail(exact(body, ['chatId', 'content', 'kind', 'speaker', 'baseRevisionId', 'lastMessageId', 'requestId', 'selectedFile', 'stream', 'responseMode', 'replyMode', 'followUpOf', 'harnessRevisionId', 'toolsEnabled', 'imagePlanId']), 'Reply requests cannot add an actor, grant, tool, or other fields.');
  fail(body.imagePlanId === undefined || typeof body.imagePlanId === 'string' && /^imageplan_[a-f0-9-]{36}$/.test(body.imagePlanId), 'Invalid picture dispatch plan.');
  fail(body.toolsEnabled === undefined || typeof body.toolsEnabled === 'boolean', 'Invalid tool selection.');
  fail(body.replyMode === undefined || isReplyMode(body.replyMode), 'Unknown reply pattern.');
  fail(body.followUpOf === undefined || ref(body.followUpOf), 'Invalid follow-up reference.');
  fail(body.stream === undefined || typeof body.stream === 'boolean', 'Invalid streaming choice.');
  fail(body.requestId === undefined || ref(body.requestId), 'Invalid reply request identity.');
  const kind = body.kind ?? 'send';
  fail(kind === 'send' || kind === 'ask', 'Unknown reply request.');
  fail(kind === 'send' ? text(body.content, 200000) : (body.content === undefined || body.content === ''), kind === 'send' ? 'Write a message first.' : 'Ask requests do not add another human message.');
  fail(kind !== 'ask' || body.selectedFile === undefined, 'Attach a file with a written message.');
  const fingerprint = requestFingerprint(body);
  const prior = body.requestId && state.exchanges.find(item => item.request?.id === body.requestId);
  if (prior) {
    fail(prior.request.fingerprint === fingerprint, 'That request identity already belongs to a different reply.');
    return { prior, fingerprint, kind };
  }
  const nextSeat = body.replyMode === 'alternate' ? alternatingSeat(state, body.chatId) : body.speaker ?? null;
  assertReplyAvailable(state, resolveSpeaker(state, body.chatId, nextSeat).model);
  if (body.replyMode === 'both') for (const seat of ['personal','visiting']) assertReplyAvailable(state, resolveSpeaker(state, body.chatId, seat).model);
  fail(body.harnessRevisionId === undefined || body.harnessRevisionId === (state.chats.find(c => c.id === body.chatId)?.harnessSelections?.at(-1)?.id ?? null), 'The harness changed. Review its selection before sending.');
  fail(body.responseMode === undefined || body.responseMode === responseModeFor(state, body.chatId), 'The base Coat changed. Review Play / Create / Work before sending.');
  const assignment = currentAssignment(state, body.chatId);
  const replyMode = body.replyMode ?? 'single';
  const settings = state.chats.find(chat => chat.id === body.chatId)?.replySettings;
  if (!body.followUpOf) fail(replyMode === (settings?.mode ?? 'single'), 'The reply pattern changed. Review the controls before sending.');
  if (assignment) {
    fail(ref(body.requestId), 'This table needs a reply request identity.');
    fail(body.baseRevisionId === assignment.id, 'The table chairs changed. Review them before sending.');
    fail(body.lastMessageId === lastMessageId(state, body.chatId), 'The conversation changed. Review the latest turn before replying.');
  } else fail(kind === 'send', 'Set up a table before asking another model to take a turn.');
  if (kind === 'ask') fail(lastMessageId(state, body.chatId), 'Start the conversation before asking for another reply.');
  if (replyMode !== 'single') { resolveSpeaker(state, body.chatId, 'personal'); resolveSpeaker(state, body.chatId, 'visiting'); }
  const seat = replyMode === 'alternate' ? alternatingSeat(state, body.chatId) : body.speaker ?? null;
  const { model, selection } = resolveSpeaker(state, body.chatId, seat);
  return { fingerprint, kind, model, selection, replyMode };
}

export function validateTables(state) {
  const participants = state.personalParticipants ?? [];
  fail(Array.isArray(participants), 'Invalid personal participants.');
  const ids = new Set();
  for (const participant of participants) {
    fail(ref(participant.id) && !ids.has(participant.id) && text(participant.name, 200), 'Invalid personal participant.'); ids.add(participant.id);
    fail(participant.nickname === undefined || validNickname(participant.nickname), 'Invalid personal nickname.');
    fail(Array.isArray(participant.generations) && participant.generations.length > 0 && Array.isArray(participant.connections) && participant.connections.length > 0, 'Personal lineage is missing.');
    for (const generation of participant.generations) {
      fail(ref(generation.id) && !ids.has(generation.id), 'Invalid generation identity.'); ids.add(generation.id);
      fail(text(generation.baseIdentity, 500) && text(generation.modelIdentifier, 200) && generation.adapter === null && generation.sourceStanding === 'user_declared', 'Invalid initial personal generation.');
    }
    fail(participant.generations.some(item => item.id === participant.currentGenerationId), 'Current personal generation missing.');
    for (const connection of participant.connections) { fail(ref(connection.id) && !ids.has(connection.id) && ref(connection.modelId), 'Invalid personal connection.'); ids.add(connection.id); }
    const model = state.models.find(item => item.id === participant.connections.at(-1).modelId);
    fail(model && model.runtime !== 'codex' && model.model === participant.generations.find(item => item.id === participant.currentGenerationId).modelIdentifier, 'Personal connection changed its base identity.');
  }
  for (const chat of state.chats) {
    if (chat.replySettings !== undefined) fail(chat.table && exact(chat.replySettings, ['mode', 'speaker']) && isReplyMode(chat.replySettings.mode) && ['personal', 'visiting'].includes(chat.replySettings.speaker), 'Invalid reply settings.');
    if (chat.table === undefined) continue;
    fail(exact(chat.table, ['assignments']) && Array.isArray(chat.table.assignments) && chat.table.assignments.length > 0, 'Invalid table.');
    for (const assignment of chat.table.assignments) {
      fail(ref(assignment.id) && !ids.has(assignment.id), 'Invalid table revision.'); ids.add(assignment.id);
      fail(assignment.personalId === null || participants.some(item => item.id === assignment.personalId), 'Table participant missing.');
      fail(assignment.visitorModelId === null || ref(assignment.visitorModelId), 'Invalid visitor reference.');
    }
    const active = chat.table.assignments.at(-1);
    fail(active.visitorModelId === null || state.models.some(item => item.id === active.visitorModelId), 'Current visiting connection missing.');
  }
  const requestIds = new Set();
  for (const exchange of state.exchanges) {
    if (exchange.request !== undefined) {
      const r = exchange.request;
      fail(ref(r.id) && !requestIds.has(r.id) && /^[a-f0-9]{64}$/.test(r.fingerprint) && ['send', 'ask'].includes(r.kind), 'Invalid or duplicate reply request.'); requestIds.add(r.id);
      const humans = state.messages.filter(message => message.exchangeId === exchange.id && message.role === 'user');
      fail(humans.length === (r.kind === 'send' ? 1 : 0), 'Reply request and human transcript disagree.');
      fail(r.replyMode === undefined || isReplyMode(r.replyMode), 'Invalid recorded reply pattern.');
      if (r.followUp) {
        const plan = r.followUp;
        fail(r.replyMode === 'both' && !r.followUpOf && exact(plan, ['requestId', 'speaker', 'modelHash', 'selectionHash', 'baselineHash', 'settingsHash']) && ref(plan.requestId) && ['personal', 'visiting'].includes(plan.speaker) && [plan.modelHash, plan.selectionHash, plan.baselineHash, plan.settingsHash].every(hash => /^[a-f0-9]{64}$/.test(hash)), 'Invalid follow-up plan.');
        fail(exchange.speaker && plan.speaker !== exchange.speaker.seat, 'A follow-up must use the other chair.');
      }
      if (r.followUpOf) {
        const parent = state.exchanges.find(turn => turn.id === r.followUpOf);
        fail(parent?.status === 'completed' && parent.chatId === exchange.chatId && parent.request?.followUp?.requestId === r.id && parent.request.followUp.speaker === exchange.speaker?.seat && parent.request.followUp.modelHash === exchange.speaker?.modelProfileHash && parent.request.followUp.selectionHash === digest(exchange.speaker) && r.kind === 'ask' && r.replyMode === 'single' && !r.followUp, 'Follow-up lost its original human request.');
        fail(state.exchanges.indexOf(parent) < state.exchanges.indexOf(exchange), 'Follow-up precedes its first reply.');
      }
    }
    if (exchange.speaker === undefined || exchange.speaker === null) continue;
    const speaker = exchange.speaker;
    const assignment = state.chats.find(chat => chat.id === exchange.chatId)?.table?.assignments.find(item => item.id === speaker.assignmentId);
    fail(assignment && ['personal', 'visiting'].includes(speaker.seat), 'Reply chair assignment missing.');
    fail(speaker.modelSnapshot?.id === exchange.modelId && speaker.modelSnapshot.model === exchange.modelIdentifier && speaker.modelSnapshot.baseUrl === exchange.modelBaseUrl && digest(speaker.modelSnapshot) === speaker.modelProfileHash, 'Reply model snapshot changed.');
    if (speaker.seat === 'personal') {
      const p = participantById(state, speaker.participantId);
      fail(p && p.id === assignment.personalId && p.generations.some(g => g.id === speaker.generationId) && p.connections.some(c => c.id === speaker.connectionId && c.modelId === exchange.modelId), 'Personal reply lineage missing.');
    } else fail(speaker.participantId === null && speaker.generationId === null && speaker.connectionId === null && assignment.visitorModelId === exchange.modelId, 'Visiting reply changed chairs.');
  }
  return true;
}

// Append-only lineage and transcript checks apply both on writes and replay.
export function preserveTableHistory(before, after) {
  preserveDreamHistory(before, after);
  preserveModelArchives(before, after);
  const prefix = (prior, next, label) => {
    fail(Array.isArray(next) && next.length >= prior.length, `${label} history was removed.`);
    prior.forEach((item, i) => fail(digest(item) === digest(next[i]), `${label} history was rewritten.`));
  };
  for (const participant of before.personalParticipants || []) {
    const next = participantById(after, participant.id);
    fail(next && next.name === participant.name && next.createdAt === participant.createdAt, 'Personal participant identity changed.');
    prefix(participant.generations, next.generations, 'Personal generation'); prefix(participant.connections, next.connections, 'Personal connection');
    fail(next.currentGenerationId === participant.currentGenerationId || permitsDreamTransition(before, after, participant), 'A foundation transition requires a checked Dream restore.');
  }
  for (const chat of before.chats) if (chat.table) prefix(chat.table.assignments, after.chats.find(item => item.id === chat.id)?.table?.assignments, 'Table assignment');
  prefix(before.messages, after.messages, 'Transcript');
  fail(after.exchanges.length >= before.exchanges.length, 'Prior turns were removed.');
  before.exchanges.forEach((prior, index) => {
    const next = after.exchanges[index];
    if (prior.status !== 'pending') fail(digest(prior) === digest(next), 'A completed turn was rewritten.');
    else {
      const stable = ({ status, error, finishReason, truncated, metrics, ...rest }) => rest;
      fail(digest(stable(prior)) === digest(stable(next)), 'An active turn changed its identity or input.');
    }
  });
}
