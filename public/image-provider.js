import { computeGuidance } from './compute-guidance.js';

const e = (v = '') => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const connection = state => state.imageConnection?.revisions.at(-1) ?? null;

export function imageProviderPanel(state, check = null) {
  const saved = connection(state), selected = Boolean(saved?.endpoint);
  const observed = check?.revisionId === saved?.id ? check : null;
  const status = observed?.result ? `<div class="notice" role="status"><strong>Invoke responded · ${e(observed.result.reportedVersion)}</strong><p>${observed.result.models.length} image model record${observed.result.models.length === 1 ? '' : 's'} reported. Computing capacity has not been measured.</p>${observed.result.models.length ? `<details><summary>Reported image models</summary><ul>${observed.result.models.map(m => `<li>${e(m.name)} <small>(${e(m.family)})</small></li>`).join('')}</ul></details>` : '<p class="field-help">Add an image model in Invoke before a future generation test.</p>'}<small>Checked ${e(new Date(observed.result.checkedAt).toLocaleString())}. This is a past connection check.</small></div>`
    : observed?.error ? `<p class="notice message-error" role="alert">${e(observed.error)}</p>` : '<p class="field-help">Connection not checked. Opening this panel does not contact Invoke.</p>';
  return `<div id="image-provider-panel"><p>Connect Invoke on this computer. This preview saves its address and checks its version and model list. <strong>Picture generation is not connected yet.</strong></p><form id="image-provider-form" data-base-revision-id="${e(saved?.id ?? '')}"><h3>Invoke · local connection</h3><label class="form-field">Local address<input name="endpoint" type="url" maxlength="200" required value="${e(saved?.endpoint ?? 'http://127.0.0.1:9090')}" aria-describedby="image-address-help"></label><p id="image-address-help" class="field-help">Use the address shown by your local Invoke installation. Saving keeps this address; it does not install or start Invoke.</p><div class="harness-actions"><button type="submit" class="primary-button">Save connection</button>${selected ? '<button type="button" class="quiet-button" data-action="image-provider-check">Check saved connection</button><button type="button" class="text-button" data-action="image-provider-disconnect">Disconnect</button>' : ''}</div><p id="image-provider-feedback" class="field-help" role="status"></p></form>${status}${computeGuidance('images')}<h3>Make pictures pocket</h3><p>Connection setup is available. Picture generation, progress, Stop and returning pictures to a chat are the next connection step. This preview does not offer an image-generation tool to the conversation model.</p><p class="field-help">Your existing Coat pockets stay as selected. Dream training remains separate.</p><div class="dialog-footer"><button type="button" class="quiet-button" data-action="close-dialog">Done</button></div></div>`;
}

export function createImageProviderPanel({ getState, command, openDialog, toast, api }) {
  let check = null, controller = null, busy = false;
  const render = () => openDialog('Image tools', imageProviderPanel(getState(), check), 'image-provider-dialog');
  const lock = value => { for (const el of document.querySelectorAll('#image-provider-form button, #image-provider-form input')) el.disabled = value; };
  return {
    cancel() { controller?.abort(); controller = null; },
    async action(action) {
      if (!action.startsWith('image-provider-')) return false;
      if (busy) return true;
      if (action === 'image-provider-open') { render(); return true; }
      const saved = connection(getState());
      if (!saved?.endpoint) return true;
      if (action === 'image-provider-disconnect') {
        const view = document.getElementById('image-provider-panel');
        busy = true; lock(true);
        try { await command('image-provider.disconnect', { baseRevisionId: saved.id }); check = null; if (view?.isConnected && document.getElementById('dialog').open) render(); toast('Image connection disconnected'); }
        finally { busy = false; lock(false); }
      } else if (action === 'image-provider-check') {
        busy = true; lock(true); check = null; controller = new AbortController();
        const localController = controller;
        document.getElementById('image-provider-feedback').textContent = 'Checking the saved address and image model list…';
        try { const result = await api.imageProviderCheck(saved.id, localController.signal); check = { revisionId: saved.id, result }; }
        catch (error) { check = { revisionId: saved.id, error: error.message }; }
        finally {
          busy = false; controller = null;
          if (!localController.signal.aborted && document.getElementById('image-provider-panel') && document.getElementById('dialog').open) render();
          lock(false);
        }
      }
      return true;
    },
    async submit(event) {
      const form = event.target;
      if (form.id !== 'image-provider-form') return false;
      event.preventDefault(); if (busy) return true;
      const view = document.getElementById('image-provider-panel');
      busy = true; lock(true);
      try { await command('image-provider.save', { baseRevisionId: form.dataset.baseRevisionId || null, endpoint: form.elements.endpoint.value }); check = null; if (view?.isConnected && document.getElementById('dialog').open) render(); toast('Image connection saved'); }
      finally { busy = false; lock(false); }
      return true;
    },
  };
}
