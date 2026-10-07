// Bind the small download helper to one reviewed installer, never a remote script.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {hashFile} from './public-release.mjs';

export function downloadPlan(receipt, {fixtureBaseUrl} = {}) {
  assert(/^\d+\.\d+\.\d+-preview\.\d+$/.test(receipt.version), 'Invalid release version');
  const version = receipt.version;
  const base = `Branchline-v${version}-Setup`;
  assert(Array.isArray(receipt.parts) && receipt.parts.length > 0 && receipt.parts.length <= 20, 'Invalid installer parts');
  if (fixtureBaseUrl) {
    assert(receipt.qualificationVariant === true, 'Only fixture builds allow a test URL');
    assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(fixtureBaseUrl), 'Fixture URL must be an exact loopback origin');
  } else assert(receipt.qualificationVariant === false, 'Do not publish a qualification installer');
  const origin = fixtureBaseUrl || `https://github.com/Grativy6/branchline/releases/download/v${version}`;
  const files = [receipt.setup, ...receipt.parts].map((file, i) => {
    assert(file && file.file === (i === 0 ? `${base}.exe` : `${base}-${i}.bin`), 'Unexpected installer filename or order');
    assert(Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes < 2_000_000_000, 'Invalid release file size');
    assert(/^[a-f0-9]{64}$/.test(file.sha256), 'Invalid SHA-256');
    return {file: file.file, bytes: file.bytes, sha256: file.sha256, url: `${origin}/${file.file}`};
  });
  return {profile: 'branchline.download-release/1', version, fixture: Boolean(fixtureBaseUrl), files,
    downloadBytes: files.reduce((sum, f) => sum + f.bytes, 0), setup: files[0].file};
}

export function pascalManifest(plan) {
  const text = value => `'${value.replaceAll("'", "''")}'`;
  return [
    '// Generated only after every installer byte has been verified locally.',
    `const ReleaseVersion = ${text(plan.version)};`,
    `const DownloadBytes = '${plan.downloadBytes}';`,
    `const FileCount = ${plan.files.length};`,
    'procedure BindFiles;', 'begin',
    ...plan.files.flatMap((f, i) => [
      `  FileNames[${i}] := ${text(f.file)};`, `  FileUrls[${i}] := ${text(f.url)};`,
      `  FileHashes[${i}] := ${text(f.sha256)};`, `  FileBytes[${i}] := ${f.bytes};`
    ]), 'end;', ''
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [receiptFile, output, fixtureBaseUrl] = process.argv.slice(2);
  const receipt = JSON.parse((await fs.readFile(receiptFile, 'utf8')).replace(/^\uFEFF/, ''));
  const plan = downloadPlan(receipt, {fixtureBaseUrl});
  for (const file of plan.files) {
    const target = path.join(path.dirname(path.resolve(receiptFile)), file.file);
    const stat = await fs.lstat(target);
    assert(stat.isFile() && !stat.isSymbolicLink(), 'Installer input must be a regular file');
    assert.equal(stat.size, file.bytes, file.file);
    assert.equal(await hashFile(target), file.sha256, file.file);
  }
  await fs.mkdir(output, {recursive: false});
  await fs.writeFile(path.join(output, 'download-release.json'), JSON.stringify(plan, null, 2) + '\n', {flag: 'wx'});
  await fs.writeFile(path.join(output, 'DownloadManifest.iss'), pascalManifest(plan), {flag: 'wx'});
  console.log(JSON.stringify({version: plan.version, fixture: plan.fixture, files: plan.files.length, downloadBytes: plan.downloadBytes}));
}
