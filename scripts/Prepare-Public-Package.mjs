import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {root,hash,hashFile,regular,selected,writeSelected,inventory} from './public-release.mjs';
import {verifiedCodexBinary} from '../server/codex-provider.mjs';
import {CODEX_SHA256} from '../server/codex-policy.mjs';
const target=path.resolve(process.argv[2]);
assert.equal(path.dirname(target),path.join(root,'releases'),'Build only a direct child of releases');
const references=JSON.parse(await regular('provenance/licensing/sources.json'));
const sources=JSON.parse(await regular('provenance/licensing/native-sources.json'));
assert.equal(hash(await fs.readFile(process.execPath)),references.nodeExeSha256,'Use the exact public Node executable');
const binary=await verifiedCodexBinary();
assert.equal(hash(await fs.readFile(binary)),CODEX_SHA256);
for(const input of sources.archives) {
  const file=path.join(root,'.local/runtime-cache/native-sources',input.file);
  assert.equal((await fs.stat(file)).size,input.bytes,'Source archive size changed: '+input.file);
  assert.equal(await hashFile(file),input.sha256,'Source archive changed: '+input.file);
}
const payload=await selected('binary');
if(process.argv.includes('--preflight')) { console.log('Public payload, runtime and corresponding-source inputs verified.'); }
else if(process.argv.includes('--manifest')) {
  const index=JSON.parse(await fs.readFile(path.join(target,'public/licenses/index.json'),'utf8'));
  const deps=[];for(const name of ['calculation-runtime.json','image-runtime.json'])deps.push(...JSON.parse(await fs.readFile(path.join(target,name),'utf8')).packages);
  assert.deepEqual(deps.map(p=>p.name+'@'+p.version).sort(),index.packages.map(p=>p.name+'@'+p.version).sort());
  const inputHashes=payload.map(i=>({path:i.file,sha256:hash(i.bytes)}));
  const rows=await inventory(target);
  for(const item of inputHashes) assert.equal(rows.find(r=>r.path===item.path)?.sha256,item.sha256,'Packaged source changed');
  for(const row of rows) assert(!/(?:^|\/)(?:\.git|\.local|training|experiments|account|auth\.json|Start-Table\.[^/]+|Connect-Hearthline\.vbs)(?:\/|$)/i.test(row.path),'Private or personal payload included');
  let sourceCommit=null;try{sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
  const manifest={profile:'branchline.public-binary/1',version:JSON.parse(await regular('package.json')).version,sourceCommit,sourceExport:await fs.readFile(path.join(root,'source-manifest.json')).then(b=>({sha256:hash(b)}),()=>null),
    inputHashes,nodeVersion:process.version,codexSha256:CODEX_SHA256,files:rows,status:'BUILT_PENDING_RELEASE_CHECKS',signed:false};
  await fs.writeFile(path.join(target,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  console.log('Manifest recorded for '+rows.length+' files.');
} else {
  await writeSelected(target,payload);
  await fs.copyFile(process.execPath,path.join(target,'node.exe'),fs.constants.COPYFILE_EXCL);
  await fs.mkdir(path.join(target,'codex-runtime'),{recursive:true});
  await fs.copyFile(binary,path.join(target,'codex-runtime/codex.exe'),fs.constants.COPYFILE_EXCL);
  await fs.copyFile(path.join(root,'provenance/codex-runtime-080.json'),path.join(target,'codex-runtime/origin.json'),fs.constants.COPYFILE_EXCL);
  await fs.mkdir(path.join(target,'licenses'));
  for(const file of await fs.readdir(path.join(target,'public/licenses'))) await fs.copyFile(path.join(target,'public/licenses',file),path.join(target,'licenses',file),fs.constants.COPYFILE_EXCL);
  console.log('Public app files copied. Open Branchline.Preview.exe; no model launcher is included.');
}
