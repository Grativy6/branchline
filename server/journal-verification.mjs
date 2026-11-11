import {HistoryInputs} from './history-inputs.mjs';
import path from 'node:path';
import {mailFiles} from './pony-mail-state.mjs';
import { Worker, parentPort, workerData } from 'node:worker_threads';
import { replayJournal } from './journal.mjs';
import { imageObjects } from './images.mjs';
import {requiredDreamArtifacts} from './dream-artifacts.mjs';

// The full historical validator runs on the frozen copy, including intermediate
// states and receipt bodies. Only counts return; no model or tool runs here.
if (parentPort) {
  try {
    const inputs=new HistoryInputs(path.dirname(workerData.file));
    const parsed = await inputs.run(()=>replayJournal(workerData.file));inputs.verifyState(parsed.state);
    parentPort.postMessage({ recordCount: parsed.recordCount, bytes: parsed.bytes, images: imageObjects(parsed.state), dreamFiles:requiredDreamArtifacts(parsed.state), ponyFiles:mailFiles(parsed.state), historyFiles:inputs.files(parsed.state), ...(parsed.state.personalContext?.profiles.length?{hasPersonalContext:true}:{}) });
  } catch (error) { parentPort.postMessage({ error: error.message }); }
}

export function verifyJournal(file) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { file }, execArgv: [] });
    worker.once('message', result => result.error ? reject(new Error(result.error)) : resolve(result));
    worker.once('error', reject);
    worker.once('exit', code => { if (code !== 0) reject(new Error('Backup verification worker stopped.')); });
  });
}
