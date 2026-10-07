import { api } from './api.js';
import { isHearth, hearthActor, hearthDetails, openHearthRun } from './hearth.js';

const e = (value = '') => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export const liveParallel = run => ['queued', 'running'].includes(run.status);
export const agentSettings = state => state.parallel?.settings.at(-1) ?? { id:null, enabled:false, automaticRequests:false };
const label = seat => seat === 'personal' ? 'Personal' : seat === 'visiting' ? 'Visiting' : 'Selected model';

export function agentSettingsForm(state) {
  const s = agentSettings(state);
  return `<form id="agent-settings-form" data-revision="${e(s.id || '')}"><h3>Agents for the task at hand</h3><p class="field-help">Try another approach to the same task, with the conversation context carried into each episode. Approaches run one at a time on this device.</p><fieldset class="agent-choice"><legend>Allow your agent to create other agents for a task at hand?</legend><label><input type="radio" name="enabled" value="yes" ${s.enabled ? 'checked' : ''}> Yes</label><label><input type="radio" name="enabled" value="no" ${!s.enabled ? 'checked' : ''}> No</label></fieldset><p class="field-help">When enabled, you choose when to start a task from Conversation settings → Work together at the hearth.</p><label class="agent-opt-in"><input type="checkbox" name="automaticRequests" ${s.automaticRequests ? 'checked' : ''} ${s.enabled ? '' : 'disabled'}><span>Let the model request shared agent work without asking me first.</span></label><p class="field-help">Branchline checks each request against the task’s existing context, permissions and shared limits. This option starts off unchecked. It adds no file-editing or computer-control tools.</p><p class="field-help">The hearth opens two continuing peers with a shared allowance. Choose a quick task or explicitly allow a longer workday. These peers receive conversation tools from their Coats. PC file tools belong to a foreground chair and are not inherited by peers. A second approach may use the same model. Model requests can use local chairs, or the selected OpenAI chair when the original reply is already going to OpenAI.</p><div class="dialog-footer"><button class="primary-button" type="submit">Save agent settings</button></div></form>`;
}

export function updateAgentForm(form, target) {
  const enabled = form.elements.enabled.value === 'yes', automatic = form.elements.automaticRequests;
  automatic.disabled = !enabled;
  if (!enabled) { automatic.checked = false; form.dataset.confirmAutomatic = 'false'; }
  else if (target === automatic) form.dataset.confirmAutomatic = String(automatic.checked);
}

export function approachForm(chatId, content, options, toolsEnabled) {
  const choices = options.models.map(m => `<option value="${e(m.seat)}" data-cloud="${m.cloud}">${label(m.seat)} · ${e(m.name)}</option>`).join('');
  return `<form id="parallel-start-form" data-chat-id="${e(chatId)}" data-basis="${options.basisHash}" data-request-id="approach_${crypto.randomUUID()}"><p class="field-help">Give two episodes the same task and starting conversation. Each explores its own angle; their findings stay separately attributed in this branch.</p><label class="form-field">Shared task<textarea name="content" rows="4" maxlength="20000" required autofocus>${e(content)}</textarea></label><div class="approach-grid">${[0,1].map(i => `<fieldset><legend>Approach ${i+1}</legend><label class="form-field">Model<select name="seat${i}" required>${choices}</select></label><label class="form-field">Angle<textarea name="angle${i}" maxlength="1000" rows="3" required>${i ? 'Explore another route. Identify assumptions and any unresolved differences.' : 'Develop a practical approach using the context already available.'}</textarea></label></fieldset>`).join('')}</div><label class="agent-opt-in"><input type="checkbox" name="toolsEnabled" ${toolsEnabled ? 'checked' : ''}> Allow the existing conversation tools</label><p class="field-help">Two model replies, run in sequence. They share 8 tool calls and a 10-minute limit. Public pages still need approval. Findings do not authorize actions.</p><label class="agent-opt-in" data-cloud-choice hidden><input type="checkbox" name="cloudApproved"> Send this task and its selected conversation context to OpenAI for the chosen chair.</label><div class="dialog-footer"><button class="quiet-button" type="button" data-action="close-dialog">Cancel</button><button class="primary-button" type="submit" ${options.models.length ? '' : 'disabled'}>Start two approaches</button></div>${options.models.length ? '' : '<p class="notice">Choose a model in a chair first.</p>'}</form>`;
}

export function updateApproachForm(form) {
  const cloud = [form.elements.seat0, form.elements.seat1].some(select => select.selectedOptions[0]?.dataset.cloud === 'true');
  form.querySelector('[data-cloud-choice]').hidden = !cloud;
  form.elements.cloudApproved.required = cloud;
  if (!cloud) form.elements.cloudApproved.checked = false;
}

export function approachDetails(state, id) {
  const job = state.parallel?.jobs.find(j => j.id === id);
  const run = state.parallel?.runs.find(r => r.id === (job?.runId || id));
  if (!run) return '<p>The task record was not found.</p>';
  if (isHearth(run)) return hearthDetails(state,id);
  const jobs = state.parallel.jobs.filter(j => j.runId === run.id);
  return `<p class="eyebrow">${e(run.status)} · ${run.origin === 'model' ? 'Requested by a model under your opt-in' : 'Started by you'}</p><h3>Shared task</h3><p class="parallel-purpose">${e(run.purpose)}</p>${jobs.map((j,i) => `<section class="approach-detail"><h3>Approach ${i+1} · ${e(j.model.name)}</h3><p>${e(j.angle)}</p><p class="field-help">${e(j.status)}${j.finishReason ? ' · '+e(j.finishReason) : ''}</p>${j.error ? `<p class="notice">${e(j.error)}</p>` : ''}</section>`).join('')}${run.error ? `<p class="notice">${e(run.error)}</p>` : ''}<p class="field-help">${run.usage.modelRounds} model requests · ${run.usage.toolCalls} tool calls · ${run.usage.outputCharacters.toLocaleString()} output characters</p><p class="field-help">${run.origin === 'model' ? 'The requesting model chose the extra angle. Treat this as another contribution, not independent confirmation.' : 'Both first passes used the same starting context, without reading one another’s new findings.'} Continue the conversation to work through their findings or differences.</p><details><summary>Source record</summary><p class="field-help parallel-source">Task: ${e(run.id)}<br>Context: ${e(run.contextHash)}<br>Admission: ${e(run.admissionId)}</p></details>`;
}

// Poll small status records while work is active. Fetch the saved conversation
// only when a status changes, and never overwrite a newer local/SSE response.
export function createParallelMonitor({ container, getState, applyState, busy, refreshTools, reportError }) {
  let timer, ticking = false, viewChat = null, visible = false, failures = 0, lastRuntimeError = null;
  const snapshots = new Map(), dismissed = new Set();
  function paint() {
    const state = getState();
    const run = state?.parallel?.runs.filter(r => r.chatId === viewChat).at(-1);
    container.hidden = !visible || !run || run.status === 'completed' || dismissed.has(run.id);
    if (container.hidden) return;
    const live = liveParallel(run), jobs = state.parallel.jobs.filter(j => j.runId === run.id), snapshot = snapshots.get(run.id);
    const active = jobs.findIndex(j => j.status === 'pending');
    const hearth=isHearth(run), open=hearth?openHearthRun(run):live;
    const heading = hearth ? run.status==='waiting'?'The hearth needs your input':live?active>=0?`${hearthActor(jobs[active].peerName||jobs[active].hearthActor)} · ${jobs[active].model.name}`:'Next episode queued':`Hearth · ${run.status}` : live ? active >= 0 ? `Approach ${active+1} of ${jobs.length} · ${jobs[active].model.name}` : 'Additional approach queued' : `Approaches ${run.status}`;
    const key = JSON.stringify([run.id,run.status,active,run.error,jobs.map(j=>j.status)]);
    if (container.dataset.key !== key) {
      container.dataset.key = key;
      container.innerHTML = `<div class="parallel-summary"><span role="status">${e(heading)}</span><div><button type="button" class="text-button" data-action="${hearth?'hearth-details':'parallel-details'}" data-id="${e(run.id)}">${hearth?'Open hearth':'Details'}</button><button type="button" class="text-button" data-action="${open ? 'parallel-cancel' : 'parallel-dismiss'}" data-id="${e(run.id)}">${open ? 'Stop' : 'Dismiss'}</button></div></div>${live ? '<details class="parallel-live"><summary>Current contribution</summary><pre></pre></details>' : `<p class="field-help">${e(run.error || (run.status==='waiting'?'The other peer’s work is saved. Your clarification will return to the hearth.':'Completed contributions remain in the conversation.'))}</p>`}`;
    }
    const output = container.querySelector('.parallel-live pre');
    if (output) output.textContent = snapshot?.liveText || 'Waiting for the next contribution…';
  }
  function schedule() {
    if (!timer && !ticking && getState()?.parallel?.runs.some(openHearthRun)) timer = setTimeout(tick,getState().parallel.runs.some(liveParallel)?650:2500);
  }
  async function tick() {
    timer = null; ticking = true;
    try {
      const state = getState(), active = state?.parallel?.runs.find(openHearthRun);
      if (!active || busy()) return;
      const result = await api.parallelStatus(active.chatId);
      if (result.runtimeError && result.runtimeError !== lastRuntimeError) {
        lastRuntimeError = result.runtimeError; reportError('An approach could not be saved: '+result.runtimeError);
      }
      for (const s of result.runs) snapshots.set(s.id,s);
      const signature = run => JSON.stringify([run?.status,run?.error,run?.waitingForUser,run?.mailCount??run?.mail?.length??0,run?.jobs?.map(j=>[j.id,j.status])]);
      const actual = result.runs.find(r=>r.id === active.id);
      const local = { ...active, jobs:state.parallel.jobs.filter(j=>j.runId === active.id) };
      if (actual && signature(actual) !== signature(local)) {
        const before = getState(), next = await api.state();
        if (getState() === before && !busy()) applyState(next);
      }
      await refreshTools(); failures = 0; paint();
    } catch (err) { if (++failures === 3) reportError('Could not refresh the approaches: '+err.message); }
    finally { ticking = false; schedule(); }
  }
  return {
    show(chatId, show) { viewChat = chatId; visible = show; paint(); schedule(); },
    dismiss(id) { dismissed.add(id); paint(); },
    dispose() { clearTimeout(timer); timer = null; },
  };
}
