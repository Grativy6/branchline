import path from 'node:path';
import {digest} from './integrity.mjs';
export const LOCAL_FILE_ADDRESS='http://127.0.0.1:0/v1';
export const fileAlias=hash=>'branchline-file-'+hash;
export const isOwnedLocal=model=>['bundled','gguf'].includes(model?.runtime);
export function assertLocalFileProfile(model){
  if(model?.runtime!=='gguf'||model.baseUrl!==LOCAL_FILE_ADDRESS||!/^branchline-file-[a-f0-9]{64}$/.test(model.model)||model.thinking===true||!['chat','plain-dialogue-v1'].includes(model.inputFormat))throw new Error('Local file models use their saved file connection.');
}
export const localFileFor=(state,model)=>state.localModels?.files.findLast(f=>f.modelId===model.id&&fileAlias(f.sha256)===model.model)??null;
export function validateLocalModels(state){
  const library=state.localModels;if(!library){if(state.models.some(m=>m.runtime==='gguf'))throw new Error('Local model file information is missing.');return;}
  if(library.profile!=='branchline.local-models/1'||!Array.isArray(library.files)||!Array.isArray(library.folders)||library.folders.length>32)throw new Error('Invalid local-model library.');
  const absolute=v=>typeof v==='string'&&v.length<=4096&&!/[\0\r\n]/.test(v)&&(path.isAbsolute(v)||path.win32.isAbsolute(v));
  if(!library.folders.every(absolute))throw new Error('Invalid saved model folder.');
  const ids=new Set();
  for(const f of library.files){
    if(!f||typeof f.id!=='string'||ids.has(f.id)||!absolute(f.path)||!f.path.toLowerCase().endsWith('.gguf')||!/^[a-f0-9]{64}$/.test(f.sha256)||!Number.isSafeInteger(f.bytes)||f.bytes<=0||!Number.isFinite(f.mtimeMs)||!f.metadata||!['chat','plain-dialogue-v1'].includes(f.metadata.inputFormat)||!Number.isSafeInteger(f.contextTokens)||f.contextTokens<512||f.contextTokens>32768)throw new Error('Invalid saved local model file.');
    const model=state.models.find(m=>m.id===f.modelId);if(model&&(model.runtime!=='gguf'||model.model!==fileAlias(f.sha256)||model.inputFormat!==f.metadata.inputFormat))throw new Error('The model and its saved file do not match.');ids.add(f.id);
  }
  for(const m of state.models.filter(m=>m.runtime==='gguf'))if(!localFileFor(state,m))throw new Error('A local model has no saved file.');
}
export function preserveLocalModels(before,after){
  const prior=before.localModels?.files??[],next=after.localModels?.files??[];
  if(next.length<prior.length||prior.some((f,i)=>digest(f)!==digest(next[i])))throw new Error('Recorded local-model file identities must remain unchanged.');
}
