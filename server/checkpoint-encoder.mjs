import { parentPort, workerData } from 'node:worker_threads';
import { encodeCheckpoint, decodeCheckpoint } from './startup-checkpoint.mjs';
import { digest } from './integrity.mjs';
try {
  const checkpoint = workerData;
  if (checkpoint.stateHash === null) checkpoint.stateHash = digest(checkpoint.state);
  const bytes = encodeCheckpoint(checkpoint);
  if (digest(decodeCheckpoint(bytes)) !== digest(checkpoint)) throw new Error('checkpoint-round-trip');
  const transfer = Uint8Array.from(bytes);
  parentPort.postMessage({ bytes: transfer }, [transfer.buffer]);
} catch (error) {
  parentPort.postMessage({ error: /^(checkpoint)-[a-z-]+$/.test(error.message) ? error.message : 'checkpoint-encoding' });
}
