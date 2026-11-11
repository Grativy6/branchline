import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const lock=JSON.parse(await fs.readFile(path.join(root,'provenance/runtime-files.json'),'utf8'));
const python=lock.files.find(f=>f.path==='book-runtime/python.exe');assert(python);
const files=await Promise.all(['__init__.py','store.py','personal_context.py','personal_server.py'].map(async name=>({name,sha256:sha(await fs.readFile(path.join(root,'server/personal_runtime/hearthline_mcp',name)))})));
const value={format:'branchline.personal-context-runtime/1',python:python.path,pythonSha256:python.sha256,packageRoot:'server/personal_runtime',files};
const output=path.join(root,'provenance/personal-context-runtime.json'),bytes=JSON.stringify(value,null,2)+'\n';
if(process.argv.includes('--check'))assert.equal(await fs.readFile(output,'utf8'),bytes,'Regenerate the personal runtime manifest for the maintained source.');
else await fs.writeFile(output,bytes);
const peachesFile=path.join(root,'provenance/peaches-runtime.json');
const peaches=JSON.parse(await fs.readFile(peachesFile,'utf8'));
assert.equal(peaches.pythonSha256,python.sha256);
for(const name of ['worker.py','package.py','signer.py','vendor/floor.py']){
  const value=sha(await fs.readFile(path.join(root,'server/peaches_runtime',name)));
  if(process.argv.includes('--check'))assert.equal(peaches.sources[name],value,'Refresh the PEACHES source manifest.');
  else peaches.sources[name]=value;
}
if(!process.argv.includes('--check'))await fs.writeFile(peachesFile,JSON.stringify(peaches,null,2)+'\n');
console.log((process.argv.includes('--check')?'Checked':'Prepared')+' maintained Python runtime manifests.');
