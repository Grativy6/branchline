// A logical connection, resolved only by the app-owned runner. No saved port,
// process argument, executable path, or credential comes from conversation data.
export const BUNDLED_PROFILE = Object.freeze({ name: 'Qwen3.5-4B · Local', model: 'branchline-qwen35-4b',
  baseUrl: 'http://127.0.0.1:0/v1', runtime: 'bundled', thinking: false, inputFormat: 'chat' });
export const BUNDLED_CONTEXT = 8192;
export const BUNDLED_IMAGE_TOKENS = 1024;
export function assertBundledProfile(model) {
  if (model?.runtime !== 'bundled' || model.model !== BUNDLED_PROFILE.model || model.baseUrl !== BUNDLED_PROFILE.baseUrl
    || model.thinking === true || (model.inputFormat ?? 'chat') !== 'chat') throw new Error('The included Qwen model uses its fixed local connection. Save a separate connection for another model.');
}
