// Explicit, public downloads only. Never called during the app's first launch.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { root, hashFile } from './public-release.mjs';
const target=path.resolve(process.argv[2] || path.join(root,'.local/bundled-inputs'));
const lock=JSON.parse(await fs.readFile(path.join(root,'provenance/bundled-model-inputs.json'),'utf8'));
await fs.mkdir(target,{recursive:true});
for(const input of lock.downloads) {
  assert(/^[A-Za-z0-9._-]+$/.test(input.file));
  const file=path.join(target,input.file);
  if(await fs.stat(file).catch(()=>null)) { assert.equal(await hashFile(file),input.sha256,'Existing input changed: '+input.file); console.log('Verified '+input.file); continue; }
  const response=await fetch(input.url,{signal:AbortSignal.timeout(30*60*1000)});
  assert(response.ok,'Download failed: '+input.file);
  const handle=await fs.open(file+'.partial','wx'), hash=crypto.createHash('sha256'); let bytes=0;
  try { for await(const chunk of response.body) { await handle.write(chunk);hash.update(chunk);bytes+=chunk.length; } await handle.sync(); }
  finally { await handle.close(); }
  assert.equal(bytes,input.bytes);assert.equal(hash.digest('hex'),input.sha256);
  await fs.rename(file+'.partial',file);console.log('Downloaded and verified '+input.file);
}
