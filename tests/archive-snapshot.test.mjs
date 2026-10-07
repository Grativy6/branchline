import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSnapshot, verifySnapshot, restoreSnapshot } from '../scripts/archive-snapshot.mjs';
const base=path.resolve(process.env.BRANCHLINE_TEST_ROOT||'.test-data');
async function fixture(){await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'snapshot-')),source=path.join(root,'original');await fs.mkdir(source);await fs.mkdir(path.join(source,'nested'));await fs.writeFile(path.join(source,'nested','model.bin'),Buffer.alloc(131073,37));await fs.writeFile(path.join(source,'note.txt'),'Opaque retained material');return {root,source,dest:path.join(root,'snapshot'),sources:[{id:'old',source,folder:'Dream/recorded-package'}]};}
test('copy and independent restore preserve bytes, originals and occupied destinations',async()=>{
  const f=await fixture(),receipt=await createSnapshot(f.sources,f.dest);assert.equal(receipt.files,2);
  const restored=await restoreSnapshot(f.dest,path.join(f.root,'restored'));assert.equal(restored.files,2);
  assert.deepEqual(await fs.readFile(path.join(f.source,'nested/model.bin')),await fs.readFile(path.join(restored.destination,'Dream/recorded-package/nested/model.bin')));
  await assert.rejects(createSnapshot(f.sources,f.dest),/EEXIST/);await assert.rejects(restoreSnapshot(f.dest,restored.destination),/EEXIST/);
  assert.equal((await fs.readdir(f.source)).length,2);
});
test('damaged copies and path escapes do not produce restored output or delete sources',async()=>{
  const f=await fixture();await createSnapshot(f.sources,f.dest);
  await fs.writeFile(path.join(f.dest,'Dream/recorded-package/note.txt'),'changed');await assert.rejects(verifySnapshot(f.dest));await assert.rejects(restoreSnapshot(f.dest,path.join(f.root,'restore-failed')));
  await assert.rejects(fs.stat(path.join(f.root,'restore-failed')),/ENOENT/);assert.equal(await fs.readFile(path.join(f.source,'note.txt'),'utf8'),'Opaque retained material');
  const manifest=JSON.parse(await fs.readFile(path.join(f.dest,'MANIFEST.json')));manifest.files[0].path='../outside';await fs.writeFile(path.join(f.dest,'MANIFEST.json'),JSON.stringify(manifest));await assert.rejects(verifySnapshot(f.dest),/relative archive path/);
});
test('duplicate mappings, nested destinations and redirected source trees are rejected',async()=>{
  const f=await fixture();await assert.rejects(createSnapshot([...f.sources,...f.sources],f.dest),/Duplicate/);
  await assert.rejects(createSnapshot(f.sources,path.join(f.source,'snapshot')),/separate/);
  const link=path.join(f.root,'redirect');await fs.symlink(f.source,link,'junction');await assert.rejects(createSnapshot([{id:'x',source:link,folder:'x'}],f.dest),/Links/);
});
