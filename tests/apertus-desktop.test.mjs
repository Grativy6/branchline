import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { once } from 'node:events';
import { fixture } from './helpers.mjs';

test('desktop setup backs up and appends through the normal store, and a second launch is a no-op', async t => {
  const f = await fixture(t);
  await f.command('message.note', {chatId:f.chatId,content:'Existing synthetic history stays intact.'});
  await f.command('draft.save', {chatId:f.chatId,text:'An unsent draft'});
  await f.app.dispose();
  const before = await fs.readFile(path.join(f.dataDir,'events.jsonl'));
  async function launch() {
    const child = spawn(process.execPath, ['server/desktop.mjs'], {cwd:path.resolve('.'),windowsHide:true,
      env:{...process.env,BRANCHLINE_DATA_DIR:f.dataDir,BRANCHLINE_SETUP_APERTUS:'1',NODE_OPTIONS:''},stdio:['pipe','pipe','pipe']});
    let error=''; child.stderr.on('data',chunk=>error+=chunk);
    const exited=once(child,'exit');
    const lines=readline.createInterface({input:child.stdout});
    try {
      const ready = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Desktop readiness timed out. ' + error)), 15000);
        lines.on('line', line => {
          const message = JSON.parse(line);
          if (message.type === 'loading') return;
          clearTimeout(timer); resolve(message);
        });
      });
      assert.equal(ready.type,'ready',error);
      const response=await fetch(ready.url+'/api/state',{headers:{'x-branchline-session':ready.sessionToken}});
      assert.equal(response.status,200);
      const state=await response.json();
      assert.equal(state.personalParticipants.at(-1).name,'Apertus');
      assert.equal(state.messages[0].content,'Existing synthetic history stays intact.');
      assert.equal(state.drafts[f.chatId],'An unsent draft');
    } finally { child.stdin.end('shutdown\n'); await exited; lines.close(); }
    assert.equal(child.exitCode,0,error);
  }
  await launch();
  const after=await fs.readFile(path.join(f.dataDir,'events.jsonl'));
  assert.deepEqual(after.subarray(0,before.length),before);
  const backups=await fs.readdir(path.join(f.dataDir,'..','backups'));
  assert.equal(backups.length,1);
  await launch();
  assert.deepEqual(await fs.readFile(path.join(f.dataDir,'events.jsonl')),after);
  assert.deepEqual(await fs.readdir(path.join(f.dataDir,'..','backups')),backups);
});

test('conflicting Apertus setup leaves settings reachable and does not repeat backups', async t => {
  const f = await fixture(t);
  await f.command('model.save', { name: 'Existing custom Apertus', model: 'branchline-apertus8b-base', baseUrl: 'http://127.0.0.1:1234/v1', inputFormat: 'chat', runtime: 'compatible' });
  await f.app.dispose();
  const before = await fs.readFile(path.join(f.dataDir, 'events.jsonl'));
  for (let i = 0; i < 2; i++) {
    const child = spawn(process.execPath, ['server/desktop.mjs'], { cwd: path.resolve('.'), windowsHide: true,
      env: { ...process.env, BRANCHLINE_DATA_DIR: f.dataDir, BRANCHLINE_SETUP_APERTUS: '1', NODE_OPTIONS: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let errors = ''; child.stderr.on('data', data => errors += data);
    const exited = once(child, 'exit'), lines = readline.createInterface({ input: child.stdout });
    try {
      const ready = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Conflicting setup blocked startup. ' + errors)), 15000);
        lines.on('line', line => { const value = JSON.parse(line); if (value.type === 'ready') { clearTimeout(timer); resolve(value); } });
      });
      const headers = { 'x-branchline-session': ready.sessionToken };
      const response = await fetch(ready.url + '/api/state', { headers }); assert.equal(response.status, 200);
      assert.equal((await response.json()).models.at(-1).name, 'Existing custom Apertus');
      const status = await (await fetch(ready.url + '/api/startup-status', { headers })).json();
      assert.match(status.warnings[0], /different settings/);
    } finally { child.stdin.end('shutdown\n'); await exited; lines.close(); }
    assert.equal(child.exitCode, 0);
  }
  assert.deepEqual(await fs.readFile(path.join(f.dataDir, 'events.jsonl')), before);
  assert.deepEqual(await fs.readdir(f.backupDir).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error)), []);
});
