import crypto from 'node:crypto';
import { CODEX_ADDRESS } from './codex-policy.mjs';

// Discovery registers connections; choosing a chair and sharing sources remain
// separate. Existing IDs, names, archives, Coats and assignments are retained.
export async function syncCodexModels(store, status) {
  if (!status?.connected || status.error || !Array.isArray(status.models)) return { added: 0 };
  const seen = new Set(), models = [];
  for (const row of status.models) {
    if (!row || row.hidden || typeof row.id !== 'string' || !row.id.trim()
      || row.id.length > 200 || /[\u0000-\u001f]/.test(row.id) || seen.has(row.id)) continue;
    const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : row.id;
    if (name.length > 200 || /[\u0000-\u001f]/.test(name)) continue;
    seen.add(row.id); models.push({ slug: row.id, name });
  }
  const exists = (state, slug) => state.models.some(m => m.runtime === 'codex' && m.model === slug);
  if (models.every(m => exists(store.state, m.slug))) return { added: 0 };
  let added = 0;
  await store.transact(state => {
    for (const model of models) {
      if (exists(state, model.slug)) continue;
      state.models.push({ id: 'model_' + crypto.randomUUID(), name: model.name,
        model: model.slug, baseUrl: CODEX_ADDRESS, thinking: false,
        runtime: 'codex', inputFormat: 'chat' });
      added++;
    }
    return state;
  });
  return { added };
}
