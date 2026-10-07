// Structured OpenAI-compatible function calls only. No parsing tools from prose.
export async function* streamLocalTools(endpoint, baseBody, tools, signal, maxResponseBytes, maxContextCharacters = 60000, metrics = null, request = fetch) {
  const messages = structuredClone(baseBody.messages); let total = 0;
  const rounds = tools.contract?.limits.calls ?? 8;
  for (let round = 0; round <= rounds; round++) {
    signal.throwIfAborted();
    await tools.beginRound?.();
    // Sequential document pages keep exact receipts. Replace older delivered page
    // text with explicit source handles; retain the model's own intervening notes.
    const pages = messages.filter(m => m.role === 'tool').filter(m => { try { return JSON.parse(m.content).value?.sourceRole === 'selected_file_evidence'; } catch { return false; } });
    for (const page of pages.slice(0,-1)) {
      const result = JSON.parse(page.content);
      if (result.value.text !== undefined) { const v=result.value; result.value={documentId:v.documentId,offset:v.offset,end:v.end,nextOffset:v.nextOffset,sourceRole:v.sourceRole,reading:'Previously delivered page; reopen this range for exact text.'}; page.content = JSON.stringify(result); }
    }
    // Other tool results stay in the receipt ledger if the next round cannot fit.
    // Never silently trim them or send an unbounded continuation to the model.
    // The caller has already reserved the image allowance. Count text parts,
    // never array length or base64 as if it were ordinary conversation text.
    const characters = messages.reduce((n, m) => n + (Array.isArray(m.content) ? m.content.reduce((sum,p) => sum + (p.type === 'text' ? p.text.length : 0), 0) : m.content?.length || 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0);
    if (characters > maxContextCharacters) throw new Error('Tool results filled this model’s working context. The results remain saved. Open Context to make room before continuing.');
    metrics?.beginRound(round);
    const response = await request(endpoint, { method:'POST', headers:{'content-type':'application/json'}, redirect:'error', signal,
      body:JSON.stringify({ ...baseBody, messages, tools:tools.definitions.map(d=>({type:'function',function:d})), tool_choice:round===rounds?'none':'auto' }) });
    if (!response.ok) { await response.body?.cancel(); throw new Error('The local model could not use the structured tool connection (HTTP ' + response.status + '). Turn Tools off for a text-only reply.'); }
    let buffer = '', text = '', bytes = 0, finish = null, done = false;
    const calls = new Map(), decoder = new TextDecoder();
    const parse = function*(record) {
      const raw = record.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
      if (!raw) return;
      if (raw === '[DONE]') { done = true; return; }
      const item = JSON.parse(raw); if (item.error) throw new Error('The local model reported a tool-stream error.');
      metrics?.observe(item);
      const choice = item.choices?.[0]; if (!choice) return;
      if (choice.finish_reason) finish = choice.finish_reason;
      const delta = choice.delta || {};
      if (typeof delta.content === 'string' && delta.content) {
        total += Buffer.byteLength(delta.content); if (total > maxResponseBytes) throw new Error('Reply exceeded its output limit.');
        text += delta.content; yield { text:delta.content };
      }
      for (const fragment of delta.tool_calls || []) {
        if (!Number.isInteger(fragment.index) || fragment.index < 0 || fragment.index >= 8) throw new Error('Invalid tool call index.');
        const call = calls.get(fragment.index) || { id:'', type:'function', function:{name:'',arguments:''} };
        if (fragment.type && fragment.type !== 'function') throw new Error('Unsupported local tool type.');
        if (fragment.id) call.id += fragment.id;
        if (fragment.function?.name) call.function.name += fragment.function.name;
        if (fragment.function?.arguments) call.function.arguments += fragment.function.arguments;
        if (call.id.length > 200 || call.function.name.length > 100 || call.function.arguments.length > 12000) throw new Error('Tool request exceeded its limits.');
        calls.set(fragment.index,call);
      }
    };
    for await (const chunk of response.body) {
      bytes += chunk.length; if (bytes > maxResponseBytes*2) throw new Error('Model stream exceeded its size limit.');
      buffer += decoder.decode(chunk,{stream:true}); const records = buffer.split(/\r?\n\r?\n/); buffer=records.pop();
      for (const record of records) yield* parse(record);
    }
    buffer += decoder.decode(); if (buffer.trim()) yield* parse(buffer);
    if (!done && !finish) throw new Error('The tool stream ended before completion.');
    if (!calls.size) { if (!text.trim()) throw new Error('The model returned no text reply.'); return finish; }
    if (finish !== 'tool_calls' || round === rounds) throw new Error('Incomplete tool request or tool-round limit reached. No partial call was executed.');
    const requested = [...calls.entries()].sort(([a],[b])=>a-b).map(([,call])=>call);
    messages.push({role:'assistant',content:text||null,tool_calls:requested});
    for (const call of requested) {
      let args; try { args = JSON.parse(call.function.arguments); } catch { throw new Error('The model returned malformed tool arguments.'); }
      const result = await tools.invoke(call.function.name,args,call.id);
      messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)});
    }
    if (text) yield {text:'\n\n'};
  }
}
