// One short-lived decoder. Fixed input bytes and transforms, no supplied paths,
// SVG, URLs, plugins or model calls. This is a resource boundary, not an OS sandbox.
import sharp from 'sharp';
sharp.cache(false);
sharp.concurrency(1);
sharp.block({ operation: ['VipsForeignLoad'] });
sharp.unblock({ operation: ['VipsForeignLoadJpegBuffer', 'VipsForeignLoadPngBuffer', 'VipsForeignLoadWebpBuffer'] });
const chunks = []; let size = 0;
try {
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 10 * 1024 * 1024) throw new Error('Picture exceeds 10 MiB.');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const options = { failOn: 'warning', limitInputPixels: 20000000, unlimited: false, sequentialRead: true };
  const metadata = await sharp(bytes, options).metadata();
  if (!['png', 'jpeg', 'webp'].includes(metadata.format) || (metadata.pages ?? 1) !== 1
    || !metadata.width || !metadata.height || metadata.width * metadata.height > 20000000)
    throw new Error('Choose a still PNG, JPEG or WebP up to 20 megapixels.');
  const oriented = await sharp(bytes, options).autoOrient().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb').png().timeout({ seconds: 10 }).toBuffer({ resolveWithObject: true });
  const thumbnail = await sharp(oriented.data, options).resize({ width: 240, height: 180, fit: 'inside', withoutEnlargement: true })
    .png().timeout({ seconds: 5 }).toBuffer({ resolveWithObject: true });
  process.stdout.write(JSON.stringify({ format: metadata.format, width: metadata.width, height: metadata.height,
    resources: { maxRssKiB: process.resourceUsage().maxRSS },
    orientation: metadata.orientation ?? 1, decoder: `sharp-${sharp.versions.sharp}/vips-${sharp.versions.vips}`,
    view: { base64: oriented.data.toString('base64'), width: oriented.info.width, height: oriented.info.height },
    thumbnail: { base64: thumbnail.data.toString('base64'), width: thumbnail.info.width, height: thumbnail.info.height } }));
} catch (error) { process.stderr.write(String(error.message).slice(0, 1500)); process.exitCode = 1; }
