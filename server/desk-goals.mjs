import crypto from 'node:crypto';
import { digest } from './integrity.mjs';
import { deskWork, deskEvent } from './desk-work.mjs';
import { chairRoster } from '../public/chair-roster.js';

export const GOAL_PROFILE = 'branchline.conversation-goal/1';
export const GOAL_TOOL = 'report_goal_work';
export const INPUT_MODES = ['queue-first', 'steer-directly', 'queue-only'];
const uid = prefix => prefix + '_' + crypto.randomUUID();
const fail = (ok, message) => { if (!ok) throw new Error(message); };
const text = (value, max) => typeof value === 'string' && value.length <= max;
export const currentGoal = (state, chatId) => state.deskWork?.goals?.findLast(g => g.chatId === chatId) ?? null;
export const goalEvents = (state, id) => (state.deskWork?.events ?? []).filter(e => e.detail?.goalId === id);
export const goalRevision = goal => goal?.revisions.at(-1) ?? null;
export const goalState = (state, id) => goalEvents(state, id).findLast(e => e.kind === 'goal.state')?.detail.status ?? 'draft';

export function goalEvent(state, goal, kind, detail = {}, task = null) {
  return deskEvent(state, task ?? { id: goal.id, chatId: goal.chatId, chairId: 'human', label: 'You' }, kind,
    { goalId: goal.id, ...detail }, ['goal.state', 'goal.revised', 'goal.assignment', 'goal.assignment.corrected', 'goal.report'].includes(kind) ? 'desk' : 'drawer');
}
export function saveGoal(state, { chatId, text: objective, criteria = '', baseRevision = null, newGoal = false, limits = {} }) {
  fail(state.chats.some(c => c.id === chatId && !c.archivedAt), 'Choose an active conversation.');
  fail(text(objective, 8000) && objective.trim() && text(criteria, 4000), 'Write a goal and optional completion criteria.');
  const bounded = {};
  for (const [key, max] of [['minutes', 100000], ['turns', 100000], ['tokens', 1000000000]]) {
    const value = limits[key] ?? null;
    fail(value === null || Number.isSafeInteger(value) && value > 0 && value <= max, 'Use a positive optional goal limit.');
    bounded[key] = value;
  }
  fail(Object.keys(limits).every(k => Object.hasOwn(bounded, k)), 'Unknown goal limit.');
  let goal = newGoal ? null : currentGoal(state, chatId);
  fail((goalRevision(goal)?.id ?? null) === baseRevision, 'The goal changed. Reopen it before saving.');
  if (!goal) {
    const prior = currentGoal(state, chatId);
    if (prior && goalState(state, prior.id) === 'running') goalEvent(state, prior, 'goal.state', { status: 'paused', reason: 'Another goal was selected.' });
    goal = { profile: GOAL_PROFILE, id: uid('goal'), chatId, createdAt: new Date().toISOString(), revisions: [] };
    (deskWork(state).goals ??= []).push(goal);
  }
  const revision = { id: uid('goalrev'), at: new Date().toISOString(), text: objective.trim(), criteria: criteria.trim(), limits: bounded };
  goal.revisions.push(revision);
  goalEvent(state, goal, 'goal.revised', { revisionId: revision.id });
  return goal;
}
export function setGoalState(state, goal, status, reason = '', basis = 'human') {
  fail(['running', 'paused', 'stopped', 'completed'].includes(status), 'Choose a supported goal action.');
  if (goalState(state, goal.id) !== status) goalEvent(state, goal, 'goal.state', { status, reason, basis });
}
export function goalAssignment(state, goalId, chairId) {
  return goalEvents(state, goalId).findLast(e => ['goal.assignment','goal.assignment.corrected'].includes(e.kind) && e.chairId === chairId) ?? null;
}
export function assignGoal(state, goal, task) {
  if (!goalAssignment(state, goal.id, task.chairId)) goalEvent(state, goal, 'goal.assignment', { assignment: task.content, taskId: task.id }, task);
}
export function latestGoalReport(state, goalId, chairId) {
  return goalEvents(state, goalId).findLast(e => e.kind === 'goal.report' && e.chairId === chairId) ?? null;
}
export function goalReportsComplete(state, goal) {
  const assignments = goalEvents(state, goal.id).filter(e => e.kind === 'goal.assignment');
  return assignments.length > 0 && !state.deskWork.tasks.some(t => t.goalId === goal.id && ['queued','waiting','preparing','running','stopping'].includes(t.status))
    && assignments.every(a => { const report = latestGoalReport(state, goal.id, a.chairId); return report?.detail.status === 'complete'
      && report.detail.goalRevisionId === goalRevision(goal).id && state.deskWork.tasks.find(t => t.id === report.taskId)?.status === 'completed'; });
}
export function reportGoalWork(state, task, args, callId) {
  const goal = state.deskWork?.goals?.find(g => g.id === task.goalId && g.chatId === task.chatId);
  fail(goal, 'This task has no conversation goal.');
  fail(['continue', 'complete', 'partial', 'waiting', 'blocked', 'idle'].includes(args.status)
    && text(args.summary, 2000) && text(args.next_step, 4000) && text(args.wait_id, 120) && text(args.after, 120)
    && ['none', 'chair', 'artifact', 'task', 'pony'].includes(args.wait_for)
    && Array.isArray(args.evidence) && args.evidence.length <= 12 && args.evidence.every(id => text(id, 120)), 'Use a concise goal status, next step or named dependency.');
  fail(args.status !== 'continue' || args.next_step.trim(), 'A continuation needs a concrete next step.');
  fail(args.status !== 'waiting' || args.wait_for !== 'none' && args.wait_id, 'Name the chair, artifact or task you are waiting for.');
  const known = new Set([...(state.deskWork?.artifacts ?? []), ...(state.deskWork?.events ?? []), ...(state.deskWork?.tasks ?? [])].filter(r => r.chatId === task.chatId).map(r => r.id));
  for(const record of state.workAccess?.artifacts??[])if(record.chatId===task.chatId)known.add(record.id);
  for(const record of state.handoffs?.records??[])if(record.scope.chatId===task.chatId)known.add(record.id);
  fail(args.evidence.every(id => known.has(id)), 'Evidence must identify a record at this conversation.');
  if(args.wait_for==='pony')fail(state.ponyMail?.parcels.some(p=>p.id===args.wait_id&&p.source.rootId===task.rootId),'Choose a parcel sent by this desk.');
  if (args.wait_for === 'chair') { const roster = chairRoster(state, state.chats.find(c => c.id === task.chatId)); fail([roster.desk, ...roster.visitors].some(c => c.id === args.wait_id), 'Choose a known chair ID.'); }
  if (args.after) fail((state.deskWork?.events ?? []).some(e => e.id === args.after && e.chatId === task.chatId), 'Choose a cursor from this conversation.');
  const event = goalEvent(state, goal, 'goal.report', { ...args, callId, goalRevisionId: state.exchanges.find(e => e.id === task.exchangeId)?.goal?.revisionId ?? task.goalRevisionId ?? goalRevision(goal).id,
    after: args.after || task.eventCursor || '', claim: 'chair_report' }, task);
  return { recorded: true, reportId: event.id, status: args.status, startsAfterCurrentTurn: args.status === 'continue', independentlyVerified: false };
}
export function goalUsage(state, goal, time = Date.now()) {
  const tasks = (state.deskWork?.tasks ?? []).filter(t => t.goalId === goal.id), started = tasks.filter(t => t.startedAt);
  let ms = 0, since = null;
  for (const event of goalEvents(state, goal.id).filter(e => e.kind === 'goal.state')) {
    if (since !== null) ms += Math.max(0, Date.parse(event.at) - since);
    since = event.detail.status === 'running' ? Date.parse(event.at) : null;
  }
  if (since !== null) ms += Math.max(0, time - since);
  let tokens = 0, known = 0;
  for (const task of started) {
    const usage = (state.deskWork.events ?? []).findLast(e => e.kind === 'task.usage' && e.taskId === task.id)?.detail;
    if (Number.isSafeInteger(usage?.totalTokens)) { tokens += usage.totalTokens; known++; continue; }
    const m = state.exchanges.find(e => e.id === task.exchangeId)?.metrics;
    if (m?.inputTokens != null && m?.outputTokens != null) { tokens += m.inputTokens + m.outputTokens; known++; }
  }
  return { turns: started.length, elapsedMs: ms, reportedTokens: known ? tokens : null, tokenTurnsKnown: known, tokenTurnsTotal: started.length };
}
export function goalLimitReason(state, goal, time) {
  const limits = goalRevision(goal).limits, usage = goalUsage(state, goal, time);
  if (limits.turns && usage.turns >= limits.turns) return 'The chosen chair-turn limit was reached.';
  if (limits.minutes && usage.elapsedMs >= limits.minutes * 60000) return 'The chosen running-time limit was reached.';
  if (limits.tokens && usage.reportedTokens !== null && usage.reportedTokens >= limits.tokens) return 'The chosen reported-token limit was reached.';
  return null;
}
export function dependencyEvent(state, task, report) {
  const all = state.deskWork?.events ?? [], cursor = all.findIndex(e => e.id === report.detail.after);
  const consumed = new Set(goalEvents(state, task.goalId).filter(e => e.kind === 'goal.dispatched' && e.detail.chairId === task.chairId).map(e => e.detail.eventId).filter(Boolean));
  const events = all.slice(cursor + 1).filter(e => e.chatId === task.chatId && e.visibility !== 'drawer' && !consumed.has(e.id));
  const { wait_for: kind, wait_id: id } = report.detail;
  if(kind==='pony')return events.find(e=>e.kind==='pony.returned'&&e.detail.parcelId===id)??null;
  if (kind === 'artifact') return events.find(e => e.kind === 'artifact.published' && e.detail.artifactId === id) ?? null;
  if (kind === 'task') return events.find(e => e.kind === 'task.finished' && e.taskId === id) ?? null;
  if (kind === 'chair') return events.find(e => e.chairId === id && (e.kind === 'artifact.published'
    || e.kind === 'goal.report' && ['complete','partial'].includes(e.detail.status) && e.detail.summary.trim()
    || e.kind === 'chair.message' && e.detail.recipientChairId === task.chairId)) ?? null;
  return null;
}
export function goalSnapshot(state, task) {
  const goal = state.deskWork?.goals?.find(g => g.id === task?.goalId);
  if (!goal) return null;
  const revision = goalRevision(goal), assignment = goalAssignment(state, goal.id, task.chairId);
  return { id: goal.id, revisionId: revision.id, text: revision.text, criteria: revision.criteria, status: goalState(state, goal.id), assignment: assignment?.detail.assignment ?? task.content,
    trigger: task.trigger ?? { kind: 'human_message' }, usage: goalUsage(state, goal), limits: revision.limits };
}
export function goalContext(state, chatId, selection, goalId = undefined, maxCharacters = 6000) {
  const goal = goalId===undefined ? currentGoal(state, chatId) : state.deskWork?.goals?.find(g=>g.id===goalId&&g.chatId===chatId);
  if (!goal) return [];
  const revision = goalRevision(goal), assignment = goalAssignment(state, goal.id, selection?.chairId);
  const report = latestGoalReport(state, goal.id, selection?.chairId);
  const amendments=(state.handoffs?.records??[]).filter(r=>r.kind==='input.amendment.accepted'&&r.detail.chairId===selection?.chairId&&state.deskWork.tasks.find(t=>t.exchangeId===r.taskId)?.goalId===goal.id).slice(-4).map(r=>({source:r.id,text:r.detail.input.content.slice(0,2000)}));
  const assignmentText=assignment?.detail.assignment??'';
  const followUps=(state.deskWork?.tasks??[]).filter(t=>t.goalId===goal.id&&t.chairId===selection?.chairId&&!t.automatic&&!t.originTaskId&&t.exchangeId&&t.id!==assignment?.detail.taskId).slice(-3).map(t=>{const message=state.messages.find(m=>m.exchangeId===t.exchangeId&&m.role==='user');return {source:message?.id??t.id,text:message?.content??t.content};});
  const view={id:goal.id,revisionId:revision.id,status:goalState(state,goal.id),text:revision.text.slice(0,3000),criteria:revision.criteria.slice(0,1000),assignment:assignmentText.slice(0,2000),humanAmendments:amendments,
    returnPoint:report?{id:report.id,goalRevisionId:report.detail.goalRevisionId,status:report.detail.status,summary:report.detail.summary.slice(0,800),nextStep:report.detail.next_step.slice(0,2000),waitFor:report.detail.wait_for,waitId:report.detail.wait_id}:null,
    humanFollowUps:followUps,assignmentSource:assignment?.id??null,limits:revision.limits,usage:goalUsage(state,goal),fullGoal:{id:goal.id,revision:revision.id},excerpt:revision.text.length>3000||revision.criteria.length>1000||assignmentText.length>2000};
  const prefix='[Current conversation goal — adopted human objective; other chairs retain their own work. Later human inputs amend or inquire about the original assignment as written. Record a concrete next step, a named wait, or an honest result using report_goal_work when available. A report is not independent verification. Use read_desk_record for full goal, task and report sources when an excerpt is marked.]\n';
  const limit=Math.max(1800,Math.min(6000,maxCharacters));
  for(let pass=0;prefix.length+JSON.stringify(view).length>limit&&pass<100;pass++){
    const fields=[[view,'text'],[view,'criteria'],[view,'assignment'],...(view.returnPoint?[[view.returnPoint,'summary'],[view.returnPoint,'nextStep']]:[]),...amendments.map(a=>[a,'text']),...followUps.map(a=>[a,'text'])].sort((a,b)=>b[0][b[1]].length-a[0][a[1]].length);
    const [object,key]=fields[0];
    if(object[key].length>100)object[key]=object[key].slice(0,Math.max(80,Math.floor(object[key].length*.65)))+' [excerpt]';
    else if(amendments.length>1)amendments.shift();
    else if(followUps.length>1)followUps.shift();
    else break;
    view.excerpt=true;
  }
  return [{ role: 'user', content: prefix + JSON.stringify(view) }];
}
export function validateGoals(state) {
  fail(state.ui.busyInputMode === undefined || INPUT_MODES.includes(state.ui.busyInputMode), 'Invalid busy-chair input preference.');
  const goals = state.deskWork?.goals;
  if (goals === undefined) return;
  fail(Array.isArray(goals) && new Set(goals.map(g => g.id)).size === goals.length, 'Invalid conversation goals.');
  for (const goal of goals) {
    fail(/^[A-Za-z0-9_-]{1,120}$/.test(goal.id)&&goal.profile === GOAL_PROFILE && state.chats.some(c => c.id === goal.chatId) && Array.isArray(goal.revisions) && goal.revisions.length > 0, 'A goal lost its conversation or revisions.');
    for (const r of goal.revisions) fail(typeof r.id === 'string'&&/^[A-Za-z0-9_-]{1,120}$/.test(r.id) && text(r.text, 8000) && r.text.trim() && text(r.criteria, 4000)
      && ['minutes', 'turns', 'tokens'].every(k => r.limits?.[k] === null || Number.isSafeInteger(r.limits?.[k]) && r.limits[k] > 0), 'Invalid goal revision.');
  }
}
export function preserveGoals(before, after) {
  for (const goal of before.deskWork?.goals ?? []) {
    const next = after.deskWork?.goals?.find(g => g.id === goal.id);
    fail(next && digest({ ...goal, revisions: [] }) === digest({ ...next, revisions: [] }) && next.revisions.length >= goal.revisions.length
      && goal.revisions.every((r, i) => digest(r) === digest(next.revisions[i])), 'Goal history cannot be rewritten.');
  }
}
