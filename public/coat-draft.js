import { HARNESS_LIMITS, exactFields } from './harness-format.js';
import { checkPockets } from './coat-pockets.js';

// Unfinished editing material. No saved Coat, selection, or permission is made here.
export function validateCoatDraft(draft) {
  if (draft === null) return;
  const fail = () => { throw new Error('Invalid unfinished Coat draft.'); };
  const text = (value, limit) => typeof value === 'string' && value.length <= limit;
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
  if (!exactFields(draft, ['content','pocketsCustomized','branch','seat','id','baseVersion','importFile'])
      || !exactFields(draft.content, ['name','description','instructions','pockets'])) fail();
  for (const field of ['name','description','instructions']) if (!text(draft.content[field], HARNESS_LIMITS[field])) fail();
  if (draft.content.pockets !== undefined) checkPockets(draft.content.pockets);
  if (typeof draft.pocketsCustomized !== 'boolean' || !['shared','personal','visiting'].includes(draft.seat)) fail();
  if (draft.branch !== null && (!exactFields(draft.branch, ['chatId','title','baseRevisionId'])
      || !id(draft.branch.chatId) || !text(draft.branch.title, 200)
      || (draft.branch.baseRevisionId !== null && !id(draft.branch.baseRevisionId)))) fail();
  if (draft.id !== undefined && (!id(draft.id) || !Number.isSafeInteger(draft.baseVersion) || draft.baseVersion < 1)) fail();
  if (draft.importFile !== undefined && (!exactFields(draft.importFile, ['name','base64'])
      || !text(draft.importFile.name, 255) || !text(draft.importFile.base64, 90000)
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(draft.importFile.base64))) fail();
}
