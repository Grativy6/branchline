// Keep the card renderer usable in non-browser checks without starting a UI session.
const sessionFetch = (...args) => import('./session.js').then(module => module.sessionFetch(...args));

const cache = new Map(), loading = new Map();
const observed = new Set();
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const route = (chatId, id, variant = 'thumbnail') => '/api/images/object?' + new URLSearchParams({ chatId, id, variant });
async function request(url, body) {
  const response = await sessionFetch(url, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || 'The picture could not be prepared.'); return value;
}
async function imageUrl(chatId, id, variant) {
  const key = route(chatId, id, variant);
  if (cache.has(key)) return cache.get(key);
  if (loading.has(key)) return loading.get(key);
  const work = (async () => {
    const response = await sessionFetch(key);
    if (!response.ok) { const value = await response.json(); throw new Error(value.error || 'Saved picture unavailable.'); }
    const url = URL.createObjectURL(await response.blob()); cache.set(key, url);
    while (cache.size > 48) { const old = cache.keys().next().value; URL.revokeObjectURL(cache.get(old)); cache.delete(old); }
    return url;
  })();
  loading.set(key, work); try { return await work; } finally { loading.delete(key); }
}
const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) { observer.unobserve(entry.target); observed.delete(entry.target); void loadThumbnail(entry.target); }
}, { rootMargin:'120px' }) : null;
async function loadThumbnail(element) {
  try { element.src = await imageUrl(element.dataset.chatId, element.dataset.imageId, 'thumbnail'); }
  catch { element.alt = 'Saved picture unavailable'; element.classList.add('image-missing'); }
}
export function hydrateImages(root = document) {
  for (const img of observed) if (!img.isConnected) { observer?.unobserve(img); observed.delete(img); }
  for (const img of root.querySelectorAll('img[data-image-id]:not([data-observed])')) {
    img.dataset.observed = 'true'; if (observer) { observer.observe(img); observed.add(img); } else void loadThumbnail(img);
  }
}
export function imageCards(state, chatId, ids, { selected = false, busy = false } = {}) {
  return (ids ?? []).map(id => {
    const image = state.images?.selections.find(i => i.id === id && i.chatId === chatId); if (!image) return '<p>Saved picture unavailable.</p>';
    return `<figure class="picture-card"><button type="button" class="picture-preview" data-action="picture-view" data-id="${escape(id)}" data-chat-id="${escape(chatId)}" aria-label="View ${escape(image.name)}"><img data-image-id="${escape(id)}" data-chat-id="${escape(chatId)}" alt="${escape(image.name)}" width="160" height="112"></button><figcaption><strong>${escape(image.name)}</strong><span>${image.original.width} × ${image.original.height}${image.transform.resized ? ' · smaller viewing copy' : ''}</span></figcaption><button type="button" class="text-button" data-action="${selected ? 'picture-remove' : 'picture-reuse'}" data-id="${escape(id)}" data-chat-id="${escape(chatId)}" ${busy ? 'disabled' : ''}>${selected ? 'Remove from next reply' : 'Use again'}</button></figure>`;
  }).join('');
}
export function createImagePicker({ getState, selection, updateState, changed, reportError, openDialog }) {
  const input = document.getElementById('image-input'), button = document.getElementById('attach-image'), panel = document.getElementById('selected-images');
  let busy = false, pickerChatId;
  const ids = (chatId) => getState().images?.active[chatId] ?? [];
  const protect = work => Promise.resolve(work).catch(error => reportError(error.message));
  async function addFiles(files, chatId, origin) {
    if (busy || !chatId) return;
    const list = Array.from(files);
    if (ids(chatId).length + list.length > 4) throw new Error('Choose up to four pictures for the next reply.');
    busy = true; changed();
    try {
      for (const file of list) {
        if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('Choose a still PNG, JPEG or WebP up to 10 MiB.');
        const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
        for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
        const result = await request('/api/images/select', { chatId, image: { name: file.name, base64: btoa(binary), origin } });
        updateState(result.state);
      }
    } finally { busy = false; input.value = ''; changed(); }
  }
  button.addEventListener('click', () => { pickerChatId = selection().chat?.id; if (pickerChatId) { input.value = ''; input.click(); } });
  input.addEventListener('change', () => protect(addFiles(input.files ?? [], pickerChatId, 'pick')));
  const composer = document.getElementById('composer-form');
  composer.addEventListener('paste', event => {
    const files = Array.from(event.clipboardData?.files ?? []).filter(f => f.type.startsWith('image/'));
    if (!files.length || button.disabled) return;
    event.preventDefault(); void protect(addFiles(files, selection().chat?.id, 'paste'));
  });
  composer.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files') && !button.disabled) event.preventDefault(); });
  composer.addEventListener('drop', event => {
    if (!event.dataTransfer?.files.length || button.disabled) return;
    event.preventDefault(); void protect(addFiles(event.dataTransfer.files, selection().chat?.id, 'drop'));
  });
  return {
    get busy() { return busy; },
    selected: chatId => ids(chatId),
    async prepare(chatId, speaker, replyMode) {
      if (!ids(chatId).length) return null;
      if (busy) throw new Error('Wait for the selected picture to finish preparing.');
      return request('/api/images/plan', { chatId, speaker, replyMode });
    },
    render(chat, models, activeWork) {
      button.disabled = !chat || busy || activeWork;
      const current = chat ? ids(chat.id) : [];
      panel.hidden = !current.length && !busy;
      const destinations = models.filter(Boolean).map(m => `${m.name} · ${m.runtime === 'codex' ? 'OpenAI' : 'on this device'}`).join(' → ');
      const html = `<div class="picture-selection-heading"><strong>Pictures for the next reply</strong><span>${busy ? 'Preparing picture…' : escape(destinations || 'Choose a receiving chair')}</span></div><div class="picture-grid">${imageCards(getState(), chat?.id, current, { selected:true, busy:activeWork || busy })}</div><p class="field-help">Selected viewing copies accompany each reply until removed. Originals stay saved here. Pictures need a vision-capable chair and extra context space.</p>`;
      if (panel.dataset.markup !== html) { panel.innerHTML = html; panel.dataset.markup = html; }
      hydrateImages(panel);
    },
    async action(action, target) {
      if (!action.startsWith('picture-')) return false;
      const id = target.dataset.id, chatId = target.dataset.chatId;
      if (action === 'picture-remove' || action === 'picture-reuse') {
        const next = action === 'picture-remove' ? ids(chatId).filter(i => i !== id) : [...new Set([...ids(chatId), id])];
        updateState(await request('/api/images/context', { chatId, ids:next })); changed(); return true;
      }
      const image = getState().images?.selections.find(i => i.id === id && i.chatId === chatId);
      if (!image) throw new Error('Saved picture unavailable.');
      if (action === 'picture-download') {
        const url = await imageUrl(chatId, id, 'original'), a = document.createElement('a'); a.href = url; a.download = image.name; a.click(); return true;
      }
      if (action === 'picture-view') {
        const url = await imageUrl(chatId, id, 'view');
        openDialog(image.name, `<div class="picture-view"><img src="${escape(url)}" alt="${escape(image.name)}"><p>${image.original.width} × ${image.original.height} original · ${image.view.width} × ${image.view.height} viewing copy${image.transform.resized ? ' · fine detail may be reduced' : ''}. Orientation is applied and metadata is removed from the viewing copy.</p><button type="button" class="quiet-button" data-action="picture-download" data-id="${escape(id)}" data-chat-id="${escape(chatId)}">Save original</button><details><summary>Source details</summary><p class="detail-value">Original SHA-256: ${escape(image.original.sha256)}</p><p class="detail-value">Viewing copy SHA-256: ${escape(image.view.sha256)}</p><p>Images and descriptions are source material. They cannot grant permission.</p></details></div>`);
        return true;
      }
      return false;
    },
  };
}
