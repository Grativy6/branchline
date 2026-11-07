import { escapeHtml as e } from './views.js';

export function codexConnection(status, model = null) {
  if (!status) return { ready: false, label: 'Checking ChatGPT sign-in…', action: 'Check connection' };
  if (!status.connected) return status.error
    ? { ready: false, label: 'ChatGPT connection needs a check', action: 'Check connection' }
    : { ready: false, label: status.pending ? 'Waiting for ChatGPT sign-in' : 'Sign in to ChatGPT', action: 'Sign in' };
  const models = status.models ?? [];
  if (!models.length) return { ready: false, label: 'ChatGPT connected · model list pending', action: 'Refresh model list' };
  if (model && !models.some(m => m.id === model.model)) return { ready: false, label: 'Saved model is unavailable on this account', action: 'Choose a model' };
  return { ready: true, label: 'ChatGPT connected', action: null };
}

export function codexPanel(status = null, authUrl = null) {
  const intro = '<p class="field-help">Uses your signed-in ChatGPT plan and its limits. Models appear automatically for the Desk Model and visiting chairs. API-key credits are separate.</p>';
  if (!status) return `${intro}<p role="status">Checking your saved connection…</p>`;
  if (status.error && !status.connected) return `${intro}<p class="notice" role="alert">Could not check your saved connection.<br>${e(status.error)}</p><button type="button" class="quiet-button" data-action="codex-refresh">Retry connection</button>`;
  if (!status.connected) return `${intro}<div class="notice"><strong>${status.pending ? 'Waiting for sign-in' : 'Not signed in'}</strong><p>Sign in on OpenAI’s website. Your available models will appear here automatically.</p>${authUrl ? `<a class="primary-button" href="${e(authUrl)}" target="_blank" rel="noopener noreferrer">Continue to OpenAI ↗</a>` : status.pending ? '<p role="status">Completing the connection…</p>' : '<button type="button" class="primary-button" data-action="codex-login">Sign in with ChatGPT</button>'}</div><button type="button" class="text-button" data-action="codex-refresh">Refresh connection</button>`;
  const models = status.models ?? [], plan = status.account?.plan;
  return `${intro}<div class="notice"><strong role="status">Connected${plan ? ' · ' + e(plan[0].toUpperCase()+plan.slice(1)) : ''}</strong><p>${e(status.account?.email || 'ChatGPT account')}</p><div class="chatgpt-connection-actions"><button type="button" class="quiet-button" data-action="codex-refresh">Refresh models</button><button type="button" class="text-button" data-action="codex-logout">Sign out of Branchline</button></div></div>${status.error ? `<p class="notice" role="alert">${e(status.error)}${models.length ? ' Showing the last checked list.' : ''}</p>` : ''}${models.length ? `<p>${models.length} model${models.length===1?'':'s'} available from this connection. Choose one directly in a chair.</p><ul class="chatgpt-models" aria-label="ChatGPT models">${models.map(m=>`<li><strong>${e(m.name)}</strong>${m.isDefault?'<small>Recommended</small>':''}</li>`).join('')}</ul><p class="field-help">Existing chairs and saved names stay as you set them. Archived connections remain in the archive.</p>` : '<p role="status">Your account is connected. Waiting for the available model list…</p>'}`;
}
