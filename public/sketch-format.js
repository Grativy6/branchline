export const SKETCH_PROFILE = 'branchline.sketch-book/1';
export const SKETCH_BYTES = 128 * 1024;
export const SKETCH_STAGES = Object.freeze({ ideas: 'Ideas', 'in-process': 'In-process', schematics: 'Schematics' });
export const sketchHead = sketch => sketch?.revisions.at(-1) ?? null;
export const sketchExcerpt = text => text.replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim().slice(0, 240);
export const sketchDestination = model => ({ id: model.id, runtime: model.runtime ?? 'compatible', baseUrl: model.baseUrl, model: model.model });
export const sameSketchDestination = (a, b) => !!a && !!b && ['id','runtime','baseUrl','model'].every(k => a[k] === b[k]);
export function checkSketchContent({ title, text, stage }) {
  if (typeof title !== 'string' || !title.trim() || title.length > 200) throw new Error('Give the sketch a title up to 200 characters.');
  if (!Object.hasOwn(SKETCH_STAGES, stage)) throw new Error('Choose Ideas, In-process or Schematics.');
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > SKETCH_BYTES || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw new Error('Sketches hold up to 128 KiB of readable text.');
}
export function checkSketchDraft(draft) {
  if (draft === null) return;
  const keys = ['id','baseRevisionId','originChatId','sourceMessageId','title','text','stage','requestId'];
  if (!draft || Object.keys(draft).length !== keys.length || !keys.every(k => Object.hasOwn(draft,k))) throw new Error('Invalid unfinished sketch.');
  for (const k of ['id','baseRevisionId','originChatId','sourceMessageId']) if (draft[k] !== null && !/^[A-Za-z0-9_-]{1,120}$/.test(draft[k])) throw new Error('Invalid sketch reference.');
  if (typeof draft.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(draft.requestId)) throw new Error('Invalid sketch request.');
  checkSketchContent({ ...draft, title: draft.title || 'Untitled sketch' });
}
