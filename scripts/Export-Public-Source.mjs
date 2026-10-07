import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {root,hash,regular,releaseTarget,selected,writeSelected} from './public-release.mjs';
const target=releaseTarget(process.argv[2]||'Branchline-v0.8.12-preview.5-Source');
const items=await selected('source');
// Finish checking before creating the export. No private Git history is copied.
await fs.mkdir(path.dirname(target),{recursive:true}); await fs.mkdir(target);
await writeSelected(target,items);
let sourceCommit=null,worktreeDirty=null;
try {sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();worktreeDirty=Boolean(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim());} catch {}
const manifest={profile:'branchline.public-source/1',version:JSON.parse(await regular('package.json')).version,status:'PREPARED_NOT_PUBLISHED',sourceCommit,worktreeDirty,
  note:'An allowlisted source snapshot, not an export of the private repository or its history. README and user guides are selected public documents. Automated checks supplement content review; they do not prove absence of every kind of private information.',
  files:items.map(i=>({source:i.source,path:i.file,bytes:i.bytes.length,sha256:hash(i.bytes)}))};
await fs.writeFile(path.join(target,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({target,files:items.length,status:manifest.status}));
