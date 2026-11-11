import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {root,hashFile,selected,writeSelected,inventory,inspectText} from './public-release.mjs';

const target=path.resolve(process.argv[2]??'');
assert.equal(path.dirname(target),path.join(root,'releases'),'Choose a direct child of releases.');
const inputArg=process.argv.find(x=>x.startsWith('--runtime-dir='));
assert(inputArg,'Supply --runtime-dir= with the extracted verified Windows runtime bundle.');
const input=path.resolve(inputArg.slice('--runtime-dir='.length));
assert(input!==target&&!target.startsWith(input+path.sep),'Keep inputs and outputs separate.');
const withModel=process.argv.includes('--with-model');
const manifestOnly=process.argv.includes('--manifest');
const preflight=process.argv.includes('--preflight');
const lock=JSON.parse(await fs.readFile(path.join(root,'provenance/runtime-files.json'),'utf8'));
const inputs=[...lock.files,...(withModel?lock.modelFiles:[])];
const native=['Branchline.Preview.exe','Branchline.Preview.dll','Branchline.Preview.deps.json','Branchline.Preview.runtimeconfig.json'];
const payload=await selected('binary');
const notices=(await fs.readdir(path.join(root,'public/licenses'))).map(name=>'licenses/'+name);
async function checked(base,row){
  assert(!path.isAbsolute(row.path)&&!row.path.split('/').some(p=>p==='..'||p===''),'Unsafe input path.');
  const file=path.join(base,row.path),real=await fs.realpath(file);
  assert.equal(real.toLowerCase(),file.toLowerCase(),'No linked runtime input.');
  assert.equal((await fs.stat(file)).size,row.bytes,'Runtime size changed: '+row.path);
  assert.equal(await hashFile(file),row.sha256,'Runtime hash changed: '+row.path);
  return file;
}
if(!manifestOnly)for(const row of inputs)await checked(input,row);
if(preflight){console.log(JSON.stringify({status:'INPUTS_VERIFIED',runtimeFiles:inputs.length,applicationFiles:payload.length}));process.exit(0);}
if(!manifestOnly){
  for(const name of native)assert((await fs.stat(path.join(target,name))).isFile(),'Publish the native desktop project into the output first.');
  await writeSelected(target,payload);
  for(const row of inputs){
    const destination=path.join(target,row.path);
    await fs.mkdir(path.dirname(destination),{recursive:true});
    if(await fs.stat(destination).then(()=>true,()=>false))await checked(target,row);
    else await fs.copyFile(path.join(input,row.path),destination,fs.constants.COPYFILE_EXCL);
  }
  await fs.mkdir(path.join(target,'licenses'));
  for(const rel of notices)await fs.copyFile(path.join(root,'public',rel),path.join(target,rel),fs.constants.COPYFILE_EXCL);
  console.log('Allowlisted application and hash-pinned runtime files copied.');
}else{
  const rows=await inventory(target);
  const expected=new Set([...native,...inputs.map(x=>x.path),...payload.map(x=>x.file),...notices]);
  assert.equal(rows.length,expected.size,'Unexpected or missing packaged files.');
  for(const row of rows){assert(expected.has(row.path),'Unselected file: '+row.path);assert(!/(?:^|\/)(?:\.git|\.local|training|experiments|workspaces|account|auth\.json)(?:\/|$)/i.test(row.path),'Private payload included.');}
  for(const row of inputs)await checked(target,row);
  for(const item of payload){const bytes=await fs.readFile(path.join(target,item.file));assert.deepEqual(bytes,item.bytes,'Packaged application changed: '+item.file);inspectText(item.file,bytes);}
  for(const rel of notices)assert.deepEqual(await fs.readFile(path.join(target,rel)),await fs.readFile(path.join(root,'public',rel)),'Packaged notice changed.');
  assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),'','Commit reviewed source before recording the package.');
  const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const manifest={profile:'branchline.public-binary/2',version:JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version,sourceCommit,
    nativeHostRebuilt:true,nativeSource:JSON.parse(await fs.readFile(path.join(root,'provenance/desktop-source.json'),'utf8')),
    runtimeLockSha256:await hashFile(path.join(root,'provenance/runtime-files.json')),nodeVersion:lock.nodeVersion,workspaceFormat:4,signed:false,status:'BUILT',files:rows};
  await fs.writeFile(path.join(target,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:'VERIFIED',version:manifest.version,sourceCommit,files:rows.length,withModel}));
}
