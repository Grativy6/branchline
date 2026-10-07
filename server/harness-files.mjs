import crypto from 'node:crypto';
import { findHarness } from '../public/harness-catalog.js';
import { HARNESS_PROFILE, COAT_PROFILE, HARNESS_LIMITS, exactFields, checkHarnessContent, harnessDocument } from '../public/harness-format.js';
import { pocketContent } from '../public/coat-pockets.js';

export function previewHarnessImport(file) {
  if (!exactFields(file, ['name', 'base64']) || typeof file.name !== 'string' || file.name.length > 200 || !/\.(json|md|txt)$/i.test(file.name) || /[\\/\u0000-\u001f]/u.test(file.name)) throw new Error('Choose a local .json, .md, or .txt Coat file.');
  if (typeof file.base64 !== 'string' || file.base64.length > Math.ceil(HARNESS_LIMITS.fileBytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64)) throw new Error('Coat imports must be at most 64 KiB.');
  const bytes = Buffer.from(file.base64, 'base64');
  if (!bytes.length || bytes.length > HARNESS_LIMITS.fileBytes || bytes.toString('base64') !== file.base64) throw new Error('The selected Coat file is empty, too large, or unreadable.');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('Choose a UTF-8 text file. The selected file could not be decoded.'); }
  let content;
  if (/\.json$/i.test(file.name)) {
    let doc; try { doc = JSON.parse(text); } catch { throw new Error('The Coat JSON could not be read.'); }
    const legacy = doc?.profile === HARNESS_PROFILE;
    if (!exactFields(doc, legacy ? ['profile', 'name', 'description', 'instructions'] : ['profile', 'name', 'description', 'instructions', 'pockets'])
      || !legacy && (doc?.profile !== COAT_PROFILE || !Object.hasOwn(doc, 'pockets')))
      throw new Error('Unsupported Coat format. Use branchline.coat/1 with pocket preferences, or the older branchline.harness/1 instruction format.');
    content = { name: doc.name, description: doc.description, instructions: doc.instructions, ...pocketContent(doc) };
    // An empty built-in export is a valid draft, although custom saves need text.
    checkHarnessContent(content, { allowEmpty: true });
  } else {
    content = { name: file.name.replace(/\.(md|txt)$/i, '').trim().slice(0, HARNESS_LIMITS.name) || 'Imported Coat', description: '', instructions: text };
    checkHarnessContent(content, { allowEmpty: true });
  }
  return { content, source: { kind: 'selected_local_file', filename: file.name, sha256: crypto.createHash('sha256').update(bytes).digest('hex') } };
}

export function exportHarness(state, ref, format = 'json') {
  const preset = findHarness(ref, state);
  if (!preset) throw new Error('The selected Coat version is unavailable.');
  if (!['json', 'md'].includes(format)) throw new Error('Choose JSON or Markdown export.');
  return {
    text: format === 'json' ? JSON.stringify(harnessDocument(preset), null, 2) + '\n' : preset.instructions,
    type: format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8',
    filename: `branchline-coat-${preset.id}-v${preset.version}.${format}`,
  };
}
