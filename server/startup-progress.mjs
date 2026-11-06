import fs from 'node:fs/promises';

const phases = new Set(['opening','preparing','ready','failed','cancelled','already_open']);
export async function startupProgress(file = process.env.BRANCHLINE_STARTUP_STATUS) {
  if (!file) return { phase:'none' };
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 16384) return { phase:'none' };
    const value = JSON.parse(await fs.readFile(file,'utf8'));
    if (!phases.has(value.phase) || typeof value.message !== 'string' || value.message.length > 1200
      || typeof value.modelIdentifier !== 'string' || value.modelIdentifier.length > 200
      || !Number.isInteger(value.modelPort) || value.modelPort < 1 || value.modelPort > 65535) return { phase:'none' };
    return { phase:value.phase, message:value.message, modelIdentifier:value.modelIdentifier, modelPort:value.modelPort };
  } catch { return { phase:'none' }; }
}
export function preparingModel(progress, model) {
  if (!['opening','preparing'].includes(progress.phase) || progress.modelIdentifier !== model?.model) return false;
  try { const url=new URL(model.baseUrl);return ['127.0.0.1','localhost','[::1]'].includes(url.hostname) && Number(url.port)===progress.modelPort; }
  catch { return false; }
}
