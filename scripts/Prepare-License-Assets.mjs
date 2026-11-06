// Retain the reviewed full upstream notices and verify their exact bytes.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const folder=path.join(root,'public/licenses'),indexPath=path.join(folder,'index.json');
const original=await fs.readFile(indexPath,'utf8'),index=JSON.parse(original);
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const check=process.argv.includes('--check');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const own={'Apache-2.0.txt':'LICENSE','NOTICE.txt':'NOTICE','LICENSE-SCOPE.txt':'LICENSE-SCOPE.md','THIRD-PARTY-NOTICES.txt':'THIRD-PARTY-NOTICES.md'};
index.version=pkg.version;
const seen=new Set(['index.json']);
for(const group of index.groups)for(const doc of group.documents){
  assert(/^[A-Za-z0-9._-]+\.txt$/.test(doc.file),'Invalid notice filename.');
  seen.add(doc.file);
  const destination=path.join(folder,doc.file),bytes=await fs.readFile(own[doc.file]?path.join(root,own[doc.file]):destination);
  if(own[doc.file]){
    if(check)assert.deepEqual(await fs.readFile(destination),bytes,'Run licenses:prepare after updating first-party notices.');
    else await fs.writeFile(destination,bytes);
    doc.bytes=bytes.length;doc.sha256=sha(bytes);
  }else{
    assert.equal(bytes.length,doc.bytes,'Upstream notice size changed: '+doc.file);
    assert.equal(sha(bytes),doc.sha256,'Upstream notice changed: '+doc.file);
  }
}
for(const file of await fs.readdir(folder))assert(seen.has(file),'Unindexed notice: '+file);
const output=JSON.stringify(index,null,2)+'\n';
if(check)assert.equal(original,output,'Licence index needs preparation.');
else await fs.writeFile(indexPath,output);
if(process.argv.includes('--runtime')){
  const lock=JSON.parse(await fs.readFile(path.join(root,'provenance/runtime-files.json'),'utf8'));
  const project=await fs.readFile(path.join(root,'desktop/Branchline.Preview.csproj'),'utf8');
  assert(project.includes(`<RuntimeFrameworkVersion>${lock.dotnetVersion}</RuntimeFrameworkVersion>`));
  assert(project.includes(`Include="Microsoft.Web.WebView2" Version="${lock.webViewVersion}"`));
}
console.log(`${check?'Checked':'Prepared'} ${seen.size-1} offline notices for ${pkg.version}.`);
