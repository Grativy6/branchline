// Copy-only maintenance helper. Never loads a model, overwrites a snapshot, or deletes a source.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import assert from 'node:assert/strict';

const hashPattern = /^[a-f0-9]{64}$/;
const equalPath = (a,b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
export async function regularPath(file, { missing = false } = {}) {
  const absolute = path.resolve(file), parts = [];
  for (let p=absolute;;p=path.dirname(p)) { parts.unshift(p); if(path.dirname(p)===p)break; }
  for(const p of parts) {
    const stat=await fs.lstat(p).catch(e=>missing && e.code==='ENOENT' ? null : Promise.reject(e));
    if(!stat)continue;
    assert(!stat.isSymbolicLink(), 'Links are not archive inputs or destinations');
    assert(equalPath(await fs.realpath(p),p),'An archive path was redirected');
  }
  return absolute;
}
function inside(root, relative) {
  assert(typeof relative==='string' && relative.length>0 && !path.isAbsolute(relative) && !relative.includes('\\') && !relative.includes(':')
    && relative.split('/').every(p=>p && p!=='.' && p!=='..'), 'Invalid relative archive path');
  const full=path.resolve(root,...relative.split('/'));
  assert(full.startsWith(path.resolve(root)+path.sep),'Archive path escaped its root');return full;
}
export async function fileHash(file) {
  const h=crypto.createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');
}
async function inventory(source) {
  const rows=[];
  async function walk(file,relative) {
    await regularPath(file);const stat=await fs.lstat(file);
    if(stat.isDirectory())for(const name of (await fs.readdir(file)).sort())await walk(path.join(file,name),relative ? relative+'/'+name : name);
    else {assert(stat.isFile(),'Only ordinary files can be archived');rows.push({source:file,relative,bytes:stat.size,modifiedAt:stat.mtime.toISOString(),mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs});}
  }
  const stat=await fs.lstat(await regularPath(source));await walk(source,stat.isDirectory()?'':path.basename(source));return rows;
}
async function copyChecked(source,dest,expected=null) {
  await regularPath(source);await regularPath(path.dirname(dest));
  const before=await fs.stat(source),hash=crypto.createHash('sha256');assert(before.isFile(),'Source is not a file');
  await pipeline(createReadStream(source),new Transform({transform(chunk,_,done){hash.update(chunk);done(null,chunk);}}),createWriteStream(dest,{flags:'wx'}));
  const copied=hash.digest('hex'),after=await fs.stat(source);await regularPath(source);await regularPath(dest);
  assert.equal(after.size,before.size,'Source size changed during copy');assert.equal(after.mtimeMs,before.mtimeMs,'Source changed during copy');assert.equal(after.ctimeMs,before.ctimeMs,'Source identity changed during copy');
  assert.equal(await fileHash(source),copied,'Source bytes changed during copy');assert.equal(await fileHash(dest),copied,'Copied file hash mismatch');
  if(expected) {assert.equal(copied,expected.sha256,'Archive source differs from manifest');assert.equal(before.size,expected.bytes,'Archive source length differs from manifest');}
  await fs.utimes(dest,before.atime,before.mtime);return {bytes:before.size,sha256:copied};
}
export async function verifySnapshot(root) {
  await regularPath(root);await regularPath(path.join(root,'MANIFEST.json'));
  const manifest=JSON.parse(await fs.readFile(path.join(root,'MANIFEST.json'),'utf8'));
  assert.equal(manifest.format,'branchline.file-snapshot/1');assert(Array.isArray(manifest.files)&&manifest.files.length<=100000,'Invalid file list');
  const seen=new Set();
  for(const row of manifest.files) {
    const key=process.platform==='win32'?row.path.toLowerCase():row.path;
    assert(!seen.has(key)&&hashPattern.test(row.sha256)&&Number.isSafeInteger(row.bytes)&&row.bytes>=0,'Invalid or duplicate manifest entry');seen.add(key);
    const file=await regularPath(inside(root,row.path)),stat=await fs.stat(file);
    assert(stat.isFile()&&stat.size===row.bytes,'Archive file missing or length changed');assert.equal(await fileHash(file),row.sha256,'Archive hash mismatch: '+row.path);
  }
  return manifest;
}
export async function createSnapshot(sources, destination, { metadata = {}, onProgress = () => {} } = {}) {
  const root=await regularPath(destination,{missing:true});assert(Array.isArray(sources)&&sources.length>0,'Choose sources');
  const entries=[], outputs=new Set();
  for(const item of sources) {
    const source=await regularPath(item.source);assert(!equalPath(source,root)&&!root.toLowerCase().startsWith(source.toLowerCase()+path.sep),'Snapshot must be separate from its sources');
    for(const row of await inventory(source)) {
      const relative=item.folder+'/'+row.relative;inside(root,relative);const key=relative.toLowerCase();assert(!outputs.has(key),'Duplicate output path');outputs.add(key);
      entries.push({...row,path:relative,group:item.id});
    }
  }
  await fs.mkdir(path.dirname(root),{recursive:true});await regularPath(path.dirname(root));await fs.mkdir(root); // refuse any existing destination
  await fs.writeFile(path.join(root,'INCOMPLETE.txt'),'Copy in progress. Original files have not been removed.\n',{flag:'wx'});
  const manifest={format:'branchline.file-snapshot/1',createdAt:new Date().toISOString(),originalsRetained:true,metadata,files:[]};
  for(const row of entries) {
    const dest=inside(root,row.path);await fs.mkdir(path.dirname(dest),{recursive:true});const checked=await copyChecked(row.source,dest);
    assert.equal(checked.bytes,row.bytes,'Source changed after inventory');
    manifest.files.push({path:row.path,source:row.source,group:row.group,modifiedAt:row.modifiedAt,...checked});
    onProgress({copied:manifest.files.length,total:entries.length,path:row.path});
  }
  await fs.writeFile(path.join(root,'MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  await verifySnapshot(root);
  await fs.writeFile(path.join(root,'INCOMPLETE.txt'),'Copied file lengths and SHA-256 hashes verified. Original files retained. See MANIFEST.json for the exact scope.\n');
  await fs.rename(path.join(root,'INCOMPLETE.txt'),path.join(root,'COPY-VERIFIED.txt'));
  return {root,files:manifest.files.length,bytes:manifest.files.reduce((n,r)=>n+r.bytes,0),manifestSha256:await fileHash(path.join(root,'MANIFEST.json'))};
}
export async function restoreSnapshot(root,destination,selectedPaths=null) {
  const manifest=await verifySnapshot(root),out=await regularPath(destination,{missing:true});
  assert(!out.toLowerCase().startsWith(path.resolve(root).toLowerCase()+path.sep) && !equalPath(out,path.resolve(root)),'Restore outside the retained snapshot');
  const rows=selectedPaths===null?manifest.files:manifest.files.filter(r=>selectedPaths.includes(r.path));
  if(selectedPaths!==null)assert(rows.length===new Set(selectedPaths).size,'Restore selection missing from manifest');
  await fs.mkdir(path.dirname(out),{recursive:true});await regularPath(path.dirname(out));await fs.mkdir(out);
  for(const row of rows){const dest=inside(out,row.path);await fs.mkdir(path.dirname(dest),{recursive:true});await copyChecked(inside(root,row.path),dest,row);}
  return {destination:out,files:rows.length,bytes:rows.reduce((n,r)=>n+r.bytes,0)};
}
