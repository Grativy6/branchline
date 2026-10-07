// Scan each incoming character once. A large unfinished data line is held as
// chunks, rather than repeatedly concatenated and rescanned on every read.
export function eventStreamParser(onEvent) {
  const decoder = new TextDecoder();
  let pieces = [], data = [], eventName = '', afterCR = false;
  const line = () => {
    const text = pieces.join(''); pieces = [];
    if (!text) {
      if (data.length) {
        let event;
        try { event = JSON.parse(data.join('\n')); }
        catch { throw new Error('The local model returned malformed streaming data.'); }
        if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('The local model returned malformed streaming data.');
        if (eventName && !event.type) event.type = eventName;
        onEvent(event);
      }
      data = []; eventName = '';
    } else if (text.startsWith('event:')) eventName = text.slice(6).trim();
    else if (text.startsWith('data:')) data.push(text.slice(5).replace(/^ /, ''));
  };
  const consume = text => {
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (afterCR) { afterCR = false; if (c === 10) { start = i + 1; continue; } }
      if (c !== 10 && c !== 13) continue;
      pieces.push(text.slice(start, i)); line(); start = i + 1; afterCR = c === 13;
    }
    if (start < text.length) pieces.push(text.slice(start));
  };
  return { push: bytes => consume(decoder.decode(bytes, { stream: true })), finish: () => consume(decoder.decode()) };
}
