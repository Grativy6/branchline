import { checkPockets, pocketContent } from './coat-pockets.js';
// Portable guidance and preferences. Connections, credentials and grants stay local.
export const HARNESS_PROFILE = 'branchline.harness/1';
export const COAT_PROFILE = 'branchline.coat/1';
export const HARNESS_LIMITS = Object.freeze({ name: 120, description: 800, instructions: 24000, fileBytes: 65536 });
export const exactFields = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
const readable = text => typeof text === 'string' && text.isWellFormed() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text);

export function harnessDocument(content) {
  return { profile: Object.hasOwn(content, 'pockets') ? COAT_PROFILE : HARNESS_PROFILE, name: content.name, description: content.description, instructions: content.instructions, ...pocketContent(content) };
}

export function checkHarnessContent(content, { allowEmpty = false } = {}) {
  if (!exactFields(content, ['name', 'description', 'instructions', 'pockets'])) throw new Error('A Coat contains only a name, description, instructions, and pocket preferences.');
  if (Object.hasOwn(content, 'pockets')) checkPockets(content.pockets);
  for (const field of ['name', 'description', 'instructions']) {
    if (!readable(content[field]) || content[field].length > HARNESS_LIMITS[field]) throw new Error(`Coat ${field} must be plain text, up to ${HARNESS_LIMITS[field].toLocaleString('en-US')} characters.`);
  }
  if (!content.name.trim() || content.name !== content.name.trim() || /[\r\n\t]/u.test(content.name)) throw new Error('Give the Coat a name on one line.');
  if (!allowEmpty && !content.instructions.trim() && !Object.hasOwn(content, 'pockets')) throw new Error('Write some instructions or choose pockets before saving the Coat.');
  if (new TextEncoder().encode(JSON.stringify(harnessDocument(content), null, 2) + '\n').length > HARNESS_LIMITS.fileBytes) throw new Error('This Coat is too large for the 64 KiB portable format. Shorten its instructions before saving.');
  return content;
}
