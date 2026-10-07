// Explicit native download-helper qualification. Local fixtures only; no install.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {hashFile} from '../scripts/public-release.mjs';

const [fixtureArg, helperArg, reportArg] = process.argv.slice(2);
const fixture = path.resolve(fixtureArg), helper = path.resolve(helperArg), output = path.resolve(reportArg);
await fs.mkdir(output, {recursive: false});
const receipt = JSON.parse(await fs.readFile(path.join(fixture, 'installer-build.json'), 'utf8'));
assert.equal(receipt.qualificationVariant, true);
const files = [receipt.setup, ...receipt.parts];
const requests = [];
let mode = 'good';
let activeChild;
const drivers = [];
function drive(action) {
  const child=spawn('powershell.exe', ['-NoProfile','-NonInteractive','-File',path.resolve('tests/drive-owned-download-window.ps1'),'-OwnerPid',String(activeChild.pid),'-Action',action],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let text='';child.stdout.on('data',chunk=>text+=chunk);child.stderr.on('data',chunk=>text+=chunk);
  const result=new Promise(resolve=>child.once('exit',code=>resolve({action,code,text})));drivers.push(result);return result;
}
const server = http.createServer(async (req, res) => {
  const name = req.url.slice(1);
  const file = files.find(f => f.file === name);
  if (!file) {res.writeHead(404); res.end(); return;}
  requests.push({mode, name});
  if (mode === 'offline') {res.writeHead(503); res.end(); return;}
  const body = await fs.readFile(path.join(fixture, name));
  if (mode === 'corrupt' && name.endsWith('-1.bin')) body[100] ^= 255;
  res.setHeader('content-length', body.length);
  if (mode === 'cancel' && name.endsWith('-1.bin')) {
    drive('cancel');
    let offset=0;const timer=setInterval(()=>{if(offset>=body.length){clearInterval(timer);res.end();return;}res.write(body.subarray(offset,offset+4096));offset+=4096;},120);
    res.on('close',()=>clearInterval(timer));
  } else res.end(body);
});
await new Promise((resolve, reject) => {server.once('error', reject); server.listen(48971, '127.0.0.1', resolve);});
const report = {kind: 'REAL_NATIVE_HELPER_WITH_LOOPBACK_FIXTURES', status: 'RUNNING', cases: [], requests};
async function run(name, cache, extra = [], interactive = false) {
  const log = path.join(output, name + '.log');
  const child = spawn(helper, [...(interactive?[]:['/VERYSILENT','/SUPPRESSMSGBOXES']), '/NORESTART', `/LOG=${log}`, `/TESTCACHE=${cache}`, ...extra], {windowsHide: true, stdio: 'ignore'});
  activeChild=child;
  if (interactive) drive(mode==='cancel'?'download':'advance');
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    // Only this still-running test helper and its owned descendants.
    spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'});
  }, 30000);
  const code = await new Promise((resolve, reject) => {child.once('error', reject); child.once('exit', resolve);});
  clearTimeout(timer);
  const logText = await fs.readFile(log, 'utf8').catch(() => '');
  const result = {name, code, timedOut, log}; report.cases.push(result);
  assert(!timedOut, `${name}: helper failed to return`);
  return {code, logText};
}
try {
  const cache = path.join(output, 'cache'), versionFolder = path.join(cache, 'Branchline-v' + receipt.version);
  assert.equal((await run('download', cache)).code, 0);
  for (const f of files) assert.equal(await hashFile(path.join(versionFolder, f.file)), f.sha256);
  const count = requests.length;
  assert.equal((await run('reuse', cache)).code, 0);
  assert.equal(requests.length, count, 'Verified complete downloads should be reused');
  await fs.writeFile(path.join(versionFolder, files[1].file), 'broken cache');
  assert.equal((await run('repair-cache', cache)).code, 0);
  assert.equal(requests.length, count + 1);
  assert.equal(await hashFile(path.join(versionFolder, files[1].file)), files[1].sha256);

  mode = 'corrupt';
  const corruptCache = path.join(output, 'corrupt-cache');
  const bad = await run('corrupt-server', corruptCache);
  assert.notEqual(bad.code, 0, 'A bad download cannot finish successfully');
  assert.equal(await fs.stat(path.join(corruptCache, 'Branchline-v' + receipt.version, files[1].file)).catch(() => null), null);
  assert.match(bad.logText, /hash|verification|download/i);
  mode = 'good';
  const beforeRetry = requests.length;
  assert.equal((await run('retry', corruptCache)).code, 0);
  assert.equal(requests.length, beforeRetry + files.length - 1, 'Successful earlier part is retained across retry');

  const beforeSpace = requests.length;
  assert.notEqual((await run('fixture-insufficient-space', path.join(output, 'no-space-cache'), ['/TESTNOSPACE=1'])).code, 0);
  assert.equal(requests.length, beforeSpace);

  mode='cancel';
  const cancelCache=path.join(output,'cancel-cache');
  assert.notEqual((await run('cancel-button',cancelCache,[],true)).code,0);
  mode='good';
  const beforeResume=requests.length;
  assert.equal((await run('retry-after-cancel',cancelCache)).code,0);
  assert.equal(requests.length,beforeResume+files.length-1);

  assert.equal((await run('setup-handoff',path.join(output,'handoff-cache'),[],true)).code,0);
  const marker=path.join(output,'handoff-cache','Branchline-v'+receipt.version,'fixture-launched.txt');
  for(let attempt=0;attempt<30&&!await fs.stat(marker).catch(()=>null);attempt++) await new Promise(r=>setTimeout(r,100));
  assert.equal((await fs.readFile(marker,'utf8')).trim(),'fixture setup launched');

  mode = 'offline';
  assert.notEqual((await run('network-failure', path.join(output, 'offline-cache'))).code, 0);
  const linkTarget = path.join(output, 'link-target'), link = path.join(output, 'link-cache');
  await fs.mkdir(linkTarget); await fs.symlink(linkTarget, link, 'junction');
  const beforeLink = requests.length;
  assert.notEqual((await run('redirected-cache', link)).code, 0);
  assert.equal(requests.length, beforeLink);
  assert.deepEqual(await fs.readdir(linkTarget), []);
  report.status = 'PASS';
} catch (error) {report.status = 'FAIL'; report.error = error.stack; process.exitCode = 1;}
finally {
  report.drivers = await Promise.all(drivers);
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
