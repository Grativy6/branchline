import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { root, hashFile } from './public-release.mjs';
const inputDir=path.resolve(process.argv[2]), target=path.resolve(process.argv[3]);
assert.equal(path.dirname(target),path.join(root,'releases'),'Bundle into a direct release folder only');
const lock=JSON.parse(await fs.readFile(path.join(root,'provenance/bundled-model-inputs.json'),'utf8'));
for(const input of lock.downloads) {
  const file=path.join(inputDir,input.file);
  assert.equal((await fs.stat(file)).size,input.bytes,input.file);assert.equal(await hashFile(file),input.sha256,input.file);
}
const bundle=path.join(target,'bundled-model');await fs.mkdir(bundle);
const files=[];
for(const item of lock.models) {
  const file=path.join(inputDir,item.file), out=path.join(bundle,item.file);
  await fs.copyFile(file,out,fs.constants.COPYFILE_EXCL);files.push({path:item.file,bytes:item.bytes,sha256:item.sha256});
}
const quote=s=>"'"+s.replaceAll("'","''")+"'";
for(const runtime of lock.runtimes) {
  const extracted=path.join(inputDir,'unpacked-'+runtime.backend+'-'+lock.runtimeTag);
  if(!await fs.stat(extracted).catch(()=>null)) {
    // Archive hashes are pinned; still reject a path that could escape extraction.
    const script=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $a=[IO.Compression.ZipFile]::OpenRead(${quote(path.join(inputDir,runtime.archive))}); try { foreach($e in $a.Entries) { if([IO.Path]::IsPathRooted($e.FullName) -or $e.FullName -match '(^|[\\\\/])\\.\\.([\\\\/]|$)' -or $e.FullName.Contains(':')) { throw 'Unsafe archive entry' } } } finally { $a.Dispose() }; [IO.Compression.ZipFile]::ExtractToDirectory(${quote(path.join(inputDir,runtime.archive))},${quote(extracted)})`;
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:'pipe'});
  }
  await fs.mkdir(path.join(bundle,runtime.backend));
  for(const item of runtime.files) {
    const file=path.join(extracted,item.file);assert.equal((await fs.stat(file)).size,item.bytes);assert.equal(await hashFile(file),item.sha256,item.file);
    const relative=runtime.backend+'/'+item.file;await fs.copyFile(file,path.join(bundle,relative),fs.constants.COPYFILE_EXCL);
    files.push({path:relative,bytes:item.bytes,sha256:item.sha256});
  }
}
await fs.writeFile(path.join(bundle,'manifest.json'),JSON.stringify({profile:'branchline.bundled-qwen/1',contextTokens:8192,imageMaxTokens:1024,
  sourceModel:lock.sourceModel,conversion:lock.conversion,runtimeTag:lock.runtimeTag,runtimeCommit:lock.runtimeCommit,files},null,2)+'\n',{flag:'wx'});
console.log('Bundled '+files.length+' verified model/runtime files.');
