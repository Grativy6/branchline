import { api } from './api.js';
import { chairRoster } from './chair-roster.js';
import { conversationMessage } from './conversation-records.js';

const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button = (action, label, id = '') => `<button type="button" class="quiet-button" data-post="${action}" data-id="${e(id)}">${label}</button>`;
export function createPonyPost({ getState, getChat, show, refresh, reportError }) {
  let view = null, rootId = null, draft = null, visibleCount = 60;
  const cache = new Map(), pending = new Set();
  const state = () => getState();
  const deskName = id => view?.desks.find(d => d.id === id)?.name ?? id;
  const visibleChat = id => state().chats.find(c => c.id === id && !c.archivedAt);
  function chairs(chatId, selected) {
    const chat = visibleChat(chatId); if (!chat) return '';
    const r = chairRoster(state(), chat);
    return [r.desk, ...r.visitors].filter(c => c.modelId).map(c => `<option value="${e(c.id)}" ${c.id === selected ? 'selected' : ''}>${e(c.name)}</option>`).join('');
  }
  async function open(nextRoot = getChat()?.rootId) {
    view = await api.pony('home'); if(nextRoot&&nextRoot!==rootId)visibleCount=60; rootId = nextRoot ?? rootId ?? view.desks[0]?.id;
    const desk = view.desks.find(d => d.id === rootId), setting = desk?.setting;
    const chats = state().chats.filter(c => c.rootId === rootId && !c.archivedAt);
    const receivingChat = visibleChat(setting?.address.chatId)?.id ?? (getChat()?.rootId === rootId ? getChat().id : chats[0]?.id);
    const parcels = view.parcels.filter(p => p.source.rootId === rootId || p.destination.rootId === rootId).slice(-visibleCount).reverse();
    show('Pony Post', `<div class="pony-home"><p class="field-help">A home for mail between desks. Notices arrive quietly. Requests join the receiving chair’s queue.</p>
      <label class="form-field">Desk<select data-post-drawer>${view.desks.map(d => `<option value="${e(d.id)}" ${d.id === rootId ? 'selected' : ''}>${e(d.name)} · ${d.setting?.enabled ? 'On' : 'Off'}</option>`).join('')}</select></label>
      ${desk ? `<form id="postal-address" data-root="${e(rootId)}"><label class="agent-opt-in"><input name="enabled" type="checkbox" ${setting?.enabled ? 'checked' : ''}>Pony Post on for this desk</label>
      <div class="pony-address"><label class="form-field">Receiving conversation<select name="chatId">${chats.map(c => `<option value="${e(c.id)}" ${c.id === receivingChat ? 'selected' : ''}>${e(c.name ?? c.title)}</option>`).join('')}</select></label>
      <label class="form-field">Receiving chair<select name="chairId">${chairs(receivingChat, setting?.address.chairId)}</select></label></div><button class="quiet-button" type="submit">Save address</button></form>` : '<p>Create a desk first.</p>'}
      <div class="dialog-footer">${button('new','New parcel')}${button('refresh','Refresh')}</div>
      <h3>Mail for ${e(desk?.name ?? 'this workspace')}</h3>${view.error ? `<p role="alert">${e(view.error)}</p>` : ''}
      ${parcels.length ? parcels.map(p => `<article class="pony-parcel"><button type="button" class="text-button" data-post="read" data-id="${e(p.id)}">${e(p.kind === 'reply' ? 'Return' : p.kind === 'request' ? 'Request' : 'Notice')} · ${e(deskName(p.source.rootId))} → ${e(deskName(p.destination.rootId))}</button><span data-post-status="${e(p.id)}">${e(p.status)}</span><small>${e(new Date(p.at).toLocaleString())} · ${e(p.author.name)}</small></article>`).join('') : '<p>No mail here yet.</p>'}
      ${view.parcels.filter(p=>p.source.rootId===rootId||p.destination.rootId===rootId).length>visibleCount?button('older','Show older mail'):''}
      ${view.legacy ? `<details><summary>Earlier Pony task records</summary><p>These are the earlier helper-task round trips, retained as originally recorded.</p>${(view.legacy.tasks ?? []).map(t => `<p>${e(t.purpose)} · ${e(t.status)}</p>`).join('')}<p>${view.legacy.trips?.length ?? 0} recorded trips.</p></details>` : ''}</div>`, 'settings-dialog');
  }
  async function compose(messageId = null) {
    view = await api.pony('home');
    const m = messageId && conversationMessage(state(), messageId), chat = m ? visibleChat(m.chatId) : getChat() ?? state().chats.find(c => c.rootId === rootId && !c.archivedAt);
    if (!chat) throw new Error('Open a sending conversation first.');
    const r = chairRoster(state(), chat), text = m?.kind === 'pony' ? (await api.pony('parcel?id=' + encodeURIComponent(m.ponyParcelId))).text : m?.content ?? '';
    draft = { requestId: 'mail_' + crypto.randomUUID(), chatId: chat.id, chairId: r.desk.id, messageId: m?.id ?? null };
    const turn = m?.exchangeId && state().exchanges.find(t => t.id === m.exchangeId);
    const enabled = view.desks.find(d => d.id === chat.rootId)?.setting?.enabled;
    show('Send with Pony Post', `<form id="postal-send"><p>From ${e(deskName(chat.rootId))} · ${e(chat.name ?? chat.title)}</p>
      ${enabled ? '' : '<p>Turn Pony Post on for this desk in its postal address.</p>'}
      <label class="form-field">To desk<select name="destinationRootId" required>${view.desks.filter(d => d.id !== chat.rootId).map(d => `<option value="${e(d.id)}" ${d.setting?.enabled ? '' : 'disabled'}>${e(d.name)}${d.setting?.enabled ? '' : ' · Off'}</option>`).join('')}</select></label>
      <label class="form-field">Delivery<select name="kind"><option value="notice">Notice · no automatic reply</option><option value="request">Request a reply · queue in its chair</option></select></label>
      <label class="form-field">Message<textarea name="text" rows="8" maxlength="100000" required>${e(text)}</textarea></label>
      ${turn?.selectedFile ? `<label class="agent-opt-in"><input type="checkbox" name="attachText">Include attached text: ${e(turn.selectedFile.name)}</label>` : ''}
      ${turn?.selectedImages?.length || m?.selectedImages?.length ? '<label class="agent-opt-in"><input type="checkbox" name="attachPictures">Include attached pictures</label>' : ''}
      <div class="dialog-footer">${button('refresh','Back')}<button type="submit" class="primary-button" ${enabled ? '' : 'disabled'}>Send parcel</button></div></form>`, 'settings-dialog');
  }
  async function read(id) {
    view = await api.pony('home');
    const p = view.parcels.find(p => p.id === id), body = await api.pony('parcel?id=' + encodeURIComponent(id));
    if (!p) return;
    show('Pony parcel', `<div class="pony-home"><p>${e(deskName(p.source.rootId))} → ${e(deskName(p.destination.rootId))} · <span data-post-status="${e(p.id)}">${e(p.status)}</span></p><div class="pony-body">${e(body.text)}</div>
      ${body.payload.images?.length ? `<p>${body.payload.images.length} saved picture attachment(s).</p>` : ''}
      <details><summary>Delivery and work records</summary>${p.events.map(r => `<p>${e(r.kind)} · ${e(new Date(r.at).toLocaleString())}${r.reason ? ' · ' + e(r.reason) : ''}${r.outcome ? ' · ' + e(r.outcome) : ''}${r.late ? ' · late return' : ''}</p>`).join('') || '<p>Queued at Pony Post.</p>'}<small>${e(p.id)}</small></details>
      <div class="dialog-footer">${button('refresh','Back')}${!p.events.some(e=>e.kind==='cancelled')&&(!p.events.some(e=>e.kind==='delivered')||p.kind==='request'&&p.status.startsWith('held')) ? button('correct','Use current receiving address',p.id) : ''}
      ${p.kind === 'request' && p.events.some(e => e.kind === 'returned') && !p.events.some(e => e.kind === 'cancelled') ? button('retry','Run a new attempt',p.id) : ''}
      ${!p.events.some(e => e.kind === 'cancelled') && (p.kind === 'request' || !p.events.some(e => e.kind === 'delivered')) ? button('cancel','Cancel parcel',p.id) : ''}</div></div>`, 'settings-dialog');
  }
  async function hydrate() {
    for (const node of document.querySelectorAll('[data-pony-body]')) {
      const id = node.dataset.ponyBody;
      if (cache.has(id)) { node.textContent = cache.get(id); continue; }
      if (pending.has(id)) continue; pending.add(id);
      api.pony('parcel?id=' + encodeURIComponent(id)).then(result => {
        if (cache.size >= 60) cache.delete(cache.keys().next().value); cache.set(id, result.text);
        for (const n of document.querySelectorAll('[data-pony-body]')) if (n.dataset.ponyBody === id) n.textContent = result.text;
      }).catch(error => { node.textContent = 'Pony Post: ' + error.message; }).finally(() => pending.delete(id));
    }
  }
  document.addEventListener('click', event => {
    const b = event.target.closest('[data-post]'); if (!b) return;
    const action = b.dataset.post;
    void (async () => {
      if(action==='older'){visibleCount+=60;return open(rootId);}
      if (action === 'new') return compose();
      if (action === 'read') return read(b.dataset.id);
      if (action === 'refresh') return open(rootId);
      if (['cancel','correct','retry'].includes(action)) { b.disabled = true; await api.pony('action',{action,id:b.dataset.id}); await refresh(); await read(b.dataset.id); }
    })().catch(reportError);
  });
  document.addEventListener('change', event => {
    if (event.target.matches('[data-post-drawer]')) void open(event.target.value).catch(reportError);
    if (event.target.matches('#postal-address [name="chatId"]')) event.target.form.elements.chairId.innerHTML = chairs(event.target.value);
  });
  document.addEventListener('submit', event => {
    const f = event.target; if (!['postal-address','postal-send'].includes(f.id)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const submit = f.querySelector('[type="submit"]'); submit.disabled = true;
    void (async () => {
      if (f.id === 'postal-address') { await api.pony('settings',{rootId:f.dataset.root,chatId:f.elements.chatId.value,chairId:f.elements.chairId.value,enabled:f.elements.enabled.checked}); await refresh(); return open(f.dataset.root); }
      const result = await api.pony('mail',{...draft,destinationRootId:f.elements.destinationRootId.value,kind:f.elements.kind.value,text:f.elements.text.value,attachText:f.elements.attachText?.checked===true,attachPictures:f.elements.attachPictures?.checked===true});
      await refresh(); return read(result.parcelId);
    })().catch(err => { submit.disabled = false; reportError(err); });
  }, true);
  setInterval(()=>{if(!document.querySelector('#dialog[open] [data-post-status]'))return;api.pony('home').then(v=>{for(const n of document.querySelectorAll('[data-post-status]')){const p=v.parcels.find(p=>p.id===n.dataset.postStatus);if(p)n.textContent=p.status;}}).catch(()=>{});},1500);
  return { open, compose, hydrate };
}
