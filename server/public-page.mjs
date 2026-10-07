import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import crypto from 'node:crypto';

export function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  // Conservative: only ordinary global unicast. Reject mapped IPv4, ULA,
  // link-local, multicast, transition mechanisms and special-purpose ranges.
  if (net.isIP(address) === 6) {
    const lower = address.toLowerCase(); const first = parseInt(lower.split(':')[0], 16);
    return first >= 0x2000 && first <= 0x3fff && !/^200[12]:|^3fff:/.test(lower);
  }
  return false;
}
export function pageUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Use a public page URL.');
  let url; try { url = new URL(value); } catch { throw new Error('Use a complete HTTP or HTTPS page URL.'); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.hash
      || host.toLowerCase().endsWith('.local') || !host.includes('.') && !net.isIP(host)
      || (net.isIP(host) && !publicAddress(host))) throw new Error('Only public HTTP(S) pages on standard ports are supported; no credentials or fragments.');
  return url;
}

function readOnce(url, address, signal) {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).get(url, {
      signal, agent: false, headers: { 'user-agent': 'Branchline/0.7.12 (public-page reader)', accept: 'text/html, text/plain', 'accept-encoding': 'identity' },
      // Pin the vetted address for the actual connection; do not resolve twice.
      lookup: (_host, options, callback) => callback(null, ...(options?.all ? [[address]] : [address.address, address.family])),
    }, response => {
      const type = (response.headers['content-type'] || '').split(';')[0].trim();
      if (response.statusCode >= 300 && response.statusCode < 400) { response.destroy(); return resolve({ redirect: response.headers.location }); }
      if (response.statusCode < 200 || response.statusCode >= 300) { response.destroy(); return reject(new Error('The page returned HTTP ' + response.statusCode + '.')); }
      if (!['text/plain', 'text/html', 'application/xhtml+xml'].includes(type) || ![undefined,'identity'].includes(response.headers['content-encoding'])) {
        response.destroy(); return reject(new Error('The page must return uncompressed readable text or HTML.'));
      }
      const chunks = []; let bytes = 0;
      response.on('data', chunk => { bytes += chunk.length; if (bytes > 256 * 1024) response.destroy(new Error('The page exceeds the 256 KiB read limit.')); else chunks.push(chunk); });
      response.once('error', reject);
      response.once('aborted', () => reject(new Error('The page transfer was interrupted.')));
      response.once('end', () => resolve({ bytes: Buffer.concat(chunks), type }));
    });
    request.once('error', () => reject(new Error(signal.aborted ? 'Page reading stopped or timed out.' : 'The public page could not be reached.')));
  });
}

export function readablePage(html) {
  return html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, '\n').replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, s => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '})[s])
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, n) => { const cp = n[0].toLowerCase()==='x' ? parseInt(n.slice(1),16) : Number(n); return cp <= 0x10ffff ? String.fromCodePoint(cp) : ''; })
    .replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim();
}

export async function fetchPublicPage(value, signal, { lookup = dns.lookup, request = readOnce } = {}) {
  let url = pageUrl(value); const original = url.href;
  const bounded = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(15000)]);
  const redirects = [];
  for (let i = 0; i < 4; i++) {
    bounded.throwIfAborted();
    const host = url.hostname.replace(/^\[|\]$/g,'');
    const addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await new Promise((resolve, reject) => {
      const onAbort = () => reject(new Error('Page lookup stopped or timed out.'));
      bounded.addEventListener('abort', onAbort, { once: true });
      Promise.resolve().then(() => { bounded.throwIfAborted(); return lookup(host, { all: true, verbatim: true }); })
        .then(resolve, reject).finally(() => bounded.removeEventListener('abort', onAbort));
    });
    bounded.throwIfAborted();
    if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('The page resolves outside the permitted public network.');
    const result = await request(url, addresses[0], bounded);
    if (Object.hasOwn(result, 'redirect')) {
      if (!result.redirect) throw new Error('The page returned an incomplete redirect.');
      const next = pageUrl(new URL(result.redirect, url).href);
      // Exact-URL approval allows normal paths on the same origin only. Another
      // site requires its own visible request, never a silent cross-site redirect.
      if (next.origin !== url.origin) throw new Error('The page redirects to another site. Ask to open that destination separately.');
      redirects.push(next.href); url = next; continue;
    }
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(result.bytes);
    const text = result.type === 'text/plain' ? raw.trim() : readablePage(raw);
    return { url: original, finalUrl: url.href, redirects, retrievedAt: new Date().toISOString(),
      sha256: crypto.createHash('sha256').update(result.bytes).digest('hex'), bytes: result.bytes.length,
      text: text.slice(0, 12000), truncated: text.length > 12000, sourceRole: 'untrusted_page_evidence' };
  }
  throw new Error('The page exceeded the redirect limit.');
}
