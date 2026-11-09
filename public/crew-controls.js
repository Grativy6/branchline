import { api } from './api.js';
import { chairRoster } from './chair-roster.js';
import { escapeHtml as e } from './views.js';
const number = value => value == null ? '—' : Number(value).toLocaleString();
const bytes = value => value == null ? '—' : (value / 1073741824).toFixed(1) + ' GiB';
const percent = value => value == null ? 'Unavailable' : Number(value).toFixed(1).replace(/\.0$/, '') + '%';
export const remainingPercent = used => used == null ? null : Math.max(0,Math.min(100,100-used));
const modeNames = { 'queue-first': 'Queue first', 'steer-directly': 'Steer directly', 'queue-only': 'Queue only' };
export function inputPreferenceForm(state) {
  return `<form id="busy-input-form"><h3>Messages to busy chairs</h3><fieldset class="note-cadence"><legend>When I send a message</legend>${Object.entries(modeNames).map(([id,label])=>`<label><input type="radio" name="mode" value="${id}" ${(state.ui.busyInputMode??'queue-first')===id?'checked':''}> ${label}</label>`).join('')}</fieldset><p class="field-help">Queue first keeps the message visible until its turn; Steer now can deliver it sooner on a supported connection. Queue only disables steering. New input on other connections waits for the next turn. Changing this choice affects future Sends.</p><button class="primary-button" type="submit">Save input preference</button></form><hr>`;
}
const progress = value => value == null ? '' : `<progress max="100" value="${Math.max(0,Math.min(100,value))}"></progress>`;
const usageFields = ['inputTokens','outputTokens','cachedInputTokens','reasoningTokens'];
function chairUsageView(chairs, expanded) {
  const headings='<th>Input</th><th>Output</th><th>Cached input</th><th>Reasoning</th>';
  return `<section><h3>Recorded chair usage</h3><p class="field-help">Totals by chair for this conversation. Expand a chair to see its exchanges. A + marks incomplete or still-running counts; — means unavailable. These are reported tokens, not a price or a fraction of your subscription. Reasoning is included in output.</p>${chairs.length?`<div class="resource-table-wrap"><table><thead><tr><th>Chair</th>${headings}</tr></thead><tbody>${chairs.map(c=>{
    const open=expanded.has(c.id),count=c.turns.length;
    const totals=usageFields.map(k=>{const t=c.totals[k];return `<td title="${e(t.measured+' of '+count+' exchanges reported this count'+(t.partial?'; total incomplete or still running':''))}">${number(t.value)}${t.value!==null&&t.partial?'+':''}</td>`;}).join('');
    return `<tr class="resource-chair"><td><button type="button" class="text-button" data-crew-action="usage-details" data-id="${e(c.id)}" aria-expanded="${open}" aria-controls="usage-${e(c.id)}">${open?'▾':'▸'} ${e(c.chair)}</button><small>${count} exchange${count===1?'':'s'}${c.active?' · '+c.active+' working':''}<br>${e(c.models.join(', '))}</small></td>${totals}</tr>${open?`<tr class="resource-chair-details" id="usage-${e(c.id)}"><td colspan="5"><div class="resource-exchange-scroll" data-usage-chair="${e(c.id)}" tabindex="0" role="region" aria-label="${e(c.chair)} exchanges"><table><thead><tr><th>Exchange</th>${headings}</tr></thead><tbody>${[...c.turns].reverse().map(t=>`<tr><td>${e(new Date(t.at).toLocaleString())}<small>${e(t.chair)} · ${e(t.model)} · ${e(t.status)}${t.usage?.partial?' · partial':''}</small></td>${usageFields.map(k=>`<td>${number(t.usage?.[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></td></tr>`:''}`;
  }).join('')}</tbody></table></div>`:'<p>No recorded chair usage yet.</p>'}</section>`;
}
export function resourceView(data, expanded = new Set()) {
  if (!data) return '<p>Measurements are unavailable.</p>';
  const cloud=data.subscription,local=data.local;
  return `${cloud?`<section><h3>ChatGPT ${cloud.plan?'· '+e(cloud.plan):''}</h3><p class="field-help">Account-wide allowance. Other activity on this account can affect these values.</p>${cloud.error?`<p>${e(cloud.error)}</p>`:''}${cloud.buckets.length?cloud.buckets.map(b=>`<article class="resource-bucket"><strong>${e(b.name)}</strong>${b.windows.length?b.windows.map(w=>`<p>${percent(remainingPercent(w.usedPercent))}${w.usedPercent==null?'':' left'}${w.durationMinutes?' · '+number(w.durationMinutes)+' minute window':''}</p>${progress(remainingPercent(w.usedPercent))}${w.resetsAt?`<small>Reported reset: ${e(new Date(w.resetsAt*1000).toLocaleString())}</small>`:''}`).join(''):'<p>Window measurements unavailable.</p>'}${b.credits?.balance!=null?`<p>Provider credit balance: ${e(b.credits.balance)}</p>`:''}${b.reached?`<p>Connection limit: ${e(b.reached.replaceAll('_',' '))}</p>`:''}</article>`).join(''):'<p>No allowance values were supplied.</p>'}<small>Last update: ${cloud.checkedAt?e(new Date(cloud.checkedAt).toLocaleString()):'unavailable'}. A reset time alone does not confirm renewed availability.</small></section>`:''}
    ${local?`<section><h3>Local resources</h3><p>${e(local.runtime.message??local.runtime.phase)}${local.runtime.backend?' · '+e(local.runtime.backend):''}${local.waiting?' · '+number(local.waiting)+' waiting for a local slot':''}</p>${local.hardware.gpus.map(g=>`<article class="resource-bucket"><strong>${e(g.name)}</strong><p>GPU: ${percent(g.utilizationPercent)} ${progress(g.utilizationPercent)}</p><p>VRAM: ${bytes(g.usedBytes)} / ${bytes(g.totalBytes)}</p><small>Whole device · ${e(g.source)}</small></article>`).join('')}${local.hardware.gpuError?`<p>${e(local.hardware.gpuError)}</p>`:''}<p>System CPU: ${percent(local.hardware.cpu.utilizationPercent)} · RAM: ${bytes(local.hardware.memory.usedBytes)} / ${bytes(local.hardware.memory.totalBytes)}</p><small>Whole-device measurements include other applications. Sampled ${e(new Date(local.hardware.sampledAt).toLocaleTimeString())}.</small></section>`:''}
    ${chairUsageView(data.chairs,expanded)}`;
}
function goalLive(goal) {
  if(!goal)return '';
  const lastState=goal.status==='completed'?(goal.stateDetail?.basis==='human'?'Marked complete by you':'Assignments reported complete'):goal.status;
  return `<p class="goal-status"><strong>${e(lastState)}</strong> · ${number(goal.usage.turns)} chair turns · ${number(Math.floor(goal.usage.elapsedMs/60000))} running minutes · ${number(goal.usage.reportedTokens)} reported tokens</p>${goal.stateDetail?.reason?`<p>${e(goal.stateDetail.reason)}</p>`:''}<p class="field-help">Token counts available for ${number(goal.usage.tokenTurnsKnown)} of ${number(goal.usage.tokenTurnsTotal)} started turns.</p>${goal.lanes.map(l=>`<article class="goal-lane"><div><strong>${e(l.chair)}</strong><span>${e(l.status)}</span></div><p>${e(l.report?.summary??l.assignment)}</p>${l.report?.next_step?`<small>Next: ${e(l.report.next_step)}</small>`:''}${l.report?.wait_for!=='none'&&l.report?.wait_id?`<small>Waiting for ${e(l.report.wait_for)} · ${e(l.report.wait_id)}</small>`:''}${l.report?.evidence?.length?`<div>Evidence: ${l.report.evidence.map((id,i)=>`<button type="button" class="text-button" data-crew-action="evidence" data-id="${e(id)}">Source ${i+1}</button>`).join(' ')}</div>`:''}${['paused','idle','partial','blocked'].includes(l.status)&&goal.status==='running'?`<button type="button" class="text-button" data-crew-action="resume-chair" data-chair="${e(l.chairId)}">Continue this chair</button>`:''}</article>`).join('')}`;
}
export function createCrewUI({getState,selection,command,sync,openDialog,closeDialog,toast,reportError,clearGoalCommand,prepareGoalStart}) {
  let resources=null,goals=[],openedChat=null,openedGoal=null,busy=false,closed=false,lastRefresh=0;
  const expandedUsage=new Set();
  function renderResources(){
    const view=document.getElementById('crew-resource-view');if(!view)return;
    const html=resourceView(resources,expandedUsage);if(view.innerHTML===html)return;
    const scrolls=[...view.querySelectorAll('[data-usage-chair]')].map(el=>[el.dataset.usageChair,el.scrollTop]);
    const focused=view.contains(document.activeElement)?document.activeElement.dataset.id:null;
    view.innerHTML=html;
    for(const el of view.querySelectorAll('[data-usage-chair]'))el.scrollTop=scrolls.find(([id])=>id===el.dataset.usageChair)?.[1]??0;
    if(focused)[...view.querySelectorAll('[data-crew-action="usage-details"]')].find(el=>el.dataset.id===focused)?.focus({preventScroll:true});
  }
  const goalButton=document.createElement('button');goalButton.type='button';goalButton.id='crew-goal-button';goalButton.className='quiet-button';goalButton.textContent='Goal';document.getElementById('open-chair-drawers').after(goalButton);
  const meter=document.createElement('button');meter.type='button';meter.id='crew-resource-button';meter.className='quiet-button';meter.hidden=true;document.getElementById('work-controls').before(meter);
  function current(){return goals.at(-1)??null;}
  function recipients(){const state=getState(),chat=selection().chat;if(!chat)return [];const r=chairRoster(state,chat);return (r.mode==='all'?[r.desk,...r.visitors]:[r.speaker==='visiting'?r.visitors.find(c=>c.id===r.selectedVisitorId):r.desk]).filter(c=>c?.modelId);}
  function render(){
    const state=getState(),chat=selection().chat;goalButton.hidden=!chat;
    const goal=state?.deskWork?.goals?.findLast(g=>g.chatId===chat?.id),status=goal?state.deskWork.events.findLast(ev=>ev.kind==='goal.state'&&ev.detail.goalId===goal.id)?.detail.status??'draft':null;
    goalButton.textContent=goal?'Goal · '+status:'Goal';
    const activity=document.getElementById('work-controls');if(meter.parentElement!==activity.parentElement||meter.nextElementSibling!==activity)activity.before(meter);
    meter.hidden=!resources?.subscription&&!resources?.local;
    const window=resources?.subscription?.buckets.flatMap(b=>b.windows).find(w=>w.usedPercent!==null),gpu=resources?.local?.hardware.gpus[0];
    meter.textContent=[resources?.subscription?(window?percent(remainingPercent(window.usedPercent))+' left':'Usage unavailable'):null,gpu?'GPU '+percent(gpu.utilizationPercent):resources?.local?'Local resources':null].filter(Boolean).join(' · ');
    meter.title='Resource measurements and recorded chair usage';
  }
  async function refresh(force=false){
    const chat=selection().chat;if(closed||busy||!chat||!force&&Date.now()-lastRefresh<4000)return;busy=true;
    try{
      const id=chat.id,results=await Promise.allSettled([api.goals(id),api.resourceMeters(id)]);
      if(selection().chat?.id!==id)return;
      if(results[0].status==='fulfilled')goals=results[0].value.goals;
      if(results[1].status==='fulfilled')resources=results[1].value;
      lastRefresh=Date.now();render();
      const target=document.getElementById('goal-live-status'),g=goals.find(g=>g.id===openedGoal);
      if(target&&openedChat===id&&g){const html=goalLive(g);if(target.innerHTML!==html)target.innerHTML=html;}
      renderResources();
    }finally{busy=false;}
  }
  async function openGoal(draft=null,historyId=null,newGoal=false){
    const chat=selection().chat;if(!chat)return;
    goals=(await api.goals(chat.id)).goals;const goal=historyId?goals.find(g=>g.id===historyId):newGoal?null:current(),revision=goal?.revisions.at(-1),historical=goal&&goal.id!==current()?.id;
    openedChat=chat.id;openedGoal=goal?.id??null;
    const limits=revision?.limits??{},chairs=recipients(),otherGoals=[...new Map((getState().deskWork?.goals??[]).filter(g=>g.chatId!==chat.id).map(g=>[g.chatId,g])).values()];
    openDialog('Conversation goal',`<p>For ${e(chat.title)} and its chairs. Configure your chairs and Coats with the usual app controls.</p>${goals.length>1?`<label class="form-field">Saved goal<select id="crew-goal-history">${goals.map(g=>`<option value="${e(g.id)}" ${g.id===goal?.id?'selected':''}>${e(g.revisions.at(-1).text.slice(0,100))}</option>`).join('')}</select></label>`:''}<form id="crew-goal-form" data-chat-id="${e(chat.id)}" data-base="${e(revision?.id??'')}" data-new="${newGoal}"><label class="form-field">Goal<textarea name="text" rows="3" maxlength="8000" required ${historical?'readonly':''}>${e(draft??revision?.text??'')}</textarea></label><details><summary>Optional completion criteria and limits</summary><label class="form-field">What would count as done?<textarea name="criteria" maxlength="4000" rows="2" ${historical?'readonly':''}>${e(revision?.criteria??'')}</textarea></label><p class="field-help">Open exploration is fine. These optional limits pause automatic goal work; explicit human messages still work. Token limits count only reported chair tokens, which may be incomplete.</p><div class="goal-limits">${[['minutes','Running minutes'],['turns','Chair turns'],['tokens','Reported tokens']].map(([name,label])=>`<label class="form-field">${label}<input type="number" name="${name}" min="1" step="1" value="${limits[name]??''}" placeholder="No chosen limit" ${historical?'readonly':''}></label>`).join('')}</div></details>${historical?'':`<button class="primary-button" type="submit">Save goal</button> <button class="quiet-button" type="button" data-crew-action="start" ${chairs.length?'':'disabled'}>Start with ${e(chairs.map(c=>c.name).join(', ')||'a selected chair')}</button><p class="field-help">Saving makes no model call. Start uses your current Select / All choice. You can also save, then send a prompt to @chairs to begin with that group.</p>`}</form>${goal&&!historical?`<div class="goal-actions">${goal.status==='running'?'<button type="button" class="quiet-button" data-crew-action="pause">Pause goal</button>':'<button type="button" class="quiet-button" data-crew-action="resume">Resume goal</button>'}<button type="button" class="quiet-button" data-crew-action="stop">Stop goal</button><button type="button" class="text-button" data-crew-action="complete">Mark complete</button></div>`:''}<div id="goal-live-status">${goalLive(goal)}</div><button type="button" class="text-button" data-crew-action="new-goal">New goal</button>${otherGoals.length?`<details><summary>Copy a goal from another conversation</summary><label class="form-field">Source conversation<select id="crew-copy-goal">${otherGoals.map(g=>`<option value="${e(g.chatId)}">${e(getState().chats.find(c=>c.id===g.chatId)?.title??'Conversation')} · ${e(g.revisions.at(-1).text.slice(0,80))}</option>`).join('')}</select></label><button type="button" class="quiet-button" data-crew-action="copy-goal">Copy as an independent draft</button></details>`:''}${revision?`<details><summary>Goal revisions · ${goal.revisions.length}</summary>${goal.revisions.map(v=>`<article><small>${e(v.at)}</small><p>${e(v.text)}</p>${v.criteria?`<p>${e(v.criteria)}</p>`:''}</article>`).join('')}</details>`:''}`,'crew-goal-dialog');
  }
  async function saveGoal(){
    const form=document.getElementById('crew-goal-form');if(!form.reportValidity())return false;
    const data=new FormData(form),limits=Object.fromEntries(['minutes','turns','tokens'].map(k=>[k,data.get(k)===''?null:Number(data.get(k))]));
    await command('goal.save',{chatId:form.dataset.chatId,text:data.get('text'),criteria:data.get('criteria'),baseRevision:form.dataset.base||null,newGoal:form.dataset.new==='true',limits});
    await clearGoalCommand?.(form.dataset.chatId);return true;
  }
  document.addEventListener('submit',event=>{
    const form=event.target;if(!['crew-goal-form','crew-input-form','busy-input-form'].includes(form.id))return;
    event.preventDefault();event.stopImmediatePropagation();void(async()=>{
      if(form.id==='crew-goal-form'){if(await saveGoal()){await openGoal();toast('Goal saved.');}}
      if(form.id==='crew-input-form'){await api.queuedInput({action:'edit',id:form.dataset.id,text:form.elements.text.value});await sync();closeDialog();toast('Queued message updated.');}
      if(form.id==='busy-input-form'){await command('input.preference',{mode:form.elements.mode.value});toast('Input preference saved.');}
    })().catch(err=>reportError(err.message));
  });
  document.addEventListener('change',event=>{if(event.target.id==='crew-goal-history')void openGoal(null,event.target.value).catch(err=>reportError(err.message));});
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-crew-action]');if(!button||button.dataset.working)return;event.preventDefault();button.dataset.working='true';
    void(async()=>{
      const action=button.dataset.crewAction,chat=selection().chat;if(!chat)return;
      if(action==='usage-details'){const id=button.dataset.id;if(expandedUsage.has(id))expandedUsage.delete(id);else expandedUsage.add(id);renderResources();return;}
      if(['edit','steer','remove','release'].includes(action)){
        if(action==='edit'){const task=getState().deskWork.tasks.find(t=>t.id===button.dataset.id),revision=getState().deskWork.events.findLast(e=>e.taskId===task.id&&e.kind==='input.revised');openDialog('Queued message',`<form id="crew-input-form" data-id="${e(task.id)}"><p>To ${e(task.label)}. Its captured recipient stays the same.</p><label class="form-field">Message<textarea name="text" rows="6" maxlength="200000" required>${e(revision?.detail.text??task.content)}</textarea></label><button type="submit" class="primary-button">Save queued message</button></form>`);return;}
        button.disabled=true;const result=await api.queuedInput({action,id:button.dataset.id});await sync();toast(result.state==='accepted'?'Steering accepted by the connection.':result.reason??(action==='remove'?'Pending message removed.':action==='release'?'Saved message released to the queue.':'Message remains queued.'));return;
      }
      if(action==='open-goal')return openGoal();
      if(action==='new-goal')return openGoal('',null,true);
      if(action==='copy-goal'){await command('goal.copy',{fromChatId:document.getElementById('crew-copy-goal').value,chatId:chat.id});return openGoal();}
      if(action==='evidence'){const record=await api.deskRecord({chatId:chat.id,id:button.dataset.id,offset:Number(button.dataset.offset??0),revision:button.dataset.revision??''});openDialog('Recorded evidence',`<p>Original source record · ${e(record.sourceRole)}</p><pre class="drawer-log">${e(record.text)}</pre>${record.nextOffset!==null?`<button type="button" class="quiet-button" data-crew-action="evidence" data-id="${e(record.id)}" data-revision="${e(record.revision)}" data-offset="${record.nextOffset}">Read next passage</button>`:''}`);return;}
      if(action==='start'){
        if(!await saveGoal())return;await prepareGoalStart?.();const r=chairRoster(getState(),selection().chat);await api.goalAction({chatId:chat.id,action:'start',chairIds:recipients().map(c=>c.id),baseRevisionId:r.revisionId,requestId:'goal_start_'+crypto.randomUUID(),toolsEnabled:document.getElementById('tools-enabled').checked});
      }else await api.goalAction({chatId:chat.id,action,chairId:button.dataset.chair});
      await sync();await openGoal();
    })().catch(err=>reportError(err.message)).finally(()=>{delete button.dataset.working;if(button.isConnected)button.disabled=false;});
  });
  goalButton.addEventListener('click',()=>void openGoal().catch(err=>reportError(err.message)));
  meter.addEventListener('click',()=>void(async()=>{await refresh(true);openDialog('Resource measurements',`<div id="crew-resource-view">${resourceView(resources,expandedUsage)}</div>`,'crew-resource-dialog');})().catch(err=>reportError(err.message)));
  const timer=setInterval(()=>{void refresh().catch(()=>{});},2000);
  window.addEventListener('pagehide',()=>{closed=true;clearInterval(timer);},{once:true});
  return {openGoal,render,refresh};
}
