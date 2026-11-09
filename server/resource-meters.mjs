import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chairRoster } from '../public/chair-roster.js';
const runFile = promisify(execFile);
const count = n => Number.isSafeInteger(n) && n >= 0 && n <= 1000000000000 ? n : null;
const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
const label = value => typeof value === 'string' ? value.slice(0, 160) : null;
const usageFields = ['inputTokens','outputTokens','cachedInputTokens','reasoningTokens'];

export function groupChairUsage(turns, chairNames = new Map()) {
  const groups = new Map();
  for (const turn of new Map(turns.map(t=>[t.taskId,t])).values()) {
    const id=turn.chatId+':'+turn.chairId;
    if(!groups.has(id))groups.set(id,{id,chatId:turn.chatId,chairId:turn.chairId,chair:turn.chair,models:[],turns:[],active:0,totals:Object.fromEntries(usageFields.map(k=>[k,{value:null,measured:0,partial:false}]))});
    const group=groups.get(id);group.chair=chairNames.get(id)??turn.chair;
    if(!group.models.includes(turn.model))group.models.push(turn.model);
    group.turns.push(turn);
    const active=['preparing','running','stopping'].includes(turn.status);if(active)group.active++;
    for(const field of usageFields){const total=group.totals[field],value=count(turn.usage?.[field]);if(value!==null){total.value=(total.value??0)+value;total.measured++;}if(turn.usage?.partial||active)total.partial=true;}
  }
  for(const group of groups.values())for(const total of Object.values(group.totals))if(total.measured<group.turns.length)total.partial=true;
  return [...groups.values()];
}

export function codexUsage(params) {
  const v = params?.tokenUsage?.total;
  if (!v || typeof params.threadId !== 'string' || typeof params.turnId !== 'string') return null;
  return { source: 'codex_thread_total', sourceId: params.threadId, threadId: params.threadId, turnId: params.turnId,
    inputTokens: count(v.inputTokens), outputTokens: count(v.outputTokens), cachedInputTokens: count(v.cachedInputTokens),
    cacheWriteInputTokens: count(v.cacheWriteInputTokens), reasoningTokens: count(v.reasoningOutputTokens), totalTokens: count(v.totalTokens) };
}
export class UsageAccumulator {
  constructor() { this.sources = new Map(); }
  observe(value) {
    if (!value || typeof value.sourceId !== 'string' || value.sourceId.length > 200) return null;
    const key = value.source + ':' + value.sourceId, prior = this.sources.get(key);
    const next = { source: label(value.source), sourceId: value.sourceId, ...(value.threadId ? { threadId: label(value.threadId), turnId: label(value.turnId) } : {}) };
    for (const field of ['inputTokens','outputTokens','cachedInputTokens','cacheWriteInputTokens','reasoningTokens','totalTokens']) next[field] = count(value[field]);
    if (next.totalTokens === null && next.inputTokens !== null && next.outputTokens !== null) next.totalTokens = next.inputTokens + next.outputTokens;
    if (prior?.totalTokens !== null && prior?.totalTokens !== undefined && next.totalTokens !== null && next.totalTokens < prior.totalTokens) return this.snapshot();
    if (next.reasoningTokens !== null && next.outputTokens !== null && next.reasoningTokens > next.outputTokens) next.reasoningTokens = null;
    if (next.cachedInputTokens !== null && next.inputTokens !== null && next.cachedInputTokens > next.inputTokens) next.cachedInputTokens = null;
    this.sources.set(key, next); return this.snapshot();
  }
  snapshot() {
    if (!this.sources.size) return null;
    const entries = [...this.sources.values()], result = { source: entries[0].source, observations: entries.length };
    for (const field of ['inputTokens','outputTokens','cachedInputTokens','cacheWriteInputTokens','reasoningTokens','totalTokens'])
      result[field] = entries.every(e => e[field] !== null) ? entries.reduce((n, e) => n + e[field], 0) : null;
    result.sourceIds = entries.map(e => ({ source: e.source, id: e.sourceId, ...(e.threadId ? { threadId: e.threadId, turnId: e.turnId } : {}) }));
    return result;
  }
}
export function accountMeters(value, checkedAt = null) {
  const raw = value?.rateLimitsByLimitId && typeof value.rateLimitsByLimitId === 'object'
    ? Object.entries(value.rateLimitsByLimitId) : value?.rateLimits ? [[value.rateLimits.limitId ?? 'subscription', value.rateLimits]] : [];
  return { accountId: label(value?.accountId), checkedAt, scope: 'account', ordinaryUsageAllowed: typeof value?.ordinaryUsageAllowed === 'boolean' ? value.ordinaryUsageAllowed : null,
    buckets: raw.slice(0, 32).map(([id, bucket]) => ({ id, name: label(bucket?.limitName) ?? label(id), model: label(bucket?.normalModelSlug), plan: label(bucket?.planType),
      reached: label(bucket?.rateLimitReachedType), windows: ['primary','secondary'].flatMap(key => {
        const window = bucket?.[key]; if (!window) return [];
        return [{ id: key, usedPercent: finite(window.usedPercent), durationMinutes: count(window.windowDurationMins), resetsAt: count(window.resetsAt) }];
      }), credits: bucket?.credits ? { balance: label(bucket.credits.balance), hasCredits: typeof bucket.credits.hasCredits === 'boolean' ? bucket.credits.hasCredits : null, unlimited: bucket.credits.unlimited === true } : null })) };
}
function csvFields(line) {
  const fields = []; let part = '', quoted = false;
  for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"') { if (quoted && line[i+1] === '"') { part += '"'; i++; } else quoted = !quoted; } else if (c === ',' && !quoted) { fields.push(part.trim()); part = ''; } else part += c; }
  fields.push(part.trim()); return fields;
}
export function parseNvidia(text) {
  return String(text).split(/\r?\n/).filter(Boolean).slice(0, 32).flatMap(line => {
    const fields = csvFields(line); if (fields.length !== 6 || !/^\d+$/.test(fields[0])) return [];
    const numeric = v => /^\d+(?:\.\d+)?$/.test(v) ? Number(v) : null;
    const load = numeric(fields[3]), used = numeric(fields[4]), total = numeric(fields[5]);
    return [{ id: fields[1].slice(0,100), index: Number(fields[0]), name: fields[2].slice(0,160), utilizationPercent: load !== null && load <= 100 ? load : null,
      usedBytes: used === null ? null : Math.round(used * 1048576), totalBytes: total === null ? null : Math.round(total * 1048576), scope: 'whole_device', source: 'NVIDIA driver / nvidia-smi' }];
  });
}
async function queryNvidia() {
  const candidates = process.platform === 'win32'
    ? [path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'nvidia-smi.exe'), path.join(process.env.ProgramW6432 ?? 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe')]
    : ['/usr/bin/nvidia-smi', '/usr/lib/wsl/lib/nvidia-smi'];
  for (const executable of candidates) {
    if (!await fs.stat(executable).then(s => s.isFile(), () => false)) continue;
    const env = Object.fromEntries(['SystemRoot','SYSTEMROOT','WINDIR','PATH','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','ProgramData','ProgramFiles','ProgramW6432','OS','PATHEXT','COMSPEC','LD_LIBRARY_PATH'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
    const result = await runFile(executable, ['--query-gpu=index,uuid,name,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'], { timeout: 4000, maxBuffer: 65536, windowsHide: true, shell: false, env });
    return parseNvidia(result.stdout);
  }
  return [];
}
const cpuTotals = cpus => cpus.reduce((a,c) => ({ idle: a.idle + c.times.idle, total: a.total + Object.values(c.times).reduce((n,v) => n+v,0) }), { idle:0,total:0 });
export class HardwareMeter {
  constructor({ query = queryNvidia, system = os, clock = Date.now } = {}) { this.query=query;this.system=system;this.clock=clock;this.cached=null;this.pending=null;this.previous=cpuTotals(system.cpus()); }
  async sample() {
    if (this.pending) return this.pending;
    if (this.cached && this.clock()-this.cached.sampledMs<3000) return this.cached;
    this.pending=(async()=>{
      const cpu=cpuTotals(this.system.cpus()),delta=cpu.total-this.previous.total;
      const utilizationPercent=delta>0?Math.max(0,Math.min(100,100*(1-(cpu.idle-this.previous.idle)/delta))):null;this.previous=cpu;
      let gpus=[],gpuError=null;try{gpus=await this.query();}catch{gpuError='GPU measurements are unavailable from this driver.';}
      this.cached={sampledMs:this.clock(),sampledAt:new Date(this.clock()).toISOString(),scope:'whole_device',cpu:{utilizationPercent,logicalProcessors:this.system.cpus().length},memory:{totalBytes:this.system.totalmem(),usedBytes:this.system.totalmem()-this.system.freemem()},gpus,gpuError:gpuError??(!gpus.length?'No supported GPU measurement is available.':null)};
      return this.cached;
    })().finally(()=>{this.pending=null;});return this.pending;
  }
}
export class ResourceMeters {
  constructor({ store, codex, localRunner, deskTasks, hardware = new HardwareMeter() }) { Object.assign(this,{store,codex,localRunner,deskTasks,hardware});this.account=null;this.accountAt=0;this.pending=null; }
  async view(chatId) {
    const state=this.store.state,chat=state.chats.find(c=>c.id===chatId),r=chat?chairRoster(state,chat):null;
    const models=r?[r.desk,...r.visitors].map(c=>state.models.find(m=>m.id===c.modelId)).filter(Boolean):[];
    const active=[...this.deskTasks.entries.values()].map(e=>e.task.model),runtime=this.localRunner.status();
    const cloud=[...models,...active].some(m=>m.runtime==='codex');
    const localModels=[...models,...active].filter(m=>!['codex','openai'].includes(m.runtime));
    const resident=runtime.busy||['ready','loading'].includes(runtime.phase),local=localModels.length>0||resident;
    const localRuntime=resident||localModels.some(m=>['bundled','gguf'].includes(m.runtime))?runtime:{phase:'external',backend:null,message:'Local connection: '+[...new Set(localModels.map(m=>m.name))].join(', ')};
    if(this.accountVersion!==this.codex.accountRevision){this.account=null;this.accountAt=0;this.accountVersion=this.codex.accountRevision;}
    if(cloud&&(!this.account||Date.now()-this.accountAt>30000)){
      this.pending??=(async()=>{try{this.account=await this.codex.meterStatus?.()??await this.codex.status();}catch{this.account={connected:false,error:'Subscription measurements are unavailable.'};}this.accountAt=Date.now();this.accountVersion=this.codex.accountRevision;})().finally(()=>{this.pending=null;});await this.pending;
    }
    const currentRates=Object.hasOwn(this.codex,'rates')?this.codex.rates:this.account?.rates;
    const account=cloud?{connected:this.account?.connected??false,plan:this.account?.account?.plan??null,error:this.account?.error??null,...accountMeters(currentRates,this.codex.ratesAt??this.account?.ratesCheckedAt??null)}:null;
    const recordedUsage=new Map((state.deskWork?.events??[]).filter(e=>e.kind==='task.usage').map(e=>[e.taskId,e.detail]));
    const exchanges=new Map(state.exchanges.map(e=>[e.id,e]));
    const turns=this.deskTasks.status().filter(t=>(!chatId||t.chatId===chatId)&&(t.startedAt||t.usage)).map(t=>{
      const metrics=exchanges.get(t.exchangeId)?.metrics;
      const measured=t.usage??recordedUsage.get(t.id)??metrics;
      return {taskId:t.id,chatId:t.chatId,chairId:t.chairId,chair:t.label,model:t.model.name,status:t.status,at:t.startedAt??t.createdAt,
        usage:measured?{...Object.fromEntries(usageFields.map(k=>[k,count(measured[k])])),partial:measured.partial===true}:null};
    });
    const names=new Map(state.chats.filter(c=>!chatId||c.id===chatId).flatMap(c=>{const roster=chairRoster(state,c);return [roster.desk,...roster.visitors].map(chair=>[c.id+':'+chair.id,chair.name]);}));
    return {subscription:account,local:local?{runtime:localRuntime,hardware:await this.hardware.sample(),waiting:this.deskTasks.status().filter(t=>t.phase==='Waiting for local runtime slot').length}:null,
      chairs:groupChairUsage(turns,names)};
  }
}
