import { api } from './api.js';
import { personalLabel } from './personal-label.js';
import { modelsBusy } from './table.js';
import { profileSharingSelections, profileSharedWith } from './agent-sharing.js';

const e = (value = '') => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const route = m => ({ runtime: m.runtime ?? 'compatible', baseUrl: m.baseUrl, model: m.model });
const current = (state, id) => state.agentProfiles?.selections.findLast(s => s.personalId === id);
const modelOptions = (models, selected = null, sharing = null) => `<fieldset class="agent-sharing"><legend>May receive this material or shared replies derived from it</legend>${models.map(m => `<label><input type="checkbox" name="model" value="${e(m.id)}" ${!selected || selected.includes(m.id) ? 'checked' : ''}><span>${e(m.name)}<small>${e(m.runtime === 'codex' ? 'OpenAI · ChatGPT subscription' : m.baseUrl)} · ${e(m.model)}</small>${sharing ? `<small>${profileSharedWith(sharing.state, sharing.id, m) ? 'Already allowed' : 'Needs approval'}</small>` : ''}</span></label>`).join('')}<p class="field-help">These exact connections are remembered. A different model or server needs a new review. Disconnecting stops future profile input; earlier shared replies remain in their conversations.</p></fieldset>`;
const errorBox = '<p id="agent-profile-error" class="notice" role="alert" hidden></p>';

export function createAgentProfiles({ getState, command, openDialog, toast }) {
  let personalId = null, draft = null, saving = false, view = 0, models = [], baseSelectionId = null;
  const show = (title, body) => { view++; openDialog(title, body, 'agent-profile-dialog'); };
  const report = err => { const box = document.getElementById('agent-profile-error'); if (box) { box.textContent = err.message; box.hidden = false; } };
  const button = (action, text, id = '') => `<button type="button" class="quiet-button" data-action="${action}" data-id="${e(id)}">${text}</button>`;
  function home() {
    const state = getState(), participant = state.personalParticipants?.find(p => p.id === personalId);
    const selected = current(state, personalId), l = state.agentProfiles, profile = l?.profiles.find(p => p.id === selected?.profileId);
    const sharingSelections = profileSharingSelections(state, personalId);
    const personalModel = state.models.find(m => m.id === participant?.connections.at(-1)?.modelId);
    show('Agent profile · ' + personalLabel(participant), `<p class="field-help">Bring an agent’s guidance and selected references to the Personal chair. Your model and conversation stay independently selectable. Scripts and MCP connections are not run.</p>
      <p><strong>${profile ? `${e(profile.name)} · v${profile.version}` : 'No profile connected'}</strong></p>
      <div class="agent-actions">${button('agent-profile-import', 'Import profile or text files')}${button('agent-profile-starter', 'Hearthline starter')}${draft ? button('agent-profile-resume', 'Resume import') : ''}${profile ? button('agent-profile-disconnect', 'Disconnect', selected.id) : ''}</div>
      <input id="agent-profile-files" type="file" accept=".json,.md,.txt" multiple hidden>
      ${errorBox}<div class="agent-profile-library">${(l?.profiles ?? []).map(p => `<article class="personal-model-card"><strong>${e(p.name)} · v${p.version}</strong><p>${e(p.description)}</p><small>${p.entries.length} source(s)${p.replaces ? ' · previous version preserved' : ''}</small><div class="agent-actions">${button('agent-profile-inspect', 'Inspect / connect', p.id)}<a class="text-button" href="/api/agent-profiles/export?id=${encodeURIComponent(p.id)}" data-export="agent-profile.json">Export</a></div></article>`).join('') || '<p class="field-help">Select a portable profile, or a small set of Markdown/text files from an agent repository. You choose what becomes guidance.</p>'}</div>
      ${sharingSelections.length ? `<section aria-label="Profile sharing"><h3>Sharing for this model and its desks</h3><p class="field-help">Earlier profile material can remain in a desk after changing models. Review those selections here, including ones from a previous Personal chair.</p>${sharingSelections.map(s => { const p = l.profiles.find(p => p.id === s.profileId), owner = state.personalParticipants.find(person => person.id === s.personalId); return `<article class="personal-model-card"><strong>${e(p.name)} · v${p.version}</strong><small>From ${e(personalLabel(owner))} · ${e(new Date(s.createdAt).toLocaleString())}</small><p>${profileSharedWith(state, s.id, personalModel) ? 'Allowed for this model connection' : 'Needs approval for this model connection'}</p>${button('agent-profile-sharing', 'Review sharing', s.id)}</article>`; }).join('')}</section>` : ''}`);
  }
  function source(entry, text) {
    return `<details class="agent-source"><summary>${e(entry.path)} · ${e(entry.role)} · ${e(entry.scope)}</summary>${entry.source ? `<p class="field-help">Source: ${e(entry.source.url)}<br>Revision: ${e(entry.source.revision)}<br>${e(entry.source.note)}</p>` : '<p class="field-help">User-selected local text; origin not independently verified.</p>'}${entry.sha256 ? `<small>SHA-256: ${e(entry.sha256)}</small>` : ''}<pre>${e(text)}</pre></details>`;
  }
  function preview() {
    if (!draft) return home();
    const l = getState().agentProfiles;
    show('Preview agent profile', `<form id="agent-profile-import-form"><label class="form-field">Name<input name="name" maxlength="120" required value="${e(draft.name)}"></label><label class="form-field">Description<textarea name="description" maxlength="1000">${e(draft.description)}</textarea></label>
      <p class="field-help">Review each source. Guidance supplies conversational defaults; references and skills are read as source material. Project guidance cannot become global instructions unless you explicitly change its scope here. Nothing is executed.</p>
      ${draft.entries.map((entry, i) => `<section class="agent-import-entry">${source(entry, entry.text)}<div class="agent-entry-options"><label>Use as <select name="role-${i}">${['guidance','reference','skill'].map(r => `<option ${entry.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label><label>Scope <select name="scope-${i}">${['agent','project'].map(s => `<option ${entry.scope === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label></div></section>`).join('')}
      <label class="form-field">Version ancestry<select name="replaces"><option value="">New profile</option>${(l?.profiles ?? []).map(p => `<option value="${e(p.id)}">Update ${e(p.name)} · v${p.version}</option>`).join('')}</select></label>${errorBox}<div class="dialog-footer">${button('agent-profile-home', 'Keep draft')}<button type="submit" class="primary-button">Save to library</button></div></form>`);
  }
  function inspect(id) {
    const state = getState(), p = state.agentProfiles.profiles.find(p => p.id === id); if (!p) return home();
    models = structuredClone(state.models); baseSelectionId = current(state, personalId)?.id ?? null;
    const selection = current(state, personalId), selected = selection?.profileId === id ? selection.paths : p.entries.filter(x => x.role === 'guidance' && x.scope === 'agent').map(x => x.path);
    show(p.name + ' · v' + p.version, `<form id="agent-profile-connect-form" data-profile-id="${e(id)}"><p>${e(p.description)}</p><p class="field-help">Only checked sources go to the Personal chair. Select up to 24,000 characters; the app will include them in its context budget.</p>
      ${p.entries.map(entry => `<section class="agent-import-entry"><label class="agent-source-choice"><input type="checkbox" name="path" value="${e(entry.path)}" ${selected.includes(entry.path) ? 'checked' : ''} ${entry.role === 'guidance' && entry.scope === 'project' ? 'disabled' : ''}>Include ${e(entry.path)} · ${state.agentProfiles.sources[entry.sha256].length.toLocaleString()} characters</label>${source(entry, state.agentProfiles.sources[entry.sha256])}</section>`).join('')}
      ${modelOptions(models)}${errorBox}<div class="dialog-footer">${button('agent-profile-home', 'Back')}<button type="submit" class="primary-button" ${modelsBusy(state) ? 'disabled' : ''}>Connect selected sources</button></div></form>`);
  }
  function sharing(id) {
    const state = getState(), selection = state.agentProfiles.selections.find(s => s.id === id);
    if (!selection) return home(); models = structuredClone(state.models);
    const profile = state.agentProfiles.profiles.find(p => p.id === selection.profileId);
    const owner = state.personalParticipants.find(p => p.id === selection.personalId);
    const selectedModelId = state.personalParticipants.find(p => p.id === personalId)?.connections.at(-1)?.modelId;
    const grants = state.agentProfiles.sharing.filter(r => r.selectionId === id).flatMap(r => r.destinations);
    show('Review sharing', `<form id="agent-profile-sharing-form" data-selection-id="${e(id)}"><p><strong>${e(profile.name)} · v${profile.version}</strong><br>Selected by ${e(personalLabel(owner))}</p>${selection.paths.map(path => { const entry = profile.entries.find(e => e.path === path); return source(entry, state.agentProfiles.sources[entry.sha256]); }).join('')}<p>Earlier clearance:</p><ul>${grants.map(d => `<li>${e(d.runtime === 'codex' ? 'OpenAI' : d.baseUrl)} · ${e(d.model)}</li>`).join('')}</ul>${modelOptions(models, [selectedModelId], { state, id })}<p class="field-help">Choose connections, then press Allow selected connections to save approval. This adds sharing clearance; it does not remove earlier approvals or grant tools.</p>${errorBox}<div class="dialog-footer">${button('agent-profile-home', 'Back')}<button type="submit" class="primary-button">Allow selected connections</button></div></form>`);
  }
  function capture() {
    const f = document.getElementById('agent-profile-import-form');
    if (!f || !draft) return;
    draft.name = f.elements.name.value; draft.description = f.elements.description.value;
    draft.entries.forEach((entry,i) => { entry.role = f.elements[`role-${i}`].value; entry.scope = f.elements[`scope-${i}`].value; });
  }
  return {
    get busy() { return saving; },
    get hasDraft() { return draft !== null; },
    keepDraft: capture,
    async action(action, target) {
      if (!action.startsWith('agent-profile-')) return false;
      if (saving) return true;
      capture();
      try {
        if (action === 'agent-profile-open') { personalId = target.dataset.id; home(); }
        else if (action === 'agent-profile-home') home();
        else if (action === 'agent-profile-import') { if (draft) preview(); else document.getElementById('agent-profile-files').click(); }
        else if (action === 'agent-profile-resume') preview();
        else if (action === 'agent-profile-inspect') inspect(target.dataset.id);
        else if (action === 'agent-profile-sharing') sharing(target.dataset.id);
        else if (action === 'agent-profile-starter') {
          if (draft) { preview(); return true; }
          const opened = view;
          const response = await fetch('/agent-profiles/hearthline.json');
          if (!response.ok) throw new Error('The bundled starter is unavailable.');
          const checked = await api.previewAgentProfile(await response.json());
          if (view === opened && document.getElementById('dialog').open) { draft = checked.bundle; preview(); }
        } else if (action === 'agent-profile-disconnect') {
          saving = true;
          await command('profile.disconnect', { personalId, baseSelectionId: target.dataset.id });
          saving = false; home(); toast('Profile disconnected. Earlier sources and replies are preserved.');
        }
      } catch (err) { report(err); } finally { saving = false; }
      return true;
    },
    async importFiles(input) {
      const opened = view;
      try {
        const files = [...(input.files ?? [])]; if (!files.length) return;
        const portable = files.length === 1 && /\.json$/i.test(files[0].name);
        if (files.length > 64 || files.reduce((n,f) => n + f.size,0) > (portable ? 1048576 : 262144)) throw new Error('Choose at most 64 text files (256 KiB total), or one profile JSON (1 MiB maximum).');
        const read = async file => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
        let bundle;
        if (portable) bundle = JSON.parse((await read(files[0])).replace(/^\uFEFF/, ''));
        else {
          const entries = [];
          for (const file of files) {
            if (!/\.(md|txt)$/i.test(file.name) || file.size > 131072) throw new Error('Choose only Markdown/text files up to 128 KiB each.');
            const path = file.webkitRelativePath || file.name;
            entries.push({ path, role: /^(AGENTS|CLAUDE|GEMINI)\.md$/i.test(path) ? 'guidance' : /(^|\/)SKILL\.md$/i.test(path) ? 'skill' : 'reference', scope: path.includes('/') ? 'project' : 'agent', text: await read(file), source: null });
          }
          bundle = { schema: 'branchline.agent-profile/1', name: files[0].name.replace(/\.(md|txt)$/i, ''), description: '', entries };
        }
        const checked = await api.previewAgentProfile(bundle);
        if (opened === view && input.isConnected && document.getElementById('dialog').open) { draft = checked.bundle; preview(); }
      } catch (err) { report(err); } finally { input.value = ''; }
    },
    async submit(event) {
      const f = event.target;
      if (!f.id.startsWith('agent-profile-')) return false;
      if (saving) return true;
      capture(); const controls = [...f.querySelectorAll('input, select, textarea, button')];
      try {
        const data = new FormData(f), selectedModels = models.filter(m => data.getAll('model').includes(m.id)).map(m => ({ id: m.id, destination: route(m) }));
        saving = true; controls.forEach(c => { c.disabled = true; });
        if (f.id === 'agent-profile-import-form') {
          const checked = await api.previewAgentProfile(draft);
          await command('profile.import', { bundle: checked.bundle, replaces: data.get('replaces') || null });
          draft = null; inspect(getState().agentProfiles.profiles.at(-1).id); toast('Profile saved. Choose the sources to connect.');
        } else if (f.id === 'agent-profile-connect-form') {
          await command('profile.connect', { personalId, baseSelectionId, profileId: f.dataset.profileId, paths: data.getAll('path'), models: selectedModels });
          home(); toast('Agent profile connected to the Personal chair');
        } else if (f.id === 'agent-profile-sharing-form') {
          await command('profile.share', { selectionId: f.dataset.selectionId, models: selectedModels });
          home(); toast('Sharing updated for the selected connections');
        }
      } catch (err) { report(err); } finally { saving = false; controls.forEach(c => { c.disabled = false; }); }
      return true;
    },
  };
}
