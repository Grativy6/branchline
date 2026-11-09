import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, finish, callTool, until, input } from './desk-helpers.mjs';
import { currentGoal, goalRevision, goalState, latestGoalReport, goalContext } from '../server/desk-goals.mjs';
import {readDeskRecord} from '../server/desk-work.mjs';
import { parseChairPrompt, chairMention } from '../public/chair-mentions.js';
import { replayJournal } from '../server/journal.mjs';
const report = (status, extra = {}) => ({ status, summary: 'Recorded fixture outcome', next_step: '', wait_for: 'none', wait_id: '', after: '', evidence: [], ...extra });
const settled = f => f.app.store.state.deskWork.tasks.every(t => !['queued','waiting','preparing','running','stopping'].includes(t.status));
async function goal(f) {
  await f.command('goal.save', { chatId: f.chatId, text: 'Build and independently check the fixture.', criteria: 'Return the observed result.' });
  return currentGoal(f.app.store.state, f.chatId);
}
test('user-created emoji chairs and generated mentions address exact independent identities', () => {
  const chairs = [{ id: 'build', name: 'Builder🛠️' }, { id: 'test', name: 'Builder🧪' }, { id: 'audit', name: 'Reviewer ☀️' }];
  const p = parseChairPrompt('Shared. @Builder🛠️ Build. @Builder🧪 Check. @{Reviewer ☀️}', chairs);
  assert.deepEqual(p.errors, []); assert.deepEqual(p.sections.map(s => s.chairId), ['build', 'test', 'audit']);
  for (const c of chairs) assert.equal(parseChairPrompt(chairMention(c.name), chairs).sections[0].chairId, c.id);
  assert(parseChairPrompt('@Builder🌍 Wrong suffix',[...chairs,{id:'plain',name:'Builder'}]).errors.length);
  const leading=[{id:'build',name:'🛠️🌌Builder'},{id:'review',name:'🔎🤝Reviewer'},{id:'notes',name:'📋☀️Notes'}];
  assert.deepEqual(parseChairPrompt('Go. @🛠️🌌Builder Build. @🔎🤝Reviewer Check. @📋☀️Notes',leading).sections.map(s=>s.chairId),['build','review','notes']);
  assert.equal(parseChairPrompt('`@Builder🛠️` is an example.', chairs).routed, false);
});
test('saving and copying a goal make no calls; copies and revisions remain independent', async () => {
  const f = await fixture();
  try {
    const original = await goal(f); assert.equal(f.requests.length, 0); assert.equal(goalState(f.app.store.state, original.id), 'draft');
    const rootId = f.app.store.state.chats[0].rootId;
    await f.command('chat.create', { rootId, title: 'Independent branch' }); const other = f.app.store.state.chats.at(-1);
    await f.command('goal.copy', { fromChatId: f.chatId, chatId: other.id });
    const copied = currentGoal(f.app.store.state, other.id); assert.notEqual(copied.id, original.id); assert.equal(copied.origin.goalId, original.id);
    await f.command('goal.save', { chatId: other.id, text: 'Different direction', baseRevision: goalRevision(copied).id });
    assert.equal(goalRevision(currentGoal(f.app.store.state, f.chatId)).text, 'Build and independently check the fixture.'); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test('long goals have bounded supplied context and an exact paginated source',async()=>{
  const f=await fixture();try{
    const text='Objective '.repeat(800),criteria='Check '.repeat(600);await f.command('goal.save',{chatId:f.chatId,text,criteria});
    const g=currentGoal(f.app.store.state,f.chatId),context=goalContext(f.app.store.state,f.chatId,{chairId:f.app.store.state.chats[0].seating.desk.id},g.id,1800)[0].content;
    assert(context.length<=1800);assert(context.includes('"excerpt":true'));let restored='',offset=0;
    do{const page=readDeskRecord(f.app.store.state,f.chatId,{id:g.id,revision:goalRevision(g).id,offset});restored+=page.text;offset=page.nextOffset;}while(offset!==null);
    assert.equal(JSON.parse(restored).text,text.trim());assert.equal(JSON.parse(restored).criteria,criteria.trim());assert.equal(f.requests.length,0);
  }finally{await f.close();}
});
test('goal coordination is explicit with Tools off and does not grant ordinary tools', { timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    const g = await goal(f); await f.app.deskTasks.admit(input(f, 'Start this assignment.', 'goal_coord'));
    await until(() => f.requests.length === 1, 'goal call');
    assert.deepEqual(f.requests[0].body.tools.map(t => t.function.name), ['read_desk_updates','read_desk_record','report_goal_work']);
    assert(f.requests[0].body.messages.some(m => typeof m.content === 'string' && m.content.includes(g.id)));
    callTool(f.requests[0], 'report_goal_work', report('complete'), 'complete');
    await until(() => f.requests.length === 2, 'return after disposition'); finish(f.requests[1], 'The fixture result is ready.');
    await until(() => settled(f) && goalState(f.app.store.state, g.id) === 'completed', () => JSON.stringify({tasks:f.app.store.state.deskWork.tasks,error:f.app.deskTasks.lastError}));
    assert.equal(f.requests.length, 2); assert.equal(f.app.deskTasks.goals(f.chatId)[0].lanes[0].report.claim, 'chair_report');
    const loaded = await replayJournal(f.app.store.file); assert.deepEqual(loaded.state.deskWork.goals, f.app.store.state.deskWork.goals);
  } finally { await f.close(); }
});
test('queued human input runs before an automatic next step, and a new return point supersedes the old one', { timeout: 20000 }, async () => {
  const f = await fixture();
  try {
    const g = await goal(f); await f.app.deskTasks.admit(input(f, 'Initial assignment.', 'goal_first'));
    await until(() => f.requests.length === 1, 'initial call');
    callTool(f.requests[0], 'report_goal_work', report('continue', { next_step: 'AUTOMATIC_NEXT_STEP' }), 'next');
    await until(() => f.requests.length === 2, 'initial wrap up');
    await f.app.deskTasks.admit(input(f, 'HUMAN_MESSAGE_FIRST', 'goal_human')); finish(f.requests[1], 'First step done.');
    await until(() => f.requests.length === 3, 'queued human call');
    assert(JSON.stringify(f.requests[2].body.messages.at(-1)).includes('HUMAN_MESSAGE_FIRST'));
    callTool(f.requests[2], 'report_goal_work', report('continue', { next_step: 'NEW_RETURN_POINT' }), 'new_next');
    await until(() => f.requests.length === 4, 'human wrap up'); finish(f.requests[3], 'I will return to the assignment.');
    await until(() => f.requests.length === 5, 'new continuation');
    assert(JSON.stringify(f.requests[4].body.messages).includes('NEW_RETURN_POINT'));
    callTool(f.requests[4], 'report_goal_work', report('complete'), 'final'); await until(() => f.requests.length === 6, 'final answer'); finish(f.requests[5]);
    await until(() => goalState(f.app.store.state, g.id) === 'completed', () => f.app.deskTasks.lastError ?? 'goal finish');
    assert.equal(f.app.store.state.deskWork.tasks.filter(t => t.automatic).length, 1);
    assert.equal(f.app.store.state.deskWork.tasks.at(-1).trigger.kind, 'declared_next_step');
  } finally { await f.close(); }
});
test('idle reports remain silent across scheduler ticks; named dependency arrivals wake once', { timeout: 20000 }, async () => {
  const f = await fixture();
  try {
    const g = await goal(f), roster = f.app.store.state.chats[0].seating;
    await f.app.deskTasks.admit(input(f, 'Wait for a contribution.', 'goal_wait'));
    await until(() => f.requests.length === 1, 'waiter call');
    callTool(f.requests[0], 'report_goal_work', report('waiting', { wait_for: 'chair', wait_id: roster.visitors[0].id }), 'wait');
    await until(() => f.requests.length === 2, 'waiter answer'); finish(f.requests[1], 'Waiting for the other chair.');
    await until(() => settled(f), 'waiter idle');
    for (let i = 0; i < 200; i++) await f.app.deskTasks.advanceGoals(); assert.equal(f.requests.length, 2);
    await f.app.deskTasks.admit({ ...input(f, '@Qwen Publish a contribution.', 'goal_peer'), toolsEnabled: true });
    await until(() => f.requests.length === 3, 'peer contribution');
    callTool(f.requests[2], 'write_desk_artifact', { id: '', revision: '', title: 'A new build', text: 'Version fixture-1' }, 'publish');
    await until(() => f.requests.length >= 4, 'peer wrap up');
    await until(() => f.requests.some((q,i) => i >= 3 && q.body.model==='hearthline'), 'dependency wake');
    const woken = f.requests.find((q,i) => i >= 3 && q.body.model==='hearthline');
    assert(woken);
    for (const q of f.requests.slice(3)) if (q !== woken) finish(q);
    const beforeIdle=f.requests.length;callTool(woken, 'report_goal_work', report('idle'), 'idle');
    await until(() => f.requests.length>beforeIdle, 'idle continuation response');
    for (const q of f.requests) if (!q.res.writableEnded) finish(q);
    await until(() => settled(f), () => JSON.stringify(f.app.store.state.deskWork.tasks));
    const count=f.requests.length;for(let i=0;i<200;i++)await f.app.deskTasks.advanceGoals();assert.equal(f.requests.length,count);
    assert.equal(f.app.store.state.deskWork.tasks.filter(t => t.trigger?.kind === 'dependency').length,1);
    assert.equal(goalState(f.app.store.state,g.id),'running');
  } finally { await f.close(); }
});

test('Pause retains an unfinished next step and Resume records a single human-triggered continuation', {timeout:15000}, async()=>{
  const f=await fixture();try{
    const g=await goal(f);await f.app.deskTasks.admit(input(f,'Initial step','pause_first'));await until(()=>f.requests.length===1,'first');
    callTool(f.requests[0],'report_goal_work',report('continue',{next_step:'Finish the remaining check.'}),'continue');await until(()=>f.requests.length===2,'wrap up');
    await f.app.deskTasks.goalAction({chatId:f.chatId,action:'pause'});finish(f.requests[1]);await until(()=>settled(f),'current work done');
    for(let i=0;i<100;i++)await f.app.deskTasks.advanceGoals();assert.equal(f.requests.length,2);assert.equal(goalState(f.app.store.state,g.id),'paused');
    await f.app.deskTasks.goalAction({chatId:f.chatId,action:'resume'});await until(()=>f.requests.length===3,'resumed step');assert.equal(f.app.store.state.deskWork.tasks.at(-1).trigger.kind,'human_resume');
    callTool(f.requests[2],'report_goal_work',report('complete'),'complete');await until(()=>f.requests.length===4,'final');finish(f.requests[3]);await until(()=>goalState(f.app.store.state,g.id)==='completed','completed');
  }finally{await f.close();}
});

test('a chosen goal limit pauses automatic steps and preserves cumulative usage across Resume', {timeout:15000},async()=>{
  const f=await fixture();try{
    await f.command('goal.save',{chatId:f.chatId,text:'A limited task',limits:{turns:1}});const g=currentGoal(f.app.store.state,f.chatId);
    await f.app.deskTasks.admit(input(f,'First bounded step','limit_first'));await until(()=>f.requests.length===1,'first');
    callTool(f.requests[0],'report_goal_work',report('continue',{next_step:'Another useful step'}),'next');await until(()=>f.requests.length===2,'wrap');finish(f.requests[1]);
    await until(()=>settled(f)&&goalState(f.app.store.state,g.id)==='paused','limit pause');assert.equal(f.app.deskTasks.goals(f.chatId)[0].usage.turns,1);
    await f.app.deskTasks.goalAction({chatId:f.chatId,action:'resume'});await f.app.deskTasks.advanceGoals();assert.equal(goalState(f.app.store.state,g.id),'paused');assert.equal(f.requests.length,2);
  }finally{await f.close();}
});

test('restart pauses a goal even when all chairs are idle and never wakes it by itself',async()=>{
  const f=await fixture();try{
    const g=await goal(f);await f.app.deskTasks.admit(input(f,'A quiet task','recover_idle'));await until(()=>f.requests.length===1,'first');
    callTool(f.requests[0],'report_goal_work',report('idle'),'idle');await until(()=>f.requests.length===2,'final');finish(f.requests[1]);await until(()=>settled(f),'idle');
    assert.equal(goalState(f.app.store.state,g.id),'running');await f.app.deskTasks.recover();assert.equal(goalState(f.app.store.state,g.id),'paused');
    for(let i=0;i<100;i++)await f.app.deskTasks.advanceGoals();assert.equal(f.requests.length,2);
  }finally{await f.close();}
});

test('two chairs waiting for each other do not wake on empty completion notices', {timeout:15000},async()=>{
  const f=await fixture();try{
    await goal(f);const r=f.app.store.state.chats[0].seating;
    await f.command('table.replySettings',{chatId:f.chatId,baseRevisionId:r.revisionId,mode:'all',speaker:'personal'});
    await f.app.deskTasks.admit({...input(f,'Wait for relevant work.','quiet_pair'),replyMode:'all'});await until(()=>f.requests.length===2,'both chairs');
    for(let i=0;i<2;i++)callTool(f.requests[i],'report_goal_work',report('waiting',{wait_for:'chair',wait_id:i===0?r.visitors[0].id:r.desk.id}),'wait_'+i);
    await until(()=>f.requests.length===4,'both waiting reports');for(const q of f.requests.slice(2))finish(q,'Waiting for a useful contribution.');await until(()=>settled(f),'quiet');
    for(let i=0;i<200;i++)await f.app.deskTasks.advanceGoals();assert.equal(f.requests.length,4);
  }finally{await f.close();}
});

test('a dependency already delivered does not wake again when a later wait repeats an old cursor', {timeout:15000},async()=>{
  const f=await fixture();try{
    await goal(f);const r=f.app.store.state.chats[0].seating;
    await f.app.deskTasks.admit(input(f,'Wait for new findings.','dedup_wait'));await until(()=>f.requests.length===1,'waiter');
    callTool(f.requests[0],'report_goal_work',report('waiting',{wait_for:'chair',wait_id:r.visitors[0].id}),'wait');await until(()=>f.requests.length===2,'waiter final');finish(f.requests[1]);await until(()=>settled(f),'waiting');
    const oldCursor=f.app.store.state.deskWork.events[0].id;
    await f.app.deskTasks.admit({...input(f,'@Qwen Publish a finding.','dedup_publish'),toolsEnabled:true});await until(()=>f.requests.length===3,'publisher');
    callTool(f.requests[2],'write_desk_artifact',{id:'',revision:'',title:'Finding',text:'A useful finding'},'publish');
    await until(()=>f.requests.some((q,i)=>i>=3&&q.body.model==='hearthline'),'first wake');
    const woken=f.requests.find((q,i)=>i>=3&&q.body.model==='hearthline');const before=f.requests.length;
    callTool(woken,'report_goal_work',report('waiting',{wait_for:'chair',wait_id:r.visitors[0].id,after:oldCursor}),'wait_again');await until(()=>f.requests.length>before,'second wait recorded');
    for(const q of f.requests)if(!q.res.writableEnded)finish(q);await until(()=>settled(f),'all returns');
    const count=f.requests.length;for(let i=0;i<100;i++)await f.app.deskTasks.advanceGoals();assert.equal(f.requests.length,count);
  }finally{await f.close();}
});
