// Fetch named public release inputs. Nothing is installed, executed or signed in.
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import crypto from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=async file=>{const h=crypto.createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');};
const codex=JSON.parse(await fs.readFile(path.join(root,'provenance/codex-runtime-080.json'),'utf8'));
const native=JSON.parse(await fs.readFile(path.join(root,'provenance/licensing/native-sources.json'),'utf8'));
const cache=path.join(root,'.local/runtime-cache');
await fs.mkdir(cache,{recursive:true});
const inputs=[{...codex,file:'codex.exe'},...native.archives.map(a=>({...a,file:'native-sources/'+a.file}))];
for(const input of inputs) {
  assert(/^[A-Za-z0-9._+/-]+$/.test(input.file)&&!input.file.split('/').includes('..')&&!input.file.startsWith('/'));
  assert(/^[a-f0-9]{64}$/.test(input.sha256));
  const file=path.join(cache,input.file);
  if(await fs.stat(file).then(()=>true,()=>false)) {
    assert.equal(await sha(file),input.sha256,'Cached input changed: '+input.file);
    continue;
  }
  const url=new URL(input.url); assert.equal(url.protocol,'https:'); assert(!url.username&&!url.password);
  await fs.mkdir(path.dirname(file),{recursive:true});
  const response=await fetch(url,{signal:AbortSignal.timeout(180000)});
  assert(response.ok,'Download failed for '+input.file+': '+response.status);
  let count=0;
  const limit=new Transform({transform(chunk,encoding,callback){count+=chunk.length;callback(count>input.bytes?new Error('Download exceeds pinned size'):null,chunk);}});
  const partial=file+'.partial-'+crypto.randomUUID();
  await pipeline(response.body,limit,createWriteStream(partial,{flags:'wx'}));
  assert.equal(count,input.bytes,'Download size changed: '+input.file);
  assert.equal(await sha(partial),input.sha256,'Download hash changed: '+input.file);
  // link is atomic and cannot replace an existing cache entry.
  await fs.link(partial,file); await fs.unlink(partial);
  console.log('Verified '+input.file);
}
console.log('All '+inputs.length+' release inputs verified. No model or account was accessed.');
