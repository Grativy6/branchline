const e=(value='')=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const taskFor=(state,chatId)=>state.ponyPost?.tasks.find(t=>t.id===state.ponyPost.bindings.filter(b=>b.chatId===chatId).at(-1)?.taskId);
const policyFor=task=>task.amendments.at(-1)?.policy??task.policy;
function usageFor(state,task){
  const trips=state.ponyPost.trips.filter(t=>t.taskId===task.id),policy=policyFor(task);
  const started=trips.filter(t=>t.send).length,reserved=trips.filter(t=>t.status==='reserved').length,returned=trips.filter(t=>t.return).length;
  return {trips,policy,started,reserved,returned,available:policy.mode==='unlimited'?null:Math.max(0,policy.limit-started-reserved)};
}
const room=n=>n===null?'no fixed limit':`${n} available`;

export function ponySummary(state,chatId){
  const task=taskFor(state,chatId),settings=state.parallel?.settings.at(-1),choice=settings?.pony;
  if(!task&&!choice?.enabled)return '';
  const usage=task?usageFor(state,task):null;
  const label=task?`${usage.reserved?usage.reserved+' queued · ':''}${usage.started} sent · ${usage.returned} returned · ${room(usage.available)}`:`${choice.mode==='unlimited'?'No fixed round-trip limit':choice.limit+' round trip'+(choice.limit===1?'':'s')} per new task`;
  return `<div class="pony-summary"><button type="button" class="text-button" data-action="pony-open">Pony Post · ${e(label)}</button>${task?`<span class="field-help">${e(task.status)}</span>`:''}<button type="button" class="text-button" data-action="pony-new">New task</button></div>`;
}

export function ponyDetails(state,chatId){
  const task=taskFor(state,chatId),chat=state.chats.find(c=>c.id===chatId),tasks=(state.ponyPost?.tasks??[]).filter(t=>t.rootId===chat?.rootId);
  const select=tasks.length?`<label class="form-field">Task for this conversation<select id="pony-task-choice"><option value="">Choose a task</option>${tasks.map(t=>`<option value="${e(t.id)}" ${task?.id===t.id?'selected':''}>${e(t.purpose.slice(0,100))} · ${e(t.status)}</option>`).join('')}</select></label>`:'';
  const controls=`<div class="dialog-footer"><button type="button" class="quiet-button" data-action="pony-new">New task</button><button type="button" class="text-button" data-action="settings-tab" data-id="agents">Agent settings</button></div>`;
  if(!task)return `${select}<p>No task is selected yet. Start one here, or let the first admitted helper request open it. Later messages continue that task until you choose another.</p>${controls}`;
  const u=usageFor(state,task),canSend=task.status==='open'&&(u.available===null||u.available>0);
  return `${select}<h3>${e(task.purpose)}</h3><p class="pony-usage" role="status">${e(u.policy.mode==='unlimited'?'No fixed round-trip limit':u.policy.limit+' round trip'+(u.policy.limit===1?'':'s')+' allowed')} · ${u.started} sent · ${u.returned} returned · ${u.reserved} reserved · ${e(room(u.available))}</p>
    <p class="field-help">A round trip includes its send and matching return. Steering and new rooms do not refill this task. Helper work currently runs one at a time on the admitted model connection.</p>
    <details class="field-help"><summary>Other work limits</summary><p>Each work window allows up to 10 minutes, 10 model calls, 8 tool calls, 48,000 bytes of tool results and 40,000 output characters. A helper reply retains at most 20,000 characters. Onward helpers share their originating window. A later foreground reply has its own work window and draws from this same remaining round-trip balance. Provider and connection limits also apply.</p></details>
    <div class="pony-task-actions"><button type="button" class="primary-button" data-action="pony-send" ${canSend?'':'disabled'}>Send pony task</button><button type="button" class="quiet-button" data-action="pony-amend">Change allowance</button>${task.status==='open'?`<button type="button" class="quiet-button" data-action="pony-stop" data-id="${e(task.id)}">Stop task</button><button type="button" class="text-button" data-action="pony-complete" data-id="${e(task.id)}">Task complete</button>`:`<button type="button" class="quiet-button" data-action="pony-resume" data-id="${e(task.id)}">Resume task</button>`}</div>
    <div class="pony-trips">${u.trips.map(t=>`<details class="pony-trip"><summary>${e(t.assignment)} · ${e(t.return?.outcome==='partial'?'partial return':t.status==='sent'?'awaiting return':t.status)}</summary><p class="field-help">${t.send?'pony task send · '+e(t.send.at):'Reserved before departure'}${t.return?'<br>pony task return · '+e(t.return.at)+(t.return.outcome==='partial'?' · partial':'')+(t.return.late?' · late return retained':''):t.send?'<br>No matching return recorded yet.':''}</p>${t.return?`<p class="pony-return">${e(t.return.text)}</p>`:''}${t.return?.note||t.error?`<p class="notice">${e(t.return?.note||t.error)}</p>`:''}${t.return&&canSend?`<button class="text-button" type="button" data-action="pony-followup" data-id="${e(t.ponyTaskId)}">Another round trip on this pony task</button>`:''}<p class="field-help">Trip ${e(t.id)}${t.parentTripId?'<br>Requested within trip '+e(t.parentTripId):''}</p></details>`).join('')||'<p>No trips yet. The allowance is available, not a quota to spend.</p>'}</div>${controls}`;
}

export function ponyNewForm(chatId,purpose=''){
  return `<form id="pony-new-form" data-chat-id="${e(chatId)}" data-request-id="pony_new_${crypto.randomUUID()}"><label class="form-field">Task purpose<textarea name="purpose" rows="3" maxlength="20000" required>${e(purpose)}</textarea></label><p class="field-help">A new task receives your current default allowance. This saves the task; it does not call a model.</p><div class="dialog-footer"><button class="quiet-button" type="button" data-action="pony-open">Back</button><button class="primary-button" type="submit">Start task</button></div></form>`;
}
export function ponyAmendForm(state,chatId){
  const task=taskFor(state,chatId),policy=policyFor(task);
  return `<form id="pony-amend-form" data-task-id="${e(task.id)}" data-revision="${task.amendments.length}" data-request-id="pony_amend_${crypto.randomUUID()}"><label class="form-field">Change<select name="change"><option value="set">Set total allowance</option><option value="add" ${policy.mode==='unlimited'?'disabled':''}>Add round trips</option><option value="unlimited" ${policy.mode==='unlimited'?'selected':''}>No fixed round-trip limit</option></select></label><label class="form-field">Round trips<input type="number" name="value" min="0" step="1" required value="${policy.limit??1}" ${policy.mode==='unlimited'?'disabled':''}></label><label class="form-field">Note (optional)<input type="text" name="note" maxlength="1000"></label><p class="field-help">The changed total keeps past usage. A matching return is still recordable even if you lower the allowance to zero.</p><div class="dialog-footer"><button class="quiet-button" type="button" data-action="pony-open">Back</button><button class="primary-button" type="submit">Save allowance</button></div></form>`;
}
export function ponySendForm(state,chatId,options,ponyTaskId=null){
  const task=taskFor(state,chatId);
  return `<form id="pony-send-form" data-chat-id="${e(chatId)}" data-basis="${e(options.basisHash)}" data-pony-task-id="${e(ponyTaskId??'')}" data-request-id="pony_send_${crypto.randomUUID()}"><p>${e(task.purpose)}</p><label class="form-field">Assignment<textarea name="assignment" rows="3" maxlength="1000" required></textarea></label><label class="form-field">Recipient<select name="modelId" required>${options.models.map(m=>`<option value="${e(m.id)}" data-cloud="${m.cloud}">${e(m.name)}</option>`).join('')}</select></label><label class="agent-opt-in"><input type="checkbox" name="allowSubtasks">Allow this helper to request further pony tasks from the same allowance</label><label class="agent-opt-in"><input type="checkbox" name="toolsEnabled">Allow the existing conversation tools</label><label class="agent-opt-in" data-pony-cloud hidden><input type="checkbox" name="cloudApproved">Send the selected task context to OpenAI for this recipient</label><p class="field-help">One round trip is reserved, including its return. Computer tools and new permissions are not inherited.</p><div class="dialog-footer"><button class="quiet-button" type="button" data-action="pony-open">Back</button><button class="primary-button" type="submit" ${options.models.length?'':'disabled'}>pony task send</button></div></form>`;
}
export function updatePonyForm(form){
  if(form.id==='pony-send-form'){
    const cloud=form.elements.modelId.selectedOptions[0]?.dataset.cloud==='true';form.querySelector('[data-pony-cloud]').hidden=!cloud;form.elements.cloudApproved.required=cloud;if(!cloud)form.elements.cloudApproved.checked=false;
  }else if(form.id==='pony-amend-form')form.elements.value.disabled=form.elements.change.value==='unlimited';
}
