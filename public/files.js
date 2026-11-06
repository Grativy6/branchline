import { resourceSettings } from "./resource-settings.js";

export function createFilePicker({ selection, changed, reportError, getState = () => null, command }) {
  const pending = new Map();
  const copies=new Map(),consumed=new Map();
  const sketch=chatId=>{const p=getState()?.sketchBook?.pending[chatId];return p&&consumed.get(chatId)!==p.transferId?p:null;};
  const get=chatId=>{
    const p=sketch(chatId);if(!p)return pending.get(chatId);
    if(copies.get(chatId)?.transferId!==p.transferId){const bytes=new TextEncoder().encode(p.text);copies.set(chatId,{name:`sketch-${p.sketchId}.md`,base64:btoa(Array.from({length:Math.ceil(bytes.length/8192)},(_,i)=>String.fromCharCode(...bytes.subarray(i*8192,(i+1)*8192))).join('')),size:bytes.length,transferId:p.transferId,title:p.title});}
    return copies.get(chatId);
  };
  const bar = document.getElementById('attached-file');
  async function addFile(file, chatId) {
    if (!file || !chatId) return;
    if (sketch(chatId)) throw new Error('Send or remove the selected Sketch before attaching another text file.');
    const state = getState(), chat = state?.chats.find(c => c.id === chatId);
    const root = state?.roots.find(r => r.id === chat?.rootId);
    if (!chat || !root) throw new Error('Choose a conversation for this file.');
    const previous = pending.get(chatId), loading = { name: file.name, loading: true };
    pending.set(chatId, loading); changed();
    try {
      if(/\.(pdf|docx)$/i.test(file.name)){
        if(!file.size||file.size>10*1024*1024)throw new Error('Choose a PDF or DOCX up to 10 MiB.');
        const raw=new Uint8Array(await file.arrayBuffer()),base64=btoa(Array.from({length:Math.ceil(raw.length/8192)},(_,i)=>String.fromCharCode(...raw.subarray(i*8192,(i+1)*8192))).join(''));
        const {api}=await import('./api.js');const prepared=await api.prepareDocument({chatId,name:file.name,base64});if(pending.get(chatId)===loading)pending.set(chatId,prepared);return;
      }
      const limit = resourceSettings(root).fileBytes;
      if (!file.size || file.size > limit) throw new Error("Choose a nonempty text file up to " + limit / 1024 + " KiB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { throw new Error('Choose UTF-8 text, such as .txt, .md or source code. PDF and Word files are not supported in this preview.'); }
      if (!text.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw new Error('This file does not contain readable UTF-8 text.');
      if (pending.get(chatId) === loading) pending.set(chatId, { name: file.name, base64: btoa(Array.from({length:Math.ceil(bytes.length/8192)},(_,i)=>String.fromCharCode(...bytes.subarray(i*8192,(i+1)*8192))).join('')), size: bytes.length });
    } catch (error) {
      if (pending.get(chatId) === loading) { if (previous) pending.set(chatId, previous); else pending.delete(chatId); }
      throw error;
    } finally { changed(); }
  }
  document.getElementById('remove-file').addEventListener('click', async () => { const chatId=selection().chat?.id,p=sketch(chatId);try{if(p)await command('sketch.pending.remove',{chatId,transferId:p.transferId});else pending.delete(chatId);changed();}catch(err){reportError(err.message);} });
  return {
    pending,
    get,
    addFile,
    get busy() { return [...pending.values()].some(value => value.loading); },
    clear: (chatId, item) => { if(item?.transferId)consumed.set(chatId,item.transferId);else if (pending.get(chatId) === item) pending.delete(chatId); },
    render(root, chat, busy) {
      const file = get(chat?.id);
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
