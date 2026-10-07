// Package only the pinned calculator and image dependency closures. No lifecycle scripts,
// cache, credentials or unrelated application dependencies are copied.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const destination=path.resolve(process.argv[2]);
assert.equal(path.dirname(destination),path.join(root,'releases'),'Output must be a named release in this workspace');
const modules=await fs.realpath(path.join(root,'node_modules'));
const lock=JSON.parse(await fs.readFile(path.join(root,'package-lock.json'),'utf8'));
const copied=new Set(), report=[];
async function copy(name) {
  if(copied.has(name))return;copied.add(name);
  const source=await fs.realpath(path.join(modules,name));
  assert(source.startsWith(modules+path.sep),'Dependency must remain inside this workspace node_modules');
  const pkg=JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8'));
  assert.equal(pkg.version,lock.packages['node_modules/'+name]?.version,'Installed dependency differs from lockfile');
  const target=path.join(destination,'node_modules',name);
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.cp(source,target,{recursive:true,errorOnExist:true,force:false});
  report.push({name,version:pkg.version,license:pkg.license});
  for(const dep of Object.keys(pkg.dependencies||{}))await copy(dep);
}
await copy('quickjs-emscripten');
await fs.writeFile(path.join(destination,'calculation-runtime.json'),JSON.stringify({packages:report},null,2)+'\n');
console.log('Copied '+report.length+' pinned QuickJS packages, including their licenses.');
assert.equal(process.platform,'win32','This desktop package targets Windows');
assert.equal(process.arch,'x64','This desktop package targets x64');
const imageStart=report.length;
await copy('sharp');
await copy('@img/sharp-win32-x64');
await fs.writeFile(path.join(destination,'image-runtime.json'),JSON.stringify({packages:report.slice(imageStart),platform:'win32-x64'},null,2)+'\n');
console.log('Copied '+(report.length-imageStart)+' pinned image packages, including native libraries and their licenses.');
