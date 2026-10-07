import { api } from './api.js';
import { escapeHtml as e } from './views.js';

export function createToolPanel({ container, reportError }) {
  let pending = [], chatId = null, visible = true, rendered = '', loading = false;
  const render = () => {
    const items = pending.filter(p => p.chatId === chatId);
    container.hidden = !visible || !items.length;
    const key = JSON.stringify(items);
    if (key === rendered) return;
    rendered = key;
    container.innerHTML = items.map(p => `<form class="tool-card" data-tool-id="${e(p.id)}">
      <strong>${e(p.modelLabel)} · ${p.kind === 'web' ? 'Read a public page?' : 'A question for you'}</strong>
      ${p.kind === 'web' ? `<p>${e(p.reason)}</p><p class="tool-url">${e(p.url)}</p><p class="field-help">Reads this page and redirects on the same site. Its text joins this conversation and is sent to the replying model. No sign-in or cookies.</p><div class="tool-buttons"><button type="button" class="primary-button" data-decision="allow">Read page</button><button type="button" class="quiet-button" data-decision="decline">Decline</button></div>`
      : `<label>${e(p.question)}<input name="answer" aria-label="Your answer" maxlength="4000" autocomplete="off" placeholder="Choose below or type your answer"></label><div class="tool-buttons">${p.choices.map(c=>`<button type="button" class="quiet-button" data-answer="${e(c)}">${e(c)}</button>`).join('')}<button class="primary-button" type="submit">Send answer</button><button type="button" class="quiet-button" data-decision="skip">Skip</button></div>`}
      <p class="field-help">Waiting for you · Stop cancels this request. An unanswered request expires.</p></form>`).join('');
  };
  const refresh = async () => {
    if (loading) return;
    loading = true;
    try { pending = await api.toolPending(); render(); }
    finally { loading = false; }
  };
  const answer = async (form, value) => {
    const buttons = [...form.querySelectorAll('button')]; buttons.forEach(b=>b.disabled=true);
    try { await api.toolAnswer({ id:form.dataset.toolId, ...value }); await refresh(); }
    catch (err) { reportError(err.message); await refresh().catch(()=>{}); }
    finally { buttons.forEach(b=>b.disabled=false); }
  };
  container.addEventListener('submit', event => {
    event.preventDefault(); const form = event.target;
    const value = form.elements.answer?.value.trim();
    if (value) void answer(form,{answer:value});
  });
  container.addEventListener('click', event => {
    const button = event.target.closest('button'), form = button?.closest('form');
    if (!form || button.type === 'submit') return;
    void answer(form,button.dataset.decision ? {decision:button.dataset.decision} : {answer:button.dataset.answer});
  });
  return { refresh, show(id, shown = true) { chatId=id; visible=shown; render(); } };
}

export function toolHistory(state, exchangeId) {
  const records = (state.handoffs?.records || []).filter(r=>r.taskId===exchangeId && r.detail.toolProfile && ['operation.result','tool.held','tool.answer'].includes(r.kind));
  if (!records.length) return '';
  return '<h3>Tools used in this exchange</h3>' + records.map(r=>`<details class="tool-receipt"><summary>${e(r.detail.tool)}${r.detail.result?.value?.sourceRole === 'selected_file_evidence' ? ' · chars '+r.detail.result.value.offset+'–'+r.detail.result.value.end+' / '+r.detail.result.value.totalCharacters : ''} · ${r.kind==='tool.answer'?'your answer':r.detail.result?.ok?'completed':'held'}</summary><pre>${e(JSON.stringify(r.detail.result ?? r.detail.answer,null,2))}</pre><small>${e(r.id)} · ${e(r.at)}</small></details>`).join('');
}
