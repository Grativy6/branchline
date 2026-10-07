// Passive measurements, never parsed from model-authored text. Only bounded
// numbers survive the provider response; raw metadata is not stored.
const MAX_TIME = 7 * 24 * 60 * 60 * 1000;
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 100000000 ? value : null;
const rate = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 10000000 ? value : null;
const fields = ['version', 'elapsedMs', 'firstTextMs', 'inputTokens', 'outputTokens', 'reasoningTokens', 'rounds', 'reportedTokensPerSecond'];

export function validateReplyMetrics(value) {
  const validTime = n => Number.isInteger(n) && n >= 0 && n <= MAX_TIME;
  const validCount = n => n === null || (Number.isSafeInteger(n) && n >= 0 && n <= 900000000);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== fields.length || !fields.every(key => Object.hasOwn(value, key))
    || value.version !== 1 || !validTime(value.elapsedMs)
    || !(value.firstTextMs === null || (validTime(value.firstTextMs) && value.firstTextMs <= value.elapsedMs))
    || !['inputTokens', 'outputTokens', 'reasoningTokens'].every(key => validCount(value[key]))
    || !Number.isInteger(value.rounds) || value.rounds < 1 || value.rounds > 9
    || !(value.reportedTokensPerSecond === null || rate(value.reportedTokensPerSecond) !== null)
    || (value.rounds !== 1 && value.reportedTokensPerSecond !== null)
    || (value.reasoningTokens !== null && (value.outputTokens === null || value.reasoningTokens > value.outputTokens))) {
    throw new Error('Invalid reply measurements.');
  }
  return value;
}

export class ReplyMetrics {
  constructor(clock = () => performance.now()) {
    this.clock = clock; this.started = clock(); this.firstTextMs = null;
    this.round = 0; this.usage = new Map([[0, {}]]);
  }
  elapsed() { return Math.min(MAX_TIME, Math.max(0, Math.round(this.clock() - this.started))); }
  text(value) { if (this.firstTextMs === null && typeof value === 'string' && value.trim()) this.firstTextMs = this.elapsed(); }
  beginRound(round) {
    if (!Number.isInteger(round) || round < 0 || round > 8) return;
    this.round = round;
    if (!this.usage.has(round)) this.usage.set(round, {});
  }
  observe(data) {
    if (!data || typeof data !== 'object') return;
    const previous = this.usage.get(this.round), usage = data.usage;
    // Usage events are cumulative snapshots within a request, not increments.
    if (usage && typeof usage === 'object') {
      previous.inputTokens = count(usage.prompt_tokens);
      previous.outputTokens = count(usage.completion_tokens);
      const reasoning = count(usage.completion_tokens_details?.reasoning_tokens);
      previous.reasoningTokens = reasoning !== null && previous.outputTokens !== null && reasoning <= previous.outputTokens ? reasoning : null;
    }
    const speed = rate(data.stats?.tokens_per_second) ?? rate(data.timings?.predicted_per_second);
    if (speed !== null) previous.reportedTokensPerSecond = speed;
  }
  snapshot(complete = true) {
    const rounds = [...this.usage.values()];
    const sum = key => complete && rounds.every(r => r[key] !== undefined && r[key] !== null)
      ? rounds.reduce((n, r) => n + r[key], 0) : null;
    return validateReplyMetrics({ version: 1, elapsedMs: this.elapsed(), firstTextMs: this.firstTextMs,
      inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), reasoningTokens: sum('reasoningTokens'),
      rounds: rounds.length, reportedTokensPerSecond: complete && rounds.length === 1 ? rounds[0].reportedTokensPerSecond ?? null : null });
  }
}
