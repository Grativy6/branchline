import { digest } from './integrity.mjs';
import { isCodex, codexInput, codexCapability } from './codex-policy.mjs';
import { localImageMessages, mediaReferences } from './model-media.mjs';

export const MODEL_INPUT_FORMATS = new Set(['chat', 'plain-dialogue-v1']);
const roles = Object.freeze({ system: 'System', user: 'User', assistant: 'Assistant' });
// These are text-completion boundaries, not a security parser or a claim that a
// base model understands roles. Executable effects remain enforced by the host.
const stops = Object.freeze(['\nUser:', '\nSystem:', '\nAssistant:', '\n[System]', '\n[Response mode:', '\n[Base Coat:', '\n[Personal Chair]', '\n[Visitor Chair]']);

export function modelTransport(model, messages, imageData) {
  if (isCodex(model)) return { format: 'codex-app-server-v1', route: 'thread/start → thread/inject_items → turn/start', input: codexInput(messages, imageData) };
  const format = model.inputFormat ?? 'chat';
  if (!MODEL_INPUT_FORMATS.has(format)) throw new Error('Unsupported model input format.');
  if (format === 'chat') return { format, route: '/chat/completions', input: { messages: localImageMessages(messages, imageData) } };
  if (mediaReferences(messages).length) throw new Error('This model connection is text-only; pixels were not sent.');
  const prompt = messages.map(message => {
    if (!roles[message.role] || typeof message.content !== 'string') throw new Error('Invalid base-model conversation.');
    return `${roles[message.role]}:\n${message.content}`;
  }).join('\n\n') + '\n\nAssistant:\n';
  return { format, route: '/completions', input: { prompt, stop: [...stops], temperature: 0.6 } };
}

export function transportReceipt(model, messages) {
  const transport = modelTransport(model, messages);
  return { format: transport.format, route: transport.route, inputHash: digest(transport.input),
    ...(isCodex(model) ? { capability: codexCapability(), replyLength: 'verbosity_target_not_a_token_cap' } : {}),
    ...(transport.format === 'plain-dialogue-v1' ? { stop: transport.input.stop, temperature: transport.input.temperature,
      interpretation: 'Role labels guide continuation; they grant no authority.' } : {}) };
}
