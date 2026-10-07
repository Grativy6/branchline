import { archiveList, archiveDetails, archiveRecord } from './model-archives.js';
const e = (v = '') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createModelArchivePanel({ getState, api, command, openDialog, beforeNavigation }) {
  let pending = null;
  const show = () => openDialog('Archived models', archiveList(getState()));
  return { async action(action, id) {
    if (!['model-archives','model-archive','model-unarchive','model-files-ready','model-archive-confirm','model-archive-details'].includes(action)) return false;
    await beforeNavigation();
    if (action === 'model-archives') { pending = null; show(); return true; }
    if (action === 'model-archive-details') { openDialog('Archive details', archiveDetails(getState(), id)); return true; }
    if (action === 'model-archive-confirm') {
      if (!pending) throw new Error('Reopen the model archive action first.');
      const saved = pending; await command(saved.type, saved.payload); pending = null; show(); return true;
    }
    const preview = await api.archivePreview(id), r = archiveRecord(getState(), id);
    const type = action === 'model-archive' ? 'modelArchive.archive' : action === 'model-unarchive' ? 'modelArchive.restore' : 'modelArchive.filesReady';
    pending = { type, payload: { modelId: id, baseRevision: preview.revision, ...(type === 'modelArchive.archive' ? { personalIds: preview.personalIds, files: r?.files ?? 'retained', copies: r?.copies ?? [] } : {}) } };
    const message = type === 'modelArchive.archive'
      ? 'Hide this connection from active model choices. Its conversations and Dream history stay readable. This button leaves the files on disk in place.'
      : type === 'modelArchive.restore' ? 'Return this saved connection to the model lists. This does not load it or change any chair.'
      : 'Confirm that you have restored the local model files for this connection. Branchline records your confirmation; the server connection is checked when used.';
    openDialog(type === 'modelArchive.archive' ? 'Archive model' : type === 'modelArchive.restore' ? 'Return model to active list' : 'Confirm restored files', `<p><strong>${e(preview.name)}</strong></p><p>${message}</p>${preview.people.length ? `<p>Personal entries sharing this connection:</p><ul>${preview.people.map(p => `<li>${e(p.name)}</li>`).join('')}</ul>` : ''}<div class="dialog-footer"><button class="quiet-button" data-action="close-dialog">Cancel</button><button class="primary-button" data-action="model-archive-confirm">${type === 'modelArchive.archive' ? 'Archive model' : type === 'modelArchive.restore' ? 'Return to active list' : 'Confirm files are restored'}</button></div>`);
    return true;
  } };
}
