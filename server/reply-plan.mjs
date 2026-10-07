import crypto from 'node:crypto';
import { digest } from './integrity.mjs';
import { compileMessages } from './model.mjs';
import { resolveSpeaker, lastMessageId } from './table.mjs';

const fail = (ok, message) => { if (!ok) throw new Error(message); };
const settingsHash = (state, chatId) => {
  const chat = state.chats.find(item => item.id === chatId);
  return digest({ replySettings: chat?.replySettings ?? null,
    agentSelections: state.agentProfiles?.selections ?? [], agentSharing: state.agentProfiles?.sharing ?? [],
    harnessRevision: chat?.harnessSelections?.at(-1)?.id ?? null,
    resources: state.roots.find(root => root.id === chat?.rootId)?.resources ?? null });
};

// One explicitly requested follow-up, bound to the other chair and the starting
// context. The live permit is private to this server instance; ledger text is
// not a reusable grant, and restarting cannot silently resume a queued reply.
export function createReplyPlanner(modelOptions = {}) {
  const pending = new Map();
  return {
    prepare(state, body, checked, exchangeId, selectedFile) {
      if (checked.replyMode !== 'both') return null;
      for (const [id, permit] of pending)
        if (permit.chatId === body.chatId || permit.expiresAt <= Date.now()) pending.delete(id);
      const speaker = checked.selection.seat === 'personal' ? 'visiting' : 'personal';
      const second = resolveSpeaker(state, body.chatId, speaker);
      const baseline = compileMessages(state, body.chatId, body.content ?? '', { ...modelOptions, selectedFile, selection: second.selection, requestKind: checked.kind });
      const plan = { requestId: 'request_' + crypto.randomUUID(), speaker, modelHash: digest(second.model), selectionHash: digest(second.selection), baselineHash: digest(baseline), settingsHash: settingsHash(state, body.chatId) };
      pending.set(exchangeId, { chatId: body.chatId, hash: digest(plan), toolsEnabled: body.toolsEnabled === true, expiresAt: Date.now() + 300000 });
      return plan;
    },
    check(state, body, checked) {
      if (!body.followUpOf) return;
      const parent = state.exchanges.find(turn => turn.id === body.followUpOf);
      const plan = parent?.request?.followUp;
      const permit = pending.get(body.followUpOf);
      fail(permit && permit.expiresAt > Date.now() && permit.hash === digest(plan), 'That follow-up is no longer pending. Ask for a new reply when ready.');
      fail(permit.toolsEnabled === (body.toolsEnabled === true), 'The follow-up must keep the original tool selection.');
      fail(parent.status === 'completed' && parent.chatId === body.chatId, 'The first reply must complete before its follow-up.');
      fail(checked.kind === 'ask' && checked.replyMode === 'single' && body.requestId === plan.requestId && checked.selection?.seat === plan.speaker, 'The follow-up does not match the requested chair and turn.');
      const last = state.messages.find(message => message.id === lastMessageId(state, body.chatId));
      fail(last?.role === 'assistant' && last.exchangeId === parent.id, 'The conversation moved on. Ask for a new reply instead.');
      fail(digest(checked.model) === plan.modelHash && digest(checked.selection) === plan.selectionHash && settingsHash(state, body.chatId) === plan.settingsHash, 'The chairs, model or reply settings changed before the follow-up.');
      const baselineState = { ...state, messages: state.messages.filter(message => message.exchangeId !== parent.id), exchanges: state.exchanges.filter(turn => turn.id !== parent.id) };
      const original = state.messages.find(message => message.exchangeId === parent.id && message.role === 'user');
      const baseline = compileMessages(baselineState, body.chatId, original?.content ?? '', { ...modelOptions, selectedFile: parent.selectedFile ?? null, selection: checked.selection, requestKind: parent.request.kind });
      fail(digest(baseline) === plan.baselineHash, 'The starting context changed before the follow-up. Review it and ask again.');
    },
    isPending(parentId) { const permit = pending.get(parentId); return !!permit && permit.expiresAt > Date.now(); },
    consume(parentId) { return pending.delete(parentId); },
    cancel(chatId) {
      let found = false;
      for (const [id, permit] of pending) if (permit.chatId === chatId) { pending.delete(id); found = true; }
      return found;
    },
  };
}
