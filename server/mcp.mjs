import crypto from 'node:crypto';

function scopeError(message) { const error = new Error(message); error.status = 400; return error; }

export function validateScope(state, rootId, chatId) {
  if (typeof rootId !== 'string' || !state.roots.some(root => root.id === rootId)) throw scopeError('A valid rootId is required for an MCP operation.');
  if (typeof chatId !== 'string' || !state.chats.some(chat => chat.id === chatId && chat.rootId === rootId)) throw scopeError('A valid chatId belonging to rootId is required for an MCP operation.');
}

export function bindingForScope(state, { rootId, chatId, bindingId = null, profile = null } = {}) {
  validateScope(state, rootId, chatId);
  const bindings = state.mcpBindings || [];
  const candidates = bindings.filter(binding => binding.enabled && binding.rootId === rootId && (binding.chatId === null || binding.chatId === chatId) && (!profile || binding.profile === profile));
  const binding = bindingId ? candidates.find(item => item.id === bindingId) : candidates[0];
  if (!binding) throw scopeError('No enabled MCP binding is configured for this root/chat scope.');
  return binding;
}

export function publicBinding(binding) {
  return { id: binding.id, label: binding.label, profile: binding.profile, rootId: binding.rootId, chatId: binding.chatId, command: binding.command, args: binding.args, cwd: binding.cwd, enabled: binding.enabled };
}

export function scopedHearthlineEnv(binding, { workspaceId, rootId, chatId }) {
  const env = { ...(binding.env || {}) };
  const prefix = env.HEARTHLINE_STORE_NAMESPACE || 'branchline';
  const canonical = `${prefix}:${crypto.createHash('sha256').update(`${workspaceId}|${binding.profile}|${rootId}|${chatId}`).digest('hex').slice(0, 32)}`;
  return { ...env, HEARTHLINE_STORE_NAMESPACE: canonical };
}

export function scopedHearthlineNamespace(binding, { workspaceId, rootId, chatId }) {
  return scopedHearthlineEnv(binding, { workspaceId, rootId, chatId }).HEARTHLINE_STORE_NAMESPACE;
}

// Starting an adapter already crosses a process boundary, including tools/list.
// The preserved baseline contains the former unrestricted launcher. A future
// executor must enforce a capability grant before this interface can dispatch.
export async function mcpRequest() {
  throw new Error('MCP dispatch held: no enforced process capability boundary is installed.');
}
