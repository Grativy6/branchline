import { escapeHtml as e } from './views.js';
import { tableInfo } from './table.js';
import { imageCards } from './images.js';
import { carrySettings } from './resource-settings.js';
import { recorderOptions, recorderSelect, recorderHint } from './recorder.js';

export const activeAccount = (state, chatId) => state.contextCarry?.records.find(r => r.id === state.contextCarry.active[chatId]);

export const preparationHint = status => status?.preparation ? (status.preparation.rewriteOnly
  ? `This pass resizes the shared account through M${status.preparation.through}, checking its cited original excerpts. No new source range is removed from working context.`
  : `This pass reads original messages M${status.preparation.from}–M${status.preparation.through}, plus the previous account and its cited original excerpts. ${status.preparation.recent} later messages stay verbatim.`)
  + ` The account is shared by both chairs. ${status.target ? `Up to ${status.target.accountCharacters.toLocaleString()} account characters and ${status.target.sources} source passages leave room for the smaller window.` : ''}`
  : status?.contextIssue || status?.issue || 'Open a conversation to prepare a handoff.';
export const budgetHint = status => status?.participants?.length
  ? `One shared account for this conversation. ${status.participants.map(p => `${p.seat === 'personal' ? 'Personal' : p.seat === 'visiting' ? 'Visiting' : 'Model'}: ${p.characters.toLocaleString()} / ${p.budget.characters.toLocaleString()} characters`).join(' · ')}. Prepared to fit all assigned chairs; these are estimates including current guidance and the saved draft.`
  : 'This is Branchline’s input budget, including the saved draft; a model’s own token window may differ.';
export const contextSize = status => status?.characters == null ? 'Shared working context' : status.characters.toLocaleString() + ' / ' + status.limit.toLocaleString() + ' characters · shared context';

export function contextBar(status, busy = false, showCount = true) {
  const known = status?.characters != null && status?.limit > 0;
  const amount = known ? Math.min(32, Math.max(0, Math.round(status.characters / status.limit * 32))) : 0;
  const phase = status?.preparationState?.phase;
  const label = status?.readyId ? 'Handoff ready' : phase === 'preparing' ? 'Preparing handoff' : phase === 'queued' ? 'Handoff queued' : 'Conversation context';
  const count = known ? `≈ ${status.characters.toLocaleString()} / ${status.limit.toLocaleString()} chars` : 'Capacity unknown';
  const limiting = status?.limitingSeat ? `. Limiting chair: ${status.limitingSeat}` : '';
  return `<button type="button" class="text-button" data-action="context-open" aria-label="${label}. ${e(count)}${e(limiting)}" title="${label}. Input characters are estimated; this is not a tokenizer count."><svg class="thought-cloud" viewBox="0 0 64 40" aria-hidden="true"><defs><clipPath id="cloud-clip"><path d="M16 33C2 33 1 16 14 14C14 0 37 0 40 12C57 3 68 29 52 33Z"/></clipPath></defs><rect class="cloud-fill" x="0" y="${34-amount}" width="64" height="${amount}" clip-path="url(#cloud-clip)"/><path class="cloud-outline" d="M16 33C2 33 1 16 14 14C14 0 37 0 40 12C57 3 68 29 52 33Z"/><circle class="cloud-outline" cx="10" cy="37" r="2"/></svg>${showCount ? `<span class="cloud-count">${e(count)}</span>` : ''}${phase === 'preparing' || phase === 'queued' || status?.readyId ? `<span class="context-hint">${label}</span>` : ''}</button>`;
}

export function contextDialog(state, chat, status, speaker = 'visiting') {
  const account = activeAccount(state, chat.id), table = tableInfo(state, chat);
  const options = recorderOptions(state, chat);
  const models = [...options.chairs, ...options.others].filter(c => c.model);
  const revisions = (state.contextCarry?.records || []).filter(r => r.chatId === chat.id).slice().reverse();
  const job = (state.contextCarry?.jobs || []).filter(j => j.chatId === chat.id).at(-1);
  const pins = state.contextCarry?.pins[chat.id] || [];
  const ready = state.contextCarry?.records.find(r => r.id === state.contextCarry.ready?.[chat.id]);
  return `<p class="field-help">This desk keeps one shared account for this conversation, whichever chair speaks next. The selected model writes a participant account or an outside review; its role and identity are credited separately. Original history stays here, and recent exchanges stay verbatim when they fit. Preparing a handoff makes one model call; it does not train weights.</p>
    <div class="context-summary"><strong id="carry-context-size">${contextSize(status)}</strong><span>${status?.carriedMessages || 0} earlier messages carried · ${(status?.totalMessages || 0) - (status?.carriedMessages || 0)} verbatim</span></div>
    <p class="field-help" id="carry-budget-hint">${e(budgetHint(status))}</p>
    <p class="notice" id="carry-over-budget" ${status?.characters > status?.limit ? '' : 'hidden'}>This conversation needs a smaller working context. A long branch may need more than one handoff pass; each pass preserves the full original history.</p>
    ${status?.contextIssue ? `<p class="notice">${e(status.contextIssue)}</p>` : ''}
    ${job && ['failed', 'cancelled'].includes(job.status) ? `<p class="notice message-error">${e(job.error)}</p>` : ''}
    ${ready ? `<section class="ready-account"><strong>Ready for the next reply</strong><p>${carrySettings(chat).review ? 'Review this account before allowing it into the next reply.' : 'Branchline will check and use this account before compiling the next reply.'} All newer messages stay verbatim.</p><details><summary>Read prepared account</summary><div class="continuity-source">${e(ready.text)}</div></details>${carrySettings(chat).review && state.contextCarry?.approved?.[chat.id] !== ready.id ? `<button type="button" class="primary-button" data-action="carry-approve" data-id="${e(ready.id)}">Approve for next reply</button>` : ''}<button type="button" class="quiet-button" data-action="carry-cancel-ready">Cancel ready account</button></section>` : ''}
    ${['queued','preparing'].includes(status?.preparationState?.phase) ? `<p role="status">${status.preparationState.phase === 'queued' ? 'Waiting for this connection. No extra model is loaded.' : 'Preparing a fixed earlier source range. Newer messages stay in the conversation.'}</p><button type="button" data-action="context-stop" class="quiet-button">Stop preparation</button>` : ''}
    ${status?.preparationState?.result?.error ? `<p class="notice">${e(status.preparationState.result.error)}</p>` : ''}
    <form id="carry-prepare-form" data-chat-id="${e(chat.id)}" data-base-id="${e(account?.id || '')}" data-last-message-id="${e(status?.lastMessageId || '')}">
      <label class="form-field">Prepare with${recorderSelect(state, chat, speaker)}</label><p class="field-help recorder-role">${e(recorderHint(speaker))}</p>
      <p class="field-help" id="carry-preparation-hint">${e(preparationHint(status))}</p>
      <button class="primary-button" type="submit" ${models.length && status?.preparation && !ready && !['queued','preparing'].includes(status?.preparationState?.phase) ? '' : 'disabled'}>Prepare handoff</button>
    </form>
    ${account ? `<hr><form id="carry-edit-form" data-chat-id="${e(chat.id)}" data-base-id="${e(account.id)}"><label class="form-field">Shared desk account<textarea name="text" rows="12" maxlength="8000" required>${e(account.text)}</textarea></label><p class="field-help">${account.author === 'user' ? 'Your correction' : 'Prepared by ' + e(account.modelLabel)} · ${e(new Date(account.createdAt).toLocaleString())}. Shared by both chairs in this branch; historical context, not permission or a replacement for your instructions.</p><button class="quiet-button" type="submit">Save correction</button></form>
      <h3>Original sources</h3><div class="context-source-list">${[...new Set(account.sources.map(ref => ref.sourceId))].map(id => `<button class="quiet-button" type="button" data-action="context-source" data-id="${e(id)}">${e(id)} · Open original</button>`).join('')}</div>` : '<p class="field-help">No handoff is active. All conversation messages are still included.</p>'}
    ${pins.length ? `<h3>Originals brought back into context</h3><div class="context-source-list">${pins.map(id => `<button class="quiet-button" type="button" data-action="context-source" data-id="${e(id)}">${e(id)}</button><button class="text-button" type="button" data-action="context-unpin" data-id="${e(id)}">Remove ${e(id)} from context</button>`).join('')}</div>` : ''}
    <details class="context-browse"><summary>Reopen another original message</summary><form id="carry-source-form"><label class="form-field">Message number (1–${status?.totalMessages || 0})<input name="number" type="number" min="1" max="${status?.totalMessages || 1}" required></label><button class="quiet-button" type="submit">Open source</button></form><p class="field-help">With Tools on, supported models can reopen earlier messages in this branch too. Text-only models can use originals you bring into context here.</p></details>
    ${revisions.length ? `<details class="context-history"><summary>Earlier handoffs and corrections (${revisions.length})</summary>${revisions.map(r => `<div class="context-revision"><span>${e(new Date(r.createdAt).toLocaleString())} · ${e(r.author === 'user' ? 'Your correction' : r.modelLabel)} · through ${e(r.throughSourceId)}</span><details><summary>Read account</summary><div class="continuity-source">${e(r.text)}</div></details><button type="button" class="text-button" data-action="context-select" data-id="${e(r.id)}" ${account?.id === r.id || status?.readyId === r.id ? 'disabled' : ''}>${account?.id === r.id ? 'Active' : status?.readyId === r.id ? 'Ready for next reply' : 'Use this version'}</button></div>`).join('')}<button type="button" class="text-button" data-action="context-full" ${account ? '' : 'disabled'}>Use full history again</button><p class="field-help">Restoring full history may reach the working-context limit again. Every handoff version remains saved.</p></details>` : ''}`;
}

export function sourceDialog(source, pinned, state, chatId) {
  return `<p><strong>${e(source.sourceId)} · ${e(source.author)}</strong> · ${e(source.status)}${source.truncated ? ' · reply cut short' : ''}<br><span class="field-help">${e(new Date(source.createdAt).toLocaleString())}</span></p>
    <div class="continuity-source context-original">${e(source.text)}</div>
    ${source.images?.length && state ? `<div class="picture-grid">${imageCards(state, chatId, source.images.map(image => image.id))}</div><p class="field-help">These pictures remain saved with the original message. Use again selects a viewing copy for your next reply; reopening text alone does not transmit pixels.</p>` : ''}
    <p class="field-help">Characters ${source.offset + 1}–${source.offset + source.text.length} of ${source.totalCharacters}. Exact recorded text and evidence; historical permissions remain historical.</p>
    <div class="context-source-list">${source.nextOffset !== null ? `<button class="quiet-button" data-action="context-source-page" data-id="${e(source.sourceId)}" data-offset="${source.nextOffset}" type="button">Read next page</button>` : ''}${source.offset ? `<button class="quiet-button" data-action="context-source" data-id="${e(source.sourceId)}" type="button">Back to start</button>` : ''}<button class="quiet-button" data-action="${pinned ? 'context-unpin' : 'context-pin'}" data-id="${e(source.sourceId)}" type="button">${pinned ? 'Remove from working context' : 'Bring whole message into context'}</button></div>
    <details><summary>Source identity</summary><p class="detail-value">${e(source.messageId)}<br>${e(source.hash)}</p></details><div class="dialog-footer"><button class="primary-button" type="button" data-action="context-open">Back to handoff</button></div>`;
}
