/* The Home screen is deliberately a pure view model and renderer.  It reads
 * the local workspace snapshot, but never changes it or probes a service. */
import { dreamsCard } from './dreams.js';
import { toyShelf } from './toy-shelf.js';

const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

const activeRoot = (state, rootId) => state.roots?.find(root => root.id === rootId && !root.archivedAt) ?? null;
const activeChat = (state, chatId) => state.chats?.find(chat => chat.id === chatId && !chat.archivedAt && activeRoot(state, chat.rootId)) ?? null;

function activityAt(state, chat) {
  const timestamps = (state.messages || [])
    .filter(message => message.chatId === chat.id && message.createdAt)
    .map(message => message.createdAt);
  timestamps.push(chat.createdAt);
  const root = activeRoot(state, chat.rootId);
  if (root?.createdAt) timestamps.push(root.createdAt);
  return timestamps.sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;
}

function activityTime(state, chat) {
  const value = activityAt(state, chat);
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function scopeFor(state, binding) {
  const root = binding.rootId ? activeRoot(state, binding.rootId) : null;
  const chat = binding.chatId ? activeChat(state, binding.chatId) : null;
  if (binding.rootId && !root) return null;
  if (binding.chatId && (!chat || chat.rootId !== binding.rootId)) return null;
  return {
    rootId: root?.id ?? null,
    chatId: chat?.id ?? null,
    label: chat ? `${root.name} · ${chat.title}` : root?.name ?? 'All branches'
  };
}

export function homeSummary(state) {
  const roots = state?.roots || [];
  const chats = state?.chats || [];
  const activeChats = chats.filter(chat => activeChat(state, chat.id));
  const ranked = activeChats
    .map(chat => ({ chat, root: activeRoot(state, chat.rootId), activityAt: activityAt(state, chat) }))
    .sort((left, right) => {
      const rightTime = Date.parse(right.activityAt);
      const leftTime = Date.parse(left.activityAt);
      return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
    });

  const mode = state?.ui?.mode;
  const selected = state?.ui?.selected?.[mode];
  const selectedRoot = selected && roots.find(root => root.id === selected.rootId && root.mode === mode && !root.archivedAt);
  const selectedChat = selectedRoot && chats.find(chat => chat.id === selected.chatId && chat.rootId === selectedRoot.id && !chat.archivedAt);
  const chosen = selectedChat ? ranked.find(item => item.chat.id === selectedChat.id) : null;
  const resumeItem = chosen || ranked[0] || null;
  const resume = resumeItem ? { root: resumeItem.root, chat: resumeItem.chat, activityAt: resumeItem.activityAt } : null;
  const recent = ranked
    .filter(item => item.chat.id !== resume?.chat?.id)
    .slice(0, 2)
    .map(item => ({ root: item.root, chat: item.chat, activityAt: item.activityAt }));

  const tools = (state?.mcpBindings || [])
    .map(binding => ({ binding, scope: scopeFor(state, binding) }))
    .filter(item => item.scope)
    .slice(0, 3);
  const totalTools = (state?.mcpBindings || []).filter(binding => scopeFor(state, binding)).length;
  const assignment = resume?.chat?.table?.assignments.at(-1);
  const personal = assignment && state.personalParticipants?.find(p => p.id === assignment.personalId);
  const selectedModelId = assignment ? (personal?.connections.at(-1)?.modelId || assignment.visitorModelId) : resume?.root?.modelId;
  const model = selectedModelId ? (state?.models || []).find(candidate => candidate.id === selectedModelId) || null
    : assignment ? null : (state?.models || [])[0] || null;
  return { resume, recent, tools, totalTools, model };
}

const shortDate = value => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

function resumeButton(item, primary = false) {
  const label = primary ? 'Continue' : `Open ${item.chat.title}`;
  return `<button class="${primary ? 'primary-button' : 'quiet-button'} home-resume-button" data-action="home-resume" data-id="${escapeHtml(item.chat.id)}">${escapeHtml(label)} <span aria-hidden="true">↗</span></button>`;
}

export function home(state, { modelCheck, dreamParticipantId = null } = {}) {
  const summary = homeSummary(state || {});
  const resume = summary.resume;
  const resumeMarkup = resume
    ? `<article class="home-card home-continue-card"><div><p class="home-eyebrow">Continue</p><h2>${escapeHtml(resume.chat.title)}</h2><p class="home-card-meta">${escapeHtml(resume.root.name)} · ${escapeHtml(shortDate(resume.activityAt))}</p></div>${resumeButton(resume, true)}</article>`
    : '<article class="home-card home-continue-card home-empty-card"><div><p class="home-eyebrow">Continue</p><h2>A clear beginning</h2><p class="home-card-meta">Your recent conversations will appear here.</p></div></article>';
  const recentMarkup = summary.recent.length
    ? `<div class="home-recent-list" aria-label="Recent conversations">${summary.recent.map(item => `<button class="home-recent-link" data-action="home-resume" data-id="${escapeHtml(item.chat.id)}"><span><strong>${escapeHtml(item.chat.title)}</strong><small>${escapeHtml(item.root.name)} · ${escapeHtml(shortDate(item.activityAt))}</small></span><span aria-hidden="true">↗</span></button>`).join('')}</div>`
    : '';
  const toolsMarkup = summary.tools.length
    ? `<div class="home-tools-list">${summary.tools.map(({ binding, scope }) => `<div class="home-tool-card"><span><strong>${escapeHtml(binding.label || 'Local tool')}</strong><small>${escapeHtml(scope.label)}</small></span><span class="home-tool-status ${binding.enabled === false ? 'is-disabled' : ''}">${binding.enabled === false ? 'Disabled' : 'Saved setup'}</span></div>`).join('')}</div>${summary.totalTools > summary.tools.length ? `<p class="home-card-meta">${summary.totalTools - summary.tools.length} more saved tool${summary.totalTools - summary.tools.length === 1 ? '' : 's'} in Settings.</p>` : ''}`
    : '<p class="home-empty-copy">Saved local tools will appear here when you add them.</p>';
  const modelName = summary.model?.name || summary.model?.model || 'No model selected';
  const checkApplies = summary.model && modelCheck?.modelId === summary.model.id;
  const modelStatus = !summary.model ? 'Choose a model in Settings.' : checkApplies ? ({ checking: 'Checking…', available: 'Model listed', missing: 'Not listed', unavailable: 'Unavailable' }[modelCheck.status] || 'Not checked') : 'Not checked';
  const modelMessage = checkApplies && modelCheck.message ? `<span class="home-model-message">${escapeHtml(modelCheck.message)}</span>` : '';
  const checkedAt = checkApplies && modelCheck.checkedAt ? `Checked ${escapeHtml(shortDate(modelCheck.checkedAt))}` : '';
  const checkButton = summary.model ? `<button class="quiet-button" data-action="home-check-model" data-id="${escapeHtml(summary.model.id)}" ${checkApplies && modelCheck.status === 'checking' ? 'disabled' : ''}>Check connection</button>` : '';
  return `<div class="home-inner"><header class="home-header"><img src="/assets/branchline-tree.png" alt="" class="home-tree"><div><p class="home-eyebrow">Branchline</p><h1 id="home-heading" tabindex="-1">Home</h1><p class="home-subtitle">A quiet place to return to your branches.</p></div></header><div class="home-content"><section aria-label="Your library"><div class="home-library">${[["personal", "My Models"], ["visiting", "Visiting Models"], ["branches", "My Branches"], ["desks", "My Desks"], ["harnesses", "My Coats"]].map(([id, label]) => `<button type="button" data-action="library" data-id="${id}">${label}</button>`).join('')}</div></section><section aria-labelledby="home-continue-heading"><h2 id="home-continue-heading" class="home-section-title">Pick up where you left off</h2>${resumeMarkup}${recentMarkup}</section>${dreamsCard(state, dreamParticipantId)}${toyShelf(state?.ui?.toyShelf)}<section aria-labelledby="home-tools-heading"><div class="home-section-heading"><h2 id="home-tools-heading" class="home-section-title">Tools &amp; connections</h2><button type="button" class="quiet-button" data-action="image-provider-open">Image tools</button><button class="quiet-button" data-action="home-tools">Manage local tools</button></div>${toolsMarkup}</section><button type="button" class="quiet-button" data-action="view-archives">View archives</button></div><footer class="home-model-strip"><span><strong>${escapeHtml(modelName)}</strong><span class="home-model-status">${escapeHtml(modelStatus)}${checkedAt ? ` · ${checkedAt}` : ''}</span>${modelMessage}</span><span class="home-model-actions">${checkButton}<button class="quiet-button" data-action="models">Manage models</button></span></footer></div>`;
}
