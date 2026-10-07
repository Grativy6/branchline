import { digest } from './integrity.mjs';

// Fixed predicate order is part of the versioned profile, never model supplied.
// This is a local mechanical effect check, not a PEA ethical judgment or grant.
export const REVIEW_PROFILES = Object.freeze({
  'selected-image/1': Object.freeze(['scope_current', 'bytes_bounded', 'format_checked', 'pixels_bounded', 'selection_bound']),
  'record-effect/2': Object.freeze(['purpose_bound', 'context_bound', 'scope_current', 'capability_bounded', 'authority_applicable', 'invocation_dispatched', 'output_complete', 'output_bounded', 'operation_clean', 'shared_task_bound', 'shared_budget_bound', 'initiation_permission']),
  'record-effect/1': Object.freeze(['purpose_bound', 'context_bound', 'scope_current', 'capability_bounded', 'authority_applicable', 'invocation_dispatched', 'output_complete', 'output_bounded', 'operation_clean']),
  'proposal-accept/1': Object.freeze(['proposal_pending', 'root_active', 'base_current', 'exact_text', 'local_request']),
  'selected-file/1': Object.freeze(['scope_current', 'purpose_bound', 'bytes_bounded', 'utf8_text', 'selection_bound', 'capability_bounded']),
});
const SECTIONS = Object.freeze({
  'selected-image/1': Object.freeze(['scope', 'capability', 'outcome', 'capability', 'context']),
  'record-effect/2': Object.freeze(['purpose', 'context', 'scope', 'capability', 'authority', 'capability', 'outcome', 'outcome', 'outcome', 'context', 'capability', 'authority']),
  'record-effect/1': Object.freeze(['purpose', 'context', 'scope', 'capability', 'authority', 'capability', 'outcome', 'outcome', 'outcome']),
  'proposal-accept/1': Object.freeze(['authority', 'scope', 'context', 'outcome', 'authority']),
  'selected-file/1': Object.freeze(['scope', 'purpose', 'capability', 'outcome', 'context', 'capability']),
});
export const EXCEPTION_CODES = Object.freeze(['UNKNOWN', 'MISSING', 'CHANGED', 'OUT_OF_PROFILE', 'ERROR']);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const fail = (ok, message) => { if (!ok) throw new Error('Mechanical review: ' + message); };
const predicates = profile => typeof profile === 'string' && Object.hasOwn(REVIEW_PROFILES, profile) ? REVIEW_PROFILES[profile] : null;

export function validateReview(review) {
  fail(object(review) && Object.keys(review).sort().join(',') === 'b,f,p,u,v,x,y', 'unknown or missing field');
  const fields = predicates(review.p);
  fail(review.v === 1 && fields, 'unknown version or profile');
  fail(hash(review.b), 'missing exact basis');
  const all = (1 << fields.length) - 1;
  for (const key of ['y', 'f', 'u']) fail(Number.isSafeInteger(review[key]) && review[key] >= 0 && review[key] <= all, 'invalid predicate mask');
  fail(!(review.y & review.f) && !(review.y & review.u) && !(review.f & review.u), 'contradictory predicate states');
  fail((review.y | review.f | review.u) === all, 'a predicate was omitted');
  fail(Array.isArray(review.x) && review.x.length <= 16, 'invalid exception list');
  for (const entry of review.x) {
    // The target is an existing predicate in this exact profile and basis.
    // There is no exception field for a replacement floor, grant or scope.
    fail(Array.isArray(entry) && entry.length === 3 && Object.keys(entry).sort().join(',') === '0,1,2' && Number.isInteger(entry[0]) && entry[0] >= 0 && fields[entry[0]] !== undefined && Number.isInteger(entry[1]) && entry[1] >= 0 && EXCEPTION_CODES[entry[1]] !== undefined && (entry[2] === null || hash(entry[2])), 'unknown or malformed exception');
  }
  return review;
}

export function makeReview(profile, basis, values, exceptions = []) {
  const fields = predicates(profile);
  fail(fields && object(values), 'unknown profile or predicates');
  fail(Object.keys(values).every(key => fields.includes(key)), 'unknown predicate');
  const review = { v: 1, p: profile, b: digest(basis), y: 0, f: 0, u: 0, x: structuredClone(exceptions) };
  fields.forEach((key, i) => {
    const value = values[key];
    fail(value === true || value === false || value === null || value === undefined, 'predicate must be true, false or unknown');
    review[value === true ? 'y' : value === false ? 'f' : 'u'] |= 1 << i;
  });
  return validateReview(review);
}

export function reviewAllowsEffect(review) {
  validateReview(review);
  return review.f === 0 && review.u === 0 && review.x.length === 0;
}

// Validate recorded evidence; this does not reissue the original live grant.
export function validateRecordedReview(record) {
  if (record.detail?.review === undefined) return;
  const review = validateReview(record.detail.review), basis = record.detail.reviewBasis;
  fail(object(basis) && review.b === digest(basis), 'review basis changed');
  const accepted = reviewAllowsEffect(review);
  fail(record.status === (accepted ? 'WITHIN_LOCAL_PROFILE' : 'HELD'), 'review decision differs from predicates');
  if (['record-effect/1','record-effect/2'].includes(review.p)) {
    fail(record.kind === 'model.to_record' && Object.keys(basis).sort().join(',') === 'context,effect,output,request', 'review belongs to a different action floor');
    fail(hash(basis.request) && hash(basis.context) && basis.output === record.contentHash, 'review does not bind this output');
    const effects = review.p === 'record-effect/2' ? ['record_parallel_contribution'] : ['record_reply', 'append_chat_journal', 'record_proposal', 'append_mind_wake', 'record_context_account'];
    fail(effects.includes(basis.effect) && record.detail.effect === (accepted ? basis.effect : 'retain_output_only'), 'effect differs from its review');
  } else if (review.p === 'proposal-accept/1') {
    fail(record.kind === 'ui.to_state' && record.detail.command === 'continuity.proposal.accept' && Object.keys(basis).sort().join(',') === 'authority,capability,command,proposal,scope', 'review belongs to a different action floor');
    fail(basis.capability === 'adopt_exact_local_proposal' && basis.authority === 'local_UI_request_not_independently_authenticated', 'proposal review changed its floor');
    fail(digest(basis.scope) === digest(record.scope) && basis.command?.type === record.detail.command && digest(basis.command) === record.contentHash, 'proposal review changed scope or request');
    fail(typeof basis.proposal?.text === 'string' && digest(basis.proposal.text) === record.detail.proposalHash, 'proposal text differs from review');
  } else if (review.p === 'selected-image/1') {
    fail(record.kind === 'image.read' && basis.effect === 'retain_selected_image' && hash(basis.selection)
      && basis.original === record.detail.snapshot?.original?.sha256 && basis.view === record.detail.snapshot?.view?.sha256
      && digest(basis.scope) === digest(record.scope) && record.contentHash === digest(record.detail.snapshot), 'image review changed its scope or bytes');
  } else {
    fail(record.kind === 'file.read' && Object.keys(basis).sort().join(',') === 'capability,effect,scope,selection,sha256', 'file review belongs to a different action floor');
    fail(basis.capability === 'selected_utf8_bytes/1' && basis.effect === 'record_selected_text' && hash(basis.selection) && hash(basis.sha256), 'file review changed its floor');
    fail(digest(basis.scope) === digest(record.scope) && basis.sha256 === record.detail.sha256, 'file review changed scope or bytes');
  }
}

export function validateReviewSources(record, receiptsByHash) {
  if (record.detail?.review?.p === 'selected-image/1') {
    const source = receiptsByHash.get(record.detail.reviewBasis.selection);
    fail(source?.kind === 'image.selection' && source.taskId === record.taskId && digest(source.scope) === digest(record.scope)
      && record.parents.includes(source.id) && source.contentHash === record.contentHash && digest(source.detail.selection) === record.contentHash, 'image review lost its selected source');
    return;
  }
  if (record.detail?.review?.p === 'selected-file/1') {
    const source = receiptsByHash.get(record.detail.reviewBasis.selection);
    fail(source?.kind === 'file.selection' && source.taskId === record.taskId && digest(source.scope) === digest(record.scope) && record.parents.includes(source.id), 'file review lost its scoped selection');
    const selection = source.detail.selection;
    fail(digest(selection) === source.contentHash && selection.sha256 === record.detail.sha256 && selection.byteLength === record.detail.byteLength && selection.name === record.detail.name, 'file selection changed');
    fail(digest(selection.capability) === digest(record.detail.capability) && selection.capability.filesystemAccess === 'NONE' && selection.capability.processDispatch === false, 'file selection changed capability');
    return;
  }
  if (!['record-effect/1','record-effect/2'].includes(record.detail?.review?.p)) return;
  const basis = record.detail.reviewBasis;
  const request = receiptsByHash.get(basis.request), context = receiptsByHash.get(basis.context);
  fail(request?.kind === 'ui.intent' && context?.kind === 'context.to_model', 'required review source is missing');
  fail([request, context].every(r => r.taskId === record.taskId && digest(r.scope) === digest(record.scope)), 'review source changed task or scope');
  fail(context.parents.includes(request.id) && record.parents.includes(context.id), 'review lost its source links');
  fail(digest(context.detail.inputMessages) === context.contentHash && digest(request.detail.task) === request.contentHash, 'source content differs from its receipt');
  fail(digest(request.detail.task.capability) === record.detail.capabilityHash && request.detail.task.allowedEffects.length === 1 && request.detail.task.allowedEffects[0] === basis.effect, 'review changed its capability or effect floor');
  if (record.detail.review.p === 'record-effect/2') {
    const shared = request.detail.task.parallel, admission = receiptsByHash.get(shared?.admissionHash);
    const hearth = shared?.profile === 'branchline.hearth-loop/1', continuing=shared?.profile==='branchline.continuing-hearth/2';
    fail(request.detail.task.kind === 'parallel' && (shared?.profile === 'branchline.parallel-approaches/1' || hearth || continuing) && admission?.kind === 'parallel.admitted'
      && admission.taskId === shared.runId && request.parents.includes(admission.id), 'parallel review lost its founding admission');
    const foundation = admission.detail.foundation;
    if(continuing){
      const turn=receiptsByHash.get(shared.turnAdmissionHash);
      fail(turn?.kind==='hearth.peer.admitted'&&turn.taskId===record.taskId&&request.parents.includes(turn.id)&&turn.parents.includes(admission.id)&&turn.detail.contextHash===context.contentHash&&turn.detail.peerId===shared.peerId&&digest(turn.detail)===turn.contentHash,'Continuing peer lost its call admission');
      const totals={modelRounds:0,toolCalls:0,toolBytes:0,outputCharacters:0};
      fail(Array.isArray(shared.allowanceHashes)&&shared.allowanceHashes.length>0&&new Set(shared.allowanceHashes).size===shared.allowanceHashes.length,'Missing user allowance');
      for(const hash of shared.allowanceHashes){const a=receiptsByHash.get(hash);fail(a?.kind==='hearth.allowance'&&a.from==='paired_local_ui'&&a.taskId===shared.runId&&digest(a.detail.extension)===a.contentHash,'Allowance source changed');for(const k in totals)totals[k]+=a.detail.extension.limits[k];}
      fail(Object.entries(totals).every(([k,v])=>v===shared.limits[k])&&foundation.peers.some(p=>p.id===shared.peerId&&p.name===shared.actor),'Continuing allowance or peer changed');
    }
    if (hearth) {
      const turn = receiptsByHash.get(shared.turnAdmissionHash);
      fail(turn?.kind === 'hearth.turn.admitted' && turn.taskId === record.taskId && request.parents.includes(turn.id) && turn.parents.includes(admission.id)
        && turn.detail.runAdmissionHash === admission.hash && turn.detail.runId === shared.runId && turn.detail.actor === shared.actor
        && turn.detail.contextHash === context.contentHash && digest(turn.detail) === turn.contentHash, 'hearth review lost its episode admission');
    }
    fail((hearth || continuing || foundation?.episodeIds.includes(record.taskId)) && foundation.purpose === request.detail.task.purpose && foundation.contextHash === shared.contextHash
      && foundation.settingsId === shared.settingsId && (continuing || digest(foundation.limits) === digest(shared.limits)) && digest(foundation) === admission.contentHash, 'parallel review changed its shared foundation');
  }
}

export function explainReview(review) {
  validateReview(review);
  return { profile: review.p, decision: reviewAllowsEffect(review) ? 'WITHIN_LOCAL_PROFILE' : 'HELD',
    predicates: Object.fromEntries(REVIEW_PROFILES[review.p].map((name, i) => [name, review.y & (1 << i) ? 'true' : review.f & (1 << i) ? 'false' : 'unknown'])),
    exceptions: review.x.map(([check, code, reference]) => ({ check: REVIEW_PROFILES[review.p][check], section: SECTIONS[review.p][check], basis: review.b, code: EXCEPTION_CODES[code], reference })),
    authorityCreated: false, peaJudgment: null };
}
