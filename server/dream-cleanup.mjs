import fs from 'node:fs/promises';
import path from 'node:path';

// Caller has just verified and loaded the finished candidate. Only this run's
// rebuildable export scratch is removed; notes, adapters and checkpoints stay.
export async function cleanDreamExport(workspace,id){
  if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(id))throw new Error('Invalid Dream cleanup identity.');
  const root=await fs.realpath(workspace),relative=path.join('dreams','runs',id,'export-work'),target=path.resolve(workspace,relative);
  const stat=await fs.lstat(target).catch(e=>e.code==='ENOENT'?null:Promise.reject(e));
  if(!stat)return {removed:true,files:0,bytes:0};
  const real=await fs.realpath(target);
  if(!stat.isDirectory()||stat.isSymbolicLink()||path.relative(root,real)!==relative)throw new Error('Export scratch is not inside its owned Dream directory.');
  let bytes=0,files=0;
  async function inspect(folder){for(const entry of await fs.readdir(folder,{withFileTypes:true})){
    const name=path.join(folder,entry.name),info=await fs.lstat(name);
    if(info.isSymbolicLink())throw new Error('Export scratch contains a linked location; it was retained.');
    if(info.isDirectory())await inspect(name);
    else if(info.isFile()){bytes+=info.size;files++;}
    else throw new Error('Export scratch contains an unexpected file type.');
  }}
  await inspect(real);
  // real is checked against the resolved workspace and the exact run suffix.
  await fs.rm(real,{recursive:true});return {removed:true,files,bytes};
}
