import fs from 'node:fs/promises';
import { OPENAI_MODELS, validateOpenAI } from './openai-input.mjs';
import crypto from 'node:crypto';
import { digest } from './integrity.mjs';
import { CODEX_CATALOG, CODEX_CATALOG_SHA256 } from './codex-policy.mjs';
import { resolveSpeaker } from './table.mjs';
import { chairRoster } from '../public/chair-roster.js';
import { activeImageIds, selectedImages, imageReference, imageSelectionRevision } from './images.mjs';

const fail = (ok, message) => { if (!ok) throw new Error('Pictures: ' + message); };
const liveClearances = new WeakSet();
export const MEDIA_PROFILE = 'branchline.direct-image-input/1';
export const mediaReferences = messages => messages.flatMap(m => m.images ?? []);
export function mediaUrl(ref, imageData) {
  fail(ref?.type === 'branchline_image' && /^[a-f0-9]{64}$/.test(ref.sha256) && ref.mimeType === 'image/png'
    && Number.isInteger(ref.width) && ref.width > 0 && ref.width <= 1024 && Number.isInteger(ref.height) && ref.height > 0 && ref.height <= 1024, 'invalid provider image reference.');
  if (imageData === undefined) return 'branchline-image:' + ref.sha256; // Binding plan only; never dispatched.
  const url = imageData.get(ref.sha256);
  fail(typeof url === 'string' && url.startsWith('data:image/png;base64,'), 'the exact selected image bytes are unavailable.');
  const bytes = Buffer.from(url.slice(22), 'base64');
  fail(bytes.length === ref.byteLength && crypto.createHash('sha256').update(bytes).digest('hex') === ref.sha256, 'provider image bytes changed after clearance.');
  return url;
}
export function localImageMessages(messages, imageData) {
  return messages.map(m => {
    if (!m.images?.length) return { role: m.role, content: m.content };
    fail(m.role === 'user', 'pixels cannot be system instructions or an assistant claim.');
    return { role: 'user', content: [{ type: 'text', text: m.content }, ...m.images.map(ref => ({ type: 'image_url', image_url: { url: mediaUrl(ref, imageData) } }))] };
  });
}
export async function imageCapability(model) {
  fail((model.inputFormat ?? 'chat') === 'chat', `${model.name} uses a text-only connection. Choose a vision-capable chair or remove the pictures from the next reply.`);
  if (model.runtime === 'openai') {validateOpenAI(model);fail(OPENAI_MODELS[model.model]?.vision,'this API model has no reviewed image route.');return {profile:MEDIA_PROFILE,route:'openai-responses-image-data-url',source:'reviewed_official_model_profile',loadedTokens:OPENAI_MODELS[model.model].window,imageTokensEach:16384,budgetBasis:'conservative_image_allowance_not_exact_tokenizer_count',destination:'OpenAI API',remote:true};}
  if (model.runtime === 'codex') {
    const bytes = await fs.readFile(CODEX_CATALOG);
    fail(crypto.createHash('sha256').update(bytes).digest('hex') === CODEX_CATALOG_SHA256, 'the reviewed Codex capability catalogue changed.');
    const entry = JSON.parse(bytes).models.find(m => m.slug === model.model);
    fail(entry?.input_modalities?.includes('image'), 'this Codex model has no reviewed image route.');
    return { profile: MEDIA_PROFILE, route: 'codex-image-data-url', source: 'pinned_runtime_schema_and_catalogue', loadedTokens: entry.context_window,
      imageTokensEach: 4096, budgetBasis: 'conservative_image_allowance_not_exact_tokenizer_count', destination: 'OpenAI', remote: true };
  }
  fail(model.runtime === 'lmstudio', 'direct pictures currently support LM Studio vision connections and the reviewed Codex models.');
  const url = new URL(model.baseUrl);
  fail(url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname) && !url.username && !url.password, 'choose a local model connection.');
  url.pathname = '/api/v1/models'; url.search = ''; url.hash = '';
  const response = await fetch(url, { signal: AbortSignal.timeout(3000), redirect: 'error' });
  fail(response.ok, 'the local model capability report is unavailable.');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; fail(size <= 256 * 1024, 'capability report exceeded its bound.'); chunks.push(chunk); }
  const models = JSON.parse(Buffer.concat(chunks).toString()).models;
  const entry = models?.find(m => m.loaded_instances?.some(i => i.id === model.model));
  const instance = entry?.loaded_instances.find(i => i.id === model.model);
  fail(entry?.capabilities?.vision === true, `${model.name} is not loaded with vision support. Your draft and pictures are retained.`);
  const tokens = instance.config?.context_length;
  fail(Number.isInteger(tokens) && tokens >= 2048, 'the loaded image model window is unknown.');
  return { profile: MEDIA_PROFILE, route: 'lmstudio-chat-image-data-url', source: 'loaded_instance_capabilities', loadedTokens: tokens,
    imageTokensEach: 4096, budgetBasis: 'conservative_image_allowance_not_exact_tokenizer_count', destination: model.baseUrl, remote: false };
}

// Plans are short-lived capabilities issued to the paired UI. Neither a source
// image, history record nor a model can manufacture the live clearance below.
export class ImagePlans {
  constructor({ capability = imageCapability } = {}) { this.plans = new Map(); this.capability = capability; }
  invalidateBundledWindow() {
    for (const [id, plan] of this.plans) if (plan.routes.some(route => route.capability?.route === 'bundled-chat-image-data-url')) this.plans.delete(id);
  }
  async prepare(state, { chatId, speaker = null, replyMode = 'single', chairIds = null, baseRevisionId = null }) {
    fail(['single', 'both', 'alternate', 'all'].includes(replyMode), 'unknown reply mode.');
    const images = selectedImages(state, chatId), chat=state.chats.find(c=>c.id===chatId), roster=chairRoster(state,chat);
    fail(images.length, 'choose at least one picture.');
    let chosen;
    if(chairIds!==null){
      fail(roster&&baseRevisionId===roster.revisionId&&Array.isArray(chairIds)&&chairIds.length>0&&chairIds.length<=32&&new Set(chairIds).size===chairIds.length,'the addressed chairs changed. Send again with the current chairs.');
      chosen=chairIds.map(id=>{fail([roster.desk,...roster.visitors].some(c=>c.id===id),'an addressed chair is unavailable.');return resolveSpeaker(state,chatId,id===roster.desk.id?'personal':'visiting',id);});
    }else{
      const first=resolveSpeaker(state,chatId,speaker);chosen=[first];
      if(replyMode==='both')chosen.push(resolveSpeaker(state,chatId,first.selection?.seat==='personal'?'visiting':'personal'));
      if(replyMode==='all')chosen=[roster.desk,...roster.visitors].filter(c=>c.modelId).map(c=>resolveSpeaker(state,chatId,c.id===roster.desk.id?'personal':'visiting',c.id));
    }
    const routes = [];
    for (const choice of chosen) {
      const route={chairId:choice.selection?.chairId??null,modelId:choice.model.id,modelName:choice.model.name,modelHash:digest(choice.model),selectionHash:digest(choice.selection),seat:choice.selection?.seat??null};
      try{route.capability=await this.capability(choice.model,state);}catch(error){route.error=`${choice.selection?.displayName??choice.model.name}: ${error.message}`;}
      routes.push(route);
    }
    fail(routes.some(r=>r.capability),routes.map(r=>r.error).join(' '));
    const id = 'imageplan_' + crypto.randomUUID();
    for (const [key, value] of this.plans) if (value.expires < Date.now()) this.plans.delete(key);
    // At most one current plan per branch; older clicks cannot accumulate grants.
    for (const [key, value] of this.plans) if (value.chatId === chatId) this.plans.delete(key);
    const plan = { id, chatId, ids: images.map(i => i.id), selectionRevision: imageSelectionRevision(state, chatId), imageHash: digest(images.map(imageReference)), routes, expires: Date.now() + 300000, firstExchange: null, uses: new Set() };
    this.plans.set(id, plan);
    return { id, chatId, images: images.map(i => ({ id: i.id, name: i.name, width: i.view.width, height: i.view.height })), routes,
      imageTokenAllowance: images.length * Math.max(...routes.map(r => r.capability?.imageTokensEach??0)), note: 'Only selected PNG viewing copies are sent. Original files stay on this device.' };
  }
  capture(state, input, tasks) {
    const ids=activeImageIds(state,input.chatId);
    if(!ids.length&&!input.imagePlanId)return [];
    const plan=this.plans.get(input.imagePlanId);
    fail(plan&&plan.expires>Date.now()&&plan.chatId===input.chatId&&plan.selectionRevision===imageSelectionRevision(state,input.chatId)&&digest(plan.ids)===digest(ids),'picture selection changed. Your draft and pictures are kept; send again.');
    fail(plan.routes.length===tasks.length&&tasks.every(t=>plan.routes.some(r=>r.chairId===t.chairId&&r.modelHash===digest(t.model)&&r.selectionHash===digest(t.selection))),'the picture recipients changed. Send again with the current chairs.');
    const images=selectedImages(state,input.chatId,plan.ids);
    fail(digest(images.map(imageReference))===plan.imageHash,'selected picture changed.');
    for(const task of tasks){
      const route=plan.routes.find(r=>r.chairId===task.chairId);
      if(route.error){Object.assign(task,{status:'failed',phase:'Picture unavailable',error:route.error,endedAt:new Date().toISOString()});continue;}
      task.input.media={profile:'branchline.chair-image-input/1',preparationId:plan.id,ids:[...plan.ids],imageHash:plan.imageHash,selectionRevision:plan.selectionRevision,...structuredClone(route)};
    }
    return [...plan.ids];
  }
  check(state, body, checked, admission = null) {
    if(admission){
      const task=state.deskWork?.tasks.find(t=>t.id===admission.taskId),media=task?.input.media;
      if(!media)return null;
      fail(media.profile==='branchline.chair-image-input/1'&&media.modelHash===digest(checked.model)&&media.selectionHash===digest(checked.selection),'this chair no longer matches its admitted picture request.');
      const images=selectedImages(state,task.chatId,media.ids);
      fail(digest(images.map(imageReference))===media.imageHash,'an admitted picture changed.');
      return {plan:null,chatId:task.chatId,images,route:media};
    }
    const ids = activeImageIds(state, body.chatId);
    if (!ids.length && !body.imagePlanId) return null;
    const plan = this.plans.get(body.imagePlanId);
    fail(plan && plan.expires > Date.now() && plan.chatId === body.chatId && plan.selectionRevision === imageSelectionRevision(state, body.chatId)
      && (body.followUpOf ? plan.firstExchange === body.followUpOf : digest(plan.ids) === digest(ids)), 'picture selection or sharing route changed. Review the destination and send again.');
    const images = selectedImages(state, body.chatId, plan.ids);
    fail(digest(images.map(imageReference)) === plan.imageHash, 'selected picture changed.');
    const route = plan.routes.find(r => r.modelHash === digest(checked.model) && r.selectionHash === digest(checked.selection));
    fail(route && !plan.uses.has(route.chairId ?? route.seat ?? route.modelId), 'this model destination was not cleared for these pictures.');
    fail(!route.error,route.error);
    fail(body.followUpOf ? plan.firstExchange === body.followUpOf : plan.firstExchange === null, 'picture follow-up no longer matches the original turn.');
    return { plan, images, route };
  }
  issue(checked, exchangeId) {
    if (!checked) return null;
    const { plan, images, route } = checked;
    if(plan){plan.uses.add(route.chairId ?? route.seat ?? route.modelId);plan.firstExchange ??= exchangeId;}
    if(route.capability.route==='selected_vision_tool')return null;
    const clearance = Object.freeze({ chatId: checked.chatId??plan.chatId, modelHash: route.modelHash, imagesHash: digest(images.map(imageReference)), capability: route.capability });
    liveClearances.add(clearance); return clearance;
  }
}
export function assertMediaClearance(clearance, messages, model, chatId) {
  const refs = mediaReferences(messages);
  if (!refs.length) { fail(!clearance, 'empty media clearance.'); return; }
  fail(messages.every(message => !message.images?.length || message.role === 'user'), 'pixels must remain user-supplied evidence.');
  fail(refs.length <= 4 && liveClearances.has(clearance) && clearance.chatId === chatId && clearance.modelHash === digest(model)
    && clearance.imagesHash === digest(refs), 'image transmission needs an exact live UI clearance.');
  liveClearances.delete(clearance);
}
