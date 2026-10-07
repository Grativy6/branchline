// Model code runs INSIDE QuickJS WebAssembly, never in Node's eval/vm or shell.
import { parentPort, workerData } from 'node:worker_threads';
import { getQuickJS } from 'quickjs-emscripten';

try {
  const engine = await getQuickJS();
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(16 * 1024 * 1024);
  runtime.setMaxStackSize(256 * 1024);
  const deadline = Date.now() + 500;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const context = runtime.newContext();
  try {
    // JSON encoding is data quotation in a JS interpreter, not shell escaping.
    const source = `(function(){const value=(function(input) { "use strict";\n${workerData.program}\n})(${JSON.stringify(workerData.input)}); if(value && typeof value.then === 'function') throw new Error('Synchronous results only'); return JSON.stringify(value);})()`;
    const result = context.evalCode(source, 'calculation.js');
    try {
      if (result.error) throw new Error('Calculation failed or exceeded its limits.');
      const encoded = context.getString(result.value);
      if (!encoded || Buffer.byteLength(encoded) > 16384) throw new Error('Return a JSON-compatible result of at most 16 KiB.');
      parentPort.postMessage({ ok: true, value: JSON.parse(encoded) });
    } finally { result.error?.dispose(); result.value?.dispose(); }
  } finally { context.dispose(); runtime.dispose(); }
} catch (error) { parentPort.postMessage({ ok: false, error: error.message }); }
