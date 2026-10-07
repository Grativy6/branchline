import { sessionFetch } from './session.js';
import { eventStreamParser } from './event-stream.js';

async function request(path, options = {}) {
  const response = await sessionFetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  let result;
  try { result = await response.json(); }
  catch { throw new Error('The local app returned an unreadable response. Your draft is still here.'); }
  if (!response.ok) throw new Error(result.error || `The local app could not complete this action (${response.status}).`);
  return result;
}

const contextStatuses = new Map();
export const api = {
  archivePreview: id => request('/api/model-archives/preview?'+new URLSearchParams({id})),
  dreamView: id => request('/api/dreams/view?'+new URLSearchParams({id})),
  dreamSource: input => request('/api/dreams/source?'+new URLSearchParams(input)),
  dreamOrganizePreview: input => request('/api/dreams/organize-preview',{method:'POST',body:JSON.stringify(input)}),
  dreamRestorePreview: input => request('/api/dreams/restore-preview',{method:'POST',body:JSON.stringify(input)}),
  dreamRestore: (input,signal) => request('/api/dreams/restore',{method:'POST',body:JSON.stringify(input),signal}),
  pcAccess: () => request('/api/pc-access'),
  pcAccessSave: value => request('/api/pc-access', {method:'POST',body:JSON.stringify(value)}),
  sketchAccess: () => request('/api/sketches/access'),
  imageProviderCheck: (revisionId, signal) => request('/api/image-provider/check', { method: 'POST', body: JSON.stringify({ revisionId }), signal }),
  localModelStatus: () => request('/api/local-model/status'),
  localModelControl: action => request('/api/local-model/control', { method: 'POST', body: JSON.stringify({ action }) }),
  previewAgentProfile: bundle => request('/api/agent-profiles/preview', { method: 'POST', body: JSON.stringify(bundle) }),
  startupStatus: () => request('/api/startup-status'),
  previewHarnessImport: file => request('/api/harnesses/import', { method: 'POST', body: JSON.stringify(file) }),
  parallelOptions: chatId => request('/api/parallel/options?' + new URLSearchParams({ chatId })),
  parallelStatus: chatId => request('/api/parallel/status?' + new URLSearchParams({ chatId })),
  parallelStart: input => request('/api/parallel/start', { method:'POST', body:JSON.stringify(input) }),
  parallelCancel: runId => request('/api/parallel/cancel', { method:'POST', body:JSON.stringify({ runId }) }),
  peerSource: input => request('/api/hearth/source?'+new URLSearchParams(input)),
  stopWork: input => request('/api/work/stop', { method:'POST', body:JSON.stringify(input) }),
  continuingStart: input => request('/api/hearth/continuing/start', { method:'POST', body:JSON.stringify(input) }),
  continuingMessage: input => request('/api/hearth/continuing/message', { method:'POST', body:JSON.stringify(input) }),
  continuingResume: input => request('/api/hearth/continuing/resume', { method:'POST', body:JSON.stringify(input) }),
  stopPeer: input => request('/api/hearth/episode/stop', { method:'POST', body:JSON.stringify(input) }),
  hearthStart: input => request('/api/hearth/start', { method:'POST', body:JSON.stringify(input) }),
  hearthMessage: input => request('/api/hearth/message', { method:'POST', body:JSON.stringify(input) }),
  hearthResume: input => request('/api/hearth/resume', { method:'POST', body:JSON.stringify(input) }),
  contextCarry: async (chatId, speaker) => {
    const key = new URLSearchParams({ chatId, speaker }).toString(), prior = contextStatuses.get(key);
    const response = await sessionFetch('/api/context-carry?' + key, { headers: prior ? { 'If-None-Match': prior.revision } : {} });
    if (response.status === 304 && prior) return prior.value;
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Could not check conversation space.');
    if (contextStatuses.size >= 16) contextStatuses.delete(contextStatuses.keys().next().value);
    contextStatuses.set(key, { value, revision: response.headers.get('etag') });
    return value;
  },
  prepareCarry: input => request('/api/context-carry/prepare', { method: 'POST', body: JSON.stringify(input) }),
  startCarry: input => request('/api/context-carry/start', { method: 'POST', body: JSON.stringify(input) }),
  carrySource: (chatId, sourceId, offset = 0) => request('/api/context-carry/source?' + new URLSearchParams({ chatId, sourceId, offset })),
  toolPending: () => request('/api/tools/pending'),
  toolAnswer: input => request('/api/tools/answer', { method: 'POST', body: JSON.stringify(input) }),
  codexStatus: () => request('/api/codex/status'),
  codexLogin: () => request('/api/codex/login', { method: 'POST', body: '{}' }),
  codexLogout: () => request('/api/codex/logout', { method: 'POST', body: '{}' }),
  state: () => request('/api/state'),
  stateSince: async revision => {
    const response = await sessionFetch('/api/state', { headers: revision ? { 'If-None-Match': revision } : {} });
    if (response.status === 304) return null;
    const state = await response.json();
    if (!response.ok) throw new Error(state.error || 'Could not refresh this workspace.');
    return { state, revision: response.headers.get('etag') };
  },
  saveDraft: (chatId, text) => request('/api/command', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ type: 'draft.save', payload: { chatId, text } }) }),
  updateUi: payload => request('/api/command', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ type: 'ui.update', payload }) }),
  command: (type, payload) => request('/api/command', { method: 'POST', body: JSON.stringify({ type, payload }) }),
  prepareAction: (input) => request('/api/actions/prepare', { method: 'POST', body: JSON.stringify(input) }),
  decideAction: (input) => request('/api/actions/decide', { method: 'POST', body: JSON.stringify(input) }),
  exchange: (chatId, content) => request('/api/exchange', { method: 'POST', body: JSON.stringify({ chatId, content }) }),
  // Streaming is deliberately kept alongside the JSON exchange API so older
  // servers and saved sessions remain usable while replies arrive as SSE.
  exchangeStream: async (chatId, content, { onEvent, selectedFile, ...turn } = {}) => {
    const response = await sessionFetch('/api/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json', 'X-Branchline-Stream': 'events-v2' },
      body: JSON.stringify({ chatId, content, ...turn, stream: true, ...(selectedFile ? { selectedFile } : {}) }),
    });
    if (!response.ok) {
      let message = `The local app could not complete this action (${response.status}).`;
      try { message = (await response.json()).error || message; } catch {}
      throw new Error(message);
    }
    const type = response.headers.get('content-type') || '';
    if (!type.includes('text/event-stream') || !response.body) {
      const result = await response.json();
      onEvent?.({ type: 'done', ...result });
      return result;
    }
    const reader = response.body.getReader();
    let finalState;
    let sawDone = false;
    const parser = eventStreamParser(event => {
      finalState = event.state || finalState;
      if (event.type === 'done') sawDone = true;
      onEvent?.(event);
    });
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        parser.push(value);
      }
      parser.finish();
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    if (!sawDone) throw new Error('The local model ended the stream before completing the reply.');
    return finalState;
  },
  cancel: (chatId) => request('/api/cancel', { method: 'POST', body: JSON.stringify({ chatId }) }),
  continuityReflect: (input) => request('/api/continuity/reflect', { method: 'POST', body: JSON.stringify(input) }),
  learningPacket: (input) => request('/api/learning/packet', { method: 'POST', body: JSON.stringify(input) }),
  continuityCancel: (chatId) => request('/api/continuity/cancel', { method: 'POST', body: JSON.stringify({ chatId }) }),
  modelsDiscover: ({ baseUrl }) => request('/api/models/discover', { method: 'POST', body: JSON.stringify({ baseUrl }) }),
  mcpCapabilities: ({ rootId, chatId, profile } = {}) => request(`/api/mcp/capabilities?${new URLSearchParams(Object.fromEntries(Object.entries({ rootId, chatId, profile }).filter(([, value]) => value)))}`),
  mcpCall: (payload) => request('/api/mcp/call', { method: 'POST', body: JSON.stringify(payload) }),
  storage: () => request('/api/storage'),
  storageBackup: () => request('/api/storage/backup', { method: 'POST', body: '{}' }),
  storageVerify: (id) => request('/api/storage/verify', { method: 'POST', body: JSON.stringify({ id }) }),
  storageRestoreCopy: (id) => request('/api/storage/restore-copy', { method: 'POST', body: JSON.stringify({ id }) }),
};
