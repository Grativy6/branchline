export function validSettingsSize(value) {
  return value === null || value && !Array.isArray(value) && Object.keys(value).sort().join() === 'height,width'
    && ['width', 'height'].every(k => Number.isSafeInteger(value[k]) && value[k] >= 160 && value[k] <= 16384);
}

export function createSettingsSize({ dialog, getPreference, save, onError, label = 'Settings', defaultWidth = 760, defaultHeight = 650 }) {
  let preferred, initialized = false, grip, reset, drag, chain = Promise.resolve();
  const scale = () => dialog.getBoundingClientRect().width / parseFloat(getComputedStyle(dialog).width) || 1;
  const available = () => ({ width: innerWidth / scale() - 24, height: innerHeight / scale() - 24 });
  const fit = () => {
    if (!grip) return;
    const room = available();
    const width = Math.min(preferred?.width ?? defaultWidth, Math.max(1, room.width));
    const height = Math.min(preferred?.height ?? defaultHeight, Math.max(1, room.height));
    dialog.style.width = width + 'px'; dialog.style.height = height + 'px';
    grip.setAttribute('aria-label', `Resize ${label}, ${Math.round(width)} by ${Math.round(height)} pixels. Drag or use arrow keys.`);
  };
  const persist = () => {
    const value = preferred && { ...preferred };
    chain = chain.catch(() => {}).then(() => save(value)).catch(error => { onError(label + ' size could not be saved: ' + error.message); throw error; });
    void chain.catch(() => {});
  };
  const size = (width, height) => {
    const room = available();
    preferred = { width: Math.round(Math.max(Math.min(360, room.width), Math.min(width, room.width))),
      height: Math.round(Math.max(Math.min(260, room.height), Math.min(height, room.height))) };
    // Tiny viewports are fitted transiently; never persist invalid geometry.
    preferred.width = Math.max(160, preferred.width); preferred.height = Math.max(160, preferred.height);
    fit();
  };
  const detach = () => {
    if (drag) { drag = null; persist(); }
    grip?.remove(); reset?.remove(); grip = reset = null;
    window.removeEventListener('resize', fit);
    dialog.style.removeProperty('width'); dialog.style.removeProperty('height');
  };
  return {
    flush: () => chain,
    detach,
    attach() {
      if (!initialized) { const saved = getPreference(); preferred = validSettingsSize(saved) ? saved : null; initialized = true; }
      grip = document.createElement('button'); grip.type = 'button'; grip.className = 'settings-resize'; grip.textContent = '⤡';
      grip.title = 'Drag to resize · arrow keys resize · Shift for smaller steps';
      reset = document.createElement('button'); reset.type = 'button'; reset.className = 'text-button settings-size-reset'; reset.textContent = 'Reset size';
      reset.onclick = () => { preferred = null; fit(); persist(); };
      dialog.querySelector('.dialog-header').insertBefore(reset, dialog.querySelector('[data-action="close-dialog"], [data-sketch-action="close-book"]'));
      dialog.append(grip);
      grip.onpointerdown = event => {
        if (event.button !== 0) return;
        event.preventDefault(); grip.focus(); grip.setPointerCapture(event.pointerId);
        const box = dialog.getBoundingClientRect(), zoom = scale(); drag = { x: event.clientX, y: event.clientY, width: box.width / zoom, height: box.height / zoom, zoom };
      };
      grip.onpointermove = event => { if (drag) size(drag.width + 2 * (event.clientX - drag.x) / drag.zoom, drag.height + 2 * (event.clientY - drag.y) / drag.zoom); };
      const finish = () => { if (drag) { drag = null; persist(); } };
      grip.onpointerup = finish; grip.onpointercancel = finish; grip.onlostpointercapture = finish;
      grip.onkeydown = event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); const box = dialog.getBoundingClientRect(), step = event.shiftKey ? 8 : 32;
        size(box.width / scale() + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
          box.height / scale() + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)); persist();
      };
      window.addEventListener('resize', fit); fit();
    },
  };
}
