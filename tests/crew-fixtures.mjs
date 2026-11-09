import { fixture } from './desk-helpers.mjs';
export function controllableCodex() {
  const calls = [];
  return { calls, close() {}, async status() { return { connected: true, models: [], pending: false }; },
    async *stream(model, messages, signal, options = {}) {
      let release;
      const ended = new Promise(resolve => { release = resolve; });
      const serial=calls.length+1;const call = { model, messages, amendments: [], usage:options.onUsage, finish: release, reject: false, uncertain: false, completed: false }; calls.push(call);
      const stop = () => release(); signal.addEventListener('abort', stop, { once: true });
      options.onSteerReady?.(async value => {
        if (call.completed) return { accepted: false, reason: 'Turn ended before steering.' };
        if (call.reject) throw Object.assign(new Error('Provider rejected this input.'), { providerRejected: true });
        if (call.uncertain) throw new Error('No acknowledgement was received.');
        call.amendments.push(value); return { accepted: true, threadId: 'thread-' + serial, turnId: 'turn-' + serial };
      });
      try { await ended; signal.throwIfAborted(); yield { text: 'Observed answer with ' + call.amendments.length + ' amendments.' }; return 'stop'; }
      finally { call.completed = true; options.onSteerReady?.(null); signal.removeEventListener('abort', stop); }
    }
  };
}
export async function cloudFixture() {
  const codex = controllableCodex(), f = await fixture({ codex });
  await f.command('model.save', { name: 'Cloud', model: 'gpt-6-astra', runtime: 'codex', baseUrl: 'codex://chatgpt', thinking: false });
  const roster = f.app.store.state.chats[0].seating, model = f.app.store.state.models.find(m => m.name === 'Cloud');
  await f.command('table.roster.chair', { chatId: f.chatId, baseRevisionId: roster.revisionId, chairId: roster.desk.id, name: 'Builder🛠️', modelId: model.id, personalId: null, coat: null });
  return { ...f, codex, async close() { for (const call of codex.calls) call.finish(); await f.close(); } };
}
