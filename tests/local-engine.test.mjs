import test from 'node:test';
import assert from 'node:assert/strict';
import {BundledRunner,parseRuntimeVersion} from '../server/bundled-runner.mjs';

const commit='b1b770d90d94cad9e9ea5b993bdbc383a522fb28';
const manifest={runtimeVersion:'1.0.0',runtimeTag:'b12359',runtimeCommit:commit};
const native='version: 1.0.0-dev (build 12359, commit b1b770d90)\nbuilt with Clang for Windows';

test('release engine checks match the build and commit, and are reused per backend',async()=>{
  let calls=0;
  const runner=new BundledRunner('unused',{readVersion:async()=>{calls++;return parseRuntimeVersion(native);}});
  runner.manifest=manifest;
  await runner.checkVersion('unused','cpu',{},new AbortController().signal);
  await runner.checkVersion('unused','cpu',{},new AbortController().signal);
  assert.equal(calls,1);
  await runner.checkVersion('unused','vulkan',{},new AbortController().signal);
  assert.equal(calls,2);
  for(const change of [{build:12360},{commit:'123456789'},{version:'1.1.0-dev'}]){
    const mismatch=new BundledRunner('unused',{readVersion:async()=>({...parseRuntimeVersion(native),...change})});
    mismatch.manifest=manifest;
    await assert.rejects(mismatch.checkVersion('unused','cpu',{},new AbortController().signal),/engine mismatch/);
    assert.equal(mismatch.versionChecks.size,0);
  }
  assert.throws(()=>parseRuntimeVersion('unidentified program'),/identify its version/);
});

