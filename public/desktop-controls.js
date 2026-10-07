import { escapeHtml as e } from './views.js';
import { recorderSelect, recorderHint } from './recorder.js';
import { RESOURCE_FIELDS, RESOURCE_DEFAULTS, resourceSettings, carrySettings } from './resource-settings.js';
export { RESOURCE_DEFAULTS };

export function resourcesForm(root) {
  if (!root) return '<p>Open a desk to adjust its resource settings. Existing desks keep their saved choices.</p>';
  const values = resourceSettings(root);
  return `<form id="resources-form" data-root-id="${e(root.id)}"><p>For ${e(root.name)}. Changes apply to later replies; they do not resize a model you loaded elsewhere.</p>
    ${Object.entries(RESOURCE_FIELDS).map(([key, f]) => `<label class="form-field">${e(f.label)}<input type="number" name="${key}" min="${f.min}" max="${f.max}" step="1" value="${values[key] ?? ''}" ${key === 'replyTokens' ? 'placeholder="Connection default"' : 'required'}><small class="field-help">${e(f.help)} Default: ${RESOURCE_DEFAULTS[key] ?? 'connection default'}.</small></label>`).join('')}
    <p class="field-help">The included Qwen uses an 8,192-token window and a 2,048-token reply default. Input estimates reserve room for output and sources. Settings never grant a tool or load another model. Runner backend and Unload are in Models and affect only Branchline’s own runner.</p>
    <button type="submit" class="primary-button">Save resources</button> <button type="button" class="quiet-button" data-action="resources-reset">Reset to defaults</button></form>`;
}
export function conversationSettings(state, root, chat) {
  if (!chat) return '<p>Open a conversation to set its handoff preferences.</p><button type="button" class="quiet-button" data-action="tour-replay">Replay welcome tour</button>';
  const v = carrySettings(chat), assignment = chat.table?.assignments.at(-1);
  const personal = state.personalParticipants?.find(p => p.id === assignment?.personalId);
  const labels = { personal: state.models.find(m => m.id === personal?.connections.at(-1)?.modelId)?.name,
    visiting: state.models.find(m => m.id === (assignment ? assignment.visitorModelId : root?.modelId))?.name };
  return `<form id="conversation-settings-form" data-chat-id="${e(chat.id)}"><p>One shared account for both chairs. Original history stays in this branch, with sources available to reopen.</p>
    <label class="form-field">Handoff recorder${recorderSelect(state, chat, v.speaker)}</label><p class="field-help recorder-role">${e(recorderHint(v.speaker))}</p>
    <label class="settings-check"><input type="checkbox" name="automatic" ${v.automatic ? 'checked' : ''}> Prepare automatically as space fills</label>
    <p class="field-help">Turning this on permits bounded account-writing requests on the selected connection, including sending the selected older conversation to that provider. It can use your subscription or provider allowance. Existing sharing review still applies. The recorder receives selected sources and the writing task, with no tools. One attempt per eligible cutoff; Stop pauses automatic preparation until you deliberately continue again. Nothing resumes automatically after an interrupted request.</p>
    <label class="settings-check"><input type="checkbox" name="review" ${v.review ? 'checked' : ''}> Review prepared accounts before use</label>
    <label class="settings-check"><input type="checkbox" name="nearPopup" ${v.nearPopup ? 'checked' : ''}> Show a notice near the working limit</label>
    <label class="settings-check"><input type="checkbox" name="showCount" ${v.showCount ? 'checked' : ''}> Show the estimated count beside the thought cloud</label>
    <p class="field-help">A ready account takes effect before the next reply is compiled. Compatible HTTP connections can keep chatting during preparation; the included model and Codex use a queue. A provider may serialize its own requests. Your draft is never sent to the recorder.</p>
    <button class="primary-button" type="submit">Save conversation settings</button></form>
    <hr><button class="quiet-button" type="button" data-action="hearth-open">Work together at the hearth</button> <button class="quiet-button" type="button" data-action="tour-replay">Replay welcome tour</button>`;
}

export const DREAM_PREPARATION = `Help me prepare a Dream workflow for my personal model. This request is preparation only: do not train, purchase, upload, create accounts, or change my active model.
Start with the model, source material I deliberately select, hardware and budget I provide. Preserve original speaker/model attribution, corrections, decisions, source handles and unfinished questions. Separate fictional lessons from observed events and keep private material private.
Distinguish a model-weight training experiment from a portable conversation handoff or Coat. A handoff preserves conversation context; it does not train weights or rewrite my Coat. Do not turn transcripts into a training set without my explicit selection and review.
Propose a bounded plan with reviewed examples, held-out checks, preserved ancestor adapters, resource estimates, experimental candidate labels, stopping conditions and a route back. Identify consequential missing decisions. Return the plan for my review before I turn the key.`;

export const TOUR_STEPS = [
  ['Welcome', null, 'Welcome to Branchline. This is your space for conversations with models you choose. Let’s take a quick look around.'],
  ['Personal chair', '[data-action="choose-model"][data-id="personal"], [data-action="library"][data-id="personal"]', 'Your Personal chair is a continuing participant. Choose its model connection in My Models. Earlier conversation stays attributed to the model that actually spoke.'],
  ['Dreams', '.dreams-section', 'Dreams are being built to help a personal model learn from material you choose. For now, you can copy a preparation prompt and review a plan. Training and schedules are not connected.'],
  ['Desks', '[data-action="desks"], [data-action="library"][data-id="desks"]', 'A desk groups related conversation branches. Use a desk for a project, an interest, or simply somewhere to talk.'],
  ['Toy Shelf', '.toy-shelf-section', 'Home’s Toy Shelf holds little starting places. New desk starts a conversation space. Manage Shelves chooses what appears here, and the lower grip adjusts the shelf’s height.'],
  ['Branches', '#new-chat, [data-action="library"][data-id="branches"]', 'Branch from a conversation point to explore another path, or start a fresh conversation. Each branch keeps its own history and sources. Other branches do not silently join its context.'],
  ['Coats', '[data-action="harnesses"], [data-action="library"][data-id="harnesses"]', 'A Coat carries the guidance and tool pockets you choose for a chair. Each saved model has a usual Coat; a branch can keep its own choice. A handoff does not rewrite it or grant new tools.'],
  ['Settings', '#settings-button', 'The gear opens settings, including conversation handoffs and resource limits. The plus beside your message is for attachments. You can replay this tour here anytime.'],
];
export function createWelcomeTour({ complete }) {
  let dialog, index = 0, focus, anchor;
  const position = () => {
    if (!dialog) return;
    const gap=16, box=dialog.getBoundingClientRect(), width=box.width, height=box.height;
    let x=(innerWidth-width)/2, y=(innerHeight-height)/2;
    if (anchor) {
      const r=anchor.getBoundingClientRect();
      x=r.left; y=r.bottom+gap;
      if (y+height>innerHeight-gap) y=r.top-height-gap;
    }
    dialog.style.margin='0'; dialog.style.position='fixed';
    dialog.style.left=Math.max(gap,Math.min(x,innerWidth-width-gap))+'px';
    dialog.style.top=Math.max(gap,Math.min(y,innerHeight-height-gap))+'px';
  };
  const clearAnchor = () => { anchor?.classList.remove('tour-anchor'); anchor = null; };
  const finish = async skipped => {
    window.removeEventListener('resize',position); clearAnchor(); dialog?.close(); dialog?.remove(); dialog = null;
    if (focus?.isConnected) focus.focus();
    await complete({ version: 1, completedAt: new Date().toISOString(), skipped });
  };
  const draw = () => {
    clearAnchor(); const [title, selector, text] = TOUR_STEPS[index];
    anchor = selector ? [...document.querySelectorAll(selector)].find(el => el.getClientRects().length) : null;
    anchor?.scrollIntoView({block:'nearest',behavior:'instant'});
    anchor?.classList.add('tour-anchor');
    dialog.innerHTML = `<p class="field-help">${index + 1} of ${TOUR_STEPS.length}</p><h2 id="welcome-title">${e(title)}</h2><p>${e(text)}</p>${selector && !anchor ? `<p class="tour-preview" aria-label="Tour preview">${e(title)} · appears when you open a desk</p>` : ''}<label class="settings-check"><input id="tour-skip" type="checkbox"> Skip tutorial</label><div class="dialog-footer">${index ? '<button type="button" class="quiet-button" id="tour-back">Back</button>' : ''}<button type="button" class="primary-button" id="tour-next">${index === TOUR_STEPS.length - 1 ? 'Finish' : 'Next'}</button></div>`;
    dialog.querySelector('#tour-skip').onchange = event => { dialog.querySelector('#tour-next').textContent = event.target.checked || index === TOUR_STEPS.length - 1 ? 'Finish' : 'Next'; };
    dialog.querySelector('#tour-next').onclick = () => { const skip = dialog.querySelector('#tour-skip').checked; if (skip || index === TOUR_STEPS.length - 1) void finish(skip); else { index++; draw(); } };
    if (index) dialog.querySelector('#tour-back').onclick = () => { index--; draw(); };
    position(); dialog.querySelector('#tour-next').focus({preventScroll:true});
  };
  return { start() { if (dialog) return; focus = document.activeElement; index = 0;
    dialog = document.createElement('dialog'); dialog.className = 'welcome-tour'; dialog.setAttribute('aria-labelledby','welcome-title');
    dialog.addEventListener('cancel', event => { event.preventDefault(); void finish(true); });
    window.addEventListener('resize',position); document.body.append(dialog); dialog.showModal(); draw();
  } };
}
