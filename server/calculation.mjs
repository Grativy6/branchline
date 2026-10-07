import { Worker } from 'node:worker_threads';

export function calculate({ program, input }, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./calculation-worker.mjs', import.meta.url), {
      workerData: { program, input }, resourceLimits: { maxOldGenerationSizeMb: 64, stackSizeMb: 2 },
      stdout: true, stderr: true,
    });
    worker.stdout.resume(); worker.stderr.resume();
    let settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer);
      signal?.removeEventListener('abort', abort); void worker.terminate();
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Calculation exceeded its time limit.')), 3000);
    const abort = () => finish(new Error('Calculation stopped.'));
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', result => finish(result.ok ? null : new Error(result.error), result.value));
    worker.once('error', () => finish(new Error('Calculation could not complete.')));
    worker.once('exit', () => { if (!settled) finish(new Error('Calculation stopped before returning a result.')); });
    if (signal?.aborted) abort();
  });
}
