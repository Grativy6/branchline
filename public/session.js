// Browser development uses an owner-supplied launch fragment. The Windows
// host keeps its credential in native memory and supplies the header itself.
const parameters = new URLSearchParams(location.hash.slice(1));
const launch = parameters.get('session');
if (launch && /^[a-f0-9]{64}$/.test(launch)) {
  sessionStorage.setItem('branchline.session', launch);
  history.replaceState(null, '', location.pathname + location.search);
}

export function sessionFetch(route, options = {}) {
  if (typeof route !== 'string' || !route.startsWith('/api/')) throw new Error('Only local app requests can use this session.');
  const headers = new Headers(options.headers);
  const token = sessionStorage.getItem('branchline.session');
  if (token) headers.set('x-branchline-session', token);
  return fetch(route, { ...options, headers, redirect: 'error' });
}

export async function downloadExport(route, filename) {
  const target = new URL(route, location.origin);
  if (target.origin !== location.origin || !['/api/export', '/api/continuity/export', '/api/harnesses/export', '/api/sketches/export', '/api/dreams/export'].includes(target.pathname)) throw new Error('Unknown export route.');
  const response = await sessionFetch(target.pathname + target.search);
  if (!response.ok) throw new Error('The export could not be read from this app session.');
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a'); link.href = url; link.download = filename;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
