// Windows integration check. Supply the rebuilt native executable, a NEW
// synthetic fixture directory on the selected drive, and a result JSON path.
// The fixture is retained; no user file is edited or recursively removed.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

assert.equal(process.platform,'win32','Run this check on Windows.');
const [executable,fixtureArg,resultArg]=process.argv.slice(2);
assert(executable&&fixtureArg&&resultArg,'Supply executable, fresh fixture folder and result path.');
const fixture=path.resolve(fixtureArg),resultFile=path.resolve(resultArg),drive=path.parse(fixture).root;
assert(/^[A-Za-z]:\\$/.test(drive));
await fs.mkdir(fixture);
const checks=[];
const call=(request,{commit=false}={})=>{
  const p=spawnSync(executable,['--pc-files'],{input:JSON.stringify(request)+'\n'+(commit?'COMMIT\n':''),encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:2*1024*1024});
  assert(!p.error,p.error?.message);
  const rows=p.stdout.trim().split(/\r?\n/).filter(Boolean).map(s=>JSON.parse(s));
  assert(rows.length&&rows.at(-1).ok!==undefined,'Native helper did not return a final result.');
  return {...rows.at(-1),prepared:rows.find(r=>r.prepared===true)??null};
};
const inspect=(location,directory=true,mode='inspect')=>call({mode,path:location,directory});
const root=inspect(drive);assert(root.ok,root.error);assert.equal(root.value.path,drive);checks.push('ordinary drive-root inspection');
const nav=inspect(drive,true,'inspect-nav');assert(nav.ok,nav.error);assert.equal(nav.value.identity,root.value.identity);checks.push('Nav root remains compatible');
const relativeDrive=inspect(drive.slice(0,2));assert(!relativeDrive.ok&&relativeDrive.error.includes('whole drive'));checks.push('drive-relative input gets actionable error');
assert(!inspect(drive,false).ok);checks.push('directory root cannot be opened as a file');
for(const invalid of ['\\\\?\\'+drive,'\\\\server\\share','H:\\test\\..\\other','H:\\test:stream','H:\\CON'])assert(!inspect(invalid).ok,invalid);
checks.push('device, network, traversal, stream and reserved-name inputs remain rejected');
const own=inspect(fixture);assert(own.ok,own.error);
const deniedDir=path.join(fixture,'excluded'),recovery=path.join(fixture,'recovery');
await fs.mkdir(deniedDir);await fs.mkdir(recovery);
await fs.writeFile(path.join(deniedDir,'hidden.txt'),'Synthetic excluded material.\n',{flag:'wx'});
const file=path.join(fixture,'note.txt'),initial='Synthetic native drive-root check.\n';
await fs.writeFile(file,initial,{flag:'wx'});
const base={root:drive,rootIdentity:root.value.identity,denied:[{path:deniedDir}],path:path.relative(drive,file),offset:0};
const listing=call({...base,mode:'list',path:''});assert(listing.ok,listing.error);checks.push('ordinary listing at drive root');
const bounded=call({...base,mode:'list',path:path.relative(drive,fixture)});assert(bounded.ok,bounded.error);assert(!bounded.value.items.some(x=>x.name==='excluded'));checks.push('listing still omits an excluded directory');
const read=call({...base,mode:'read'});assert(read.ok,read.error);assert.equal(read.value.text,initial);checks.push('text read under selected drive root');
const no=call({...base,mode:'read',path:path.relative(drive,path.join(deniedDir,'hidden.txt'))});assert(!no.ok&&/excluded/.test(no.error));checks.push('excluded file stays unavailable');
assert(!call({...base,mode:'read',rootIdentity:'not-the-selected-root'}).ok);checks.push('changed root identity is held');
const operationId=crypto.randomBytes(16).toString('hex');
const edit={...base,mode:'replace',identity:read.value.identity,sha256:read.value.sha256,oldText:initial,text:initial+'I was here - native fixture\n',operationId,recovery};
const edited=call(edit,{commit:true});assert(edited.ok,edited.error);assert(edited.prepared);assert.equal(await fs.readFile(path.join(recovery,operationId+'.original'),'utf8'),initial);
const after=call({...base,mode:'read'});assert(after.ok,after.error);assert.equal(after.value.text,edit.text);checks.push('confirmed edit and original-byte recovery under a drive root');
assert(!call({...edit,operationId:crypto.randomBytes(16).toString('hex')},{commit:true}).ok);assert.equal(await fs.readFile(file,'utf8'),edit.text);checks.push('stale edit cannot overwrite a newer file');
const topName='Branchline-drive-root-check-'+crypto.randomBytes(8).toString('hex')+'.txt';
const created=call({...base,mode:'create',path:topName,text:'Synthetic direct-root create check.\n'},{commit:true});assert(created.ok,created.error);checks.push('create text directly in a selected drive root');
const topPath=path.join(drive,topName),retainedPath=path.join(fixture,'direct-root-created.txt');
assert.equal(path.dirname(topPath),drive);assert(retainedPath.startsWith(fixture+path.sep));
await fs.rename(topPath,retainedPath);
const result={status:'PASS',checks,selectedDrive:drive,fixture,executable,source:'actual rebuilt native helper',retainedSyntheticFiles:true,userFilesEdited:false,finishedAt:new Date().toISOString()};
await fs.writeFile(resultFile,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:result.status,checks:checks.length,resultFile}));
