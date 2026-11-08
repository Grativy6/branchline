import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function protectedPcPaths(dataDir,executable=process.env.BRANCHLINE_NATIVE_FILES??null,additional=[]) {
 const home=process.env.USERPROFILE;
 return [dataDir,path.win32.resolve(dataDir,'../codex-connection'),path.win32.resolve(dataDir,'../webview'),
  ...(executable?[path.win32.dirname(executable)]:[]),...(home?['AppData','.codex','.ssh','.aws','.azure','.kube'].map(n=>path.win32.join(home,n)):[]),...additional].map(p=>path.win32.normalize(p));
}
// Packaged runtime paths travel with the app. Development manifests remain a
// local fallback only when the packaged manifest is absent, never when invalid.
export async function readRuntime(name,explicit=null){
 if(!['peaches-runtime.json','personal-context-runtime.json','home-runtime.json'].includes(name))throw new Error('Unknown local runtime.');
 const packaged=path.join(appRoot,name);let selected=explicit??packaged;
 if(!explicit)try{await fs.access(packaged);}catch(e){if(e.code!=='ENOENT')throw e;selected=path.join(appRoot,'.local',name);}
 selected=path.resolve(selected);const raw=await fs.readFile(selected,'utf8');if(Buffer.byteLength(raw)>128*1024)throw new Error('Runtime configuration is too large.');
 const config=JSON.parse(raw),base=path.dirname(selected);
 for(const field of ['python','packageRoot'])if(config[field]!==undefined){
  const value=config[field];if(typeof value!=='string'||!value||value.startsWith('\\\\'))throw new Error('Use a local runtime path.');
  if(!path.isAbsolute(value)){const resolved=path.resolve(base,value);if(!resolved.startsWith(base+path.sep))throw new Error('Runtime path leaves its package.');config[field]=resolved;}
 }
 return config;
}
