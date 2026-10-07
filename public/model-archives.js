// Archive entries describe saved connections. They never grant filesystem access.
export const archiveRecord = (state, modelId) => state.modelArchives?.findLast(r => r.modelId === modelId) ?? null;
export const isModelArchived = (state, modelId) => archiveRecord(state, modelId)?.archived === true;
export const activeModels = state => (state.models ?? []).filter(m => !isModelArchived(state, m.id));
export const modelFilesHeld = (state, modelId) => ['elsewhere', 'unknown'].includes(archiveRecord(state, modelId)?.files);
export const personalArchived = (state, person) => isModelArchived(state, person?.connections.at(-1)?.modelId);
export const archiveLabel = (state, modelId) => isModelArchived(state, modelId) ? ' · Archived' : modelFilesHeld(state, modelId) ? ' · Files need attention' : '';

const e = (v = '') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function archiveList(state) {
  const entries = (state.models ?? []).filter(m => archiveRecord(state, m.id));
  return `<p>Earlier models keep their conversations, Dream history and original identities here. Returning a model to the list does not load it.</p><div class="model-archive-list">${entries.map(m => {
    const r = archiveRecord(state, m.id), people = r.personalIds.map(id => state.personalParticipants.find(p => p.id === id));
    return `<section class="model-card"><strong>${e(m.name)}</strong><small>${r.archived ? 'Archived' : 'Returned to active list'} · ${e(m.model)}</small><p class="field-help">${r.files === 'retained' ? 'Original model files reported retained. Connection availability is checked when used.' : 'Files archived — restore the local model before use.'}</p><div>${people.map(p => `<button class="dream-review-button" data-action="dream-review" data-id="${e(p.id)}">Review Dreams · ${e(p.nickname || p.name)}</button>`).join('')}<button class="text-button" data-action="model-archive-details" data-id="${e(m.id)}">Archive details</button>${r.archived ? `<button class="text-button" data-action="model-unarchive" data-id="${e(m.id)}">Return to active list</button>` : r.files !== 'retained' ? `<button class="text-button" data-action="model-files-ready" data-id="${e(m.id)}">I restored the local files</button>` : ''}</div>${r.copies.length ? r.copies.map(c => `<p class="field-help"><strong>${e(c.label)}</strong><br><span class="detail-value">${e(c.path)}</span><br>${c.checkedAt ? 'Recorded copy check: ' + e(new Date(c.checkedAt).toLocaleString()) : 'No copy check recorded'} · availability not checked in app <button class="text-button" data-action="storage-copy" data-path="${e(c.path)}">Copy folder location</button></p>`).join('') : '<p class="field-help">No separate archive location recorded.</p>'}</section>`;
  }).join('') || '<p>No archived models yet.</p>'}</div>`;
}
export function archiveDetails(state, modelId) {
  const r = archiveRecord(state, modelId);
  if (!r) return '<p>This archive entry is unavailable.</p>';
  return `<p>Recorded on ${e(new Date(r.at).toLocaleString())}. Locations and file checks are recorded maintenance information; the app does not open or inspect these folders.</p><dl><dt>Saved connection</dt><dd class="detail-value">${e(r.modelId)}</dd><dt>Personal entries</dt><dd class="detail-value">${e(r.personalIds.join(', ') || 'None')}</dd></dl>${r.copies.map(c => `<section class="model-card"><strong>${e(c.label)}</strong><span class="detail-value">${e(c.path)}</span><p>${c.logicalBytes === null ? 'Size not recorded' : e(c.logicalBytes.toLocaleString()) + ' logical bytes'}</p>${c.manifestSha256 ? `<details><summary>Manifest receipt</summary><code class="detail-value">${e(c.manifestSha256)}</code></details>` : ''}<button class="text-button" data-action="storage-copy" data-path="${e(c.path)}">Copy folder location</button></section>`).join('')}<p class="field-help">Earlier attribution, source handles, corrections, Coats and permissions stay in their original records. This archive does not merge personal models.</p><button class="quiet-button" data-action="model-archives">Back to archived models</button>`;
}
