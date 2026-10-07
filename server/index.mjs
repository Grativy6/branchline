import { archivePreview } from './model-archives.mjs';
import { readPeerSource } from './peer-context.mjs';
import { dreamView, organizationPreview, restoreTarget, applyDreamRestore } from './dream-history.mjs';
import { migrateCoats } from './harnesses.mjs';
import http from 'node:http';
import { ReplyMetrics } from './reply-metrics.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import { ImageStore, IMAGE_LIMITS } from './image-store.mjs';
import { checkInvokeConnection, imageConnection } from './image-provider.mjs';
import { activeImageIds, selectedImages, recordImageSelection, applyImageSelection, imageObjects } from './images.mjs';
import { ImagePlans, imageCapability } from './model-media.mjs';
import { BundledRunner } from './bundled-runner.mjs';
import { configureBundledModel } from './bundled-setup.mjs';
import { BUNDLED_IMAGE_TOKENS } from './bundled-profile.mjs';
import { previewHarnessImport, exportHarness } from './harness-files.mjs';
import { liveSketch, sketchHead, pendingSketchFile, assertSketchDisclosure } from './sketches.mjs';
import { previewAgentProfile, exportAgentProfile, assertAgentDisclosure } from './agent-profiles.mjs';
import { StorageManager } from './storage.mjs';
import { ReflectionManager, exportContinuity } from './reflection.mjs';
import { prepareModelWrite, prepareInterruptedWrite } from './effect-boundary.mjs';
import { appendExchange, ensureText } from './domain.mjs';
import { generateResult, streamGenerate, compileMessages, discoverModels, replyTokenLimit, validateLoopback } from './model.mjs';
import { bindingForScope, publicBinding, validateScope } from './mcp.mjs';
import { prepareModelHandoff, holdExternalProcess, PROFILE, recordHandoff, digest } from './handoff.mjs';
import { packHandoffs } from './handoff-wire.mjs';
import { recordSelectedFile } from './selected-file.mjs';
import { checkTurnRequest, assertInferenceIdle, resolveSpeaker, currentAssignment } from './table.mjs';
import { carryPreview, readChatSource, activateReadyCarry, cancelReadyCarry, readyCarry } from './context-carry.mjs';
import { resourceSettings, carrySettings } from '../public/resource-settings.js';
import { resolveRecorder } from './carry-recorder.mjs';
import { contextBudget } from './context-budget.mjs';
import { sharedContextPlan } from './shared-context.mjs';
import { CodexProvider } from './codex-provider.mjs';
import { createReplyPlanner } from './reply-plan.mjs';
import { learningPacket } from './learning-view.mjs';
import { createUiSession } from './ui-session.mjs';
import { AdoptionBroker } from './actions.mjs';
import { makeToolContract } from './tool-contract.mjs';
import { PcFiles } from './pc-files.mjs';
import { pcApron } from './pc-permissions.mjs';
import { ConversationTools, ToolInteractions } from './conversation-tools.mjs';
import { ContinuingHearthTasks } from './continuing-hearth.mjs';
import { liveRun, openRun, PARALLEL_PROFILE } from './parallel-state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicHeaders = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

function json(response, status, value, headers = {}) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { ...publicHeaders, 'content-type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(value));
}

function sse(response, event, value) {
  if (response.destroyed || response.writableEnded) return false;
  response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
  return true;
}

async function readBody(request, maxBytes = 1024 * 1024) {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    throw Object.assign(new Error('JSON content type required.'), { status: 415 });
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Request body too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Invalid JSON request.'); }
}

function isLocalRequest(request, port) {
  try {
    const host = new URL('http://' + request.headers.host);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname)) return false;
    if (Number(host.port || 80) !== port) return false;
    if (request.headers['sec-fetch-site'] === 'cross-site') return false;
    const origin = request.headers.origin;
    if (!origin) return true;
    const source = new URL(origin);
    return source.protocol === 'http:' && source.host === host.host;
  } catch { return false; }
}

export async function createApp({
  dataDir = path.resolve(here, '../.local'),
  publicDir = path.resolve(here, '../public'),
  backupDir = path.resolve(dataDir, '..', 'backups'),
  modelOptions = {},
  bundledDir = path.resolve(here, '../bundled-model'),
  onLoadProgress,
} = {}) {
  const uiSession = createUiSession();
  const store = new Store(dataDir);
  await store.open({ onProgress: onLoadProgress });
  const localRunner = modelOptions.localRunner ?? new BundledRunner(bundledDir);
  let bundledWarning = null;
  try { await localRunner.open(); }
  catch { bundledWarning = 'The included-model installation needs repair. Other model connections are still available.'; }
  if (localRunner.status().available && store.freshWorkspace) await store.transact(state => configureBundledModel(state, { fresh: true }));
  const storage = new StorageManager(store, backupDir);
  const imageStore = new ImageStore(dataDir);
  const imagePlans = new ImagePlans({ capability: modelOptions.imageCapability ?? (model => model.runtime === 'bundled' ? localRunner.imageCapability(model) : imageCapability(model)) });
  const codex = modelOptions.codex ?? new CodexProvider({ accountDir: path.resolve(dataDir, '..', 'codex-connection') });
  modelOptions = { ...modelOptions, codex, imageStore, localRunner };
  const reflections = new ReflectionManager(store, modelOptions);
  const contextStatusCache = new Map();
  const actions = new AdoptionBroker(store);
  const toolInteractions = new ToolInteractions();
  const pcFiles = new PcFiles(store,modelOptions.pcFilesOptions);
  if(store.state.chats.some(c=>!c.coatPolicy)) await store.transact(state=>{migrateCoats(state);return state;});
  const parallel = new ContinuingHearthTasks(store, toolInteractions, modelOptions);
  const replyPlanner = createReplyPlanner(modelOptions);
  const records = store.state.handoffs?.records || [];
  const unfinishedOperations = records.filter(r => r.kind === 'operation.request' && !records.some(next => ['operation.result', 'operation.interrupted'].includes(next.kind) && next.parents.includes(r.id)));
  if (unfinishedOperations.length || store.state.parallel?.runs.some(openRun) || store.state.exchanges.some(exchange => exchange.status === 'pending') || store.state.roots.some(root => root.continuity?.jobs.some(job => job.status === 'pending')) || store.state.mind?.jobs.some(job => job.status === 'pending') || store.state.contextCarry?.jobs.some(job => job.status === 'pending')) {
    await store.transact(prepareInterruptedWrite);
  }
  const active = new Map();
  const stopping=new Set();
  const retainStop=promise=>{stopping.add(promise);promise.catch(error=>{parallel.lastError='Stop record could not be saved: '+error.message;}).finally(()=>stopping.delete(promise));};
  const stopEpoch = new Map();
  let imageCheck = null;
  let dreamRecovery = null;
  let closing = false;
  // Only fixed application routes supply these callbacks, never model text.
  async function observedOperation(name, payload, capability, operation) {
    let request;
    await store.transact(state => {
      request = recordHandoff(state, { kind: 'operation.request', from: 'local_ui', to: 'fixed_application_operation', payload,
        status: 'REQUEST_RECORDED', detail: { operation: name, purpose: name, capability, authority: 'this local UI request only', localIdentityAssumption: 'not independently authenticated human identity' } });
      return state;
    });
    let result;
    try { result = await operation(); }
    catch (error) {
      await store.transact(state => { recordHandoff(state, { kind: 'operation.result', taskId: request.taskId, from: 'fixed_application_operation', to: 'local_ui', payload: { error: error.message }, parents: [request.id], status: 'UNRESOLVED', unresolved: ['The operation reported an error. Any partial effects remain for inspection.'], detail: { operation: name, error: error.message, completed: false } }); return state; });
      throw error;
    }
    await store.transact(state => { recordHandoff(state, { kind: 'operation.result', taskId: request.taskId, from: 'fixed_application_operation', to: 'local_ui', payload: result, parents: [request.id], status: 'OBSERVED', detail: { operation: name, result, authorityCreated: false } }); return state; });
    return result;
  }
  const publicRoot = path.resolve(publicDir);
  const server = http.createServer(async (request, response) => {
    // A page may keep polling while its native window is closing. Release the
    // socket after its current response instead of renewing keep-alive forever.
    response.on('finish', () => { if (closing) request.socket.end(); });
    try {
      if (closing) { response.shouldKeepAlive = false; return json(response, 503, { error: 'The local server is shutting down.' }); }
      if (!isLocalRequest(request, server.address()?.port)) return json(response, 403, { error: 'Only same-origin local requests are accepted.' });
      const url = new URL(request.url, 'http://' + request.headers.host);
      const method = request.method;
      if (url.pathname.startsWith('/api/')) uiSession.authorize(request);
      if (method === 'POST' && url.pathname === '/api/image-provider/check') {
        const body = await readBody(request, 1024);
        if (!body || Object.keys(body).join(',') !== 'revisionId') throw new Error('Choose the saved image connection to check.');
        const saved = imageConnection(store.state);
        if (!saved?.endpoint || body.revisionId !== saved.id) throw new Error('The image connection changed. Reopen Image tools and check the saved address.');
        if (imageCheck) throw new Error('An image connection check is already running.');
        const controller = new AbortController();
        let finishCheck;
        const check = { controller, done: new Promise(resolve => { finishCheck = resolve; }) }; imageCheck = check;
        response.on('close', () => { if (!response.writableEnded) controller.abort(); });
        try {
          const result = await observedOperation('image_connection_check', { revisionId: saved.id, endpoint: saved.endpoint }, 'read only Invoke version and installed main-model metadata at the saved loopback address',
            () => checkInvokeConnection(saved.endpoint, { signal: controller.signal }));
          if (imageConnection(store.state)?.id !== saved.id) throw new Error('The image connection changed during its check. Check the new saved address.');
          return json(response, 200, result);
        } finally { if (imageCheck === check) imageCheck = null; finishCheck(); }
      }
      if (method === 'GET' && url.pathname === '/api/local-model/status') return json(response, 200, localRunner.status());
      if (method === 'POST' && url.pathname === '/api/local-model/control') {
        const body = await readBody(request, 1024);
        if (!body || Object.keys(body).join(',') !== 'action' || !['auto', 'cpu', 'unload'].includes(body.action)) throw new Error('Choose automatic, CPU, or unload.');
        assertInferenceIdle(store.state);
        return json(response, 200, await observedOperation('included_model_' + body.action, body, 'manage only the app-owned Qwen process', async () => {
          if (body.action === 'unload') await localRunner.unload(); else await localRunner.setPreference(body.action);
          return localRunner.status();
        }));
      }
      if (method === 'POST' && url.pathname === '/api/images/select') {
        const body = await readBody(request, Math.ceil(IMAGE_LIMITS.bytes / 3) * 4 + 4096);
        if (!body || Object.keys(body).sort().join(',') !== 'chatId,image') throw new Error('Choose picture bytes and their branch.');
        assertInferenceIdle(store.state);
        const current = store.state.chats.find(c => c.id === body.chatId);
        if (!current || current.archivedAt || store.state.roots.find(r => r.id === current.rootId)?.archivedAt) throw new Error('Choose an active branch.');
        if (activeImageIds(store.state, body.chatId).length >= IMAGE_LIMITS.count) throw new Error('Remove a selected picture before adding another.');
        const snapshot = await imageStore.ingest(body.image);
        let image;
        await store.transact(state => { assertInferenceIdle(state); image = recordImageSelection(state, body.chatId, snapshot); return state; });
        return json(response, 201, { image, state: store.state });
      }
      if (method === 'POST' && url.pathname === '/api/images/context') {
        const body = await readBody(request, 4096);
        if (!body || Object.keys(body).sort().join(',') !== 'chatId,ids') throw new Error('Choose pictures for this branch.');
        return json(response, 200, await store.transact(state => applyImageSelection(state, body.chatId, body.ids)));
      }
      if (method === 'POST' && url.pathname === '/api/images/plan') {
        const body = await readBody(request, 4096);
        if (!body || Object.keys(body).some(k => !['chatId','speaker','replyMode'].includes(k))) throw new Error('Choose the branch and receiving chairs.');
        assertInferenceIdle(store.state);
        return json(response, 200, await imagePlans.prepare(store.state, body));
      }
      if (method === 'GET' && url.pathname === '/api/images/object') {
        const image = selectedImages(store.state, url.searchParams.get('chatId'), [url.searchParams.get('id')])[0];
        const variant = url.searchParams.get('variant') ?? 'thumbnail';
        if (!['original','view','thumbnail'].includes(variant)) throw new Error('Choose an image view.');
        const bytes = await imageStore.read(image[variant]);
        response.writeHead(200, { ...publicHeaders, 'content-type': image[variant].mimeType, 'content-length': bytes.length,
          ...(variant === 'original' ? { 'content-disposition': 'attachment; filename="original-' + image.original.sha256.slice(0, 12) + '.' + ({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[image.original.mimeType]) + '"' } : {}) });
        return response.end(bytes);
      }
      if (method === 'GET' && url.pathname === '/api/startup-status') return json(response, 200, { warnings: server.startupWarnings });
      if (method === 'GET' && url.pathname === '/api/state') {
        const etag = `"${store.owner.token}:${store.sequence}"`;
        if (request.headers['if-none-match'] === etag) {
          response.writeHead(304, { ...publicHeaders, etag }); return response.end();
        }
        return json(response, 200, store.state, { etag });
      }
      if (method === 'GET' && url.pathname === '/api/parallel/options') return json(response, 200, parallel.options(url.searchParams.get('chatId')));
      if (method === 'GET' && url.pathname === '/api/parallel/status') return json(response, 200, parallel.status(url.searchParams.get('chatId')));
      if (method === 'POST' && url.pathname === '/api/parallel/start') return json(response, 202, await parallel.start(await readBody(request, 100000)));
      if(method==='POST'&&url.pathname==='/api/hearth/continuing/start')return json(response,202,await parallel.startContinuing(await readBody(request,100000)));
      if(method==='POST'&&url.pathname==='/api/hearth/continuing/message')return json(response,200,await parallel.messageContinuing(await readBody(request,64000)));
      if(method==='POST'&&url.pathname==='/api/hearth/continuing/resume')return json(response,202,await parallel.resumeContinuing(await readBody(request,64000)));
      if(method==='POST'&&url.pathname==='/api/hearth/episode/stop'){const b=await readBody(request);if(Object.keys(b).sort().join()!=='peer,runId')throw new Error('Choose one episode.');await parallel.stopPeer(b.runId,b.peer);return json(response,200,store.state);}
      if (method === 'POST' && url.pathname === '/api/hearth/start') return json(response, 202, await parallel.startHearth(await readBody(request, 100000)));
      if (method === 'POST' && url.pathname === '/api/hearth/message') return json(response, 200, await parallel.messageHearth(await readBody(request, 64000)));
      if (method === 'POST' && url.pathname === '/api/hearth/resume') return json(response, 202, await parallel.resumeHearth(await readBody(request, 64000)));
      if (method === 'POST' && url.pathname === '/api/parallel/cancel') {
        const body = await readBody(request, 1000);
        if (!body || Object.keys(body).length !== 1 || typeof body.runId !== 'string') throw new Error('Choose the parallel task to stop.');
        await parallel.cancel(body.runId); return json(response, 200, store.state);
      }
      if (method === 'GET' && url.pathname === '/api/context-carry') {
        const chatId = url.searchParams.get('chatId');
        const contextState = store.state;
        const chat = contextState.chats.find(c => c.id === chatId);
        if (!chat) throw new Error('Choose a branch.');
        const preparationState = reflections.status(chatId);
        // State changes and active preparation transitions invalidate immediately.
        // Recheck external local-model capacity at least once every 15 seconds.
        const etag = '"' + digest([store.owner.token, store.sequence, chatId,
          url.searchParams.get('speaker'), preparationState, Math.floor(Date.now() / 15000)]) + '"';
        if (request.headers['if-none-match'] === etag) { response.writeHead(304, { ...publicHeaders, etag }); return response.end(); }
        if (contextStatusCache.has(etag)) return json(response, 200, contextStatusCache.get(etag), { etag });
        const root = contextState.roots.find(r => r.id === chat.rootId);
        let model = contextState.models.find(m => m.id === root?.modelId), shared, preparationBudget, recorder;
        try {
          const chosen = resolveRecorder(contextState, chatId, url.searchParams.get('speaker') || carrySettings(chat).speaker);
          model = chosen.model; recorder = chosen.selection.recorder;
          [shared, preparationBudget] = await Promise.all([sharedContextPlan(contextState, chatId, modelOptions), contextBudget(model, { ...modelOptions, maxTokens: 2048 })]);
        } catch (error) {
          shared = { scope: 'conversation', participants: [], characters: null, limit: modelOptions.maxContextCharacters ?? 60000,
            budget: null, target: null, contextIssue: error.message };
        }
        const preview = carryPreview(contextState, chatId, { maxContextCharacters: preparationBudget?.characters ?? 60000, target: shared.target, recorder });
        const result = { ...preview, ...shared, preparation: shared.target ? preview.preparation : null, preparationBudget, preparationState };
        if (contextStatusCache.size >= 16) contextStatusCache.delete(contextStatusCache.keys().next().value);
        contextStatusCache.set(etag, result);
        return json(response, 200, result, { etag });
      }
      if (method === 'POST' && url.pathname === '/api/context-carry/start') {
        const body = await readBody(request, 4096);
        if (!body || Object.keys(body).sort().join() !== 'baseId,chatId,lastMessageId,speaker') throw new Error('Choose only the branch, source cutoff and recorder.');
        return json(response, 202, reflections.startCarry(body));
      }
      if (method === 'GET' && url.pathname === '/api/context-carry/source') {
        return json(response, 200, readChatSource(store.state, url.searchParams.get('chatId'), url.searchParams.get('sourceId'), Number(url.searchParams.get('offset') || 0)));
      }
      if (method === 'POST' && url.pathname === '/api/context-carry/prepare') {
        const body = await readBody(request, 4096);
        if (!body || Object.keys(body).some(k => !['chatId', 'speaker', 'baseId', 'lastMessageId'].includes(k))) throw new Error('Context preparation accepts only the branch, chair and current revision.');
        const controller = new AbortController();
        response.on('close', () => { if (!response.writableEnded) controller.abort(); });
        const result = await reflections.run({ ...body, target: 'carry' }, { signal: controller.signal });
        return json(response, result.status, result.error ? { error: result.error, state: result.state } : result.state);
      }
      if (method === 'GET' && url.pathname === '/api/tools/pending') return json(response, 200, toolInteractions.list());
      if (method === 'POST' && url.pathname === '/api/tools/answer') return json(response, 200, await toolInteractions.respond(await readBody(request, 8192)));
      if (method === 'GET' && url.pathname === '/api/codex/status') return json(response, 200, await codex.status());
      if (method === 'POST' && ['/api/codex/login', '/api/codex/logout'].includes(url.pathname)) {
        const body = await readBody(request);
        if (!body || Object.keys(body).length) throw new Error('The subscription connection accepts no credentials, paths, or configuration from the page.');
        assertInferenceIdle(store.state);
        const login = url.pathname.endsWith('/login'); let result;
        await observedOperation(login ? 'codex.login' : 'codex.logout', {}, { effect: 'account_connection', profile: 'branchline.codex-chat/1' }, async () => {
          result = login ? await codex.loginStart() : await codex.logout();
          return { status: login ? 'browser_sign_in_started' : 'signed_out' };
        });
        return json(response, 200, result);
      }
      if (method === 'POST' && url.pathname === '/api/actions/prepare') return json(response, 200, await actions.prepare(await readBody(request, 4096)));
      if (method === 'POST' && url.pathname === '/api/actions/decide') {
        const result = await actions.decide(await readBody(request, 4096));
        return json(response, result.status, result.error ? { error: result.error, state: result.state } : result.state);
      }
      if (method === 'GET' && url.pathname === '/api/handoffs') {
        const chatId = url.searchParams.get('chatId');
        return json(response, 200, { profile: PROFILE, records: (store.state.handoffs?.records || []).filter(r => !chatId || r.scope.chatId === chatId), peerRuntime: PARALLEL_PROFILE, externalProcessBoundary: 'NOT_IMPLEMENTED' });
      }
      // Read-only export. Cache advertisements omit bytes, never required meaning.
      if (method === 'POST' && url.pathname === '/api/handoffs/packet') {
        const body = await readBody(request, 300000);
        if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(key => !['taskId', 'knownNodes'].includes(key))) throw new Error('Packet request accepts only taskId and knownNodes.');
        const taskId = ensureText(body.taskId, 'Task', 200);
        const job = store.state.parallel?.jobs.find(j=>j.id === taskId);
        const admissionId = job && store.state.parallel.runs.find(r=>r.id === job.runId)?.admissionId;
        const records = (store.state.handoffs?.records || []).filter(r => r.taskId === taskId || r.id === admissionId);
        if (!records.length) return json(response, 404, { error: 'No recorded handoff for that task.' });
        return json(response, 200, packHandoffs(records, { known: body.knownNodes ?? [], taskId }));
      }
      if (method === 'GET' && url.pathname === '/api/storage') return json(response, 200, await storage.info());
      if (method === 'POST' && url.pathname === '/api/learning/packet') {
        const body = await readBody(request, 20000);
        return json(response, 200, learningPacket(store.state, body));
      }
      if (method === 'POST' && url.pathname === '/api/storage/backup') return json(response, 201, { backup: await observedOperation('create verified backup copy', {}, { read: [store.file, store.workspaceMetadataFile], createWithin: storage.backupDir, delete: false, enforcement: 'fixed_application_paths', osIsolation: 'NOT_IMPLEMENTED' }, () => storage.backup()) });
      if (method === 'POST' && url.pathname === '/api/storage/verify') {
        const body = await readBody(request); const id = ensureText(body.id, 'backup id', 80);
        return json(response, 200, await observedOperation('verify selected backup', { id }, { readWithin: storage.backupDir, modifyBackup: false }, () => storage.verify(id)));
      }
      if (method === 'POST' && url.pathname === '/api/storage/restore-copy') {
        const body = await readBody(request); const id = ensureText(body.id, 'backup id', 80);
        return json(response, 201, await observedOperation('restore verified backup into a new copy', { id }, { readWithin: storage.backupDir, createWithin: storage.recoveredDir, replaceActiveWorkspace: false, delete: false, enforcement: 'fixed_application_paths', osIsolation: 'NOT_IMPLEMENTED' }, () => storage.restoreCopy(id)));
      }
      if (method === 'POST' && url.pathname === '/api/models/discover') {
        const body = await readBody(request);
        const baseUrl = validateLoopback(body.baseUrl).href;
        return json(response, 200, await observedOperation('read local model catalogue', { baseUrl }, { interface: 'loopback_HTTP_GET_models', destination: baseUrl, redirects: false, remoteServiceIsolation: 'NOT_ASSESSED' }, () => discoverModels(baseUrl)));
      }
      if (method === 'GET' && url.pathname === '/api/export') {
        const snapshot = store.state, objects = imageObjects(snapshot);
        if (objects.length) {
          for (const ref of objects) await imageStore.read(ref);
          response.writeHead(200, { ...publicHeaders, 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="branchline-workspace-with-images.json"' });
          const write = async text => {
            if (response.destroyed) throw new Error('Export connection closed.');
            if (!response.write(text)) await new Promise((resolve, reject) => {
              const done = error => { response.off('drain', drain); response.off('close', close); error ? reject(error) : resolve(); };
              const drain = () => done(), close = () => done(new Error('Export connection closed.'));
              response.once('drain', drain); response.once('close', close);
            });
          };
          await write('{"profile":"branchline.workspace-export/2","state":' + JSON.stringify(snapshot) + ',"imageObjects":[');
          for (let i = 0; i < objects.length; i++) {
            const ref = objects[i], bytes = await imageStore.read(ref);
            await write((i ? ',' : '') + JSON.stringify({ ...ref, base64: bytes.toString('base64') }));
          }
          return response.end(']}');
        }
        return json(response, 200, store.state, { 'content-disposition': 'attachment; filename="branchline-workspace.json"' });
      }
      if (method === 'GET' && url.pathname === '/api/mcp/capabilities') {
        const rootId = url.searchParams.get('rootId') || null; const chatId = url.searchParams.get('chatId') || null;
        const profile = url.searchParams.get('profile') || null;
        validateScope(store.state, rootId, chatId);
        const bindings = (store.state.mcpBindings || []).filter(binding => binding.enabled && (!rootId || binding.rootId === rootId) && (!chatId || binding.chatId === null || binding.chatId === chatId) && (!profile || binding.profile === profile));
        const results = [];
        for (const binding of bindings) {
          results.push({ binding: publicBinding(binding), status: 'unavailable', tools: [], error: 'This adapter needs an enforced process capability boundary before Branchline can start it. No process was launched.' });
        }
        return json(response, 200, { rootId, chatId, profile, bindings: results });
      }
      if (method === 'POST' && url.pathname === '/api/mcp/call') {
        const body = await readBody(request); const binding = bindingForScope(store.state, body);
        if (typeof body.tool !== 'string' || !/^[A-Za-z0-9_.-]{1,200}$/.test(body.tool)) throw new Error('invalid MCP tool name');
        const args = body.arguments === undefined ? {} : body.arguments;
        if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new Error('MCP arguments must be an object');
        let receipt;
        const purpose = body.purpose === undefined ? null : ensureText(body.purpose, 'tool purpose', 2000);
        await store.transact(state => { receipt = holdExternalProcess(state, { rootId: body.rootId, chatId: body.chatId, bindingId: binding.id, method: 'tools/call', tool: body.tool, arguments: args, purpose, bindingSnapshot: publicBinding(binding) }); return state; });
        return json(response, 409, { error: 'Tool dispatch held: this adapter has no enforced process capability boundary. No process was launched.', receipt });
      }
      if(method==='GET'&&url.pathname==='/api/hearth/source'){
        const run=store.state.parallel?.runs.find(r=>r.id===url.searchParams.get('runId')),peer=run?.peers?.find(p=>p.name===url.searchParams.get('peer'));
        if(!peer)throw new Error('Choose a continuing hearth and peer.');
        return json(response,200,readPeerSource(store.state,run,peer,url.searchParams.get('sourceId'),Number(url.searchParams.get('offset')||0)));
      }
      if (method === 'GET' && url.pathname === '/api/pc-access') return json(response,200,pcFiles.status());
      if (method === 'POST' && url.pathname === '/api/pc-access') {
        const result=await pcFiles.configure(await readBody(request));
        // A permission change ends affected requests. The next reply recompiles
        // the apron and source-sharing review instead of renewing an old grant.
        for(const [chatId,controller] of active) if(store.state.pcAccess?.exposures.some(e=>e.rootId===store.state.chats.find(c=>c.id===chatId)?.rootId))controller.abort();
        return json(response,200,result);
      }
      if (method === 'POST' && url.pathname === '/api/command') {
        const body = await readBody(request);
        if (body?.type === 'sketch.grant') {
          if (!body.payload || Object.keys(body.payload).sort().join() !== 'access,destination,modelId') throw new Error('Choose a model connection and Sketch Book access.');
          body.payload.workspaceId = store.workspaceId;
        }
        const minimal = ['draft.save', 'ui.update'].includes(body?.type) && request.headers.prefer === 'return=minimal';
        await store.command(body, { returnState: false }); await parallel.recheck();
        if (body.type === 'chat.carrySettings') {reflections.suspended.delete(body.payload.id);await store.transact(s=>{s.chats.find(c=>c.id===body.payload.id).workStopped=false;return s;});}
        void reflections.consider();
        if (minimal) return json(response, 200, { saved: true, sequence: store.sequence,
          ...(body.type === 'ui.update' ? { ui: store.state.ui } : { chatId: body.payload.chatId }) });
        return json(response, 200, store.state);
      }
      if (method === 'GET' && url.pathname === '/api/model-archives/preview') return json(response,200,archivePreview(store.state,url.searchParams.get('id')));
      if (method === 'GET' && url.pathname === '/api/dreams/view') return json(response,200,dreamView(store.state,url.searchParams.get('id')));
      if (method === 'GET' && url.pathname === '/api/dreams/export') {
        const view=dreamView(store.state,url.searchParams.get('id'));
        return json(response,200,{format:'branchline.dream-history/1',exportedAt:new Date().toISOString(),...view}, {'content-disposition':'attachment; filename="dream-history.json"'});
      }
      if (method === 'GET' && url.pathname === '/api/dreams/source') {
        const view=dreamView(store.state,url.searchParams.get('id')),record=view.records.find(r=>r.id===url.searchParams.get('dreamId'));
        const source=record?.sources[Number(url.searchParams.get('index'))];
        if(!source)throw new Error('Dream source not found.');
        const all=store.state.messages.filter(m=>m.chatId===source.chatId),cutoff=all.findIndex(m=>m.id===source.messageId);
        if(cutoff<0||digest(all[cutoff])!==source.messageHash)throw new Error('The recorded source is unavailable or changed.');
        const offset=Number(url.searchParams.get('offset')??0);if(!Number.isSafeInteger(offset)||offset<0||offset>cutoff)throw new Error('Invalid source page.');
        const rows=all.slice(offset,Math.min(cutoff+1,offset+8));
        return json(response,200,{title:source.title,desk:source.desk,messages:rows.map(m=>({role:m.role,name:m.modelLabel,at:m.createdAt,text:m.content.slice(0,12000),truncated:m.content.length>12000})),nextOffset:offset+rows.length<=cutoff?offset+rows.length:null});
      }
      if (method === 'POST' && url.pathname === '/api/dreams/organize-preview') {
        assertInferenceIdle(store.state);return json(response,200,organizationPreview(store.state,await readBody(request,32000)));
      }
      if (method === 'POST' && url.pathname === '/api/dreams/restore-preview') {
        assertInferenceIdle(store.state);const input=await readBody(request,4096),target=restoreTarget(store.state,input);
        return json(response,200,{...input,name:target.who.nickname||target.who.name,model:target.model.name,
          supported:target.model.runtime==='bundled'&&localRunner.status().available,
          limitation:target.model.runtime==='bundled'?'The included stock weights will be checked before selection. This does not reconstruct a trained adapter.':'This connection is managed outside Branchline. Exact checkpoint loading and verification are not available here yet.',
          affected:store.state.chats.filter(c=>c.table?.assignments.at(-1)?.personalId===input.personalId).map(c=>c.title)});
      }
      if (method === 'POST' && url.pathname === '/api/dreams/restore') {
        const input=await readBody(request,4096);assertInferenceIdle(store.state);const target=restoreTarget(store.state,input);
        if(dreamRecovery)throw new Error('A saved Dream state is already being prepared.');
        if(target.model.runtime!=='bundled'||!localRunner.status().available)throw new Error('This saved checkpoint has no supported verified restore route. Your current model is unchanged.');
        const controller=new AbortController();dreamRecovery=controller;store.dreamRecoveryPending=true;
        response.on('close',()=>{if(!response.writableEnded)controller.abort();});
        const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(180000)]);
        try {
          localRunner.verified=false;
          await localRunner.verify(signal);await localRunner.ensure(signal);signal.throwIfAborted();
          const checked={kind:'bundled_files_checked',manifestHash:digest(localRunner.manifest),at:new Date().toISOString()};
          const next=await store.transact(s=>{signal.throwIfAborted();assertInferenceIdle(s);return applyDreamRestore(s,input,checked);});
          return json(response,200,next);
        } finally {store.dreamRecoveryPending=false;dreamRecovery=null;}
      }
      if (method === 'POST' && url.pathname === '/api/harnesses/import') return json(response, 200, previewHarnessImport(await readBody(request, 100000)));
      if (method === 'GET' && url.pathname === '/api/sketches/export') {
        const s=liveSketch(store.state,url.searchParams.get('id'),url.searchParams.get('revision'),{archived:true});
        response.writeHead(200,{...publicHeaders,'content-type':'text/markdown; charset=utf-8','content-disposition':`attachment; filename="${s.id}.md"`});
        return response.end(sketchHead(s).text);
      }
      if (method === 'GET' && url.pathname === '/api/sketches/access') return json(response,200,{workspaceId:store.workspaceId});
      if (method === 'POST' && url.pathname === '/api/agent-profiles/preview') return json(response, 200, previewAgentProfile(await readBody(request)));
      if (method === 'GET' && url.pathname === '/api/agent-profiles/export') {
        const bundle = exportAgentProfile(store.state, url.searchParams.get('id'));
        response.writeHead(200, { ...publicHeaders, 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="agent-profile.json"' });
        return response.end(JSON.stringify(bundle, null, 2) + '\n');
      }
      if (method === 'GET' && url.pathname === '/api/harnesses/export') {
        const file = exportHarness(store.state, { id: url.searchParams.get('id'), version: Number(url.searchParams.get('version')) }, url.searchParams.get('format') || 'json');
        response.writeHead(200, { ...publicHeaders, 'content-type': file.type, 'content-disposition': `attachment; filename="${file.filename}"` });
        return response.end(file.text);
      }
      if (method === 'GET' && url.pathname === '/api/continuity/export') {
        const document = url.searchParams.get('document');
        const text = exportContinuity(store.state, { rootId: url.searchParams.get('rootId'), chatId: url.searchParams.get('chatId'), document });
        response.writeHead(200, { ...publicHeaders, 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="${document}.md"` });
        return response.end(text);
      }
      if (method === 'POST' && url.pathname === '/api/continuity/cancel') {
        const body = await readBody(request);
        const stopped = reflections.cancel(body.chatId);

        if (!stopped) return json(response, 404, { error: 'There is no active reflection in this chat.' });
        return json(response, 200, store.state);
      }
      if (method === 'POST' && url.pathname === '/api/continuity/reflect') {
        const body = await readBody(request);
        const controller = new AbortController();
        response.on('close', () => { if (!response.writableEnded) controller.abort(); });
        if (closing) controller.abort();
        const result = await reflections.run(body, { signal: controller.signal });
        return json(response, result.status, result.error ? { error: result.error, state: result.state } : result.state);
      }
      if(method==='POST'&&url.pathname==='/api/work/stop') {
        const body=await readBody(request);
        if(!body || !['all','episode'].includes(body.scope) || Object.keys(body).some(k=>!['scope','chatId'].includes(k)) || (body.scope==='episode'&&!store.state.chats.some(c=>c.id===body.chatId)))throw new Error('Choose all running episodes or this conversation episode.');
        // Close admission synchronously before awaiting any saved write.
        parallel.stopAdmission(body.scope === 'all' ? null : body.chatId);
        const ids=body.scope==='all'?store.state.chats.map(c=>c.id):[body.chatId];
        for(const id of ids){stopEpoch.set(id,(stopEpoch.get(id)??0)+1);active.get(id)?.abort();replyPlanner.cancel(id);reflections.cancel(id);}
        if(body.scope==='all'){imageCheck?.controller.abort();dreamRecovery?.abort();for(const r of store.state.parallel?.runs??[])if(openRun(r))retainStop(parallel.cancel(r.id));}
        else retainStop(parallel.cancelChat(body.chatId));
        retainStop(store.transact(s=>{for(const id of ids){const chat=s.chats.find(c=>c.id===id);chat.workStopped=true;cancelReadyCarry(s,id);}return s;}));
        return json(response,200,{state:store.state,scope:body.scope,message:'Stop requested for admitted local work. Partial results remain; the saved Stop record may still be finishing. Remote provider computation may still be finishing; cancellation is not independently confirmed.'});
      }
      if (method === 'POST' && url.pathname === '/api/cancel') {
        const { chatId } = await readBody(request);
        if (typeof chatId !== 'string' || !store.state.chats.some(c => c.id === chatId)) throw new Error('Choose a branch to stop.');
        parallel.stopAdmission(chatId);
        stopEpoch.set(chatId, (stopEpoch.get(chatId) ?? 0) + 1);
        const controller = active.get(chatId);
        const cancelledFollowUp = replyPlanner.cancel(chatId);
        const cancelledCarry = reflections.cancel(chatId);
        controller?.abort();

        retainStop(store.transact(s=>{const c=s.chats.find(c=>c.id===chatId);if(c)c.workStopped=true;cancelReadyCarry(s,chatId);return s;}));
        const ready = !!readyCarry(store.state, chatId);
        if (ready) retainStop(store.transact(state => { cancelReadyCarry(state, chatId); return state; }));
        const parallelActive = store.state.parallel?.runs.some(r => r.chatId === chatId && openRun(r));
        retainStop(parallel.cancelChat(chatId));
        if (!controller && !cancelledFollowUp && !parallelActive && !cancelledCarry && !ready && !store.state.exchanges.some(e => e.chatId === chatId && e.status === 'pending')) return json(response, 404, { error: 'There is no active reply or handoff in this chat.' });
        controller?.abort();
        return json(response, 200, store.state);
      }
      if (method === 'POST' && url.pathname === '/api/exchange') {
        const body = await readBody(request, 2 * 1024 * 1024);
        const priorSketch = body.requestId && store.state.exchanges.find(e=>e.chatId===body.chatId&&e.request?.id===body.requestId)?.sketchSource;
        const pendingSketch = !priorSketch && !body.followUpOf && (!body.kind || body.kind==='send') ? store.state.sketchBook?.pending[body.chatId] : null;
        if(priorSketch && body.selectedFile===undefined)body.selectedFile={name:`sketch-${priorSketch.sketchId}.md`,base64:Buffer.from(priorSketch.text,'utf8').toString('base64')};
        if (pendingSketch) {
          const file=pendingSketchFile(store.state,body.chatId);
          if(body.selectedFile!==undefined&&digest(body.selectedFile)!==digest(file))throw new Error('Remove the selected sketch before attaching different text.');
          body.selectedFile=file;
        }
        const epoch = stopEpoch.get(body.chatId) ?? 0;
        const preliminary = checkTurnRequest(store.state, body);
        const preliminaryImages = preliminary.prior ? null : imagePlans.check(store.state, body, preliminary);
        const selectedRoot = store.state.roots.find(r => r.id === store.state.chats.find(c => c.id === body.chatId)?.rootId);
        const otherSeat = !preliminary.prior && preliminary.replyMode === 'both' ? (preliminary.selection.seat === 'personal' ? 'visiting' : 'personal') : null;
        const otherModel = otherSeat ? resolveSpeaker(store.state, body.chatId, otherSeat).model : null;
        const resources = resourceSettings(selectedRoot);
        const budgets = preliminary.prior ? [] : await Promise.all([preliminary.model, ...(otherModel ? [otherModel] : [])].map(model => contextBudget(model, { maxContextCharacters: resources.inputCharacters, ...modelOptions, maxTokens: replyTokenLimit(selectedRoot, model) })));
        const imageCount = preliminaryImages?.images.length ?? 0;
        const imageTokensEach = [preliminary.model, ...(otherModel ? [otherModel] : [])].every(m => m?.runtime === 'bundled') ? BUNDLED_IMAGE_TOKENS : 4096;
        const contextLimit = Math.min(modelOptions.maxContextCharacters ?? resources.inputCharacters, ...budgets.map(b => b.characters)) - imageCount * imageTokensEach * 3;
        if (contextLimit < 2000) throw new Error(imageCount ? 'The selected pictures leave too little working context. Send fewer pictures or choose a larger loaded window. Your draft and pictures are retained.' : 'The reply allowance leaves too little input space in the loaded model window. Reduce maximum reply tokens in Resources or choose a larger loaded window. Your draft is retained.');
        // Verify objects before recording a turn. Dispatch rechecks them again.
        if (preliminaryImages) for (const picture of preliminaryImages.images) await imageStore.read(picture.view);
        const content = body.content ?? '';
        const exchangeId = 'exchange_' + crypto.randomUUID();
        let model;
        let messages;
        let handoff;
        let toolContract;
        let replay = null;
        let speaker = null;
        let maxTokens = null;
        await store.transact(state => {
          const checked = checkTurnRequest(state, body);
          if (!checked.prior && digest(checked.model) !== digest(preliminary.model)) throw new Error('The model changed while its context budget was checked. Review the selected chair and send again.');
          if (!checked.prior && otherSeat && digest(resolveSpeaker(state, body.chatId, otherSeat).model) !== digest(otherModel)) throw new Error('The second model changed while its context budget was checked. Review both chairs and send again.');
          if (checked.prior) { replay = checked.prior; return state; }
          if(epoch!==(stopEpoch.get(body.chatId)??0))throw new Error('Reply preparation was stopped. Send deliberately again.');
          state.chats.find(c=>c.id===body.chatId).workStopped=false;reflections.suspended.delete(body.chatId);
          if (!body.followUpOf) {
            activateReadyCarry(state, body.chatId);
            for (const seat of (otherSeat ? [checked.selection.seat, otherSeat] : [checked.selection?.seat])) {
              const destination = resolveSpeaker(state, body.chatId, seat);
              assertAgentDisclosure(state, body.chatId, destination.model, destination.selection, 'reply');
              assertSketchDisclosure(state, body.chatId, destination.model, store.workspaceId);
              compileMessages(state, body.chatId, body.content ?? '', { ...modelOptions, maxContextCharacters: contextLimit, selection: destination.selection });
            }
          }
          replyPlanner.check(state, body, checked);
          const chat = state.chats.find(item => item.id === body.chatId);
          const root = state.roots.find(item => item.id === chat?.rootId);
          if (!chat || !root) throw new Error('Chat not found.');
          model = checked.model;
          speaker = checked.selection;
          maxTokens = replyTokenLimit(root, model);
          const selectedFile = body.selectedFile === undefined ? null : recordSelectedFile(state, { chatId: chat.id, taskId: exchangeId, purpose: content, file: body.selectedFile });
          if(pendingSketch && digest(state.sketchBook?.pending[chat.id]??null)!==digest(pendingSketch))throw new Error('The selected sketch copy changed. Review it and send again.');
          const checkedImages = imagePlans.check(state, body, checked);
          const pictures = checkedImages?.images ?? [];
          const followUp = replyPlanner.prepare(state, body, checked, exchangeId, selectedFile);
          const turnRequest = { id: body.requestId ?? 'request_' + crypto.randomUUID(), kind: checked.kind, fingerprint: checked.fingerprint,
            ...(body.replyMode !== undefined ? { replyMode: checked.replyMode } : {}), ...(followUp ? { followUp } : {}),
            ...(body.followUpOf ? { followUpOf: body.followUpOf } : {}) };
          messages = compileMessages(state, chat.id, content, { ...modelOptions, maxContextCharacters: contextLimit, selectedFile, selectedImages: pictures, selection: speaker, requestKind: checked.kind, followUp: !!body.followUpOf, selectedSketch:pendingSketch });
          toolContract = makeToolContract(state, { chatId:chat.id, model, selectedFile, enabled:body.toolsEnabled === true, seat: speaker?.seat ?? 'visiting', workspaceId:store.workspaceId,
            pcAvailable:pcFiles.available(),workspacePath:store.dataDir,
            parallel: pictures.length ? null : parallel.requestProfile(state, chat.id, model, checked.replyMode) });
          messages[0]={...messages[0],content:messages[0].content+'\n\n'+pcApron(toolContract)};
          const purpose = body.followUpOf ? `The human requested both chairs. This is the ${speaker.seat} follow-up, continuing from the original prompt and the first reply.` : checked.kind === 'ask' ? `The human requested the ${speaker.seat} chair's next reply on this conversation.` : content;
          handoff = prepareModelHandoff(state, { taskId: exchangeId, chatId: chat.id, kind: 'reply', messages, purpose, selection: speaker, turnRequest, inputReceipts: selectedFile ? [selectedFile.receiptId] : [], toolContract, workspaceId:store.workspaceId,
            mediaClearance: imagePlans.issue(checkedImages, exchangeId),workspacePath:store.dataDir });
          const next = appendExchange(state, chat.id, {
            id: exchangeId, content, modelId: model.id, modelLabel: model.name,
            modelIdentifier: model.model, modelBaseUrl: model.baseUrl,
            replyLength: root.replyLength, thinking: model.thinking ?? false, runtime: model.runtime ?? 'compatible',
            request: turnRequest, speaker,
          });
          next.exchanges.find(e => e.id === exchangeId).handoff = handoff;
          if (selectedFile) next.exchanges.find(e => e.id === exchangeId).selectedFile = selectedFile;
          if(pendingSketch){next.exchanges.find(e=>e.id===exchangeId).sketchSource=structuredClone(pendingSketch);delete next.sketchBook.pending[chat.id];}
          if (pictures.length) next.exchanges.find(e => e.id === exchangeId).selectedImages = pictures.map(i => i.id);
          return next;
        });
        if (replay) return replay.status === 'pending'
          ? json(response, 409, { error: 'This request is already running. No second reply was started.', exchangeId: replay.id, state: store.state })
          : json(response, 200, store.state);
        // Stop can arrive while the initial ledger write is being flushed.
        // Recheck the live request before dispatching either half of Both.
        const stoppedBeforeDispatch = body.followUpOf ? !replyPlanner.consume(body.followUpOf)
          : body.replyMode === 'both' && !replyPlanner.isPending(exchangeId);
        const controller = new AbortController();
        active.set(body.chatId, controller);
        let timedOut = false;
        const timeoutMs = modelOptions.timeoutMs ?? resources.replySeconds * 1000;
        const timeoutMessage = `The model did not finish within ${Math.round(timeoutMs / 60000)} minutes. Any streamed text is preserved.`;
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
        response.on('close', () => { if (!response.writableEnded) controller.abort(); });
        if (closing || stoppedBeforeDispatch || response.destroyed || epoch !== (stopEpoch.get(body.chatId) ?? 0)) controller.abort();
        const parallelOrigin = parallel.bindOrigin(exchangeId, { handoff, messages, model, contract: toolContract, content, kind: body.kind ?? 'send',
          selectedFile: store.state.exchanges.find(e => e.id === exchangeId)?.selectedFile ?? null });
        const tools = toolContract ? new ConversationTools({ store,handoff,contract:toolContract,signal:controller.signal,interactions:toolInteractions,
          pcFiles,
          onEvent:event=>{ if (body.stream === true) sse(response,event.type,event); }, ...parallelOrigin, ...(modelOptions.pageReader ? {pageReader:modelOptions.pageReader} : {}) }) : null;
        const metrics = new ReplyMetrics();
        if (body.stream === true) {
          const compact = request.headers['x-branchline-stream'] === 'events-v2';
          response.writeHead(200, { ...publicHeaders, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
          sse(response, 'started', { exchangeId, chatId: body.chatId, modelLabel: model.name, speaker });
          let answer = '';
          try {
            const chunks = streamGenerate(model, messages, controller.signal, { ...modelOptions, maxContextCharacters: contextLimit, maxTokens, handoff, tools, metrics,
              onStatus: status => sse(response, 'model_status', { message: status.message, phase: status.phase }) });
            let step; let finishReason = null;
            while (!(step = await chunks.next()).done) {
              answer += step.value.text;
              metrics.text(step.value.text);
              if (!sse(response, 'delta', { text: step.value.text })) controller.abort();
            }
            finishReason = step.value;
            const measured = metrics.snapshot();
            await tools?.close();
            const next = await store.transact(state => { controller.signal.throwIfAborted(); return prepareModelWrite(state, handoff, { content: answer, finishReason, metrics: measured }).state; }, { returnState: !compact });
            sse(response, 'done', compact ? { exchangeId, sequence: store.sequence, saved: true } : { state: next });
          } catch (err) {
            await tools?.close();
            const cancelled = controller.signal.aborted && !timedOut;
            const message = timedOut ? timeoutMessage : cancelled ? 'Reply stopped. Your partial reply remains marked incomplete.' : err.message === 'fetch failed' ? 'Could not reach the local model. Check its server address and that the model is loaded.' : err.message;
            const next = await store.transact(state => prepareModelWrite(state, handoff, { content: answer, problem: message, cancelled, metrics: metrics.snapshot(false) }).state, { returnState: !compact });
            sse(response, 'error', compact ? { error: message, exchangeId, saved: true } : { error: message, state: next });
            sse(response, 'done', compact ? { exchangeId, sequence: store.sequence, saved: true } : { state: next });
          } finally {
            await tools?.close();
            clearTimeout(timer);
            if (active.get(body.chatId) === controller) active.delete(body.chatId);
            await parallel.releaseOrigin(exchangeId);
            parallel.kick();
            if (!controller.signal.aborted) void reflections.consider();
            if (!response.writableEnded) response.end();
          }
          return;
        }
        let answer;
        try {
          answer = await generateResult(model, messages, controller.signal, { ...modelOptions, maxContextCharacters: contextLimit, maxTokens, handoff, tools, metrics });
          answer.metrics = metrics.snapshot();
          await tools?.close();
          const next = await store.transact(state => { controller.signal.throwIfAborted(); return prepareModelWrite(state, handoff, answer).state; });
          return json(response, 200, next);
        } catch (err) {
          await tools?.close();
          const cancelled = controller.signal.aborted && !timedOut;
          const message = timedOut ? timeoutMessage : cancelled ? 'Reply stopped. Your message remains in history.' : err.message === 'fetch failed' ? 'Could not reach the local model. Check its server address and that the model is loaded.' : err.message;
          const next = await store.transact(state => prepareModelWrite(state, handoff, { content: answer?.content ?? '', problem: message, cancelled, metrics: metrics.snapshot(false) }).state);
          return json(response, cancelled ? 409 : 502, { error: message, state: next });
        } finally {
          await tools?.close();
          clearTimeout(timer);
          if (active.get(body.chatId) === controller) active.delete(body.chatId);
          await parallel.releaseOrigin(exchangeId);
          parallel.kick();
          if (!controller.signal.aborted) void reflections.consider();
        }
      }
      if (method === 'GET' && url.pathname === '/favicon.ico') {
        response.writeHead(204, publicHeaders); return response.end();
      }
      if (method === 'GET' && !url.pathname.startsWith('/api/')) {
        const pathname = decodeURIComponent(url.pathname);
        const filename = path.resolve(publicRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
        const relative = path.relative(publicRoot, filename);
        if (relative.startsWith('..') || path.isAbsolute(relative)) return json(response, 403, { error: 'Invalid asset path.' });
        try {
          const content = await fs.readFile(filename);
          const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
          response.writeHead(200, { ...publicHeaders, 'content-type': contentTypes[path.extname(filename)] || 'application/octet-stream' });
          return response.end(content);
        } catch (err) { if (!['ENOENT', 'EISDIR'].includes(err.code)) throw err; }
      }
      return json(response, 404, { error: 'Not found.' });
    } catch (err) {
      if (response.headersSent) {
        // A failed final save cannot become a second HTTP response or an
        // unhandled rejection. The UI retains streamed text as unconfirmed.
        sse(response, 'error', { error: 'The reply could not be confirmed saved: ' + (err.message || 'Local save failed.'), saved: false });
        if (!response.writableEnded) response.end();
        return;
      }
      if (response.headersSent) response.destroy();
      else json(response, err.status || 400, { error: err.message || 'The local request failed.' });
    }
  });
  const originalClose = server.close.bind(server);
  let closePromise;
  server.close = callback => {
    if (!closePromise) {
      closing = true;
      uiSession.revoke();
      actions.close();
      const imageShutdown = imageCheck?.done;
      imageCheck?.controller.abort();
      dreamRecovery?.abort();
      for (const controller of active.values()) controller.abort();
      const parallelShutdown = parallel.close();
      codex.close();
      const reflectionShutdown = reflections.close();
      const runnerShutdown = localRunner.close();
      closePromise = new Promise((resolve, reject) => {
        // Abort work first, then bound uncooperative/incomplete HTTP clients.
        // Store.close still waits for every accepted write before checkpointing.
        const connectionsDeadline = setTimeout(() => server.closeAllConnections(), 5000);
        connectionsDeadline.unref();
        originalClose(err => {
          clearTimeout(connectionsDeadline);
          if (err && err.code !== 'ERR_SERVER_NOT_RUNNING') return reject(err);
          Promise.all([reflectionShutdown, parallelShutdown, runnerShutdown, imageShutdown,...stopping]).then(() => store.close()).then(resolve, reject);
        });
      });
    }
    if (callback) closePromise.then(() => callback(), callback);
    return server;
  };
  server.dispose = () => new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  server.store = store;
  server.startupWarnings = bundledWarning ? [bundledWarning] : [];
  server.localRunner = localRunner;
  Object.defineProperty(server, 'sessionToken', { get: () => uiSession.token });
  server.storage = storage;
  server.reflections = reflections;
  server.active = active;
  server.parallel = parallel;
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const port = Number(process.env.PORT || 4317);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
    const server = await createApp({ dataDir: process.env.BRANCHLINE_DATA_DIR || path.resolve(here, '../.local') });
    server.on('error', async err => { console.error('Branchline: ' + err.message); await server.dispose(); process.exitCode = 1; });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.dispose(); });
    server.listen(port, '127.0.0.1', () => console.log('Branchline beta is ready at http://127.0.0.1:' + port + '/#session=' + server.sessionToken));
  } catch (err) { console.error('Branchline: ' + err.message); process.exitCode = 1; }
}
