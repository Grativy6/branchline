import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './index.mjs';
import { apertusConfigured, configureApertus } from './apertus-setup.mjs';
import { hearthlineConfigured, configureHearthline } from './hearthline-profile-setup.mjs';
import { StorageManager } from './storage.mjs';

// This is the deliberately small process boundary used by the Windows host.
// It owns one local app server and communicates with its parent over stdin/stdout.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dataDir = process.env.BRANCHLINE_DATA_DIR || path.join(root, '.local');
const publicDir = process.env.BRANCHLINE_PUBLIC_DIR || path.join(root, 'public');

let server;
let closing = false;

function ready(port) {
  process.stdout.write(JSON.stringify({ type: 'ready', url: `http://127.0.0.1:${port}`, sessionToken: server.sessionToken }) + '\n');
}

async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  try { if (server) await server.dispose(); }
  catch (error) { process.stderr.write(`Branchline desktop backend shutdown: ${error.message}\n`); code = 1; }
  process.exit(code);
}

try {
  server = await createApp({ dataDir, publicDir, onLoadProgress: progress => {
    process.stdout.write(JSON.stringify({ type: 'loading', ...progress }) + '\n');
  } });
  if (process.env.BRANCHLINE_SETUP_APERTUS === '1' && !apertusConfigured(server.store.state)) {
    try {
      // Resolve a conflicting registration before copying a large workspace.
      // Setup failure must leave Settings reachable so the user can correct it.
      configureApertus(server.store.state);
      await new StorageManager(server.store).backup();
      await server.store.transact(configureApertus);
    } catch (error) {
      server.startupWarnings.push('Apertus setup was not applied. ' + error.message);
      process.stderr.write(`Branchline optional setup: ${error.message}\n`);
    }
  }
  if (process.env.BRANCHLINE_SETUP_HEARTHLINE === '1' && !hearthlineConfigured(server.store.state)) {
    try {
      configureHearthline(server.store.state);
      await new StorageManager(server.store).backup();
      await server.store.transact(configureHearthline);
    } catch (error) {
      server.startupWarnings.push('Hearthline profile setup was not applied. ' + error.message);
      process.stderr.write(`Branchline optional profile setup: ${error.message}\n`);
    }
  }
  server.on('error', error => {
    process.stderr.write(`Branchline desktop backend: ${error.message}\n`);
    void shutdown(1);
  });
  server.listen(0, '127.0.0.1', () => ready(server.address().port));
  process.stdin.setEncoding('utf8');
  let input = '';
  process.stdin.on('data', chunk => {
    input += chunk;
    let newline;
    while ((newline = input.indexOf('\n')) >= 0) {
      const line = input.slice(0, newline).trim();
      input = input.slice(newline + 1);
      if (line === 'shutdown' || line === '{"type":"shutdown"}') void shutdown();
    }
  });
  process.stdin.on('end', () => void shutdown());
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void shutdown());
} catch (error) {
  process.stderr.write(`Branchline desktop backend: ${error.message}\n`);
  process.exitCode = 1;
}
