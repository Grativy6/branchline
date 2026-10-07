import { createModelArchivePanel } from './model-archive-panel.js';
import { activeModels } from './model-archives.js';
import { allowanceFrom,updateAllowance } from './continuing-hearth.js';
import { archiveView } from './views.js';
import { handoffSummary, coatToolReceipt } from './handoffs.js';
import { api } from './api.js';
import { ORIENTATIONS, effectiveOrientation, recordedOrientationLabel } from './response-orientations.js';
import { resourcesForm, conversationSettings, RESOURCE_DEFAULTS, createWelcomeTour, DREAM_PREPARATION } from './desktop-controls.js';
import { carrySettings } from './resource-settings.js';
import { recorderHint } from './recorder.js';
import { createSettingsSize } from './settings-size.js';
import { createDreamReview } from './dream-review.js';
import { createSketchBook } from './sketch-book.js';
import { createToyShelf, shelfSettings, SHELF_APPS } from './toy-shelf.js';
import { replyBusy } from './table.js';
import { renderMarkdown } from './markdown.js';
import { createToolPanel, toolHistory } from './tools.js';
import { home } from './home.js';
import { createImageProviderPanel } from './image-provider.js';
import { recentDreamParticipant, dreamAbout } from './dreams.js';
import { escapeHtml as e, currentInstruction, selected, isPending, branchList, conversation, details, modelsSettings, advancedSettings, workspaceSettings } from './views.js';
import { reflectionDialogContent, continuityExchangeSummary, setContinuityTab } from './continuity.js';
import { storagePanel } from './storage.js';
import { createFilePicker } from './files.js';
import { createImagePicker, hydrateImages } from './images.js';
import { tableInfo, tableSetup, turnOptions, modelsBusy, replySettings, replyControls, replyPatternLabel, hasRecordedReply } from './table.js';
import { accountFor, mindInspection, packetPreview } from './mind.js';
import { initializeAppearance, saveAppearance, appearanceSettings } from './appearance.js';
import { messageInfoKeys, messageInfoSettings, messageInfoDetails } from './message-info.js';
import { licencesSettings, loadLicences } from './licenses.js';
import { downloadExport } from './session.js';
import { deskBar, modelPicker, deskPicker, branchDialog } from './desks.js';
import { harnessPreview, pocketSummary } from './harness-views.js';
import { harnessRef } from './harness-catalog.js';
import { createHarnessEditor } from './harness-editor.js';
import { createAgentProfiles } from './agent-profiles.js';
import { personalSettings, personalNicknameForm } from './table.js';
import { codexPanel } from './codex.js';
import { activeAccount, contextBar, contextDialog, sourceDialog, preparationHint, budgetHint, contextSize } from './context-carry.js';
import { agentSettings, agentSettingsForm, updateAgentForm, approachForm, updateApproachForm, approachDetails, createParallelMonitor, liveParallel } from './parallel.js';
import { mountPcAccess } from './pc-access.js';
import { isHearth, hearthForm, updateHearthForm, hearthDetails } from './hearth.js';
initializeAppearance();

const $ = id => document.getElementById(id);
const toolPanel = createToolPanel({ container:$('tool-interactions'), reportError:message=>error(message) });
const mcpCapabilities = {};
let discoveredModels = [];
let discoveredBaseUrl = 'http://127.0.0.1:1234/v1';
let state;
const agentProfiles = createAgentProfiles({ getState: () => state, command, openDialog, toast });
const imageProviderPanel = createImageProviderPanel({ getState: () => state, command, openDialog, toast, api });
const harnessEditor = createHarnessEditor({ getState: () => state, refreshState: async () => {
  const epoch = ++pollEpoch, next = await api.state();
  if (epoch === pollEpoch) { state = next; render(); }
}, command, openDialog:(title,content,className,surface)=>surface === 'chat' ? openDialog(title,content,className) : openSettings('coats',null,{title,content}), closeDialog, toast });
let screen = 'home';
let modelCheck;
let dreamParticipantId;
let codexStatus, codexAuthUrl, codexPoll, codexView = 0;
async function openCodex() {
  openDialog('ChatGPT subscription', codexPanel(), 'codex-dialog');
  const view = codexView;
  try { codexStatus = await api.codexStatus(); }
  catch (err) { codexStatus = { error: err.message }; }
  if (view !== codexView || !$('dialog').open) return;
  showCodex();
}
function showCodex() {
  openDialog('ChatGPT subscription', codexPanel(codexStatus, codexAuthUrl), 'codex-dialog');
  if (codexStatus?.connected) codexAuthUrl = null;
  if (codexAuthUrl && !codexStatus?.connected && !codexStatus?.error) {
    const view = codexView;
    const poll = async () => {
      try {
        const status = await api.codexStatus(); if (view !== codexView || !$('dialog').open) return;
        codexStatus = status;
        if (status.connected || status.error || !status.pending) showCodex();
        else codexPoll = setTimeout(poll, 2500);
      }
      catch (err) { if (view === codexView) { codexStatus = { error: err.message }; showCodex(); } }
    };
    codexPoll = setTimeout(poll, 2500);
  }
}
let query = '';
let detailsOpen = false;
let detailsRootId;
let detailsChatId;
let detailsDirty = false;
let settingsTab = 'conversation';
const welcomeTour = createWelcomeTour({ complete: value => command('ui.update', { welcomeTour:value }) });
let draftTimer;
let toastTimer;
let dialogReturnFocus;
let pollTimer;
let closingPage = false;
let pollEpoch = 0, pollInFlight = false;
let polledState = null, pollRevision = null;
let liveRenderFrame = null;
let draftSaveChain = Promise.resolve();
let storageInfo;
let storageBusy = false;
let storageBusyLabel = 'Working…';
let storageMessage = '';
let storageLoadToken = 0;
let storageFocusTarget;
let continuityBusy = false;
let continuityChatId = null;
let continuityCancelRequested = false;
let heartDraft = null;
let heartSaveChain = Promise.resolve();
let heartDirty = false;
const pendingDrafts = new Map();
const sending = new Set();
const submitting = new Set();
const liveReplies = new Map();
const stoppedReplies = new Set();
const replyRequests = new Map();
let preparedLearningPacket = null;
let appearanceSaveChain = Promise.resolve();
let messageInfoSaveChain = Promise.resolve();
let responseModeSaving = false;
let coatWarningOpen = false, coatWarningSaving = false;
let replySettingsSaving = false;
let guidanceReview = null;
let contextStatus = null, contextStatusKey = '', carryBusy = false;
function refreshContextStatus(root, chat, busy) {
  if (!chat) return;
  const key = JSON.stringify([chat.id, state.messages.at(-1)?.id, activeAccount(state, chat.id)?.id, state.contextCarry?.pins[chat.id],
    state.drafts[chat.id]?.length, root?.instructions.at(-1)?.id, root?.continuity?.heart.at(-1)?.id,
    root?.continuity?.journal.map(j => [j.id, j.removedAt]), state.mcpContext?.[chat.id],
    state.mind?.accounts.length, chat.harnessSelections?.at(-1)?.id, chat.responseMode, root?.resources, chat.carrySettings, state.contextCarry?.ready, chosenModel(root, chat), nextSpeaker(chat),
    chat.table?.assignments.at(-1)?.id, state.models, state.modelArchives, state.personalParticipants?.map(p => [p.id, p.currentGenerationId, p.connections.at(-1)?.id]), state.agentProfiles?.selections.at(-1)?.id, state.agentProfiles?.sharing.at(-1)?.id]);
  $('context-status').innerHTML = contextBar(contextStatus, false, carrySettings(chat).showCount);
  if (busy || key === contextStatusKey) return;
  contextStatusKey = key;
  api.contextCarry(chat.id, carrySettings(chat).speaker).then(status => {
    if (contextStatusKey !== key) return;
    contextStatus = status;
    $('context-status').innerHTML = contextBar(status, false, carrySettings(chat).showCount);
  }).catch(() => {});
}
async function openContext(speaker) {
  await beforeNavigation();
  const { chat } = selected(state);
  if (!chat) return;
  speaker ||= carrySettings(chat).speaker;
  const status = await api.contextCarry(chat.id, speaker);
  if (speaker === carrySettings(chat).speaker) contextStatus = status;
  openDialog('Conversation context', contextDialog(state, chat, status, speaker), 'context-dialog');
}
async function openContextSource(id, offset = 0) {
  const { chat } = selected(state);
  const source = await api.carrySource(chat.id, id, offset);
  openDialog('Original conversation source', sourceDialog(source, state.contextCarry?.pins[chat.id]?.includes(id), state, chat.id), 'context-dialog');
  hydrateImages();
}
function nextSpeaker(chat) {
  return replySettings(state, chat).next;
}
function chosenModel(root, chat, speaker = nextSpeaker(chat)) {
  const table = tableInfo(state, chat);
  return table ? (speaker === 'personal' ? table.personalModel : speaker === 'visiting' ? table.visitorModel : null) : state.models.find(m => m.id === root?.modelId);
}
function refreshComposerButtons(root, chat) {
  const table = tableInfo(state, chat), model = chosenModel(root, chat);
  const busy = replyBusy(state, chosenModel(root, chat)) || submitting.size > 0 || continuityBusy || responseModeSaving || replySettingsSaving;
  const draft = $('message-input').value, file = filePicker.get(chat?.id);
  const unavailable = table && (!model || (replySettings(state, chat).mode !== 'single' && !(table.personalModel && table.visitorModel)));
  $('send-button').disabled = busy || unavailable || !draft.trim() || !!file?.loading;
  $('send-button').textContent = unavailable ? 'Choose the required models' : model ? 'Send message ↑' : 'Save note ↑';
  $('save-note').hidden = !table;
  $('save-note').disabled = busy || !draft.trim() || !!file;
  return unavailable;
}
const filePicker = createFilePicker({ getState:()=>state, command, selection: () => { if (!state) return {}; const { root, chat } = selected(state); return { root: root ? { ...root, modelId: chosenModel(root, chat)?.id ?? null } : root, chat }; }, changed: () => render(), reportError: message => error(message) });
const sketchBook = createSketchBook({getState:()=>state,command,beforeNavigation,attachment:chatId=>filePicker.get(chatId),
  navigate:(rootId,chatId)=>navigate(rootId,chatId,state.roots.find(r=>r.id===rootId).mode),showCoats:()=>openSettings('coats'),api,toast,reportError:message=>error(message)});
const modelArchivePanel = createModelArchivePanel({ getState:()=>state, api, command, openDialog, beforeNavigation });
const dreamReview = createDreamReview({getState:()=>state,command,beforeNavigation,api,applyState:next=>{state=next;pollEpoch++;render();},reportError:message=>error(message)});
$('open-sketch-book').addEventListener('click',safe(()=>sketchBook.open()));
const imagePicker = createImagePicker({ getState: () => state, selection: () => selected(state), updateState: value => { state = value; }, changed: () => render(), reportError: message => error(message), openDialog });
const parallelMonitor = createParallelMonitor({ container:$('parallel-activity'), getState:()=>state,
  applyState:next=>{ pollEpoch++; state=next; render(); }, busy:()=>sending.size > 0 || submitting.size > 0,
  refreshTools:()=>toolPanel.refresh(), reportError:error });
async function openApproaches() {
  await beforeNavigation();
  const { chat } = selected(state);
  if (!chat || modelsBusy(state) || submitting.size) return;
  if (filePicker.get(chat.id)) throw new Error('Send the attached text in this branch first, so both approaches can receive its saved source. Your draft and attachment are still here.');
  const options = await api.parallelOptions(chat.id);
  openDialog('Two approaches, one task', approachForm(chat.id, $('message-input').value, options, $('tools-enabled').checked), 'settings-dialog');
  const form = $('parallel-start-form');
  if (options.models.length > 1) form.elements.seat1.selectedIndex = 1;
  updateApproachForm(form);
}
const hearthDrafts = new Map();
async function showPeerSource(form,offset=0){const result=await api.peerSource({runId:form.dataset.runId,peer:form.elements.peer.value,sourceId:form.elements.sourceId.value,offset});form.querySelector('pre').textContent=result.author+' · '+result.sourceId+' · '+result.hash+'\n'+result.text;const button=form.querySelector('[data-action="peer-source-more"]');button.hidden=result.nextOffset===null;button.dataset.offset=result.nextOffset;}

async function openHearth(id=null) {
  const current=$('hearth-message-form');
  if(current)hearthDrafts.set(current.dataset.runId,current.elements.message.value);
  if(id) {
    const next=await api.state();pollEpoch++;state=next;render();
    return openDialog('Shared hearth',hearthDetails(state,id,hearthDrafts.get(id)||''),'settings-dialog');
  }
  await beforeNavigation();const {chat}=selected(state);
  if(!chat||modelsBusy(state)||submitting.size)return;
  if(filePicker.get(chat.id))throw new Error('Send the attached text in this branch first so the hearth can carry its saved source.');
  const options=await api.parallelOptions(chat.id);
  openDialog('Work together at the hearth',hearthForm(chat.id,$('message-input').value,options),'settings-dialog');
  updateHearthForm($('hearth-start-form'));
}

function error(message) {
  $('error-text').textContent = message;
  $('error-banner').hidden = false;
  if ($('dialog').open) {
    let inline = $('dialog-error');
    if (!inline) {
      inline = document.createElement('p');
      inline.id = 'dialog-error';
      inline.className = 'notice message-error';
      inline.setAttribute('role', 'alert');
      $('dialog-content').prepend(inline);
    }
    inline.textContent = message;
  }
}
function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3000);
}
function safe(action) {
  return async event => {
    try { await action(event); }
    catch (err) { error(err.message); }
  };
}
async function command(type, payload, { renderNow = true } = {}) {
  const next = type === 'ui.update' ? await api.updateUi(payload) : await api.command(type, payload);
  pollEpoch++; state = type === 'ui.update' ? { ...state, ui: next.ui } : next;
  // Dismiss the prior attempt's profile error after the user revises sharing.
  // A later request still checks every carried selection on the server.
  if (type === 'profile.share' && $('error-text').textContent.startsWith('Agent profile:')) $('error-banner').hidden = true;
  if (renderNow) render();
  return state;
}
const settingsSize = createSettingsSize({ dialog: $('dialog'), getPreference: () => state?.ui.settingsSize,
  save: settingsSize => command('ui.update', { settingsSize }, { renderNow: false }), onError: message => toast(message) });
const toyShelf = createToyShelf({ container: $('home-screen'), getPreference: () => state?.ui.toyShelf,
  save: toyShelf => command('ui.update', { toyShelf }, { renderNow: false }), onError: message => error(message) });
window.addEventListener('resize', () => toyShelf.resize());
let homeMarkup = '';
function openDialog(title, content, className = '') {
  settingsSize.detach();
  clearTimeout(codexPoll); codexView++;
  if (!$('dialog').open) dialogReturnFocus = document.activeElement;
  $('dialog').className = `app-dialog ${className}`;
  $('dialog-content').innerHTML = `<div class="dialog-header"><h2 id="dialog-title">${e(title)}</h2><button class="icon-button" type="button" data-action="close-dialog" aria-label="Close dialog">×</button></div><div class="dialog-body">${content}</div>`;
  $('dialog').append($('work-controls'));
  $('dialog').setAttribute('aria-labelledby', 'dialog-title');
  if (!$('dialog').open) $('dialog').showModal();
  $('dialog').scrollTop = 0;
  if ($('dialog').classList.contains('settings-window')) settingsSize.attach();
  const focusAtOpen = document.activeElement;
  requestAnimationFrame(() => { if (document.activeElement === focusAtOpen) $('dialog').querySelector('[autofocus]')?.focus(); });
}
async function dismissCoatWarning() {
  if (coatWarningSaving) return;
  coatWarningSaving = true;
  const button = $('coat-warning-ok');
  button.disabled = true;
  try {
    if ($('coat-warning-suppress').checked) await command('ui.update', { coatChangeWarning: false });
    coatWarningOpen = false;
    $('dialog').close();
  } finally { coatWarningSaving = false; if (button.isConnected) button.disabled = false; }
}
function showCoatWarning() {
  coatWarningOpen = true;
  openDialog('Coat changed', '<p>Changing a Coat can lead to disorientation.</p><label class="check-line"><input id="coat-warning-suppress" type="checkbox"> Do not show me again</label><div class="dialog-footer"><button id="coat-warning-ok" autofocus type="button" class="primary-button" data-action="close-dialog">Ok</button></div>', 'coat-warning-dialog');
}
function coatWarningSetting() {
  return `<label class="check-line coat-warning-setting"><input id="coat-warning-setting" type="checkbox" ${state.ui.coatChangeWarning !== false ? 'checked' : ''}> Show Coat-change warning</label><button type="button" class="text-button" data-action="sketch-access">Sketch Book model access</button>`;
}
function closeDialog() { if (coatWarningOpen) return dismissCoatWarning(); if (harnessEditor.busy || agentProfiles.busy) return; harnessEditor.keepDraft(); agentProfiles.keepDraft(); $('dialog').close(); }
function returnToPersonalModels(form) {
  if (form.dataset.returnView === 'settings') openSettings('models');
  else openDialog('My Models', personalSettings(state));
  $('dialog').querySelector(`[data-action="personal-rename"][data-id="${CSS.escape(form.dataset.id)}"]`)?.focus();
}
$('dialog').addEventListener('cancel', event => { if (coatWarningOpen) { event.preventDefault(); dismissCoatWarning().catch(err => error(err.message)); } else if (continuityBusy || carryBusy || harnessEditor.busy || agentProfiles.busy) event.preventDefault(); else { harnessEditor.keepDraft(); agentProfiles.keepDraft(); } });
$('dialog').addEventListener('close', () => {
  settingsSize.detach();
  $('activity-home').append($('work-controls'));
  imageProviderPanel.cancel();
  clearTimeout(codexPoll); codexView++;
  if (dialogReturnFocus?.isConnected) dialogReturnFocus.focus();
  if (guidanceReview) {
    const review = guidanceReview; guidanceReview = null;
    api.decideAction({ actionId: review.plan.id, reviewHash: review.reviewHash, token: review.token, decision: 'cancel' }).catch(err => error(err.message));
  }
});

function openSettings(tab = settingsTab, editing = null, coatView = null) {
  harnessEditor.keepDraft();
  if (tab === 'mcp') tab = 'advanced';
  settingsTab = tab;
  openDialog('Settings', `<div class="dialog-tabs" role="tablist" aria-label="Settings">${[['conversation', 'Conversation'], ['resources', 'Resources'], ['models', 'Models'], ['coats', 'Coats & pockets'], ['toy-shelf', 'Toy Shelf'], ['agents', 'Agents'], ['appearance', 'Appearance'], ['message-info', 'Message info'], ['workspace', 'Workspace'], ['advanced', 'Advanced'], ['licences', 'About & licences']].map(([id, label]) => `<button type="button" role="tab" aria-selected="${tab === id}" data-action="settings-tab" data-id="${id}">${label}</button>`).join('')}</div><div class="settings-content">${tab === 'conversation' ? conversationSettings(state, selected(state).root, selected(state).chat) : tab === 'resources' ? resourcesForm(selected(state).root) : tab === 'coats' ? coatWarningSetting() + (coatView ? `<h3>${e(coatView.title)}</h3>${coatView.content}` : harnessEditor.markup()) : tab === 'toy-shelf' ? shelfSettings(state.ui.toyShelf) : tab === 'models' ? modelsSettings(state, editing, discoveredModels) : tab === 'agents' ? agentSettingsForm(state) : tab === 'appearance' ? appearanceSettings() : tab === 'message-info' ? messageInfoSettings(state.ui.messageInfo) : tab === 'workspace' ? workspaceSettings(state, storageInfo) : tab === 'licences' ? licencesSettings() : advancedSettings(state, mcpCapabilities)}</div>`, 'settings-dialog settings-window');
  if (tab === 'licences') loadLicences($('licences-panel'));
  if (tab === 'agents') {
    const panel=document.createElement('section');panel.id='pc-access-panel';panel.innerHTML='<p>Loading PC access…</p>';
    $('dialog').querySelector('.settings-content').prepend(panel);mountPcAccess(panel,state,message=>error(message));
  }
  if (tab === 'workspace') {
    refreshStoragePanel();
    loadStorage({ preserveMessage: true });
  }
}

async function loadStorage({ preserveMessage = false } = {}) {
  const token = ++storageLoadToken;
  try {
    const result = await api.storage();
    if (token !== storageLoadToken) return;
    storageInfo = result;
    if (!preserveMessage) storageMessage = '';
    if ($('dialog').open && settingsTab === 'workspace') {
      const panel = $('storage-panel');
      if (panel) panel.outerHTML = storagePanel(storageInfo, { busy: storageBusy, busyLabel: storageBusyLabel, message: storageMessage });
    }
  } catch (err) {
    if (token !== storageLoadToken) return;
    storageMessage = err.message;
    const panel = $('storage-panel');
    if (panel) panel.outerHTML = storagePanel(null, { busy: storageBusy, busyLabel: storageBusyLabel, message: storageMessage });
  }
}

function refreshStoragePanel() {
  const panel = $('storage-panel');
  if (panel) {
    panel.outerHTML = storagePanel(storageInfo, { busy: storageBusy, busyLabel: storageBusyLabel, message: storageMessage });
    if (storageFocusTarget) requestAnimationFrame(() => document.querySelector(`[data-action="${storageFocusTarget.action}"]${storageFocusTarget.id ? `[data-id="${CSS.escape(storageFocusTarget.id)}"]` : ''}`)?.focus());
  }
}

function hasWorkActivity() {
  return state && (modelsBusy(state) || sending.size > 0 || continuityBusy || carryBusy);
}
function refreshWorkActivity() {
  const active = Boolean(hasWorkActivity()), controls = $('work-controls');
  controls.classList.toggle('is-active', active);
  const summary = controls.querySelector('summary');
  summary.setAttribute('aria-label', active ? 'Activity: work running' : 'Activity: no running episodes');
  summary.title = active ? 'Work is running. Open Activity to stop running episodes.' : 'No running episodes.';
  // Reuse the reply poll for background work too, so the indicator settles even
  // after moving to Home, another branch or a Settings tab.
  if (!active || closingPage) { clearInterval(pollTimer); pollTimer = null; return; }
  if (!pollTimer) pollTimer = setInterval(async () => {
    if (pollInFlight || !hasWorkActivity()) return;
    const epoch = pollEpoch; pollInFlight = true;
    try {
      const result = await api.stateSince(state === polledState ? pollRevision : null);
      // A pending snapshot must not replace a newer final reply or UI action.
      if (epoch !== pollEpoch || !hasWorkActivity()) return;
      await toolPanel.refresh();
      if (epoch !== pollEpoch || !hasWorkActivity() || !result) return;
      state = result.state; polledState = state; pollRevision = result.revision; render();
    } catch { /* The work request reports connection errors. */ }
    finally { pollInFlight = false; }
  }, 900);
}
function render({ scroll = false, refreshDetails = false } = {}) {
  if (!state) return;
  sketchBook.refresh();
  dreamReview.refresh();
  refreshWorkActivity();
  const { root, chat } = selected(state);
  const fs = state.ui.mode === 'fs';
  const atHome = screen === 'home';
  document.body.dataset.mode = atHome ? 'personal' : state.ui.mode;
  document.body.dataset.screen = screen;
  document.title = `${atHome ? 'Home' : chat?.title || 'Welcome'} · Branchline`;
  $('app-shell').classList.toggle('sidebar-collapsed', state.ui.sidebarCollapsed);
  $('app-shell').classList.toggle('details-open', !atHome && detailsOpen);
  $('mode-home').setAttribute('aria-pressed', String(atHome));
  syncNavigationAccessibility();
  $('new-root').textContent = '+ New branch';
  $('branch-list').innerHTML = branchList(state, query);
  $('home-screen').hidden = !atHome;
  $('conversation-header').hidden = atHome;
  $('table-bar').hidden = atHome;
  $('conversation').hidden = atHome;
  $('composer-form').hidden = atHome || !chat;
  $('details-panel').hidden = atHome || !detailsOpen;
  $('details-toggle').hidden = atHome || detailsOpen;
  $('skip-link').href = atHome ? '#home-heading' : chat ? '#message-input' : '#conversation';
  $('skip-link').textContent = atHome ? 'Skip to Home' : chat ? 'Skip to message' : 'Skip to workspace';
  parallelMonitor.show(chat?.id, !atHome);
  toolPanel.show(chat?.id, !atHome);
  $('configure-model').setAttribute('aria-label', 'Attachments');
  if (atHome) {
    if (dreamParticipantId === undefined) dreamParticipantId = recentDreamParticipant(state);
    const markup = home(state, { modelCheck, dreamParticipantId });
    if (homeMarkup !== markup && !toyShelf.dragging) { $('home-screen').innerHTML = markup; homeMarkup = markup; }
    toyShelf.attach();
    return;
  }
  const globalBusy = modelsBusy(state) || submitting.size > 0 || continuityBusy || carryBusy || responseModeSaving || replySettingsSaving;
  const table = tableInfo(state, chat);
  const chairMarkup = deskBar(state, root, chat, globalBusy);
  if ($('table-bar').innerHTML !== chairMarkup) $('table-bar').innerHTML = chairMarkup;
  $('arrange-chairs').hidden = !chat;
  $('arrange-chairs').disabled = globalBusy;
  $('arrange-chairs').textContent = table ? 'Arrange chairs' : 'Set up this table';
  $('conversation-heading').textContent = chat?.title || root?.name || 'Your workspace';
  $('new-chat').hidden = !root;
  $('rename-chat').hidden = !chat;
  $('details-toggle').disabled = !root;
  $('details-toggle').setAttribute('aria-expanded', String(detailsOpen));
  const atBottom = $('conversation').scrollHeight - $('conversation').scrollTop - $('conversation').clientHeight < 100;
  const markup = conversation(state, root, chat, chat ? liveReplies.get(chat.id) : null);
  if ($('conversation').innerHTML !== markup) $('conversation').innerHTML = markup;
  if (scroll || atBottom) requestAnimationFrame(() => { $('conversation').scrollTop = $('conversation').scrollHeight; });
  $('composer-form').hidden = !chat;
  const busy = chat && (isPending(state, chat.id) || submitting.has(chat.id));
  const rootBusy = root && state.chats.some(c => c.rootId === root.id && (isPending(state, c.id) || sending.has(c.id)));
  const modelOptions = `<option value="">No model · save notes</option>${activeModels(state).map(m => `<option value="${e(m.id)}">${e(m.name)}</option>`).join('')}`;
  if ($('model-select').innerHTML !== modelOptions) $('model-select').innerHTML = modelOptions;
  $('model-select').value = root?.modelId || '';
  $('model-select').disabled = !root || !!rootBusy;
  $('model-select').hidden = !!table;
  const replyMarkup = replyControls(state, chat, globalBusy);
  if ($('table-reply-controls').innerHTML !== replyMarkup) $('table-reply-controls').innerHTML = replyMarkup;
  $('table-reply-controls').hidden = !table;
  const responseMode = effectiveOrientation(chat?.responseMode);
  $('response-mode-controls').hidden = !chat || fs;
  for (const button of $('response-mode-controls').querySelectorAll('[data-response-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.responseMode === responseMode));
    button.disabled = responseModeSaving || !chat || !!chat.archivedAt || !!root?.archivedAt;
  }
  $('response-mode-description').textContent = `${ORIENTATIONS[responseMode]} Changes apply to future replies.`;
  const selectedModel = chosenModel(root, chat);
  const replyingModels = replySettings(state, chat).mode === 'both' ? [table?.personalModel, table?.visitorModel] : [selectedModel];
  const toolsSupported = replyingModels.some(model => model && model.inputFormat !== 'plain-dialogue-v1');
  $('tools-enabled').disabled = globalBusy || !toolsSupported;
  $('tools-label').title = toolsSupported ? 'Clock, calculations, attached text and questions. Public pages ask first.' : 'This chair uses a text-only connection. Structured tools are unavailable.';
  toolPanel.show(chat?.id, screen === 'chat');
  const draft = chat ? (pendingDrafts.get(chat.id)?.text ?? state.drafts[chat.id] ?? '') : '';
  if ($('message-input').value !== draft) $('message-input').value = draft;
  $('message-input').disabled = !!busy;
  filePicker.render(root ? { ...root, modelId: selectedModel?.id ?? null } : root, chat, globalBusy);
  imagePicker.render(chat, replyingModels, globalBusy);
  hydrateImages();
  const chairUnavailable = refreshComposerButtons(root, chat);
  $('cancel-button').hidden = !chat || (!isPending(state, chat.id) && !submitting.has(chat.id) && !state.parallel?.runs.some(r=>r.chatId === chat.id && liveParallel(r)) && !state.contextCarry?.jobs.some(j=>j.chatId === chat.id && j.status === 'pending') && !state.contextCarry?.ready?.[chat.id] && !['queued','preparing'].includes(contextStatus?.preparationState?.phase));
  const cloudInTurn = selectedModel?.runtime === 'codex' || (replySettings(state, chat).mode === 'both' && table?.visitorModel?.runtime === 'codex');
  const patternHint = replySettings(state, chat).mode === 'both' ? `${nextSpeaker(chat) === 'personal' ? 'Personal then Visiting' : 'Visiting then Personal'} · second reads the first reply` : replySettings(state, chat).mode === 'alternate' ? `Alternate · ${nextSpeaker(chat) === 'personal' ? 'Personal' : 'Visiting'} next` : 'Local model · Enter to send · Shift+Enter for a new line';
  $('composer-hint').textContent = globalBusy ? (replyBusy(state, selectedModel) ? 'Connection busy · Stop also cancels queued work.' : 'Preparing an earlier handoff · You can keep chatting.') : chairUnavailable ? 'Arrange the required chairs, turn off Both / Alternate, or save a note.' : selectedModel ? (cloudInTurn ? 'OpenAI receives selected context · ' + patternHint.replace('Local model · ', '') : patternHint) : 'Saved notes join this chat’s context when you choose a model.';
  refreshContextStatus(root, chat, globalBusy);
  $('details-panel').hidden = !detailsOpen;
  if (detailsOpen && (detailsRootId !== root?.id || detailsChatId !== chat?.id || refreshDetails || !detailsDirty)) {
    // Avoid rebuilding a focused editor while the background exchange status changes.
    if (refreshDetails || detailsRootId !== root?.id || detailsChatId !== chat?.id || !$('details-panel').contains(document.activeElement)) {
      $('details-content').innerHTML = details(state, root, chat, heartDraft?.rootId === root?.id ? heartDraft : null);
      detailsRootId = root?.id;
      detailsChatId = chat?.id;
    }
  }
}

function renderLiveReply(chatId, live) {
  if (liveRenderFrame !== null) return;
  liveRenderFrame = requestAnimationFrame(() => {
    liveRenderFrame = null;
    if (screen !== 'chat' || selected(state).chat?.id !== chatId || liveReplies.get(chatId) !== live) return;
    const container = $('conversation'), body = container.querySelector('.live-reply .message-body');
    if (!body) return; // A saved result or navigation has already replaced it.
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    body.innerHTML = renderMarkdown(live.text || live.status || '…');
    if (atBottom) container.scrollTop = container.scrollHeight;
  });
}

function flushDrafts() {
  clearTimeout(draftTimer);
  draftSaveChain = draftSaveChain.catch(() => {}).then(async () => {
    for (const [chatId, draft] of [...pendingDrafts]) {
      // Invalidate snapshots on BOTH sides of a save. A poll can start during
      // the write and still carry the old draft after its acknowledgement.
      pollEpoch++;
      try { await api.saveDraft(chatId, draft.text); }
      finally { pollEpoch++; }
      if (pendingDrafts.get(chatId) === draft) {
        pendingDrafts.delete(chatId);
        state.drafts[chatId] = draft.text;
      }
    }
    $('draft-status').textContent = 'Draft saved';
  });
  return draftSaveChain;
}
async function saveDetails(showToast = true) {
  const form = $('details-form');
  if (!form) return;
  const data = new FormData(form);
  if (!String(data.get('name') || '').trim()) throw new Error('Give this branch a name before leaving it.');
  await command('root.update', { id: form.dataset.rootId, name: data.get('name').trim(), notes: data.get('notes'), instructions: data.get('instructions') }, { renderNow: false });
  detailsDirty = false;
  if (showToast) { render({ refreshDetails: true }); toast('Branch details saved'); }
}
function saveHeartDraft() {
  heartSaveChain = heartSaveChain.catch(() => {}).then(async () => {
    while (heartDirty && heartDraft) {
      const draft = heartDraft;
      await command('heart.save', { rootId: draft.rootId, text: draft.text, baseRevisionId: draft.baseRevisionId }, { renderNow: false });
      const revisionId = state.roots.find(root => root.id === draft.rootId).continuity.heart.at(-1)?.id || null;
      // The editor may have changed while the save was in flight. Carry those
      // keystrokes forward against the revision this save actually produced.
      if (heartDraft === draft) { heartDirty = false; heartDraft = null; }
      else if (heartDraft?.rootId === draft.rootId && heartDraft.baseRevisionId === draft.baseRevisionId) {
        heartDraft = { ...heartDraft, baseRevisionId: revisionId };
      }
      const form = $('heart-form');
      if (form?.dataset.rootId === draft.rootId) form.dataset.baseRevisionId = revisionId || '';
    }
  });
  return heartSaveChain;
}
async function beforeNavigation() {
  await toyShelf.flush();
  await flushDrafts();
  if (detailsDirty) await saveDetails(false);
  await saveHeartDraft();
  $('draft-status').textContent = '';
}
async function navigate(rootId, chatId, mode = state.ui.mode) {
  await beforeNavigation();
  const root = state.roots.find(r => r.id === rootId);
  if (root && !chatId) chatId = state.chats.find(c => c.rootId === root.id && !c.archivedAt)?.id || null;
  await command('ui.update', { mode, selected: { ...state.ui.selected, [mode]: { rootId: rootId || null, chatId: chatId || null } } }, { renderNow: false });
  screen = 'chat';
  $('app-shell').classList.remove('nav-open');
  if (window.innerWidth < 1100) { detailsOpen = false; render(); }
  render({ scroll: true });
}
async function showHome(event) {
  const fromTab = event?.currentTarget === $('mode-home');
  await beforeNavigation();
  if (screen !== 'home') dreamParticipantId = undefined;
  screen = 'home';
  detailsOpen = false;
  $('app-shell').classList.remove('nav-open');
  render();
  $('home-screen').scrollTop = 0;
  (fromTab ? $('mode-home') : $('home-heading')).focus();
}
function newRootDialog() {
  openDialog('Create a desk', `<form id="new-root-form"><label class="form-field">Desk name<input autofocus name="name" placeholder="My desk" maxlength="100" required></label><p class="field-help">A home for related conversation branches, shared guidance, and your notes.</p><div class="dialog-footer"><button type="button" class="quiet-button" data-action="close-dialog">Cancel</button><button class="primary-button" type="submit">Create desk</button></div></form>`);
}
function newBranchDialog() {
  if (!state.roots.some(r => !r.archivedAt)) return newRootDialog('personal');
  openDialog('New branch', branchDialog(state, selected(state).root));
}
function chatDialog(chat = null) {
  if (!chat) return newBranchDialog();
  openDialog('Rename branch', `<form id="chat-form" data-id="${e(chat.id)}"><label class="form-field">Branch name<input autofocus name="title" maxlength="100" required value="${e(chat.title)}"></label><div class="dialog-footer"><button class="text-button" type="button" data-action="archive-current-chat">Archive branch</button><button type="button" class="quiet-button" data-action="close-dialog">Cancel</button><button class="primary-button" type="submit">Save name</button></div></form>`);
}
function manageRoot(id) {
  const root = state.roots.find(r => r.id === id);
  openDialog('Manage desk', `<form id="root-form" data-id="${e(id)}"><label class="form-field">Name<input autofocus name="name" maxlength="100" required value="${e(root.name)}"></label><p class="field-help">Archiving hides this desk and its branches. Restore it any time in Settings → Workspace.</p><div class="dialog-footer"><button type="button" class="text-button" data-action="archive-root" data-id="${e(id)}">Archive desk</button><button type="button" class="quiet-button" data-action="close-dialog">Cancel</button><button type="submit" class="primary-button">Save name</button></div></form>`);
}
function exchangeForReflection(chatId, exchangeId) {
  const exchange = state.exchanges.find(item => item.id === exchangeId && item.chatId === chatId);
  if (!exchange || exchange.status === 'pending') return null;
  const messages = state.messages.filter(message => message.exchangeId === exchangeId);
  return { ...exchange, userContent: messages.find(message => message.role === 'user')?.content || '', assistantContent: messages.find(message => message.role === 'assistant')?.content || '' };
}
function openReflection(exchangeId, target = 'journal') {
  const { root, chat } = selected(state);
  const exchange = exchangeForReflection(chat?.id, exchangeId);
  if (!root || !chat || !exchange) return toast('Choose a turn that has finished or stopped.');
  if (exchange.status !== 'completed' || exchange.truncated) target = 'mind';
  continuityChatId = chat.id;
  openDialog('Reflect on this exchange', reflectionDialogContent(root, chat, exchange, false, target, state, tableInfo(state, chat)?.personalModel ? 'personal' : 'visiting'), 'continuity-dialog');
}

$('new-root').addEventListener('click', () => newBranchDialog());
$('mode-home').addEventListener('click', safe(showHome));
$('brand-home').addEventListener('click', safe(showHome));
$('new-chat').addEventListener('click', () => chatDialog());
$('rename-chat').addEventListener('click', () => chatDialog(selected(state).chat));
$('branch-search').addEventListener('input', event => { query = event.target.value; $('branch-list').innerHTML = branchList(state, query); });
$('toggle-sidebar').addEventListener('click', safe(async () => {
  if (window.innerWidth < 760) {
    $('app-shell').classList.toggle('nav-open');
    syncNavigationAccessibility();
    if ($('app-shell').classList.contains('nav-open')) $('branch-search').focus();
  } else await command('ui.update', { sidebarCollapsed: !state.ui.sidebarCollapsed });
}));
function syncNavigationAccessibility() {
  const open = window.innerWidth < 760 ? $('app-shell').classList.contains('nav-open') : !state?.ui.sidebarCollapsed;
  $('sidebar').inert = !open;
  $('toggle-sidebar').setAttribute('aria-expanded', String(open));
  $('toggle-sidebar').setAttribute('aria-controls', 'sidebar');
}
function closeNavigation() { $('app-shell').classList.remove('nav-open'); syncNavigationAccessibility(); $('toggle-sidebar').focus(); }
window.addEventListener('resize', syncNavigationAccessibility);
$('close-sidebar').addEventListener('click', closeNavigation);
$('nav-backdrop')?.addEventListener('click', closeNavigation);
$('settings-button').addEventListener('click', safe(async () => { await beforeNavigation(); openSettings(); }));
$('configure-model').addEventListener('click', () => {
  const menu=$('attachment-menu'); menu.hidden=!menu.hidden;
  $('configure-model').setAttribute('aria-expanded',String(!menu.hidden));
});
$('details-toggle').addEventListener('click', safe(async () => {
  if (detailsDirty) await saveDetails(false);
  await saveHeartDraft();
  detailsOpen = !detailsOpen; render({ refreshDetails: true });
  if (detailsOpen) $('close-details').focus();
}));
$('close-details').addEventListener('click', safe(async () => {
  if (detailsDirty) await saveDetails(false);
  await saveHeartDraft();
  detailsOpen = false; render(); $('details-toggle').focus();
}));
$('dismiss-error').addEventListener('click', () => { $('error-banner').hidden = true; });
$('details-content').addEventListener('input', event => {
  if (event.target.closest('#details-form')) { detailsDirty = true; $('details-save-status').textContent = 'Unsaved · saved when you leave this branch'; }
  if (event.target.closest('#heart-form')) {
    const form = event.target.closest('#heart-form');
    heartDraft = { rootId: form.dataset.rootId, baseRevisionId: form.dataset.baseRevisionId || null, text: form.elements.text.value };
    heartDirty = true;
  }
});
$('model-select').addEventListener('change', safe(async event => {
  const id = selected(state).root?.id;
  const modelId = event.target.value || null;
  await beforeNavigation();
  try { await command('root.model', { id, modelId }); }
  catch (err) { render(); throw err; }
  toast(modelId ? 'Model set for the next exchange' : 'Note mode selected');
}));
async function setReplySettings(mode, speaker) {
  const chat = selected(state).chat, table = tableInfo(state, chat);
  if (!table || replySettingsSaving || submitting.size || modelsBusy(state)) return;
  replySettingsSaving = true; render();
  try { await command('table.replySettings', { chatId: chat.id, baseRevisionId: table.assignment.id, mode, speaker }); }
  finally { replySettingsSaving = false; render(); }
}
$('response-mode-controls').addEventListener('click', safe(async event => {
  const button = event.target.closest('[data-response-mode]');
  const chat = selected(state).chat;
  if (!button || button.disabled || !chat || effectiveOrientation(chat.responseMode) === button.dataset.responseMode) return;
  responseModeSaving = true;
  render();
  try {
    await flushDrafts();
    await command('chat.responseMode', { id: chat.id, responseMode: button.dataset.responseMode });
    toast(`${button.textContent} for future replies`);
  } finally { responseModeSaving = false; render(); if (button.isConnected) button.focus(); }
  if (state.ui.coatChangeWarning !== false) showCoatWarning();
}));
$('dialog').addEventListener('change', safe(async event => {
  if (event.target.id !== 'coat-warning-setting') return;
  const checkbox = event.target;
  checkbox.disabled = true;
  try { await command('ui.update', { coatChangeWarning: checkbox.checked }); }
  catch (err) { checkbox.checked = state.ui.coatChangeWarning !== false; throw err; }
  finally { checkbox.disabled = false; }
}));
$('message-input').addEventListener('input', event => {
  const chat = selected(state).chat;
  if (!chat) return;
  pendingDrafts.set(chat.id, { text: event.target.value });
  $('draft-status').textContent = 'Saving…';
  const { root } = selected(state);
  refreshComposerButtons(root, chat);
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => flushDrafts().catch(err => { $('draft-status').textContent = 'Draft not saved'; error(err.message); }), 350);
});
$('message-input').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!$('send-button').disabled) $('composer-form').requestSubmit(); }
});
async function sendTurn(kind = 'send', requestedSpeaker = null) {
  const { root, chat } = selected(state);
  const content = kind === 'ask' ? '' : $('message-input').value;
  if (!chat || (kind === 'send' && !content.trim()) || submitting.size || replyBusy(state, chosenModel(root, chat)) || responseModeSaving || replySettingsSaving) return;
  const speaker = requestedSpeaker || nextSpeaker(chat);
  const model = chosenModel(root, chat, speaker);
  if (tableInfo(state, chat) && speaker !== 'note' && !model) throw new Error('That chair has no available model. Arrange the chairs first.');
  const attached = kind === 'send' ? filePicker.get(chat.id) : null;
  const toolsEnabled = $('tools-enabled').checked;
  if (attached?.loading || imagePicker.busy) return;
  if (attached && !model) throw new Error('Choose a local model or remove the attached file before saving a note.');
  submitting.add(chat.id);
  stoppedReplies.delete(chat.id);
  render();
  try {
    await beforeNavigation();
    if (!model) {
      await command('message.note', { chatId: chat.id, content });
      pendingDrafts.delete(chat.id);
      toast('Note saved');
    } else {
      sending.add(chat.id);
      refreshWorkActivity();
      const requestKey = JSON.stringify({ chatId: chat.id, content, kind, speaker, toolsEnabled, replyMode: replySettings(state, chat).mode, responseMode: effectiveOrientation(chat.responseMode), harnessRevision: chat.harnessSelections?.at(-1)?.id ?? null, file: attached?.base64 ?? null, images: imagePicker.selected(chat.id) });
      let request = replyRequests.get(chat.id);
      if (request?.key !== requestKey) {
        request = { key: requestKey, options: turnOptions(state, chat, speaker, kind) };
        const picturePlan = await imagePicker.prepare(chat.id, tableInfo(state, chat) ? speaker : null, replySettings(state, chat).mode);
        if (picturePlan) request.options.imagePlanId = picturePlan.id;
        replyRequests.set(chat.id, request);
      }
      const imagePlanId = request.options.imagePlanId;
      let options = { ...request.options }, turnModel = model;
      // At most two human-requested replies. Each call still crosses the normal
      // host boundary; the second needs the first call's exact live follow-up.
      for (let step = 0; step < 2; step++) {
        if (stoppedReplies.has(chat.id)) break;
        const live = { text: '', modelLabel: turnModel.name, speaker: tableInfo(state, chat) ? { seat: options.speaker } : null };
        liveReplies.set(chat.id, live); render({ scroll: true });
        const streamedState = await api.exchangeStream(chat.id, step === 0 ? content : '', { ...options, toolsEnabled, selectedFile: step === 0 && attached ? { name: attached.name, base64: attached.base64 } : undefined, onEvent: event => {
          if (event.type === 'started') { live.exchangeId = event.exchangeId; live.modelLabel = event.modelLabel || live.modelLabel; live.speaker = event.speaker; if (step === 0 && kind === 'send') filePicker.clear(chat.id, attached); }
          if (event.type === 'delta') { live.text += event.text || ''; renderLiveReply(chat.id, live); return; }
          if (event.type === 'model_status') { live.status = event.message; renderLiveReply(chat.id, live); return; }
          if (event.type === 'tool_question' || event.type === 'tool') void toolPanel.refresh().catch(()=>{});
          if (event.type === 'tool' && event.name === 'write_sketch' && event.status === 'completed') toast('Sketch saved · available in Sketch Book');
          if (event.type === 'error' && event.error) live.text += live.text ? `\n\n${event.error}` : event.error;
          if (event.type !== 'done' && screen === 'chat' && selected(state).chat?.id === chat.id) render({ scroll: true });
        } });
        pollEpoch++;
        state = streamedState || await api.state();
        liveReplies.delete(chat.id);
        if (step === 0 && kind === 'send') pendingDrafts.delete(chat.id);
        const completed = state.exchanges.find(turn => turn.request?.id === options.requestId);
        if (step === 0 && completed) replyRequests.delete(chat.id);
        const followUp = completed?.request?.followUp;
        if (step || !followUp || completed.status !== 'completed' || stoppedReplies.has(chat.id)) break;
        turnModel = chosenModel(root, chat, followUp.speaker);
        if (!turnModel) throw new Error('The follow-up chair is no longer available. Arrange its model before asking again.');
        options = { ...turnOptions(state, chat, followUp.speaker, 'ask'), requestId: followUp.requestId, replyMode: 'single', followUpOf: completed.id, ...(imagePlanId ? { imagePlanId } : {}) };
      }
      replyRequests.delete(chat.id);
    }
  } catch (err) {
    pollEpoch++;
    error(err.message);
    try {
      state = await api.state();
      const request = replyRequests.get(chat.id);
      if (request?.options.imagePlanId && !state.exchanges.some(exchange => exchange.request?.id === request.options.requestId)) replyRequests.delete(chat.id);
    } catch { /* Keep the current draft and state in view. */ }
    const live = liveReplies.get(chat.id);
    if (live) live.problem = 'The connection ended before this text was confirmed saved. Copy it before closing.';
  } finally {
    pollEpoch++;
    const live = liveReplies.get(chat.id);
    const saved = live?.exchangeId && state.messages.some(m => m.role === 'assistant' && m.exchangeId === live.exchangeId);
    if (!live?.problem || saved) liveReplies.delete(chat.id);
    sending.delete(chat.id);
    submitting.delete(chat.id);
    stoppedReplies.delete(chat.id);
    await toolPanel.refresh().catch(()=>{});
    render({ scroll: true, refreshDetails: !detailsDirty });
    if (screen === 'chat' && selected(state).chat?.id === chat.id) $('message-input').focus();
  }
}
$('composer-form').addEventListener('submit', safe(async event => { event.preventDefault(); await sendTurn(); }));
$('cancel-button').addEventListener('click', safe(async () => {
  const chatId = selected(state).chat.id;
  stoppedReplies.add(chatId);
  try { await api.stopWork({scope:'episode',chatId}); }
  catch (err) { if (!err.message.includes('There is no active reply')) throw err; }
  contextStatusKey = ''; state = await api.state(); render(); toast('Stop requested. Partial replies remain; remote compute cancellation is not confirmed.');
}));

document.addEventListener('click', safe(async event => {
  const exportLink = event.target.closest('a[data-export]');
  if (exportLink) { event.preventDefault(); await downloadExport(exportLink.getAttribute('href'), exportLink.dataset.export); return; }
  const target = event.target.closest('[data-action]');
  if (!target || !state) return;
  const { action, id } = target.dataset;
  if (action === 'sketch-access') { await harnessEditor.persist(); closeDialog(); return sketchBook.openAccess(); }
  if (action === 'save-sketch') return sketchBook.saveReply(id);
  if (action === 'open-sketch') { await refreshState(); closeDialog(); return sketchBook.open(id); }
  if (action === 'tour-replay') { closeDialog(); welcomeTour.start(); return; }

  if (action === 'resources-reset') { const root=selected(state).root; if(root) await command('root.resources',{id:root.id,resources:{...RESOURCE_DEFAULTS}}); openSettings('resources'); return; }
  if (action === 'dream-prepare') { openDialog('Prepare a Dream', '<p>Copy this into a conversation with a model you choose. This button does not send material or start training.</p><textarea id="dream-preparation" rows="13" readonly>'+e(DREAM_PREPARATION)+'</textarea><button class="primary-button" type="button" data-action="dream-copy">Copy preparation prompt</button>'); return; }
  if (action === 'dream-copy') { await navigator.clipboard.writeText(DREAM_PREPARATION); toast('Preparation prompt copied'); return; }
  if (action === 'carry-approve' || action === 'carry-cancel-ready') { const chat=selected(state).chat; await command(action === 'carry-approve' ? 'carry.approve' : 'carry.cancelReady', {chatId:chat.id,baseId:activeAccount(state,chat.id)?.id??null,...(action==='carry-approve'?{recordId:id}:{})}); contextStatusKey=''; await openContext(); return; }
  if (target.disabled) return;
  if (await imagePicker.action(action, target)) return;
  if (await imageProviderPanel.action(action)) return;
  if (await harnessEditor.action(action, target)) return;
  if (await agentProfiles.action(action, target)) return;
  if (await modelArchivePanel.action(action,id)) return;
  if (action === 'shelf-manage') { await beforeNavigation(); return openSettings('toy-shelf'); }
  if (action === 'peaches-open') { await beforeNavigation(); return openDialog('Book of PEACHES', '<div class="peaches-placeholder"><img src="/assets/book-of-peaches.svg" alt="A peach resting beside a gold-trimmed Book of PEACHES" width="150" height="150"><p>Coming later.</p></div><div class="dialog-footer"><button type="button" class="primary-button" data-action="close-dialog">Got it</button></div>'); }
  if (action === 'shelf-up' || action === 'shelf-down') {
    const row = target.closest('.shelf-setting-row'), other = action === 'shelf-up' ? row.previousElementSibling : row.nextElementSibling;
    if (other) { action === 'shelf-up' ? other.before(row) : other.after(row); target.focus(); }
    return;
  }
  if (action === 'shelf-defaults') {
    const list = target.closest('form').querySelector('.shelf-arrangement');
    for (const app of SHELF_APPS) { const row = list.querySelector(`[data-shelf-id="${app.id}"]`); row.querySelector('input').checked = true; list.append(row); }
    target.closest('form').querySelector('.shelf-settings-status').textContent = 'Default arrangement ready. Choose Save shelf to keep it.';
    return;
  }
  if (action === 'shelf-height-reset') { await toyShelf.resetHeight(); render(); toast('Shelf height reset'); return; }
  if (action === 'parallel-open') return openHearth();
  if(action==='peer-source-more')return showPeerSource(target.closest('form'),Number(target.dataset.offset));
  if(action==='hearth-stop-peer'){await api.stopPeer({runId:id,peer:target.dataset.peer});await openHearth(id);return;}
  if (action === 'hearth-open') return openHearth();
  if (action === 'hearth-details') return openHearth(id);
  if (action === 'parallel-details') {
    const jobs = state.parallel?.jobs.filter(j=>j.id === id || j.runId === id) ?? [];
    if(jobs.some(j=>j.hearthActor||j.peerId))return openHearth(jobs[0].runId);
    return openDialog('Approach details', approachDetails(state,id)+jobs.map(j=>`<h3>${e(j.model.name)} · recorded episode</h3>${handoffSummary(state,j.id,e)}${toolHistory(state,j.id)}`).join(''));
  }
  if (action === 'parallel-dismiss') return parallelMonitor.dismiss(id);
  if (action === 'parallel-cancel') {
    state=await api.parallelCancel(id);pollEpoch++;render();
    if($('hearth-message-form')?.dataset.runId===id)await openHearth(id);
    toast('Stopping shared work…');return;
  }
  if(action==='coat-follow') { await command('harness.branch',{chatId:target.dataset.chat,key:target.dataset.key,baseId:target.dataset.base||null,mode:'follow',ref:null}); harnessEditor.openPicker(state.chats.find(c=>c.id===target.dataset.chat)); return; }
  if (action === 'context-open') return openContext();
  if (action === 'context-source' || action === 'context-source-page') return openContextSource(id, Number(target.dataset.offset || 0));
  if (action === 'context-stop') { await api.continuityCancel(selected(state).chat.id); toast('Stopping context preparation…'); return; }
  if (['context-select', 'context-full', 'context-pin', 'context-unpin'].includes(action)) {
    const chatId = selected(state).chat.id, baseId = activeAccount(state, chatId)?.id ?? null;
    if (action === 'context-select' || action === 'context-full') await command('carry.select', { chatId, baseId, recordId: action === 'context-full' ? null : id });
    else await command('carry.pin', { chatId, baseId, sourceId: id, pinned: action === 'context-pin' });
    contextStatusKey = ''; return openContext();
  }
  if (action === 'codex-open') return openCodex();
  if (action === 'codex-login') {
    target.disabled = true;
    try { const result = await api.codexLogin(); codexAuthUrl = result.authUrl; codexStatus = { connected: false, pending: true }; showCodex(); }
    finally { target.disabled = false; }
    return;
  }
  if (action === 'codex-logout') { await api.codexLogout(); codexAuthUrl = null; return openCodex(); }
  if (action === 'codex-save') {
    if (!codexStatus?.connected || !codexStatus.models.some(m => m.id === id)) throw new Error('Refresh your subscription connection first.');
    const existing = state.models.find(m => m.runtime === 'codex' && m.model === id);
    if (!existing) await command('model.save', { name: target.dataset.name + ' · Codex', model: id, baseUrl: 'codex://chatgpt', runtime: 'codex', inputFormat: 'chat', thinking: false });
    toast('Model saved. Select it in the Visiting chair.'); return openSettings('models');
  }
  if (action === 'personal-rename') {
    if (modelsBusy(state) || submitting.size) return;
    const participant = state.personalParticipants?.find(p => p.id === id);
    if (!participant) return;
    const returnView = $('dialog').classList.contains('settings-dialog') ? 'settings' : 'library';
    return openDialog('Rename personal model', personalNicknameForm(participant, returnView));
  }
  if (action === 'personal-original-name') {
    const form = target.closest('form');
    form.elements.nickname.value = form.dataset.originalName;
    form.elements.nickname.focus(); return;
  }
  if (action === 'personal-nickname-cancel') return returnToPersonalModels(target.closest('form'));
  if (action === 'desks') { await beforeNavigation(); return openDialog('My Desks', deskPicker(state)); }
  if (action === 'new-branch') return newBranchDialog();
  if (action === 'rename-branch') { const chat = selected(state).chat; if (chat) chatDialog(chat); return; }
  if (action === 'choose-model' || action === 'harnesses') {
    await beforeNavigation(); const { root, chat } = selected(state);
    if (!chat || (action !== 'harnesses' && (modelsBusy(state) || submitting.size))) return;
    return action === 'harnesses' ? harnessEditor.openPicker(chat) : openDialog(id === 'personal' ? 'My Models' : 'Visiting Models', modelPicker(state, root, chat, id));
  }
  if (action === 'library') {
    await beforeNavigation();
    if (id === 'desks') return openDialog('My Desks', deskPicker(state));
    if (id === 'harnesses') return harnessEditor.openLibrary();
    if (id === 'personal') return openDialog('My Models', personalSettings(state));
    if (id === 'visiting') return openSettings('models');
    return openDialog('My Branches', `<div class="library-list">${state.chats.filter(c => !c.archivedAt && state.roots.some(r => r.id === c.rootId && !r.archivedAt)).map(c => `<div><button class="quiet-button" data-action="select-chat" data-id="${e(c.id)}"><strong>${e(c.title)}</strong><small>${e(state.roots.find(r => r.id === c.rootId).name)}</small></button><button type="button" class="text-button" data-action="archive-current-chat" data-id="${e(c.id)}">Add to archive</button></div>`).join('') || '<p>No branches yet.</p>'}</div><div class="dialog-footer"><button class="primary-button" data-action="new-branch">New branch</button></div>`);
  }
  if (action === 'table-setup') { await beforeNavigation(); const { chat } = selected(state); if (chat) openDialog('Arrange the table', tableSetup(state, chat)); return; }
  if (action === 'ask-now') return sendTurn('ask');
  if (action === 'save-note') return sendTurn('send', 'note');
  if (action === 'select-chair' || action === 'reply-pattern') {
    if (target.disabled) return;
    const chat = selected(state).chat, settings = replySettings(state, chat);
    if (action === 'select-chair') { if (settings.mode !== 'alternate') await setReplySettings(settings.mode, id); }
    else await setReplySettings(settings.mode === id ? 'single' : id, settings.speaker);
    return;
  }
  if (action === 'close-dialog') { if (!coatWarningOpen && (continuityBusy || carryBusy)) return; return closeDialog(); }
  if (action === 'home-new-root') return newRootDialog();
  if (action === 'home-resume') {
    const chat = state.chats.find(item => item.id === id && !item.archivedAt);
    const root = state.roots.find(item => item.id === chat?.rootId && !item.archivedAt);
    if (root && chat) return navigate(root.id, chat.id, root.mode);
    return;
  }
  if (action === 'home-tools') { await beforeNavigation(); return openSettings('advanced'); }
  if (action === 'dream-review') return dreamReview.open(id || dreamParticipantId);
  if (action === 'dream-about') return openDialog('About Dream', dreamAbout(), 'dream-dialog');
  if (action === 'home-check-model') {
    const model = state.models.find(item => item.id === id);
    if (!model || modelCheck?.status === 'checking') return;
    if (model.runtime === 'codex') return openCodex();
    if (model.runtime === 'bundled') {
      const status = await api.localModelStatus();
      modelCheck = { modelId: id, status: status.available ? 'available' : 'unavailable', checkedAt: new Date().toISOString(), message: status.message };
      render(); return;
    }
    modelCheck = { modelId: id, status: 'checking' }; render();
    try {
      const result = await api.modelsDiscover({ baseUrl: model.baseUrl });
      const available = result.models.some(item => item.id === model.model);
      modelCheck = { modelId: id, status: available ? 'available' : 'missing', checkedAt: new Date().toISOString(), message: available ? 'Model listed by the local server.' : 'Server replied; this model is not listed.' };
    } catch {
      modelCheck = { modelId: id, status: 'unavailable', checkedAt: new Date().toISOString(), message: 'Could not reach this local model server.' };
    }
    const current = state.models.find(item => item.id === id);
    if (current?.baseUrl !== model.baseUrl || current?.model !== model.model) modelCheck = undefined;
    render();
    return;
  }
  if (action === 'new-root') return newRootDialog('personal');
  if(action==='fold-desk') { const folded={...(state.ui.foldedDesks??{})}; folded[id]=!folded[id]; await command('ui.update',{foldedDesks:folded}); return; }
  if (action === 'select-root') { closeDialog(); const root = state.roots.find(r => r.id === id); return navigate(id, null, root.mode); }
  if (action === 'select-chat') { closeDialog(); const chat = state.chats.find(c => c.id === id); return navigate(chat.rootId, id, state.roots.find(r => r.id === chat.rootId).mode); }
  if (action === 'root-menu') { await beforeNavigation(); return manageRoot(id); }
  if (action === 'models') { await beforeNavigation(); return openSettings('models'); }
  if (action === 'settings-tab') { if (id === 'workspace') await beforeNavigation(); return openSettings(id); }
  if (action === 'storage-retry') { if (storageBusy) return; storageMessage = ''; refreshStoragePanel(); return loadStorage(); }
  if (action === 'storage-refresh') { if (storageBusy) return; storageLoadToken++; storageMessage = ''; refreshStoragePanel(); return loadStorage(); }
  if (action === 'storage-copy') {
    const path = target.dataset.path || '';
    try { await navigator.clipboard.writeText(path); toast('Path copied'); }
    catch { toast('Select the path text to copy it'); }
    return;
  }
  if (action === 'storage-backup') {
    if (storageBusy) return;
    storageBusy = true; storageBusyLabel = 'Saving backup…'; storageLoadToken++; storageFocusTarget = { action: 'storage-backup' }; storageMessage = ''; refreshStoragePanel();
    try {
      await beforeNavigation();
      const result = await api.storageBackup();
      storageMessage = `Backup saved at ${result.backup?.createdAt ? new Date(result.backup.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'the local backup folder'}.`;
      await loadStorage({ preserveMessage: true });
      toast('Workspace backup saved');
    } catch (err) { storageMessage = err.message; }
    finally { storageBusy = false; storageBusyLabel = 'Working…'; refreshStoragePanel(); }
    return;
  }
  if (action === 'storage-verify') {
    if (storageBusy) return;
    storageBusy = true; storageBusyLabel = 'Checking backup…'; storageLoadToken++; storageFocusTarget = { action: 'storage-verify', id }; storageMessage = ''; refreshStoragePanel();
    try {
      await beforeNavigation();
      const result = await api.storageVerify(id);
      storageMessage = result.valid ? `Backup checked successfully · ${result.recordCount} records.` : 'The backup could not be verified.';
    } catch (err) { storageMessage = err.message; }
    finally { storageBusy = false; storageBusyLabel = 'Working…'; refreshStoragePanel(); }
    return;
  }
  if (action === 'storage-restore') {
    if (storageBusy) return;
    storageBusy = true; storageBusyLabel = 'Restoring copy…'; storageLoadToken++; storageFocusTarget = { action: 'storage-restore', id }; storageMessage = ''; refreshStoragePanel();
    try {
      await beforeNavigation();
      const result = await api.storageRestoreCopy(id);
      storageMessage = `A separate copy was restored to ${result.restoredPath}. Your current workspace was left unchanged.`;
      toast('Restore copy ready');
    } catch (err) { storageMessage = err.message; }
    finally { storageBusy = false; storageBusyLabel = 'Working…'; refreshStoragePanel(); }
    return;
  }
  if (action === 'discover-models') {
    const baseUrl = target.dataset.baseUrl || 'http://127.0.0.1:8080/v1';
    target.disabled = true;
    target.textContent = 'Checking…';
    try {
      const result = await api.modelsDiscover({ baseUrl });
      discoveredBaseUrl = baseUrl;
      discoveredModels = (result.models || []).map(model => ({ ...model, baseUrl }));
      if (!discoveredModels.length) toast('Bonsai is running, but no models were listed.');
    } catch (err) {
      discoveredModels = [];
      target.disabled = false;
      target.textContent = 'Check connection';
      throw err;
    }
    return openSettings('models');
  }
  if (action === 'use-discovered-model') {
    return openSettings('models', { name: target.dataset.name || id, model: id, baseUrl: target.dataset.baseUrl || 'http://127.0.0.1:8080/v1', runtime: target.dataset.runtime || (target.dataset.baseUrl?.includes(':1234') ? 'lmstudio' : 'compatible') });
  }
  if (action === 'local-model-add') {
    const status = await api.localModelStatus();
    if (!status.available) throw new Error('Run the full Setup to install the included Qwen first.');
    if (!state.models.some(m => m.runtime === 'bundled')) await command('model.save', { name: 'Qwen3.5-4B · Local', model: 'branchline-qwen35-4b', baseUrl: 'http://127.0.0.1:0/v1', runtime: 'bundled', thinking: false, inputFormat: 'chat' });
    return openSettings('models');
  }
  if (action === 'local-model' || action === 'local-model-control') {
    const status = action === 'local-model-control' ? await api.localModelControl(id) : await api.localModelStatus();
    return openDialog('Included Qwen', `<p>${e(status.message)}</p><p class="field-help">Stock Qwen3.5-4B · runs on this computer. It loads when you send a message. Stop remains available while loading and replying. To repair missing or damaged files, run the full Setup again.</p><p class="field-help">Mode: ${status.preference === 'cpu' ? 'CPU' : 'Automatic graphics / CPU fallback'} · ${status.contextTokens.toLocaleString()} token context.</p>${status.available && !state.models.some(m => m.runtime === 'bundled') ? '<button type="button" class="primary-button" data-action="local-model-add">Add to my models</button>' : ''}<div class="dialog-footer"><button type="button" class="quiet-button" data-action="local-model-control" data-id="auto" ${status.busy ? 'disabled' : ''}>Automatic</button><button type="button" class="quiet-button" data-action="local-model-control" data-id="cpu" ${status.busy ? 'disabled' : ''}>Use CPU</button><button type="button" class="quiet-button" data-action="local-model-control" data-id="unload" ${status.busy ? 'disabled' : ''}>Unload</button><button type="button" class="primary-button" data-action="close-dialog">Done</button></div>`);
  }
  if (action === 'edit-model') { const model = state.models.find(m => m.id === id); if (model?.runtime === 'bundled') { const status = await api.localModelStatus(); return openDialog('Included Qwen', `<p>${e(status.message)}</p><button type="button" class="primary-button" data-action="local-model">Model controls</button>`); } return model?.runtime === 'codex' ? openCodex() : openSettings('models', model); }
  if (action === 'delete-model') {
    await command('model.delete', { id }); openSettings('models'); return toast('Model profile removed; branch histories retained');
  }
  if (action === 'delete-mcp') { await command('mcp.binding.remove', { id }); openSettings('mcp'); return toast('MCP binding removed'); }
  if (action === 'discover-mcp') { const { root, chat } = selected(state); const result = await api.mcpCapabilities({ rootId: root?.id, chatId: chat?.id }); const binding = result.bindings.find(item => item.binding.id === id); mcpCapabilities[id] = binding || { status: 'unavailable', error: 'Binding was not returned for this scope.' }; openSettings('mcp'); return; }
  if (action === 'mcp-call') { const { root, chat } = selected(state); const tool = target.dataset.tool; openDialog(`Call ${tool}`, `<form id="mcp-call-form" data-binding="${e(id)}" data-tool="${e(tool)}"><label class="form-field">Arguments (JSON object)<textarea name="args" rows="5">{}</textarea></label><p class="field-help">The result is recorded with the selected root, chat, binding, and tool identity.</p><div class="dialog-footer"><button type="button" class="quiet-button" data-action="close-dialog">Cancel</button><button class="primary-button" type="submit">Call tool</button></div></form>`); return; }
  if (action === 'continuity-tab') { await beforeNavigation(); setContinuityTab(id); return render({ refreshDetails: true }); }
  if (action === 'reflect-latest' || action === 'mind-reflect') {
    await beforeNavigation();
    const { chat } = selected(state); const latest = state.exchanges.filter(exchange => exchange.chatId === chat?.id && exchange.status !== 'pending').at(-1);
    return openReflection(latest?.id, action === 'mind-reflect' ? 'mind' : 'journal');
  }
  if (action === 'mind-inspect') return openDialog('Learning wake', mindInspection(state, id), 'continuity-dialog');
  if (action === 'table-input') {
    const input = state.handoffs?.records.find(r => r.id === id && r.kind === 'context.to_model');
    if (!input) throw new Error('That recorded input is unavailable.');
    return openDialog('Input recorded for Personal', `<p class="field-help">This is the exact request content recorded for this model call. It does not prove understanding or a weight update.</p><pre class="mind-json">${e(JSON.stringify(input.detail.inputMessages, null, 2))}</pre>${handoffSummary(state, input.taskId, e)}`, 'continuity-dialog');
  }
  if (action === 'mind-exclude') {
    const wake = state.mind?.wakes.find(w => w.id === id);
    if (!wake) throw new Error('That wake is unavailable.');
    await beforeNavigation();
    await command('mind.exclude', { chatId: wake.chatId, wakeId: id, baseAccountId: accountFor(state, wake.chatId)?.id });
    preparedLearningPacket = null;
    render({ refreshDetails: true });
    openDialog('Learning wake', mindInspection(state, wake.jobId), 'continuity-dialog');
    return toast('Wake and recorded dependents excluded from future context');
  }
  if (action === 'mind-download') {
    if (!preparedLearningPacket) throw new Error('Preview a selected learning packet first.');
    const url = URL.createObjectURL(new Blob([JSON.stringify(preparedLearningPacket, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `branchline-learning-${preparedLearningPacket.hash.slice(0, 12)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); return;
  }
  if (action === 'reflect-exchange') { await beforeNavigation(); return openReflection(id); }
  if (action === 'reflect-cancel') {
    if (continuityCancelRequested) return;
    continuityCancelRequested = true;
    if (continuityChatId) state = await api.continuityCancel(continuityChatId);
    toast('Stopping reflection…'); return;
  }
  if (action === 'journal-remove') {
    await beforeNavigation();
    const { root } = selected(state); await command('journal.remove', { rootId: root.id, entryId: id }); toast('Memory removed from context'); return;
  }
  if (action === 'source-exchange') {
    const { root } = selected(state); const job = (root?.continuity?.jobs || []).find(item => item.id === id); const sourceChat = state.chats.find(item => item.id === job?.chatId); const exchange = exchangeForReflection(sourceChat?.id, job?.sourceExchangeId);
    if (!job || !sourceChat || !exchange) return toast('The source exchange is not available in this branch.');
    openDialog('Source exchange', `<dl><dt>Recorded</dt><dd>${e(exchange.createdAt)}</dd><dt>Model</dt><dd>${e(job.modelLabel)}<br><span class="detail-value">${e(job.modelIdentifier)}</span></dd></dl><div class="continuity-source"><strong>You</strong><p>${e(exchange.userContent)}</p><p class="continuity-source-reply"><strong>${e(exchange.modelLabel || job.modelLabel)}</strong><br>${e(exchange.assistantContent)}</p></div><p class="field-help">This is the exact completed exchange used for the journal reflection.</p>`); return;
  }
  if (action === 'proposal-source') {
    const { root } = selected(state); const proposal = (root?.continuity?.proposals || []).find(item => item.id === id); const job = (root?.continuity?.jobs || []).find(item => item.id === proposal?.jobId); const sourceChat = state.chats.find(item => item.id === job?.chatId); const exchange = exchangeForReflection(sourceChat?.id, job?.sourceExchangeId);
    if (!proposal || !job || !sourceChat || !exchange) return toast('The proposal source exchange is not available.');
    openDialog('Proposal source exchange', `<dl><dt>Proposal</dt><dd>${e(proposal.target)} · ${e(proposal.createdAt)}</dd><dt>Model</dt><dd>${e(job.modelLabel)}<br><span class="detail-value">${e(job.modelIdentifier)} · ${e(job.runtime)}</span></dd><dt>Source chat</dt><dd>${e(sourceChat.title)}</dd></dl><div class="continuity-source"><strong>You</strong><p>${e(exchange.userContent)}</p><p class="continuity-source-reply"><strong>${e(exchange.modelLabel || job.modelLabel)}</strong><br>${e(exchange.assistantContent)}</p></div><p class="field-help">The proposal remains inactive until you explicitly accept it.</p>`); return;
  }
  if (action === 'proposal-accept' || action === 'proposal-dismiss') {
    await beforeNavigation();
    const { root } = selected(state); const proposal = (root.continuity?.proposals || []).find(item => item.id === id);
    if (!proposal) return;
    if (action === 'proposal-dismiss') await command('continuity.proposal.dismiss', { rootId: root.id, proposalId: id }, { renderNow: false });
    else {
      guidanceReview = await api.prepareAction({ rootId: root.id, proposalId: id });
      const { plan } = guidanceReview;
      return openDialog('Review guidance change', `<p><strong>${e(plan.branchName)} · ${e(plan.target)}.md</strong></p><p>${e(plan.consequence)}</p><p class="field-help">Proposed by ${e(plan.modelLabel)}. Review the meaning before accepting. This review expires in five minutes.</p><h3>Current text</h3><pre class="mind-json">${e(plan.previousText || '(empty)')}</pre><h3>Proposed text</h3><pre class="mind-json">${e(plan.proposedText)}</pre><div class="dialog-footer"><button class="quiet-button" data-action="guidance-cancel">Keep current text</button><button class="primary-button" data-action="guidance-accept">Accept this exact change</button></div>`, 'continuity-dialog');
    }
    render({ refreshDetails: true });
    toast(action === 'proposal-dismiss' ? 'Proposal dismissed' : 'Proposal accepted'); return;
  }
  if (action === 'guidance-accept' || action === 'guidance-cancel') {
    if (!guidanceReview) throw new Error('Open the proposal review again.');
    const review = guidanceReview; guidanceReview = null;
    try {
      state = await api.decideAction({ actionId: review.plan.id, reviewHash: review.reviewHash, token: review.token, decision: action === 'guidance-accept' ? 'accept' : 'cancel' });
      closeDialog(); render({ refreshDetails: true });
      return toast(action === 'guidance-accept' ? 'Guidance accepted for future exchanges' : 'Current guidance kept');
    } catch (err) { state = await api.state(); render({ refreshDetails: true }); throw err; }
  }
  if(action==='view-archives') { await beforeNavigation(); return openDialog('Archives',archiveView(state)); }
  if (action === 'archive-root' || action === 'restore-root') {
    await beforeNavigation();
    await command('root.archive', { id, archived: action === 'archive-root' });
    if (action === 'restore-root') openDialog('Archives',archiveView(state)); else closeDialog();
    return toast(action === 'archive-root' ? 'Branch archived' : 'Branch restored');
  }
  if (action === 'archive-current-chat' || action === 'restore-chat') {
    await beforeNavigation();
    await command('chat.update', { id: id || selected(state).chat.id, archived: action === 'archive-current-chat' });
    if (action === 'restore-chat') openDialog('Archives',archiveView(state)); else closeDialog();
    return toast(action === 'restore-chat' ? 'Chat restored' : 'Chat archived');
  }
  if (action === 'reuse-message') {
    const m = state.messages.find(m => m.id === id);
    pendingDrafts.set(m.chatId, { text: m.content }); await flushDrafts(); render(); $('message-input').focus(); return;
  }
  if (action === 'reply-details') {
    const m = state.messages.find(m => m.id === id);
    const chat = state.chats.find(c => c.id === m.chatId);
    const root = state.roots.find(r => r.id === chat.rootId);
    const revision = root.instructions.find(r => r.id === m.instructionRevisionId);
    const exchange = state.exchanges.find(item => item.id === m.exchangeId);
    const canReflect = exchange && exchange.status !== 'pending';
    const responseModeLabel = recordedOrientationLabel(exchange?.responseMode);
    openDialog('Reply details', `<dl><dt>Model at this exchange</dt><dd>${e(m.modelLabel)}<br><span class="detail-value">${e(m.modelIdentifier || m.modelId)}</span></dd><dt>Connection at this exchange</dt><dd class="detail-value">${e(m.modelBaseUrl || 'See local exchange record')}</dd><dt>Recorded</dt><dd>${e(exchange?.createdAt || m.createdAt || '—')}</dd><dt>Reply provenance</dt><dd>${hasRecordedReply(state, exchange) ? 'Matches its recorded model output. This does not certify truth or grant permission.' : 'Authorship unverified. Original text is preserved and supplied as quoted historical context, not as the model’s own prior reply.'}</dd><dt>Base Coat at this exchange</dt><dd id="reply-response-mode">${e(responseModeLabel)}</dd><dt>Reply pattern</dt><dd id="reply-pattern-detail">${e(replyPatternLabel(state, exchange))}</dd><dt>Additional Coat at this exchange</dt><dd id="reply-harness">${e(exchange?.harness ? exchange.harness.preset.name + " · v" + exchange.harness.preset.version : "Not recorded in this earlier reply")}</dd><dt>Instruction revision</dt><dd class="detail-value">${e(m.instructionRevisionId || 'No custom instructions')}</dd></dl>${messageInfoDetails(exchange, m, e)}${pocketSummary(exchange?.harness?.preset)}${coatToolReceipt(state, exchange?.id, e)}<h3>Coat instructions</h3><div class="message-body notice">${e(exchange?.harness?.preset.instructions || "No additional Coat instructions recorded.")}</div><h3>Desk instructions used</h3><div class="message-body notice">${e(revision?.text || 'No custom branch instructions.')}</div>${continuityExchangeSummary(root, exchange)}${handoffSummary(state, exchange?.id, e)}${toolHistory(state, exchange?.id)}${canReflect ? `<div class="dialog-footer"><button type="button" class="primary-button" data-action="reflect-exchange" data-id="${e(exchange.id)}">Reflect on this exchange</button></div>` : '<p class="field-help">Reflection is available after a complete exchange.</p>'}<p class="field-help">This is a local reply record. No public stamp is issued.</p>`);
  }
}));

document.addEventListener('change', safe(async event => {
  if (event.target.name === 'speaker') {
    const hint = event.target.closest('#carry-prepare-form, #conversation-settings-form')?.querySelector('.recorder-role');
    if (hint) hint.textContent = recorderHint(event.target.value);
  }
  const form = event.target.closest('#carry-prepare-form');
  if (!form || event.target.name !== 'speaker') return;
  const speaker = event.target.value, button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  $('carry-preparation-hint').textContent = 'Checking the writer’s window and the shared context…';
  const status = await api.contextCarry(form.dataset.chatId, speaker);
  if (!form.isConnected || form.elements.speaker.value !== speaker) return;
  $('carry-preparation-hint').textContent = preparationHint(status);
  $('carry-context-size').textContent = contextSize(status);
  $('carry-budget-hint').textContent = budgetHint(status);
  $('carry-over-budget').hidden = !(status.characters > status.limit);
  button.disabled = !status.preparation;
}));

document.addEventListener('input', event => harnessEditor.input(event));
document.addEventListener('change', event => {
  if (event.target.id === 'agent-profile-files') { void agentProfiles.importFiles(event.target); return; }
  if (event.target.id === 'harness-import-file') { void harnessEditor.importFile(event.target); return; }
  if (event.target.id === 'dream-personal-select') {
    const chosen = event.target.value;
    if (chosen && !(state.personalParticipants || []).some(p => p.id === chosen)) return;
    dreamParticipantId = chosen || null;
    render();
    $('dream-personal-select')?.focus({ preventScroll: true });
    return;
  }
  const agents = event.target.closest('#agent-settings-form');
  if (agents) { updateAgentForm(agents,event.target); return; }
  const approaches = event.target.closest('#parallel-start-form');
  const hearth = event.target.closest('#hearth-start-form');
  if(hearth){updateHearthForm(hearth);updateAllowance(hearth,event.target);}
  const resume=event.target.closest('#hearth-resume-form');
  if(resume){updateAllowance(resume,event.target);resume.querySelector('[data-extension]').hidden=!resume.elements.extend.checked;}
  if (approaches) { updateApproachForm(approaches); return; }
  const harnessForm = event.target.closest('#harness-form');
  if (harnessForm) {
    const shared = harnessForm.elements.shared.checked;
    $('visiting-harness-picker').hidden = shared;
    $('harness-preview').innerHTML = harnessPreview(state, harnessForm.elements.personal.value, shared ? null : harnessForm.elements.visiting.value);
    $('personal-harness-picker').querySelector('label').firstChild.textContent = shared ? 'Shared Coat' : 'Personal Coat';
    return;
  }
  const infoForm = event.target.closest('#message-info-form');
  if (infoForm) {
    const messageInfo = Object.fromEntries(messageInfoKeys.map(key => [key, infoForm.elements[key].checked]));
    $('message-info-status').textContent = 'Saving message information…';
    messageInfoSaveChain = messageInfoSaveChain.catch(() => {}).then(async () => {
      await command('ui.update', { messageInfo });
      if ($('message-info-status')) $('message-info-status').textContent = 'Message information saved with this workspace.';
    }).catch(error);
    return;
  }
  const form = event.target.closest('#appearance-form');
  if (!form) return;
  const appearance = saveAppearance(Object.fromEntries(new FormData(form)));
  $('appearance-status').textContent = 'Saving appearance…';
  appearanceSaveChain = appearanceSaveChain.catch(() => {}).then(async () => {
    await command('ui.update', { appearance }, { renderNow: false });
    if ($('appearance-status')) $('appearance-status').textContent = 'Appearance saved with this workspace.';
  }).catch(error);
});

document.addEventListener('submit', safe(async event => {
  const form = event.target;
  if (form.id === 'toy-shelf-settings') {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]'); if (submit.disabled) return; submit.disabled = true;
    const rows = [...form.querySelectorAll('.shelf-setting-row')];
    try {
      await toyShelf.update({ order: rows.map(row => row.dataset.shelfId), hidden: rows.filter(row => !row.querySelector('input').checked).map(row => row.dataset.shelfId) });
      render(); form.querySelector('.shelf-settings-status').textContent = 'Shelf saved';
    } finally { if (submit.isConnected) submit.disabled = false; }
    return;
  }
  if (form.id === 'composer-form') return;
  event.preventDefault();
  if (await agentProfiles.submit(event)) return;
  if (await imageProviderPanel.submit(event)) return;
  if(form.classList.contains('usual-coat-form')) { await command('harness.usual',{key:form.dataset.key,baseId:form.dataset.baseId||null,ref:harnessRef(form.elements.ref.value)}); openSettings('coats'); toast('Usual Coat saved for future replies'); return; }
  if (form.id === 'harness-editor-form') return harnessEditor.save(event);
  if (form.id === 'harness-delete-form') return harnessEditor.delete(event);
  if (form.id === 'agent-settings-form') {
    await command('parallel.settings',{ baseRevisionId:form.dataset.revision || null,
      enabled:form.elements.enabled.value === 'yes', automaticRequests:form.elements.automaticRequests.checked,
      confirmAutomatic:form.dataset.confirmAutomatic === 'true' });
    openSettings('agents'); toast('Agent settings saved'); return;
  }
  if (form.id === 'hearth-start-form') {
    if(modelsBusy(state)||submitting.size)return;
    const button=form.querySelector('button[type="submit"]');button.disabled=true;
    try {
      await beforeNavigation();
      const result=await api.continuingStart({requestId:form.dataset.requestId,chatId:form.dataset.chatId,content:form.elements.content.value,
        peers:[0,1].map(i=>({key:form.elements['peer'+i].value,direction:form.elements['direction'+i].value})),limits:allowanceFrom(form),toolsEnabled:form.elements.toolsEnabled.checked,cloudApproved:form.elements.cloudApproved.checked,basisHash:form.dataset.basis});
      pendingDrafts.delete(form.dataset.chatId);pollEpoch++;state=result.state;closeDialog();render({scroll:true});toast('The hearth is open');
    } finally {if(button.isConnected)button.disabled=false;}return;
  }
  if(form.id==='peer-source-form'){await showPeerSource(form);return;}
  if(form.id==='hearth-resume-form'){
    const button=form.querySelector('button[type="submit"]');button.disabled=true;
    try {const result=await api.continuingResume({runId:form.dataset.runId,requestId:form.dataset.requestId,target:form.elements.target.value,extension:form.elements.extend.checked?allowanceFrom(form,'extend'):null,cloudApproved:form.elements.cloudApproved?.checked??false});state=result.state;pollEpoch++;render();await openHearth(result.runId);toast('Selected episodes resumed');}
    finally{if(button.isConnected)button.disabled=false;}return;
  }
  if (form.id === 'hearth-message-form') {
    const button=form.querySelector('button[type="submit"]');button.disabled=true;
    try {
      const input={runId:form.dataset.runId,requestId:form.dataset.requestId,message:form.elements.message.value};
      let id=input.runId;
      if(form.dataset.profile==='continuing') state=await api.continuingMessage({...input,target:form.elements.target.value,scopeChange:form.elements.scopeChange.checked});
      else if(form.dataset.resume==='true') {
        if(!form.elements.renewAllowance.checked)return;
        const result=await api.hearthResume({...input,cloudApproved:form.elements.cloudApproved?.checked??false});state=result.state;id=result.runId;
      } else state=await api.hearthMessage(input);
      hearthDrafts.delete(input.runId);form.elements.message.value='';pollEpoch++;render();await openHearth(id);toast('Clarification sent to the hearth');
    } finally {if(button.isConnected)button.disabled=false;}return;
  }
  if (form.id === 'parallel-start-form') {
    if (modelsBusy(state) || submitting.size) return;
    const button = form.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      await beforeNavigation();
      const result = await api.parallelStart({ requestId:form.dataset.requestId, chatId:form.dataset.chatId,
        content:form.elements.content.value,
        approaches:[0,1].map(i=>({seat:form.elements['seat'+i].value,angle:form.elements['angle'+i].value})),
        toolsEnabled:form.elements.toolsEnabled.checked, cloudApproved:form.elements.cloudApproved.checked,
        basisHash:form.dataset.basis });
      pendingDrafts.delete(form.dataset.chatId); pollEpoch++; state = result.state;
      closeDialog(); render({scroll:true}); toast('Two approaches started');
    } finally { if (button.isConnected) button.disabled = false; }
    return;
  }
  if (form.id === 'carry-source-form') return openContextSource('M' + new FormData(form).get('number'));
  if (form.id === 'resources-form') {
    const data = Object.fromEntries(new FormData(form)); const resources = Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v===''?null:Number(v)]));
    await command('root.resources',{id:form.dataset.rootId,resources}); contextStatusKey=''; toast('Resource settings saved for later replies'); return;
  }
  if (form.id === 'conversation-settings-form') {
    const settings={speaker:form.elements.speaker.value};
    for(const key of ['automatic','review','nearPopup','showCount']) settings[key]=form.elements[key].checked;
    await command('chat.carrySettings',{id:form.dataset.chatId,settings}); contextStatusKey=''; toast('Conversation settings saved'); return;
  }
  if (form.id === 'carry-edit-form') {
    await command('carry.revise', { chatId: form.dataset.chatId, baseId: form.dataset.baseId, text: new FormData(form).get('text') });
    contextStatusKey = ''; await openContext(); toast('Correction saved as a new version'); return;
  }
  if (form.id === 'carry-prepare-form') {
    const input={chatId:form.dataset.chatId,speaker:form.elements.speaker.value,baseId:form.dataset.baseId||null,lastMessageId:form.dataset.lastMessageId||null};
    const receipt=await api.startCarry(input);
    closeDialog(); state=await api.state(); contextStatusKey=''; render();
    toast(receipt.status === 'queued' ? 'Handoff queued; your draft stays here.' : 'Preparing in the background. Stop is available.');
    return;
  }
  if (form.id === 'table-form') {
    const data = Object.fromEntries(new FormData(form));
    await command('table.assign', { chatId: form.dataset.chatId, baseRevisionId: form.dataset.baseRevisionId || null, personalId: data.personalId || null, visitorModelId: data.visitorModelId || null });
    closeDialog(); render({ refreshDetails: true }); return toast('Chairs set for the next turn');
  }
  if (form.id === 'personal-form') {
    const data = Object.fromEntries(new FormData(form));
    await command('personal.create', data);
    openSettings('models'); return toast('Personal participant created');
  }
  if (form.id === 'personal-nickname-form') {
    const value = form.elements.nickname.value.trim();
    const nickname = !value || value === form.dataset.originalName ? null : value;
    const baseNickname = JSON.parse(form.dataset.baseNickname);
    const button = form.querySelector('[type="submit"]'); button.disabled = true;
    try {
      if (nickname !== baseNickname) await command('personal.nickname', { participantId: form.dataset.id, nickname, baseNickname });
      returnToPersonalModels(form); toast('Nickname saved');
    } finally { if (button.isConnected) button.disabled = false; }
    return;
  }
  if (form.id === 'mind-export-form') {
    const wakeIds = new FormData(form).getAll('wakeId');
    if (!wakeIds.length || wakeIds.length > 16) throw new Error('Select between one and sixteen wakes.');
    preparedLearningPacket = await api.learningPacket({ chatId: form.dataset.chatId, wakeIds });
    openDialog('Preview learning packet', packetPreview(preparedLearningPacket), 'continuity-dialog'); return;
  }
  if (form.id === 'details-form') return saveDetails();
  if (form.id === 'heart-form') {
    // Preserve any independent branch-detail draft when refreshing the panel.
    if (detailsDirty) await saveDetails(false);
    heartDraft = { rootId: form.dataset.rootId, text: new FormData(form).get('text'), baseRevisionId: form.dataset.baseRevisionId || null };
    heartDirty = true;
    await saveHeartDraft();
    render({ refreshDetails: true });
    toast('Heart saved'); return;
  }
  if (form.id === 'reflect-form') {
    if (continuityBusy) return;
    const data = Object.fromEntries(new FormData(form));
    const sourceTurnIds = new FormData(form).getAll('sourceTurnId');
    const { root, chat } = selected(state);
    const exchange = exchangeForReflection(chat?.id, form.dataset.exchangeId);
    if (!root || !chat || !exchange) throw new Error('That exchange is no longer available for reflection.');
    const request = data.target === 'mind'
      ? { chatId: chat.id, sourceTurnIds, target: 'mind', speaker: data.speaker, requestId: form.dataset.requestId, baseAccountId: form.dataset.baseAccountId || null }
      : { chatId: chat.id, exchangeId: exchange.id, target: data.target, speaker: data.speaker };
    if (data.target === 'mind' && (!sourceTurnIds.length || sourceTurnIds.length > 4)) throw new Error('Choose one to four source turns.');
    continuityBusy = true; continuityChatId = chat.id;
    continuityCancelRequested = false;
    openDialog('Reflect on this exchange', reflectionDialogContent(root, chat, exchange, true, data.target, state, data.speaker), 'continuity-dialog');
    for (const box of $('reflect-form').querySelectorAll('[name="sourceTurnId"]')) box.checked = sourceTurnIds.includes(box.value);
    $('dialog').querySelector('.dialog-header [data-action="close-dialog"]').disabled = true;
    $('reflect-form').querySelector('fieldset').disabled = true;
    try {
      state = await api.continuityReflect(request);
      continuityBusy = false; continuityChatId = null; closeDialog(); render({ refreshDetails: true });
      if (data.target === 'mind') {
        const job = state.mind?.jobs.find(j => j.requestId === request.requestId);
        if (job) openDialog('Learning wake', mindInspection(state, job.id), 'continuity-dialog');
        toast(job?.wakeId ? 'Learning wake recorded · no training run' : 'Reflection retained for inspection');
      } else toast(data.target === 'journal' ? 'Memory added to the journal' : 'Proposal ready for review');
    } catch (err) {
      try { state = await api.state(); } catch { /* keep the current state if the server has already closed */ }
      continuityBusy = false; continuityChatId = null;
      closeDialog(); render({ refreshDetails: true });
      if (!continuityCancelRequested) openDialog('Reflection could not be confirmed', `<p class="notice message-error">${e(err.message)}</p><p class="field-help">The app refreshed its local record where possible. Inspect reflection history before trying again.</p><div class="dialog-footer"><button type="button" class="primary-button" data-action="close-dialog">Close</button></div>`);
      throw err;
    }
    return;
  }
  if (form.id === 'mcp-context-form') { const chat = selected(state).chat; const resultIds = [...form.querySelectorAll('input[name="resultId"]:checked')].map(input => input.value); await command('mcp.context.set', { chatId: chat.id, resultIds }); toast('Selected MCP context saved'); return; }
  const data = Object.fromEntries(new FormData(form));
  const submit = form.querySelector('[type="submit"]');
  // A second Enter/click can arrive while navigation saves the previous draft.
  if (form.id === 'new-root-form' && (submit?.disabled || !form.isConnected)) return;
  if (submit) submit.disabled = true;
  try {
    if (form.id === 'harness-form') {
      const shared = form.elements.shared.checked;
      await command('harness.select', { chatId: form.dataset.chatId, baseRevisionId: form.dataset.baseRevisionId || null, baseDefaultId: form.dataset.baseDefaultId || null, shared, personal: harnessRef(data.personal), visiting: harnessRef(shared ? data.personal : data.visiting), saveAsDefault: form.elements.saveAsDefault.checked });
      closeDialog(); toast('Coat choices saved for future replies');
    } else if (form.id === 'chair-picker-form') {
      const personal = form.dataset.seat === 'personal';
      await command('table.assign', { chatId: form.dataset.chatId, baseRevisionId: form.dataset.baseRevisionId || null, personalId: (personal ? data.modelChoice : form.dataset.otherId) || null, visitorModelId: (personal ? form.dataset.otherId : data.modelChoice) || null });
      closeDialog(); toast('Model selected');
    } else if (form.id === 'new-branch-form') {
      await beforeNavigation();
      const root = state.roots.find(r => r.id === data.rootId);
      await command('chat.create', { rootId: root.id, title: data.title.trim(), setupChairs: true }, { renderNow: false });
      closeDialog(); await navigate(root.id, state.ui.selected[root.mode].chatId, root.mode); $('message-input').focus();
    } else if (form.id === 'new-root-form') {
      await beforeNavigation();
      await command('root.create', { name: data.name.trim(), mode: 'personal', setupChairs: true }, { renderNow: false });
      screen = 'chat';
      closeDialog(); $('app-shell').classList.remove('nav-open'); render({ scroll: true }); $('message-input').focus();
    } else if (form.id === 'chat-form') {
      await beforeNavigation();
      if (form.dataset.id) await command('chat.update', { id: form.dataset.id, title: data.title.trim() });
      else await command('chat.create', { rootId: selected(state).root.id, title: data.title.trim() });
      closeDialog(); render({ scroll: true }); $('message-input').focus();
    } else if (form.id === 'root-form') {
      await command('root.update', { id: form.dataset.id, name: data.name.trim() }); closeDialog();
    } else if (form.id === 'model-form') {
      modelCheck = undefined;
      await command('model.save', { ...data, thinking: form.elements.thinking?.checked === true, runtime: data.runtime || 'compatible', ...(form.dataset.id ? { id: form.dataset.id } : {}) });
      openSettings('models'); toast('Local model profile saved');
    } else if (form.id === 'mcp-form') {
      let args; try { args = JSON.parse(data.args); } catch { throw new Error('Arguments must be a JSON string array.'); }
      if (!Array.isArray(args)) throw new Error('Arguments must be a JSON string array.');
      const { root } = selected(state);
      await command('mcp.binding.save', { label: data.label.trim(), profile: data.profile, command: data.command.trim(), args, cwd: data.cwd.trim() || null, rootId: root?.id || null, chatId: null });
      openSettings('mcp'); toast('MCP binding saved');
    } else if (form.id === 'mcp-call-form') {
      let args; try { args = JSON.parse(data.args); } catch { throw new Error('Arguments must be a JSON object.'); }
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Arguments must be a JSON object.');
      const { root, chat } = selected(state); const result = await api.mcpCall({ rootId: root.id, chatId: chat.id, bindingId: form.dataset.binding, tool: form.dataset.tool, arguments: args });
      openDialog('MCP tool result', `<p class="notice">${e(JSON.stringify(result.result, null, 2))}</p><p class="field-help">Recorded for ${e(result.binding.label)} · ${e(result.tool)}.</p><button type="button" class="primary-button" data-action="close-dialog">Done</button>`);
    }
  } finally { if (submit?.isConnected) submit.disabled = false; }
}));
window.addEventListener('beforeunload', event => {
  if (!closingPage && (toyShelf.unsaved || pendingDrafts.size || filePicker.pending.size || detailsDirty || heartDirty || harnessEditor.unsaved || sketchBook.unsaved || dreamReview.unsaved || agentProfiles.hasDraft || continuityBusy || carryBusy)) { event.preventDefault(); event.returnValue = ''; }
});
// The native host waits for this explicit acknowledgement before stopping storage.
// A Coat edit remains a draft; closing never selects it or adopts its instructions.
window.branchlineCloseState = { status: 'idle' };
window.branchlineCancelClose = () => { closingPage = false; window.branchlineCloseState = { status: 'idle' }; if (state) render(); };
window.branchlinePrepareClose = (discardSelections = false) => {
  if (window.branchlineCloseState.status === 'saving') return;
  closingPage = true; pollEpoch++; clearInterval(pollTimer); pollTimer = null;
  window.branchlineCloseState = { status: 'saving' };
  void (async () => {
    const deadline = Date.now() + 15000;
    while (harnessEditor.busy || agentProfiles.busy || sketchBook.busy || dreamReview.busy || imagePicker.busy || submitting.size) {
      if (Date.now() > deadline) throw new Error('An edit is still saving. Please try closing again after it finishes.');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (state) {
      await beforeNavigation();
      await harnessEditor.persist();
      await sketchBook.persist();
      await dreamReview.persist();
    }
    window.branchlineCloseState = !discardSelections && (filePicker.pending.size || agentProfiles.hasDraft)
      ? { status: 'needs-confirmation', message: 'Your conversation and Coat drafts are saved. Unsent file selections or an unfinished agent-profile import are still open. Close and discard those selections?' }
      : { status: 'ready' };
  })().catch(err => { window.branchlineCloseState = { status: 'failed', message: err.message }; });
};
document.addEventListener('keydown', safe(async event => {
  if (event.key === 'Escape' && !$('dialog').open && !sketchBook.isOpen && !dreamReview.isOpen) {
    if (detailsOpen) { if (detailsDirty) await saveDetails(false); await saveHeartDraft(); detailsOpen = false; render(); $('details-toggle').focus(); }
    else closeNavigation();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (window.innerWidth < 760) $('app-shell').classList.add('nav-open');
    else if (state.ui.sidebarCollapsed) await command('ui.update', { sidebarCollapsed: false });
    syncNavigationAccessibility(); $('branch-search').focus();
  }
}));

try {
  state = await api.state(); initializeAppearance(state.ui.appearance); await toolPanel.refresh(); render();
  if (!state.ui.welcomeTour) welcomeTour.start();
  void api.startupStatus().then(status => { if (status.warnings?.length) error(status.warnings.join('\n')); }).catch(() => {});
}
catch (err) { error(`Branchline could not open its local workspace. ${err.message}`); $('home-screen').hidden = true; $('composer-form').hidden = true; $('conversation').hidden = false; $('conversation').innerHTML = '<div class="empty-chat"><h1>Workspace unavailable</h1><p>Check the local server and reload to try again. Existing data has not been replaced.</p></div>'; }

let preparationPoll = false, lastNearNotice = '';
setInterval(async () => {
  if (!state || closingPage || preparationPoll || screen !== 'chat') return;
  const {chat}=selected(state); if(!chat) return;
  preparationPoll=true;
  try {
    const status=await api.contextCarry(chat.id,nextSpeaker(chat)); if(selected(state).chat?.id!==chat.id)return; contextStatus=status;
    if (['queued','preparing'].includes(status.preparationState?.phase) || state.contextCarry?.jobs.some(j=>j.status==='pending') || status.readyId !== (state.contextCarry?.ready?.[chat.id]??null)) {
      const epoch=pollEpoch, update=await api.stateSince(pollRevision);
      if(update && epoch===pollEpoch && !closingPage) { state=update.state; pollRevision=update.revision; render(); }
    }
    $('context-status').innerHTML=contextBar(status,false,carrySettings(chat).showCount);
    const key=chat.id+':'+(status.activeId??'none');
    if(carrySettings(chat).nearPopup && status.characters >= status.limit-Math.max(3000,status.target?.recentCharacters??0) && lastNearNotice!==key) {
      lastNearNotice=key; toast('Conversation space is filling. Open the thought cloud to prepare or review a handoff.');
    }
    if(['queued','preparing'].includes(status.preparationState?.phase)) $('cancel-button').hidden=false;
  } catch {} finally {preparationPoll=false;}
},1500);

async function stopAllEpisodes(){const result=await api.stopWork({scope:'all'});state=result.state;pollEpoch++;render();toast(result.message);$('work-controls').open=false;}
$('stop-all-episodes').addEventListener('click',safe(stopAllEpisodes));
document.addEventListener('keydown',event=>{if(event.ctrlKey&&event.altKey&&!event.shiftKey&&!event.metaKey&&event.code==='Period'){event.preventDefault();if(!event.repeat)void safe(stopAllEpisodes)();}});

$('activity-home').append($('work-controls'));
