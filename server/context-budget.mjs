// Character budgets are deliberately labelled estimates, not tokenizer counts.
// Read only the selected LM Studio instance's loaded window; never load, unload,
// resize or switch models. Unknown compatible servers keep the app ceiling.
const reports = new Map();
import { BUNDLED_CONTEXT, assertBundledProfile } from './bundled-profile.mjs';
export async function contextBudget(model, { maxContextCharacters = 60000, maxTokens = null } = {}) {
  const reservedOutput = maxTokens ?? 2048;
  if (model?.runtime === 'bundled') {
    assertBundledProfile(model);
    return { characters: Math.min(maxContextCharacters, Math.max(0, (BUNDLED_CONTEXT - reservedOutput - 1024) * 3)), basis: 'fixed_bundled_window_character_estimate', loadedTokens: BUNDLED_CONTEXT, outputTokens: maxTokens, reservedOutput };
  }
  if (model?.runtime !== 'lmstudio') return { characters: maxContextCharacters, basis: 'application_character_ceiling', loadedTokens: null, outputTokens: maxTokens };
  const key = model.baseUrl + '\n' + model.model;
  let report = reports.get(key);
  if (!report || report.until < Date.now()) {
    let tokens = null;
    try {
      const url = new URL(model.baseUrl);
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Not loopback');
      url.pathname = '/api/v1/models'; url.search = ''; url.hash = '';
      const response = await fetch(url, { signal: AbortSignal.timeout(1500), redirect: 'error' });
      let raw = '', bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length; if (bytes > 256 * 1024) throw new Error('Model report too large');
        raw += Buffer.from(chunk).toString('utf8');
      }
      if (!response.ok) throw new Error('Model report unavailable');
      const instance = JSON.parse(raw).models?.flatMap(m => m.loaded_instances || []).find(i => i.id === model.model);
      const value = instance?.config?.context_length;
      if (Number.isSafeInteger(value) && value >= 2048 && value <= 10000000) tokens = value;
    } catch { /* Retain a conservative, explicit fallback. Do not alter the model. */ }
    report = { tokens, until: Date.now() + 15000 }; reports.set(key, report);
  }
  const reserve = maxTokens ?? (report.tokens ? Math.min(2048, Math.floor(report.tokens / 4)) : reservedOutput);
  const characters = report.tokens ? Math.max(0, (report.tokens - reserve - 1024) * 3) : 16000;
  return { characters: Math.min(maxContextCharacters, characters), basis: report.tokens ? 'loaded_window_character_estimate' : 'local_window_unknown_conservative_estimate', loadedTokens: report.tokens, outputTokens: maxTokens };
}
