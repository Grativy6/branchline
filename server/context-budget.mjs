// Character budgets are deliberately labelled estimates, not tokenizer counts.
// Read only the selected LM Studio instance's loaded window; never load, unload,
// resize or switch models. Unknown compatible servers keep the app ceiling.
const reports = new Map();
import { OPENAI_MODELS } from './openai-input.mjs';
import { BUNDLED_CONTEXT, assertBundledProfile, isBundledContext } from './bundled-profile.mjs';
import {assertLocalFileProfile} from './local-model-state.mjs';
export async function contextBudget(model, { maxContextCharacters = null, maxTokens = null, localRunner = null } = {}) {
  maxContextCharacters ??= model?.runtime === 'bundled' ? 3000000 : 60000;
  const reservedOutput = maxTokens ?? (model?.runtime==='openai'?8192:2048);
  if(model?.runtime==='openai'){const spec=OPENAI_MODELS[model.model];if(!spec)throw new Error('API context profile is unavailable.');return {characters:Math.min(maxContextCharacters,(spec.window-reservedOutput-16384)*3),basis:'published_API_window_character_estimate',loadedTokens:spec.window,outputTokens:maxTokens??8192,reservedOutput};}
  if(model?.runtime==='codex')return {characters:Math.min(maxContextCharacters,(272000-reservedOutput-16384)*3),basis:'reviewed_subscription_base_window_character_estimate',loadedTokens:272000,outputTokens:null,reservedOutput};
  if(model?.runtime==='gguf'){
    assertLocalFileProfile(model);const status=localRunner?.status?.(model)??{},configuredTokens=status.contextTokens??8192,loadedTokens=status.loadedContextTokens??null;
    return {characters:Math.min(maxContextCharacters,Math.max(0,((loadedTokens??configuredTokens)-reservedOutput-1024)*3)),basis:loadedTokens?'loaded_local_file_window_character_estimate':'configured_local_file_window_character_estimate',configuredTokens,loadedTokens,outputTokens:maxTokens,reservedOutput};
  }
  if (model?.runtime === 'bundled') {
    assertBundledProfile(model);
    const status = localRunner?.status?.(model) ?? {};
    if (status.changing) throw new Error('The included model window is changing. Try again when it is ready; your draft is saved.');
    const configuredTokens = status.contextTokens ?? BUNDLED_CONTEXT;
    const loadedTokens = status.loadedContextTokens ?? null;
    if (!isBundledContext(configuredTokens) || (loadedTokens !== null && loadedTokens !== configuredTokens)) throw new Error('The included model window could not be confirmed. Choose its context again.');
    const windowTokens = loadedTokens ?? configuredTokens;
    return { characters: Math.min(maxContextCharacters, Math.max(0, (windowTokens - reservedOutput - 1024) * 3)),
      basis: loadedTokens === null ? 'configured_bundled_window_character_estimate' : 'loaded_bundled_window_character_estimate',
      configuredTokens, loadedTokens, outputTokens: maxTokens, reservedOutput };
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
