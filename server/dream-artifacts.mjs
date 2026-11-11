import fs from 'node:fs/promises';
import path from 'node:path';
import {dreamTraining,DREAM_ACTIVE} from '../public/dream-training-state.js';
const id='[A-Za-z0-9_-]{1,120}',leaf='[A-Za-z0-9_.-]+\\.(?:json|safetensors|bin|pt|pth|jinja|txt|model)';
const allowed=new RegExp(`^dreams/(?:notes/${id}\\.json|portraits/[a-f0-9]{64}\\.webp|runtime\\.json|runs/${id}/(?:candidate\\.gguf|${leaf}|adapter/${leaf}|checkpoints/checkpoint-[0-9]+/${leaf}))$`);
export const validDreamArtifact=p=>typeof p==='string'&&allowed.test(p)&&!p.split('/').some(x=>x==='.'||x==='..');
export function requiredDreamArtifacts(state){
  const d=dreamTraining(state),files=new Set(d.notes.filter(n=>!n.removed).map(n=>'dreams/notes/'+n.id+'.json'));
  for(const p of d.portraits)if(p.sha256)files.add('dreams/portraits/'+p.sha256+'.webp');
  for(const r of d.runs)if(r.candidate){files.add(`dreams/runs/${r.id}/candidate.gguf`);files.add(`dreams/runs/${r.id}/adapter/adapter_model.safetensors`);}
  return [...files].sort();
}
export async function dreamArtifactFiles(root,state,{quiet=false}={}){
  const d=dreamTraining(state);if(quiet&&d.runs.some(r=>DREAM_ACTIVE.has(r.status)))throw new Error('Suspend the running Dream before making a complete workspace backup.');
  const files=new Set(requiredDreamArtifacts(state));
  const engine=await fs.lstat(path.join(root,'dreams','runtime.json')).catch(e=>e.code==='ENOENT'?null:Promise.reject(e));if(engine){if(!engine.isFile()||engine.isSymbolicLink())throw new Error('The selected training configuration is not an ordinary file.');files.add('dreams/runtime.json');}
  async function walk(relative){
    const folder=path.join(root,relative),stat=await fs.lstat(folder).catch(e=>e.code==='ENOENT'?null:Promise.reject(e));if(!stat)return;if(stat.isSymbolicLink())throw new Error('Dream backup folders cannot be links.');
    for(const item of await fs.readdir(folder,{withFileTypes:true})){
      const name=relative+'/'+item.name;if(item.isSymbolicLink())throw new Error('Dream backup files cannot be links.');
      if(item.isFile()&&validDreamArtifact(name))files.add(name);
      if(item.isDirectory()&&(['adapter','checkpoints'].includes(item.name)||/^checkpoint-[0-9]+$/.test(item.name)))await walk(name);
    }
  }
  for(const r of d.runs)await walk('dreams/runs/'+r.id);
  for(const name of files){if(!validDreamArtifact(name))throw new Error('Invalid Dream artifact path.');const file=path.join(root,name),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('A Dream artifact is unavailable.');}
  return [...files].sort();
}
