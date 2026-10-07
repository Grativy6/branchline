import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const IMAGE_LIMITS = Object.freeze({ bytes: 10 * 1024 * 1024, pixels: 20000000, count: 4, viewSide: 1024 });
export const imageHash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const validImageHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = (ok, message) => { if (!ok) throw new Error('Picture: ' + message); };
const mime = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
const extensions = { png: ['png'], jpeg: ['jpg', 'jpeg'], webp: ['webp'] };
const decoder = fileURLToPath(new URL('./image-decoder.mjs', import.meta.url));

export function selectedImageBytes(input) {
  fail(input && Object.keys(input).sort().join(',') === 'base64,name,origin', 'only selected bytes, a name and selection method are accepted.');
  fail(typeof input.name === 'string' && input.name.trim() && input.name.length <= 180 && !/[\\/:\x00-\x1f\x7f]/.test(input.name), 'use a filename, not a path.');
  fail(['pick', 'paste', 'drop'].includes(input.origin), 'unknown selection method.');
  fail(typeof input.base64 === 'string' && input.base64.length <= Math.ceil(IMAGE_LIMITS.bytes / 3) * 4, 'choose a file up to 10 MiB.');
  const bytes = Buffer.from(input.base64, 'base64');
  fail(bytes.length > 0 && bytes.length <= IMAGE_LIMITS.bytes && bytes.toString('base64') === input.base64, 'empty or invalid selected bytes.');
  let format;
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    format = 'png'; let offset = 8, ended = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
      fail(length <= bytes.length - offset - 12, 'truncated PNG.');
      fail(type !== 'acTL', 'animated pictures are not supported.');
      offset += length + 12;
      if (type === 'IEND') { ended = true; break; }
    }
    fail(ended && offset === bytes.length, 'truncated PNG or extra data after the picture.');
  } else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    format = 'jpeg'; fail(bytes.at(-2) === 255 && bytes.at(-1) === 217, 'truncated JPEG or extra data after the picture.');
  } else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    format = 'webp'; fail(bytes.readUInt32LE(4) + 8 === bytes.length, 'truncated WebP or extra data after the picture.');
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const type = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4);
      fail(length <= bytes.length - offset - 8, 'truncated WebP chunk.');
      fail(type !== 'ANIM' && type !== 'ANMF' && !(type === 'VP8X' && (bytes[offset + 8] & 2)), 'animated pictures are not supported.');
      offset += 8 + length + (length % 2);
    }
    fail(offset === bytes.length, 'truncated WebP chunk.');
  }
  fail(format && extensions[format].includes(input.name.split('.').at(-1).toLowerCase()), 'the filename and detected PNG, JPEG or WebP format must agree.');
  return { bytes, format, name: input.name, origin: input.origin };
}

function decode(bytes) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--max-old-space-size=128', decoder], { shell: false, windowsHide: true, stdio: ['pipe','pipe','pipe'],
      env: { SYSTEMROOT: process.env.SYSTEMROOT ?? '', PATH: process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32') : '', VIPS_CONCURRENCY: '1' } });
    let output = [], total = 0, problem = ''; const timer = setTimeout(() => { problem = 'The picture took too long to decode.'; child.kill(); }, 15000);
    child.stdout.on('data', chunk => { total += chunk.length; if (total > 16 * 1024 * 1024) { problem = 'Decoded picture exceeded its output bound.'; child.kill(); } else output.push(chunk); });
    child.stderr.on('data', chunk => { if (problem.length < 2000) problem += chunk.toString(); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); if (code !== 0) return reject(new Error('Picture could not be decoded: ' + (problem || 'decoder stopped.')));
      try { resolve(JSON.parse(Buffer.concat(output).toString())); } catch { reject(new Error('Picture decoder returned invalid data.')); } });
    child.stdin.on('error', () => {}); child.stdin.end(bytes);
  });
}

export class ImageStore {
  constructor(dataDir) { this.root = path.join(path.resolve(dataDir), 'image-objects'); this.busy = false; }
  async directory(create = true) {
    if (create) await fs.mkdir(this.root, { recursive: true });
    const stat = await fs.lstat(this.root).catch(() => null);
    fail(stat?.isDirectory() && !stat.isSymbolicLink(), 'saved image storage is missing or is a link.');
    return this.root;
  }
  file(hash) { fail(validImageHash(hash), 'invalid internal object handle.'); return path.join(this.root, hash); }
  async read(ref) {
    const file = this.file(ref.sha256); await this.directory(false);
    const stat = await fs.lstat(file).catch(() => null);
    fail(stat?.isFile() && !stat.isSymbolicLink() && stat.size === ref.byteLength && stat.size <= IMAGE_LIMITS.bytes, 'saved image is missing or changed; its earlier description cannot replace it.');
    const bytes = await fs.readFile(file);
    fail(imageHash(bytes) === ref.sha256, 'saved image failed its integrity check.');
    return bytes;
  }
  async put(bytes, format, dimensions) {
    fail(bytes.length > 0 && bytes.length <= IMAGE_LIMITS.bytes, 'derived picture exceeds the byte bound.');
    const ref = { sha256: imageHash(bytes), byteLength: bytes.length, mimeType: mime[format], ...dimensions };
    await this.directory(); const target = this.file(ref.sha256);
    if (await fs.lstat(target).catch(() => null)) { await this.read(ref); return ref; }
    const temp = target + '.tmp-' + crypto.randomUUID();
    const handle = await fs.open(temp, 'wx');
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    try { await fs.link(temp, target); } catch (error) { if (error.code !== 'EEXIST') throw error; await this.read(ref); }
    await fs.unlink(temp); return ref;
  }
  ingest(input) {
    fail(!this.busy, 'another picture is preparing. Try again when it finishes.');
    const selected = selectedImageBytes(input);
    this.busy = true;
    const work = (async () => {
      const decoded = await decode(selected.bytes);
      fail(decoded.format === selected.format, 'decoder format disagrees with the file signature.');
      const original = await this.put(selected.bytes, selected.format, { width: decoded.width, height: decoded.height });
      const view = await this.put(Buffer.from(decoded.view.base64, 'base64'), 'png', { width: decoded.view.width, height: decoded.view.height });
      const thumbnail = await this.put(Buffer.from(decoded.thumbnail.base64, 'base64'), 'png', { width: decoded.thumbnail.width, height: decoded.thumbnail.height });
      return { name: selected.name, origin: selected.origin, original, view, thumbnail,
        transform: { profile: 'branchline.image-view/1', decoder: decoded.decoder, orientation: decoded.orientation, autoOrient: true,
          maxSide: 1024, colourspace: 'srgb', metadata: 'stripped', format: 'png', resized: Math.max(decoded.width, decoded.height) > 1024 } };
    })();
    return work.finally(() => { this.busy = false; });
  }
  async materialize(messages) {
    const data = new Map();
    for (const image of messages.flatMap(m => m.images ?? [])) {
      if (!data.has(image.sha256)) data.set(image.sha256, `data:${image.mimeType};base64,${(await this.read(image)).toString('base64')}`);
    }
    return data;
  }
}
