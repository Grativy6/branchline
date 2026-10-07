import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { journalChunks, journalInfo } from '../server/journal-codec.mjs';

// An offline recovery utility, not an app/model tool. Never overwrites an output.
const [sourceArg, targetArg] = process.argv.slice(2);
if (!sourceArg || !targetArg) throw new Error('Usage: node scripts/Export-Journal.mjs <journal> <new-plain-jsonl-file>');
const source = path.resolve(sourceArg), target = path.resolve(targetArg);
if (source.toLowerCase() === target.toLowerCase()) throw new Error('Export requires a different output path.');
const info = await journalInfo(source), output = await fs.open(target, 'wx', 0o600);
const digest = crypto.createHash('sha256'); let bytes = 0;
try {
  for await (const chunk of journalChunks(source)) { await output.writeFile(chunk); bytes += chunk.length; digest.update(chunk); }
  if (bytes !== info.bytes) throw new Error('Export size mismatch. Partial output preserved.');
  await output.sync();
} finally { await output.close(); }
console.log(JSON.stringify({ status: 'EXPORTED_EXACT_LOGICAL_BYTES', bytes, sha256: digest.digest('hex'), output: target }));
