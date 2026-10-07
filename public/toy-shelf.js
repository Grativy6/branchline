// Presentation choices only. Executable actions come from this fixed catalog.
export const SHELF_HEIGHT = { default: 240, min: 180, max: 1200 };
export const SHELF_APPS = [
  { id: 'desk', label: 'New desk', action: 'home-new-root', mode: 'personal', className: 'home-personal-button', help: 'A place for related conversations.' },
  { id: 'peaches', label: 'Book of PEACHES', action: 'peaches-open', className: 'toy-peaches', help: 'Book of PEACHES · coming later.' }
];
const ids = SHELF_APPS.map(app => app.id);
const legacyIds = ['desk', 'tend', 'fs']; // Read old preferences without restoring retired entries.
export function validToyShelf(value) {
  return value === null || !!value && !Array.isArray(value) && typeof value === 'object'
    && Object.keys(value).sort().join() === 'height,hidden,order'
    && (value.height === null || Number.isSafeInteger(value.height) && value.height >= SHELF_HEIGHT.min && value.height <= SHELF_HEIGHT.max)
    && Array.isArray(value.order) && [ids, ['desk'], legacyIds].some(allowed => value.order.length === allowed.length && new Set(value.order).size === allowed.length && value.order.every(id => allowed.includes(id)))
    && Array.isArray(value.hidden) && new Set(value.hidden).size === value.hidden.length && value.hidden.every(id => value.order.includes(id));
}
export function shelfPreferences(value) {
  return value && validToyShelf(value) ? { height: value.height, order: [...value.order.filter(id => ids.includes(id)), ...ids.filter(id => !value.order.includes(id))], hidden: value.hidden.filter(id => ids.includes(id)) } : { height: null, order: [...ids], hidden: [] };
}
const icon = () => '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 21h34v6H7zM11 27v13m26-13v13M17 11h14v10H17zM24 4v4m-3-2h6"/><path d="M15 32h18" opacity=".5"/></svg>';

export function toyShelf(value) {
  const prefs = shelfPreferences(value), apps = prefs.order.filter(id => !prefs.hidden.includes(id)).map(id => SHELF_APPS.find(app => app.id === id));
  return `<section class="toy-shelf-section" aria-labelledby="toy-shelf-heading"><h2 id="toy-shelf-heading" class="home-section-title">Toy Shelf</h2>
    <div class="toy-shelf"><div class="toy-shelf-content"><div class="toy-shelf-side"><img class="toy-shelf-art" src="/assets/toy-shelf.svg" alt="A warm wooden shelf with small toy blocks, a framed sparkle and a resting peach"><button type="button" class="quiet-button" data-action="shelf-manage">Manage Shelves</button></div>
    <div class="toy-shelf-scroll" tabindex="0" role="region" aria-label="Shelf apps"><div class="toy-shelf-grid">${apps.map(app => `<button type="button" class="toy-tile ${app.className}" data-action="${app.action}" data-shelf-id="${app.id}" title="${app.help}"><span class="toy-tile-icon">${app.id === 'peaches' ? '<img src="/assets/book-of-peaches.svg" alt="">' : icon()}</span><span>${app.label}</span></button>`).join('')}${apps.length ? '' : '<p class="toy-shelf-empty">Room for something new.<br>Choose what to show in Manage Shelves.</p>'}<span class="toy-slot" aria-hidden="true"></span></div></div></div>
    <div class="toy-shelf-footer"><button class="toy-shelf-grip" type="button" aria-label="Resize Toy Shelf height" title="Drag to resize · Up/Down to adjust height"><span aria-hidden="true">═</span></button></div></div></section>`;
}
export function shelfSettings(value) {
  const prefs = shelfPreferences(value);
  return `<form id="toy-shelf-settings"><p>Choose the little starting places on your Home shelf.</p><div class="shelf-arrangement">${prefs.order.map(id => {
    const app = SHELF_APPS.find(a => a.id === id);
    return `<div class="shelf-setting-row" data-shelf-id="${id}"><label class="check-line"><input type="checkbox" name="${id}" ${prefs.hidden.includes(id) ? '' : 'checked'}> ${app.label}</label><span><button class="quiet-button" type="button" data-action="shelf-up" aria-label="Move ${app.label} up">↑</button><button class="quiet-button" type="button" data-action="shelf-down" aria-label="Move ${app.label} down">↓</button></span></div>`;
  }).join('')}</div><p class="field-help">Hiding an icon leaves your desks and conversations in place. More kinds of apps can find a home here later.</p><div class="dialog-footer"><button type="submit" class="primary-button">Save shelf</button><button type="button" class="quiet-button" data-action="shelf-defaults">Restore default arrangement</button><button type="button" class="quiet-button" data-action="shelf-height-reset">Reset height</button></div><p class="shelf-settings-status" role="status"></p></form>`;
}

export function createToyShelf({ container, getPreference, save, onError }) {
  let element, grip, drag, dirtyHeight, heightSave, timer, chain = Promise.resolve(), failed = false, pending = 0;
  const clamp = (n, max = SHELF_HEIGHT.max) => Math.max(SHELF_HEIGHT.min, Math.min(max, Math.round(n)));
  const scale = () => element?.offsetWidth ? element.getBoundingClientRect().width / element.offsetWidth : 1;
  const limit = () => clamp(innerHeight / (scale() || 1) * .75);
  const preferred = () => dirtyHeight !== undefined ? dirtyHeight : shelfPreferences(getPreference()).height;
  function fit() {
    if (!element?.isConnected) return;
    const height = clamp(preferred() ?? SHELF_HEIGHT.default, limit());
    element.style.height = height + 'px';
    grip.setAttribute('aria-label', 'Resize Toy Shelf height, ' + height + ' pixels');
  }
  function update(patch) {
    pending++;
    chain = chain.catch(() => {}).then(async () => {
      try { await save({ ...shelfPreferences(getPreference()), ...patch }); failed = false; }
      catch (err) { failed = true; throw err; }
      finally { pending--; }
    });
    return chain;
  }
  function persist() {
    clearTimeout(timer);
    if (dirtyHeight === undefined) return chain;
    const captured = dirtyHeight;
    if (heightSave?.value === captured) return heightSave.promise;
    const saving = { value: captured };
    saving.promise = update({ height: captured }).then(() => { if (dirtyHeight === captured) dirtyHeight = undefined; })
      .finally(() => { if (heightSave === saving) heightSave = null; });
    heightSave = saving;
    return saving.promise;
  }
  function finish(event) {
    if (!drag || event && event.pointerId !== drag.id) return;
    const prior = drag; drag = null;
    if (grip?.hasPointerCapture(prior.id)) grip.releasePointerCapture(prior.id);
    void persist().catch(err => onError('Shelf height was not saved: ' + err.message));
  }
  function start(event) {
    if (event.button !== 0 || drag) return;
    clearTimeout(timer);
    drag = { id: event.pointerId, y: event.clientY, height: element.offsetHeight, scale: scale() || 1 };
    grip.setPointerCapture(event.pointerId); event.preventDefault();
  }
  function move(event) {
    if (!drag || drag.id !== event.pointerId) return;
    dirtyHeight = clamp(drag.height + (event.clientY - drag.y) / drag.scale, limit()); fit();
  }
  function key(event) {
    if (!['ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault();
    dirtyHeight = event.key === 'Home' ? null : clamp(element.offsetHeight + (event.key === 'ArrowUp' ? -1 : 1) * (event.shiftKey ? 8 : 24), limit());
    fit(); clearTimeout(timer); timer = setTimeout(() => persist().catch(err => onError('Shelf height was not saved: ' + err.message)), 250);
  }
  function detach() {
    finish();
    if (grip) { for (const [event, fn] of [['pointerdown', start], ['pointermove', move], ['pointerup', finish], ['pointercancel', finish], ['lostpointercapture', finish], ['keydown', key]]) grip.removeEventListener(event, fn); }
    element = grip = null;
  }
  return {
    get dragging() { return !!drag; }, get unsaved() { return dirtyHeight !== undefined || pending > 0 || failed; },
    attach() {
      const next = container.querySelector('.toy-shelf');
      if (next !== element) { detach(); element = next; grip = next?.querySelector('.toy-shelf-grip');
        if (grip) for (const [event, fn] of [['pointerdown', start], ['pointermove', move], ['pointerup', finish], ['pointercancel', finish], ['lostpointercapture', finish], ['keydown', key]]) grip.addEventListener(event, fn);
      }
      fit();
    },
    update, async resetHeight() { dirtyHeight = null; fit(); await persist(); },
    async flush() { finish(); await persist(); },
    resize: fit
  };
}
