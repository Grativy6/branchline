// Shared composer/server parser. Only the current human draft is parsed.
export const chairAlias = name => String(name).normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, '-');
export const chairMention = name => /^[\p{L}\p{N}_-]+$/u.test(name) ? `@${name}` : `@{${name}}`;
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
    let match = /^@(?:\{([^}\n]{1,200})\}|([\p{L}\p{N}\p{M}\p{S}_\-\u200d]{1,200}))/u.exec(text.slice(i));
    if(text[i+1]!=='{'){
      const named=chairs.map(chair=>chair.name).sort((a,b)=>b.length-a.length).find(name=>text.slice(i+1,i+1+name.length).toLocaleLowerCase()===name.toLocaleLowerCase()&&!/^[\p{L}\p{N}\p{M}\p{S}\u200d_.@-]/u.test(text.slice(i+1+name.length)));
      if(named){const raw=text.slice(i+1,i+1+named.length);match=['@'+raw,undefined,raw];}
    }
    if (!match) { i++; continue; }
    const end = i + match[0].length;
    if (/^[\p{L}\p{N}\p{M}\p{S}\u200d_.@-]/u.test(text.slice(end))) { i = end; continue; }
    const name = match[1] ?? match[2], matches = aliases.get(chairAlias(name)) ?? [];
    const marker = { start: i, end, name, chairId: matches.length === 1 ? matches[0].id : null, label: matches.length === 1 ? matches[0].name : name };
    if (matches.length !== 1) errors.push(`${matches.length ? 'More than one chair matches' : 'No chair at this desk matches'} @${name}. Choose a unique chair name.`);
    markers.push(marker); i = end;
  }
  if (!markers.length) return { routed: false, sharedContext: '', sections: text.trim() && selectedChairId ? [{ chairId: selectedChairId, content: text.trim(), start: 0, end: text.length }] : [], markers, errors };
  if (markers.length > 32) errors.push('Use at most 32 addressed sections in one message.');
  const sections = markers.map((m, n) => ({ chairId: m.chairId, label: m.label, content: text.slice(m.end, markers[n + 1]?.start ?? text.length).replace(/^\s*:\s*/, '').trim(), start: m.end, end: markers[n + 1]?.start ?? text.length }));
  return { routed: true, sharedContext: text.slice(0, markers[0].start).trim(), sections, markers, errors };
}

// Explicit addresses choose the recipients; All is the unaddressed broadcast
// default. Repeated addresses collect directions into one turn for that chair.
export function routeChairPrompt(text, chairs, selectedChairId = null, mode = 'single') {
  const parsed = parseChairPrompt(text, chairs, selectedChairId);
  if (!parsed.routed && mode === 'all') {
    const occupied = chairs.filter(c => c.modelId !== null);
    return {...parsed, routed:true, broadcast:true, sections:occupied.map(c=>({chairId:c.id,label:c.name,content:String(text??'').trim()})),
      errors:occupied.length?parsed.errors:['Choose a model for at least one chair.']};
  }
  if (!parsed.routed || parsed.errors.length) return parsed;
  const sections=[];
  for (const section of parsed.sections) {
    const prior=sections.find(s=>s.chairId===section.chairId);
    if (prior) { prior.content=[prior.content,section.content].filter(Boolean).join('\n\n'); prior.end=section.end; }
    else sections.push({...section});
  }
  return {...parsed,sections};
}
