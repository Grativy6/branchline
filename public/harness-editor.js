import { api } from './api.js';
import { findHarness, harnessChoice, harnessRef } from './harness-catalog.js';
import { HARNESS_LIMITS, checkHarnessContent } from './harness-format.js';
import { harnessLibrary, harnessEditor, harnessDialog, harnessDeleteDialog } from './harness-views.js';
import { POCKET_PROFILE, BUILTIN_PROVIDER, defaultPockets, pocketContent } from './coat-pockets.js';

// A local editor draft is never applied to a branch until an explicit save.
export function createHarnessEditor({ getState, refreshState, command, openDialog, closeDialog, toast }) {
  let draft = null, branch = null, saving = false, restored = false;
  const restore = () => { if (!restored && getState()) { draft = structuredClone(getState().ui.coatDraft ?? null); restored = true; } };
  const form = () => document.getElementById('harness-editor-form');
  const capture = () => {
    restore();
    const f = form();
    if (f && draft) {
      const pockets = draft.pocketsCustomized ? { pockets: { profile: POCKET_PROFILE, selected: [...f.querySelectorAll('[data-pocket-tool]:checked')].map(el => ({ tool: el.dataset.pocketTool, provider: el.dataset.pocketProvider })) } } : {};
      draft.content = { name: f.elements.name.value, description: f.elements.description.value, instructions: f.elements.instructions.value, ...pockets };
      draft.seat = f.elements.seat?.value ?? 'shared';
    }
  };
  const edit = () => openDialog(draft.id ? 'Edit Coat' : draft.importFile ? 'Import Coat' : 'New Coat', harnessEditor(draft), 'harness-editor-dialog', branch ? 'chat' : 'settings');
  const persist = async () => {
    capture();
    if (JSON.stringify(draft) !== JSON.stringify(getState().ui.coatDraft ?? null))
      await command('ui.update', { coatDraft: structuredClone(draft) }, { renderNow: false });
  };
  const library = () => { capture(); branch = null; openDialog('My Coats', harnessLibrary(getState(), { draft, branch: null }), 'harness-library-dialog', 'settings'); };
  const rememberBranch = chat => { branch = chat ? { chatId: chat.id, title: chat.title, baseRevisionId: harnessChoice(chat).id } : null; };
  const picker = () => {
    const state = getState(), chat = state.chats.find(c => c.id === branch?.chatId), root = state.roots.find(r => r.id === chat?.rootId);
    if (!chat || !root) return library();
    rememberBranch(chat); openDialog('Coats for ' + chat.title, harnessDialog(state, root, chat), 'coat-picker-dialog', 'chat');
  };
  const newDraft = (content = { name: '', description: '', instructions: '', pockets: defaultPockets() }, extra = {}) => {
    restore();
    if (!draft) draft = { content, pocketsCustomized: Object.hasOwn(content, 'pockets'), branch: branch ? { ...branch } : null, seat: 'shared', ...extra };
    edit();
  };
  const changeDeletion = async (type, payload, message) => {
    if (saving) return;
    const controls = [...document.getElementById('dialog').querySelectorAll('button, input, textarea, select')];
    try {
      saving = true; controls.forEach(control => { control.disabled = true; });
      await command(type, payload);
      saving = false; library();
      toast(type === 'harness.delete' ? 'Coat removed from your library' : 'Coat restored');
    } catch (err) {
      message.textContent = err.message; message.hidden = false; message.setAttribute('role', 'alert');
      message.scrollIntoView({ block: 'nearest' });
      try { await refreshState(); } catch { /* Keep the failure and current view if refresh is unavailable. */ }
    } finally { saving = false; controls.forEach(control => { control.disabled = false; }); }
  };
  return {
    markup() { capture(); branch = null; return harnessLibrary(getState(), {draft,branch:null}); },
    openLibrary(chat = null) { rememberBranch(chat); library(); },
    openPicker(chat) { capture(); rememberBranch(chat); picker(); },
    get busy() { return saving; },
    get unsaved() { capture(); return JSON.stringify(draft) !== JSON.stringify(getState()?.ui.coatDraft ?? null); },
    persist,
    keepDraft: capture,
    input(event) {
      if (!event.target.closest('#harness-editor-form')) return;
      if (event.target.matches('[data-pocket-tool]')) draft.pocketsCustomized = true;
      capture(); document.getElementById('harness-length').textContent = `${draft.content.instructions.length.toLocaleString('en-US')} / 24,000 characters`;
      if (draft.pocketsCustomized) document.getElementById('coat-pocket-mode').textContent = 'These exact pocket choices will be saved with this version.';
    },
    async action(action, target) {
      if (!action.startsWith('harness-')) return false;
      if (saving) return true;
      if (action === 'harness-library') library();
      else if (action === 'harness-choose') picker();
      else if (action === 'harness-new') newDraft();
      else if (action === 'harness-take-off') {
        const select = document.getElementById('harness-form')?.elements[target.dataset.name];
        if (select) { select.value = 'conversation'; select.dispatchEvent(new Event('change', { bubbles: true })); }
      }
      else if (action === 'harness-pocket-provider' && draft) {
        const checkbox = [...form().querySelectorAll('[data-pocket-tool]')].find(el => el.dataset.pocketTool === target.dataset.tool);
        if (checkbox) { checkbox.dataset.pocketProvider = BUILTIN_PROVIDER; checkbox.checked = true; draft.pocketsCustomized = true; capture(); edit(); }
      }
      else if (action === 'harness-keep') { capture(); closeDialog(); }
      else if (action === 'harness-resume' && draft) edit();
      else if (action === 'harness-discard') { draft = null; await persist(); library(); }
      else if (action === 'harness-import') document.getElementById('harness-import-file').click();
      else if (action === 'harness-delete' && !draft) openDialog('Delete Coat', harnessDeleteDialog(getState(), target.dataset.id));
      else if (action === 'harness-restore') {
        const h = getState().customHarnesses?.find(h => h.id === target.dataset.id);
        if (h?.deletedAt) await changeDeletion('harness.restore', { id: h.id, baseVersion: h.versions.at(-1).version, baseDeletedAt: h.deletedAt }, document.getElementById('harness-library-status'));
      }
      else if (action === 'harness-edit') {
        const h = getState().customHarnesses?.find(h => h.id === target.dataset.id), latest = h?.versions.at(-1);
        if (latest && !h.deletedAt) newDraft({ name: latest.name, description: latest.description, instructions: latest.instructions, ...pocketContent(latest) }, { id: h.id, baseVersion: latest.version });
      } else if (action === 'harness-duplicate') {
        const h = findHarness(harnessRef(target.dataset.key), getState());
        if (h) newDraft({ name: (h.name.slice(0, HARNESS_LIMITS.name - 7) + ' · copy'), description: h.description, instructions: h.instructions, pockets: h.pockets ? structuredClone(h.pockets) : defaultPockets() });
      }
      return true;
    },
    async delete(event) {
      const f = event.target;
      await changeDeletion('harness.delete', { id: f.dataset.id, baseVersion: Number(f.dataset.baseVersion), baseDeletedAt: null }, document.getElementById('harness-delete-error'));
    },
    async importFile(input) {
      const selected = input.files?.[0]; if (!selected) return;
      const status = document.getElementById('harness-library-status');
      try {
        if (selected.size > HARNESS_LIMITS.fileBytes) throw new Error('Choose a file no larger than 64 KiB.');
        status.textContent = 'Reading your selected file…';
        const bytes = new Uint8Array(await selected.arrayBuffer());
        const importFile = { name: selected.name, base64: btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')) };
        const preview = await api.previewHarnessImport(importFile);
        if (input.isConnected && document.getElementById('dialog').open && !draft) newDraft(preview.content, { importFile });
      } catch (err) { if (status.isConnected) { status.textContent = err.message; status.setAttribute('role', 'alert'); } }
      finally { input.value = ''; }
    },
    async save(event) {
      if (saving || !draft) return;
      capture(); const message = document.getElementById('harness-editor-error');
      const controls = [...document.getElementById('dialog').querySelectorAll('button, input, textarea, select')];
      try {
        const content = { ...draft.content, name: draft.content.name.trim() };
        checkHarnessContent(content);
        const payload = { content };
        if (draft.id) Object.assign(payload, { id: draft.id, baseVersion: draft.baseVersion });
        else if (draft.importFile) payload.importFile = draft.importFile;
        const applying = event.submitter?.value === 'use';
        if (applying && draft.branch) payload.use = { chatId: draft.branch.chatId, baseRevisionId: draft.branch.baseRevisionId, seat: draft.seat };
        message.hidden = true; saving = true; controls.forEach(control => { control.disabled = true; });
        await command(draft.id ? 'harness.revise' : 'harness.create', payload);
        draft = null; await persist(); saving = false;
        if (applying) closeDialog(); else library();
        toast(applying ? 'Coat saved and selected for future replies' : 'Coat saved to your library');
      } catch (err) {
        message.textContent = err.message; message.hidden = false; message.scrollIntoView({ block: 'nearest' });
        try { await refreshState(); } catch { /* The typed draft stays available even while offline. */ }
      }
      finally { saving = false; controls.forEach(control => { control.disabled = false; }); }
    },
  };
}
