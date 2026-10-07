import { EventEmitter } from 'node:events';
import { CODEX_CONFIG, CODEX_VERSION } from '../server/codex-policy.mjs';

export class FakeCodexRpc extends EventEmitter {
  constructor() { super(); this.calls = []; this.closed = false; this.accountType = 'chatgpt'; this.mode = 'normal'; this.turns = 0; }
  notify() {}
  async request(method, params = {}) {
    this.calls.push({ method, params: structuredClone(params) });
    if (method === 'initialize') return { userAgent: 'Codex Desktop/' + CODEX_VERSION };
    if (method === 'config/read') return { config: { ...structuredClone(CODEX_CONFIG), chatgpt_base_url: 'https://chatgpt.com/backend-api/', ...(this.badConfig ? { web_search: 'live' } : {}) }, layers: [{ name: { type: 'sessionFlags' }, config: structuredClone(CODEX_CONFIG) }] };
    if (method === 'account/read') return { account: this.accountType ? { type: this.accountType, email: 'synthetic@example.invalid', planType: 'plus' } : null };
    if (method === 'account/login/start') return { type: 'chatgpt', loginId: 'synthetic-login', authUrl: 'https://auth.openai.com/authorize?state=synthetic-private-state' };
    if (method === 'account/logout') { this.accountType = null; return {}; }
    if (method === 'model/list') return { data: [{ model: 'synthetic-codex', displayName: 'Synthetic Codex', hidden: false, isDefault: true }], nextCursor: null };
    if (method === 'account/rateLimits/read') return {};
    if (method === 'thread/start') return { thread: { id: 'thread-' + (++this.turns) }, model: this.mode === 'wrong-model' ? 'wrong-model' : params.model, modelProvider: 'openai', approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: { type: 'readOnly' }, instructionSources: [], runtimeWorkspaceRoots: [] };
    if (method === 'turn/start') {
      const threadId = params.threadId, turnId = 'turn-' + this.turns, itemId = 'item-' + this.turns;
      // Notifications deliberately arrive before the turn/start response.
      this.emit('notification', { method: 'item/agentMessage/delta', params: { threadId, turnId, itemId, delta: 'A synthetic ' } });
      if (this.mode === 'clock') {
        this.emit('notification', { method:'item/started',params:{threadId,turnId,item:{id:'clock',type:'dynamicToolCall',tool:'read_clock'}} });
        const result=await this.toolHandler({threadId,turnId,callId:'clock',tool:'read_clock',arguments:{}});
        if (!result.success) throw new Error(JSON.stringify(result));
        this.emit('notification', {method:'item/completed',params:{threadId,turnId,item:{id:itemId,type:'agentMessage',text:'A synthetic clock reply.'}}});
        this.emit('notification', {method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}});
      } else if (this.mode === 'normal') {
        this.emit('notification', { method: 'item/completed', params: { threadId, turnId, item: { id: itemId, type: 'agentMessage', text: 'A synthetic visitor reply.' } } });
        this.emit('notification', { method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed' } } });
      } else if (this.mode === 'tool') this.emit('blockedRequest', { method: 'item/commandExecution/requestApproval' });
      else if (this.mode === 'failure') this.emit('notification', { method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'failed', error: { message: 'Synthetic account limit reached' } } } });
      return { turn: { id: turnId } };
    }
    return {};
  }
  close() { if (this.closed) return; this.closed = true; this.emit('disconnected', new Error('Disconnected')); }
}
