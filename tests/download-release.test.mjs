import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadPlan, pascalManifest} from '../scripts/download-release.mjs';
const version = '0.8.12-preview.2';
const entry = file => ({file, bytes: 200, sha256: 'a'.repeat(64)});
const receipt = () => ({version, qualificationVariant: false, setup: entry(`Branchline-v${version}-Setup.exe`), parts: [entry(`Branchline-v${version}-Setup-1.bin`)]});

test('helper pins the executable and every matching part to one public release', () => {
  const plan = downloadPlan(receipt());
  assert.equal(plan.downloadBytes, 400);
  assert(plan.files.every(f => f.url.startsWith(`https://github.com/Grativy6/branchline/releases/download/v${version}/`)));
  const source = pascalManifest(plan);
  assert(source.includes(plan.files[0].sha256));
  assert(source.includes(plan.files[1].url));
});

test('cross-version, missing/reordered, traversal and oversized installer inputs are refused', () => {
  for (const edit of [
    r => r.setup.file = '../another.exe', r => r.parts = [],
    r => r.parts[0].file = `Branchline-v${version}-Setup-2.bin`,
    r => r.parts[0].bytes = 2_000_000_000,
    r => r.setup.sha256 = 'unverified', r => r.version = "bad'\ncode",
    r => r.qualificationVariant = true
  ]) { const r = receipt(); edit(r); assert.throws(() => downloadPlan(r)); }
});

test('fixture URLs require a separate qualification input and cannot point outside loopback', () => {
  assert.throws(() => downloadPlan(receipt(), {fixtureBaseUrl: 'http://127.0.0.1:4567'}));
  const r = receipt(); r.qualificationVariant = true;
  assert.equal(downloadPlan(r, {fixtureBaseUrl: 'http://127.0.0.1:4567'}).fixture, true);
  for (const fixtureBaseUrl of ['http://example.com', 'http://127.0.0.1:4567/path', 'http://127.0.0.1:4567@elsewhere'])
    assert.throws(() => downloadPlan(r, {fixtureBaseUrl}));
});
