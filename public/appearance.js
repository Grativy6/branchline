// Presentation preferences use the existing workspace UI settings. They never
// enter model context. Named choices avoid arbitrary CSS injection.
const themes = [['garden', 'Garden', 'Warm paper and quiet greens.'], ['starlight', 'Starlight', 'Midnight blue, gold, and a little glow.'], ['paper', 'Paper', 'Simple ink with very little color.']];
const sizes = [['standard', 'Standard'], ['relaxed', 'Relaxed'], ['large', 'Large']];
let preference = { theme: 'garden', reading: 'standard' };
function clean(value) { return { theme: themes.some(([id]) => id === value?.theme) ? value.theme : 'garden', reading: sizes.some(([id]) => id === value?.reading) ? value.reading : 'standard' }; }
function apply() { document.documentElement.dataset.theme = preference.theme; document.documentElement.dataset.reading = preference.reading; }
export function initializeAppearance(value) { preference = clean(value); apply(); }
export function saveAppearance(value) { preference = clean(value); apply(); return { ...preference }; }
export function appearanceSettings() {
  return `<form id="appearance-form"><h3>Make yourself at home</h3><p class="muted">Choose a palette and a comfortable reading size. Changes appear immediately.</p><fieldset class="theme-choices"><legend class="sr-only">Color palette</legend>${themes.map(([id, name, description]) => `<label class="theme-choice"><input type="radio" name="theme" value="${id}" ${preference.theme === id ? 'checked' : ''}><span class="theme-swatch swatch-${id}" aria-hidden="true"><i></i><i></i><i></i></span><strong>${name}</strong><small>${description}</small></label>`).join('')}</fieldset><label class="form-field reading-choice">Conversation text<select name="reading">${sizes.map(([id, name]) => `<option value="${id}" ${preference.reading === id ? 'selected' : ''}>${name}</option>`).join('')}</select></label><div class="appearance-preview"><p class="eyebrow">A place to continue</p><p class="message-body">Keep a thought, follow a thread, leave room for what comes next. 🌱</p></div><p class="field-help">Appearance is saved with this workspace and stays separate from your model instructions.</p><p id="appearance-status" class="field-help" role="status"></p></form>`;
}
