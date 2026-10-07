// Generate the offline viewer from the original notices. --check is read-only;
// --runtime also checks the Windows build inputs. No network access is needed.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'public/licenses');
const check = process.argv.includes('--check');
const runtime = process.argv.includes('--runtime');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
const project = await fs.readFile(path.join(root, 'desktop/Branchline.Preview.csproj'), 'utf8');
const references = JSON.parse(await fs.readFile(path.join(root, 'provenance/licensing/sources.json'), 'utf8'));
const assets = new Map();
const groups = ['Branchline', 'Included components', 'Windows runtime'].map(title => ({ title, documents: [] }));
const packages = [];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function document(group, title, source, file) {
  assert(/^[A-Za-z0-9._-]+\.txt$/.test(file), 'Use a plain local notice filename');
  assert(!assets.has(file), 'Duplicate notice filename');
  const bytes = await fs.readFile(path.join(root, source));
  assets.set(file, bytes);
  groups[group].documents.push({ title, file, source, bytes: bytes.length, sha256: hash(bytes) });
}

await document(0, 'Apache License 2.0 — full text', 'LICENSE', 'Apache-2.0.txt');
await document(0, 'Branchline attribution', 'NOTICE', 'NOTICE.txt');
await document(0, 'What this licence covers', 'LICENSE-SCOPE.md', 'LICENSE-SCOPE.txt');
await document(0, 'Component notices and release status', 'THIRD-PARTY-NOTICES.md', 'THIRD-PARTY-NOTICES.txt');
await document(1, 'Marked 15.0.12 — licence and notices', 'public/vendor/MARKED-LICENSE.md', 'Marked-LICENSE.txt');
await document(1, 'Stock Qwen3.5 model — Apache 2.0', 'provenance/licensing/Qwen3.5-LICENSE.txt', 'Qwen3.5-LICENSE.txt');
await document(1, 'llama.cpp — MIT licence', 'provenance/licensing/llama.cpp-LICENSE.txt', 'llama.cpp-LICENSE.txt');
await document(1, 'LLVM OpenMP runtime — licence and exceptions', 'provenance/licensing/LLVM-OpenMP-LICENSE.txt', 'LLVM-OpenMP-LICENSE.txt');
await document(1, 'Inno Setup installer — licence', 'provenance/licensing/Inno-Setup-LICENSE.txt', 'Inno-Setup-LICENSE.txt');
await document(2, 'Microsoft WebView2 Evergreen runtime — terms', 'provenance/licensing/WebView2-Runtime-LICENSE.txt', 'WebView2-Runtime-LICENSE.txt');
await document(2, 'Microsoft Visual C++ runtime — terms', 'provenance/licensing/VC-Runtime-LICENSE.txt', 'VC-Runtime-LICENSE.txt');

const visited = new Set();
async function dependency(name) {
  if (visited.has(name)) return;
  visited.add(name);
  const folder = path.join(root, 'node_modules', name);
  const installed = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8'));
  assert.equal(installed.version, lock.packages['node_modules/' + name]?.version, 'Installed dependency must match lockfile: ' + name);
  const files = (await fs.readdir(folder)).filter(file => /^(licen[cs]e|notice|copying|copyright)(\.|$)/i.test(file)).sort();
  assert(files.length, 'A dependency has no local licence file: ' + name);
  packages.push({ name, version: installed.version, license: installed.license });
  for (const file of files) {
    await document(1, `${name} ${installed.version} — ${file}`, `node_modules/${name}/${file}`, name.replace(/[@/]/g, '_') + '-' + file.replace(/\./g, '_') + '.txt');
  }
  for (const child of Object.keys(installed.dependencies || {}).sort()) await dependency(child);
}
// Same closures as Copy-Calculation-Runtime; build verification compares the
// resulting package inventories before calling the bundle complete.
await dependency('quickjs-emscripten');
await dependency('sharp');
await dependency('@img/sharp-win32-x64');
await document(1, 'Sharp native libraries — licence inventory', 'node_modules/@img/sharp-win32-x64/README.md', 'Sharp-native-inventory.txt');
await document(1, 'Sharp native libraries — versions', 'node_modules/@img/sharp-win32-x64/versions.json', 'Sharp-native-versions.txt');

assert(project.includes(`<RuntimeFrameworkVersion>${references.dotnetVersion}</RuntimeFrameworkVersion>`), 'Review runtime notices after a .NET upgrade');
assert(project.includes(`Include="Microsoft.Web.WebView2" Version="${references.webViewVersion}"`), 'Review notices after a WebView2 upgrade');
if (runtime) assert.equal(process.version, references.nodeVersion, 'Review Node notices before packaging a different Node version');
for (const ref of references.documents) {
  const source = 'provenance/licensing/' + ref.file;
  const bytes = await fs.readFile(path.join(root, source));
  assert.equal(hash(bytes), ref.sha256, 'A retained upstream notice changed: ' + ref.file);
  if (runtime && ref.nugetPath) {
    const installed = await fs.readFile(path.join(os.homedir(), '.nuget/packages', ref.nugetPath));
    assert.equal(hash(installed), ref.sha256, 'The runtime pack notice differs: ' + ref.file);
  }
  await document(ref.group, ref.title, source, ref.file);
}
await document(2, 'Codex model catalogue — retained upstream licence', 'provenance/codex-upstream-LICENSE.txt', 'Codex-upstream-LICENSE.txt');

assets.set('index.json', Buffer.from(JSON.stringify({ version: pkg.version, packages, groups }, null, 2) + '\n'));
if (!check) await fs.mkdir(output, { recursive: true });
for (const [name, bytes] of assets) {
  if (check) assert.deepEqual(await fs.readFile(path.join(output, name)), bytes, 'Stale licence asset: ' + name + '; run npm run licenses:prepare');
  else await fs.writeFile(path.join(output, name), bytes);
}
const extra = (await fs.readdir(output)).filter(name => !assets.has(name));
assert.equal(extra.length, 0, 'Unexpected retained licence assets: ' + extra.join(', ') + '; review before removing them');
console.log(`${check ? 'Checked' : 'Prepared'} ${assets.size - 1} offline notices for Branchline ${pkg.version}.`);
