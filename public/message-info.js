// Display preferences only. These values never enter the model's conversation.
const choices = [
  ['speed', 'Reply speed', 'Tokens per second, when the connection reports usage.'],
  ['firstWord', 'First-word wait', 'Time until the first visible text arrives.'],
  ['totalTime', 'Total time', 'Time from model dispatch to the end of its reply.'],
  ['tokens', 'Token counts', 'Input, output, and reasoning counts when reported.'],
  ['model', 'Model & connection', 'The model and connection used for this reply.'],
  ['finish', 'Completion status', 'Completed, stopped, failed, or length limit.'],
];
export const messageInfoKeys = Object.freeze(choices.map(([key]) => key));
export function messageInfoPreferences(value) { return Object.fromEntries(messageInfoKeys.map(key => [key, value?.[key] === true])); }
export function messageInfoSettings(value) {
  const settings = messageInfoPreferences(value);
  return `<form id="message-info-form"><h3>A little more information</h3><p class="muted">Choose what appears below model replies. Leave everything off for a quiet conversation.</p><div class="message-info-choices">${choices.map(([key, title, help]) => `<label class="message-info-choice"><input type="checkbox" name="${key}" ${settings[key] ? 'checked' : ''}><span><strong>${title}</strong><small>${help}</small></span></label>`).join('')}</div><p class="field-help">Measurements start with new replies. Older replies keep their original records. Missing token counts are shown as unavailable.</p><p class="field-help">“Overall” speed includes waiting and tools. “Generation” speed is reported by the runtime. These switches add no model calls or hardware polling.</p><p id="message-info-status" class="field-help" role="status"></p></form>`;
}
const seconds = ms => (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + ' s';
const number = n => n.toLocaleString('en-US');
const connection = runtime => runtime === 'codex' ? 'ChatGPT subscription' : runtime === 'lmstudio' ? 'LM Studio' : runtime === 'bundled' ? 'Included Qwen · local' : runtime === 'compatible' ? 'Local connection' : 'Connection not recorded';
function items(exchange, message) {
  const metrics = exchange?.metrics;
  const timingHelp = 'Measured from model dispatch, including connection, queue, prompt processing, and tool waits. Final history saving is excluded.';
  let speed = 'Speed unavailable', speedHelp = 'The connection did not report token counts or generation speed for this reply.';
  if (metrics?.reportedTokensPerSecond != null) {
    speed = metrics.reportedTokensPerSecond.toFixed(1) + ' tok/s generation';
    speedHelp = 'Generation speed reported by the runtime. Excludes the initial wait; may differ between runtimes.';
  } else if (metrics?.outputTokens != null && metrics.elapsedMs > 0) {
    speed = (metrics.outputTokens / (metrics.elapsedMs / 1000)).toFixed(1) + ' tok/s overall';
    speedHelp = 'Reported output tokens divided by total request time, including waits and tools. Output may include reasoning and tool-call tokens.';
  }
  const tokens = !metrics || (metrics.inputTokens === null && metrics.outputTokens === null) ? 'Token counts unavailable'
    : `${metrics.inputTokens === null ? '—' : number(metrics.inputTokens)} in / ${metrics.outputTokens === null ? '—' : number(metrics.outputTokens)} out${metrics.reasoningTokens === null ? '' : ` · ${number(metrics.reasoningTokens)} reasoning`}`;
  const status = exchange?.truncated ? 'Length limit' : exchange?.status === 'completed' ? 'Completed' : exchange?.status === 'cancelled' ? 'Stopped' : exchange?.status === 'failed' ? 'Failed' : 'Status not recorded';
  return {
    speed: [metrics ? speed : 'Speed not recorded', speedHelp],
    firstWord: [metrics?.firstTextMs != null ? `First word ${seconds(metrics.firstTextMs)}` : metrics ? 'First word unavailable' : 'First word not recorded', 'First visible, non-whitespace text received by Branchline. Hidden reasoning and network buffering can affect this wait; it is not a measurement of the first generated token.'],
    totalTime: [metrics ? `Total ${seconds(metrics.elapsedMs)}` : 'Time not recorded', timingHelp],
    tokens: [tokens, `Provider-reported counts${metrics?.rounds > 1 ? ` summed across ${metrics.rounds} model requests` : ''}. Reasoning, when reported, is included in output. Interrupted replies may have no complete counts.`],
    model: [`${exchange?.modelLabel || message?.modelLabel || 'Model not recorded'} · ${connection(exchange?.runtime)}`, exchange?.modelIdentifier || message?.modelIdentifier || ''],
    finish: [status, exchange?.finishReason ? `Provider finish reason: ${exchange.finishReason}` : status],
  };
}
export function messageInfoFooter(settings, exchange, message, escape) {
  const chosen = messageInfoKeys.filter(key => settings?.[key] === true);
  if (!chosen.length) return '';
  const info = items(exchange, message);
  return `<footer class="message-info" aria-label="Reply information">${chosen.map(key => `<span data-info="${key}" title="${escape(info[key][1])}">${escape(info[key][0])}</span>`).join('')}</footer>`;
}
export function messageInfoDetails(exchange, message, escape) {
  const info = items(exchange, message);
  return `<h3>Reply measurements</h3><dl class="reply-measurements">${choices.filter(([key]) => key !== 'model').map(([key, title]) => `<dt>${title}</dt><dd title="${escape(info[key][1])}">${escape(info[key][0])}</dd>`).join('')}</dl><p class="field-help">Times cover model dispatch through completion, including waiting and tools. Overall speed uses reported output counts; generation speed comes from the runtime. Counts may include hidden reasoning and tool calls. Earlier replies have no retroactive measurements.</p>`;
}
