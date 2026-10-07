// Exact first-party payload selection shared by the source and binary exporters.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export async function hashFile(file) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file, { highWaterMark: 4 * 1024 * 1024 })) digest.update(chunk);
  return digest.digest('hex');
}
export const files=JSON.parse(await fs.readFile(path.join(root,'release-files.json'),'utf8'));
export function releaseTarget(name) {
  assert(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name),'Use a plain release folder name');
  return path.join(root,'releases',name);
}
export async function regular(file) {
  assert(!path.isAbsolute(file)&&!file.split('/').some(p=>p==='..'||p===''),'Invalid release path');
  const full=path.join(root,file), real=await fs.realpath(full);
  assert.equal(real.toLowerCase(),full.toLowerCase(),'Release inputs cannot be symlinks');
  assert((await fs.lstat(full)).isFile(),'Expected a file');
  return fs.readFile(full);
}
export function inspectText(file,bytes) {
  if(/\.(png|ico|wasm|dll|exe|node|pdb)$/i.test(file)) return;
  const text=bytes.toString('utf8');
  // Findings stop the export. Only file and category are reported, not values.
  const rules=[
    ['private development path', /(?:[CH]:[\\/]+Users[\\/]+cdpan|H:[\\/]+Hearthline|H:[\\/]+Chris['’] Path|C:[\\/]+Users[\\/]+Christopher)/i],
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
    ['credential-like value', /\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{25,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|hf_[A-Za-z0-9]{28,}|rpa_[A-Za-z0-9]{25,})\b/],
  ];
  for(const [category,pattern] of rules) {
    const reviewed=files.auditExceptions?.some(e=>e.file===file&&e.category===category&&e.sha256===hash(bytes));
    assert(!pattern.test(text)||reviewed,`Public export held: ${category} in ${file}`);
  }
}
export async function selected(kind) {
  const mappings=files[kind]; assert(Array.isArray(mappings));
  const seen=new Set(), result=[];
  for(const item of mappings) {
    const {source,file}=typeof item==='string'?{source:item,file:item}:item;
    assert(!seen.has(file),'Duplicate output path'); seen.add(file);
    assert(!path.isAbsolute(file)&&!file.split('/').some(p=>p==='..'||p===''));
    const bytes=await regular(source); inspectText(source,bytes);
    result.push({source,file,bytes});
  }
  return result;
}
export async function writeSelected(target,items) {
  for(const {file,bytes} of items) {
    const out=path.join(target,file); await fs.mkdir(path.dirname(out),{recursive:true});
    await fs.writeFile(out,bytes,{flag:'wx'});
  }
}
export async function inventory(folder) {
  const rows=[];
  async function walk(dir) {
    for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
      assert(!entry.isSymbolicLink(),'A release cannot include links');
      const full=path.join(dir,entry.name);
      if(entry.isDirectory()) await walk(full);
      else {const stat=await fs.stat(full);rows.push({path:path.relative(folder,full).replaceAll('\\','/'),bytes:stat.size,sha256:await hashFile(full)});}
    }
  }
  await walk(folder); return rows.sort((a,b)=>a.path.localeCompare(b.path));
}
