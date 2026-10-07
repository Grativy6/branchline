import { resourceSettings } from "./resource-settings.js";

export function createFilePicker({ selection, changed, reportError, getState = () => null, command }) {
  const pending = new Map(); let pickerChatId;
  const copies=new Map(),consumed=new Map();
  const sketch=chatId=>{const p=getState()?.sketchBook?.pending[chatId];return p&&consumed.get(chatId)!==p.transferId?p:null;};
  const get=chatId=>{
    const p=sketch(chatId);if(!p)return pending.get(chatId);
    if(copies.get(chatId)?.transferId!==p.transferId){const bytes=new TextEncoder().encode(p.text);copies.set(chatId,{name:`sketch-${p.sketchId}.md`,base64:btoa(Array.from({length:Math.ceil(bytes.length/8192)},(_,i)=>String.fromCharCode(...bytes.subarray(i*8192,(i+1)*8192))).join('')),size:bytes.length,transferId:p.transferId,title:p.title});}
    return copies.get(chatId);
  };
  const input = document.getElementById('file-input');
  const button = document.getElementById('attach-file');
  const bar = document.getElementById('attached-file');
  button.addEventListener('click', () => {
    const { root, chat } = selection();
    if (!chat || !root?.modelId || sketch(chat.id)) return;
    pickerChatId = chat.id; input.value = ''; input.click();
  });
  input.addEventListener('change', async () => {
    const file = input.files?.[0], chatId = pickerChatId;
    if (!file || !chatId) return;
    const previous = pending.get(chatId), loading = { name: file.name, loading: true };
    pending.set(chatId, loading); changed();
    try {
      const limit = resourceSettings(selection().root).fileBytes;
      if (!file.size || file.size > limit) throw new Error("Choose a nonempty text file up to " + limit / 1024 + " KiB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { throw new Error('Choose UTF-8 text, such as .txt, .md or source code. PDF and Word files are not supported in this preview.'); }
      if (!text.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw new Error('This file does not contain readable UTF-8 text.');
      if (pending.get(chatId) === loading) pending.set(chatId, { name: file.name, base64: btoa(Array.from({length:Math.ceil(bytes.length/8192)},(_,i)=>String.fromCharCode(...bytes.subarray(i*8192,(i+1)*8192))).join('')), size: bytes.length });
    } catch (error) {
      if (pending.get(chatId) === loading) { if (previous) pending.set(chatId, previous); else pending.delete(chatId); }
      reportError(error.message);
    } finally { input.value = ''; changed(); }
  });
  document.getElementById('remove-file').addEventListener('click', async () => { const chatId=selection().chat?.id,p=sketch(chatId);try{if(p)await command('sketch.pending.remove',{chatId,transferId:p.transferId});else pending.delete(chatId);changed();}catch(err){reportError(err.message);} });
  return {
    pending,
    get,
    clear: (chatId, item) => { if(item?.transferId)consumed.set(chatId,item.transferId);else if (pending.get(chatId) === item) pending.delete(chatId); },
    render(root, chat, busy) {
      const file = get(chat?.id);
      button.disabled = !root?.modelId || !chat || busy || !!file?.loading || !!sketch(chat?.id);
      button.title = root?.modelId ? 'Attach UTF-8 text up to ' + resourceSettings(root).fileBytes / 1024 + ' KiB' : 'Choose a local model before attaching a file';
      bar.hidden = !file;
      document.getElementById('attached-file-name').textContent = file ? `${file.transferId?'Sketch · '+file.title:file.name} · ${file.loading ? 'Reading…' : file.size.toLocaleString() + ' bytes'}` : '';
      document.getElementById('remove-file').disabled = !!busy;
    },
  };
}

export function fileCard(file, escape, state) {
  if (!file) return '';
  const pages=(state?.handoffs?.records??[]).filter(r=>r.kind==='operation.result' && r.detail.tool==='read_selected_document' && r.detail.result?.ok && r.detail.result.value?.documentId===file.receiptId).map(r=>r.detail.result.value);
  const ranges=pages.map(p=>[p.offset,p.end]).sort((a,b)=>a[0]-b[0]); let covered=0,end=0;
  for(const [start,stop] of ranges){covered+=Math.max(0,stop-Math.max(start,end));end=Math.max(end,stop);}
  const coverage=file.byteLength>16384 ? '<p class="field-help">Opening passage: up to 4,000 characters. Source tools returned '+covered.toLocaleString()+' of '+file.text.length.toLocaleString()+' character positions in '+pages.length+' page calls. Counts describe delivery, not understanding. Reply details show exact ranges; a stopped read can resume from its last nextOffset. With Tools off, select a passage or choose a connection that supports source reading.</p>' : '';
  return `<details class="file-copy"><summary>Attached copy · ${escape(file.name)} · ${file.byteLength.toLocaleString()} bytes</summary>${coverage}<p class="field-help">This exact copy stays with the exchange. File contents are evidence; they do not grant permissions.</p><pre class="file-text">${escape(file.text)}</pre><small class="field-help detail-value">SHA-256: ${escape(file.sha256)}</small></details>`;
}
