import { escapeHtml as e } from './views.js';

export function licencesSettings() {
  return '<section id="licences-panel" class="licences-panel" aria-label="About Branchline"><p role="status">Opening the included licence notices…</p></section>';
}

// Only local, packaged text is read, and only after this Settings tab is opened.
// No workspace data, model connection or permission record participates here.
export async function loadLicences(panel) {
  try {
    const response = await fetch('/licenses/index.json');
    if (!response.ok) throw new Error('The licence index is unavailable.');
    const index = await response.json();
    if (!panel.isConnected) return;
    panel.innerHTML = `<h3>Branchline <small>${e(index.version)}</small></h3>
      <p>Founded by Christopher Daniel Pang.<br>Copyright 2026 Christopher Daniel Pang.</p>
      <p>Branchline’s own application is licensed under Apache-2.0. You can use, modify and share it under those terms. Included components keep their own licences.</p>
      <p class="muted">These notices are included with the app and can be read offline.</p>
      ${index.groups.map(group => `<section class="licence-group"><h4>${e(group.title)}</h4>${group.documents.map(doc => `<details class="licence-document" data-licence-file="${e(doc.file)}"><summary>${e(doc.title)}</summary><pre class="licence-text" tabindex="0" aria-label="${e(doc.title)}" aria-live="polite">Open to read the full text.</pre></details>`).join('')}</section>`).join('')}`;
    panel.addEventListener('toggle', async event => {
      const item = event.target;
      if (!item.matches?.('details[data-licence-file]') || !item.open || item.dataset.loaded || item.dataset.loading) return;
      const text = item.querySelector('pre');
      item.dataset.loading = 'true';
      text.textContent = 'Opening…';
      try {
        const filename = item.dataset.licenceFile;
        if (!/^[A-Za-z0-9._-]+\.txt$/.test(filename)) throw new Error('Invalid packaged notice.');
        const result = await fetch('/licenses/' + filename);
        if (!result.ok) throw new Error('The notice file is unavailable.');
        text.textContent = await result.text();
        item.dataset.loaded = 'true';
      } catch {
        text.textContent = 'This notice could not be opened. Close and reopen this item to try again. The same files are in the app’s public/licenses folder.';
      } finally { delete item.dataset.loading; }
    }, true);
  } catch {
    if (panel.isConnected) panel.innerHTML = '<p role="alert">The licence notices could not be opened. Try this tab again, or open LICENSE, NOTICE and THIRD-PARTY-NOTICES.md in the app folder.</p>';
  }
}
