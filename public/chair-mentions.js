// Shared composer/server parser. Only the current human draft is parsed.
export const chairAlias = name => String(name).normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, '-');
export const chairMention = name => /\s/.test(name) ? `@{${name}}` : `@${name}`;
export function parseChairPrompt(text, chairs, selectedChairId = null) {
  text = String(text ?? '');
  const aliases = new Map();
  for (const chair of chairs) for (const alias of new Set([chairAlias(chair.name), chair.name.normalize('NFKC').toLocaleLowerCase()])) {
    const rows = aliases.get(alias) ?? []; rows.push(chair); aliases.set(alias, rows);
  }
  const markers = [], errors = [];
  let i = 0, lineStart = true;
  while (i < text.length) {
    const c = text[i];
    if (c === '\n') { lineStart = true; i++; continue; }
    if (lineStart && /[ \t]/.test(c)) { i++; continue; }
    if (lineStart && c === '>') { i = text.indexOf('\n', i); if (i < 0) break; continue; }
    lineStart = false;
    if (c === '\\') { i += 2; continue; }
    if (c === '`' || c === '~' && text.slice(i, i + 3) === '~~~') {
      let end = i + 1; while (text[end] === c) end++;
      const fence = text.slice(i, end), close = text.indexOf(fence, end);
      i = close < 0 ? text.length : close + fence.length; continue;
    }
    if (['"', '“', '‘', "'"].includes(c) && (i === 0 || /[\s([{=:]/.test(text[i - 1]))) {
      const closing = c === '“' ? '”' : c === '‘' ? '’' : c;
      const end = text.indexOf(closing, i + 1);
      if (end >= 0) { i = end + 1; continue; }
    }
    if (c !== '@' || i > 0 && !/[\s([{]/.test(text[i - 1])) { i++; continue; }
    const match = /^@(?:\{([^}\n]{1,200})\}|([\p{L}\p{N}_-]{1,200}))/u.exec(text.slice(i));
    if (!match) { i++; continue; }
    const end = i + match[0].length;
    if (/[\p{L}\p{N}_.@-]/u.test(text[end] ?? '')) { i = end; continue; }
    const name = match[1] ?? match[2], matches = aliases.get(chairAlias(name)) ?? [];
    const marker = { start: i, end, name, chairId: matches.length === 1 ? matches[0].id : null, label: matches.length === 1 ? matches[0].name : name };
    if (matches.length !== 1) errors.push(`${matches.length ? 'More than one chair matches' : 'No chair at this desk matches'} @${name}. Choose a unique chair name.`);
    markers.push(marker); i = end;
  }
  if (!markers.length) return { routed: false, sharedContext: '', sections: text.trim() && selectedChairId ? [{ chairId: selectedChairId, content: text.trim(), start: 0, end: text.length }] : [], markers, errors };
  if (markers.length > 32) errors.push('Use at most 32 addressed sections in one message.');
  const sections = markers.map((m, n) => ({ chairId: m.chairId, label: m.label, content: text.slice(m.end, markers[n + 1]?.start ?? text.length).replace(/^\s*:\s*/, '').trim(), start: m.end, end: markers[n + 1]?.start ?? text.length }));
  for (const section of sections) if (!section.content) errors.push(`Write an instruction after @${section.label}; empty sections do not start work.`);
  return { routed: true, sharedContext: text.slice(0, markers[0].start).trim(), sections, markers, errors };
}
