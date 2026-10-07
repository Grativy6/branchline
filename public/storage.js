const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function formatBytes(bytes = 0) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

function date(value) {
  if (!value) return 'Unknown time';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? 'Unknown time' : parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function storagePanel(info = null, { busy = false, busyLabel = 'Working…', message = '' } = {}) {
  if (!info) return `<section class="storage-panel details-section" id="storage-panel"><div class="storage-heading"><div><h3>Storage &amp; backups</h3><p class="field-help">${e(message ? 'Storage details could not be loaded.' : 'Checking this local workspace…')}</p></div><span class="status-chip">Local only</span></div><p class="notice" role="status">${e(message || 'Loading storage details…')}</p><button class="quiet-button" type="button" data-action="storage-retry" ${busy ? 'disabled' : ''}>Try again</button></section>`;
  const backups = Array.isArray(info.backups) ? info.backups : [];
  const pathButton = path => path ? `<button class="text-button storage-copy" type="button" data-action="storage-copy" data-path="${e(path)}">Copy path</button>` : '';
  return `<section class="storage-panel details-section" id="storage-panel" aria-labelledby="storage-heading">
    <div class="storage-heading"><div><h3 id="storage-heading">Storage &amp; backups</h3><p class="field-help">Keep a recoverable copy of this workspace on this computer.</p></div><span class="status-chip">Local only</span></div>
    <dl class="storage-facts"><dt>Workspace</dt><dd><code class="storage-path" tabindex="0">${e(info.workspacePath || 'Unavailable')}</code>${pathButton(info.workspacePath)}</dd><dt>History on disk</dt><dd>${e(formatBytes(info.journalBytes))} · ${e(String(info.recordCount || 0))} records${info.compressed ? `<br><span class="field-help">Losslessly compressed · ${e(formatBytes(info.expandedJournalBytes))} when unpacked</span>` : ''}</dd>${info.checkpointBytes !== undefined ? `<dt>Startup save points</dt><dd>${e(formatBytes(info.checkpointBytes))}</dd>` : ''}${info.imageBytes ? `<dt>Saved pictures</dt><dd>${e(formatBytes(info.imageBytes))} · ${info.imageObjects} unique originals and views</dd>` : ''}<dt>Backup folder</dt><dd><code class="storage-path" tabindex="0">${e(info.backupPath || 'Unavailable')}</code>${pathButton(info.backupPath)}</dd></dl>
    <div class="storage-actions"><button class="primary-button" type="button" data-action="storage-backup" ${busy ? 'disabled' : ''}>${busy ? e(busyLabel) : 'Back up now'}</button><button class="quiet-button" type="button" data-action="storage-refresh" ${busy ? 'disabled' : ''}>Refresh</button></div>
    ${info.checkpointFailure ? `<p class="notice" role="status">The latest startup save point could not be refreshed (${e(info.checkpointFailure.code)}). Your journal is still saved; opening may need more history checks. Last covered record: ${e(info.checkpointSequence)}.</p>` : ''}
    <p class="field-help">Backups include Branchline history, workspace identity and selected pictures. Model files and external tool data are separate. These copies stay on this computer; copy the backup folder to another drive for an extra backup.</p>
    <p class="field-help">Restore a copy creates a separate folder. It does not switch the app to that copy.</p>
    <p class="field-help">Large histories are compressed automatically when opening or closing the app. Every original record remains recoverable. Compression uses this computer, with no model or cloud service.</p>
    <h4>Saved backups</h4>
    ${message ? `<p class="notice storage-status" role="status">${e(message)}</p>` : ''}
    <div class="storage-backups" aria-live="polite">${backups.length ? backups.map(backup => `<article class="storage-backup"><div><strong>${e(date(backup.createdAt))}</strong><small>${e(formatBytes(backup.bytes))} · ${e(String(backup.recordCount || 0))} records</small></div><div class="storage-backup-actions"><button class="text-button" type="button" data-action="storage-verify" data-id="${e(backup.id)}" ${busy ? 'disabled' : ''}>Check</button><button class="quiet-button" type="button" data-action="storage-restore" data-id="${e(backup.id)}" ${busy ? 'disabled' : ''}>Restore a copy</button></div></article>`).join('') : '<p class="muted">No backups yet. Your current workspace remains in place.</p>'}</div>
  </section>`;
}
