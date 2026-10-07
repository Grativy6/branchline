import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { receiptFixture } from './receipt-fixture.mjs';
import { packHandoffs, unpackHandoffs, packetBytes } from '../server/handoff-wire.mjs';
import { explainReview } from '../server/review.mjs';

// Byte measurement only: synthetic material, no real model, network or training.
const instructions = 'Synthetic enduring guidance. '.repeat(500);
const cache = new Map(); const rows = []; let state;
for (let i = 0; i < 8; i++) {
  const f = receiptFixture({ instructions, state, taskId: 'task_measure_' + i, purpose: 'Synthetic distinct request ' + i, reply: 'Synthetic distinct outcome ' + i });
  state = f.state;
  const knownNodes = [...cache.keys()];
  const packet = packHandoffs(f.records, { known: knownNodes });
  assert.deepEqual(unpackHandoffs(packet, { cache }), f.records);
  rows.push({ exchange: i + 1, fullReceiptBytes: packetBytes(f.records), packetBytes: packetBytes(packet), advertisementBytes: packetBytes({ taskId: f.handle.taskId, knownNodes }), newNodes: Object.keys(packet.n).length });
}
const compact = state.handoffs.records.at(-1).detail.review;
const expanded = { version: compact.v, basis: compact.b, ...explainReview(compact) };
const total = key => rows.reduce((sum, row) => sum + row[key], 0);
const result = { measurement: 'UTF-8 JSON bytes, not tokens, latency, GPU cost or disk-store savings', synthetic: true,
  scenario: '8 separate tasks sharing unchanged 14,500-byte guidance; same receiver cache; three exact receipts per task',
  instructionsBytes: Buffer.byteLength(instructions), review: { compactBytes: packetBytes(compact), explainedBytes: packetBytes(expanded) }, exchanges: rows,
  totals: { fullReceiptBytes: total('fullReceiptBytes'), packetBytes: total('packetBytes'), advertisementBytes: total('advertisementBytes'), wireIncludingAdvertisements: total('packetBytes') + total('advertisementBytes') } };
const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test-results/compact-receipts.json');
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
