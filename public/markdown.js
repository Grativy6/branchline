import { marked } from './vendor/marked.esm.js';

// Assistant text is rendered through this deliberately small, inert surface.
// The transcript remains the original Markdown; this function only creates the
// display representation used by the UI.
function escapeHtml(value, preserveEntities = false) {
  const pattern = preserveEntities ? /&(?!#\d+;|#x[\da-f]+;|[a-z][\da-z]*;)|[<>"']/gi : /[&<>"']/g;
  return String(value ?? '').replace(pattern, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function linkLabel(renderer, tokens) {
  // Nested labels use the same inert renderer, including literal raw HTML.
  return renderer.parser.parseInline(tokens);
}

const renderer = new marked.Renderer();

// Links are shown as readable text. Branchline does not turn assistant output
// into a navigation surface in this slice.
renderer.link = function inertLink({ href, tokens }) {
  const label = linkLabel(this, tokens);
  const url = escapeHtml(href, true);
  return `<span class="md-link">${label}${url ? ` <span class="md-link-url">(${url})</span>` : ''}</span>`;
};

// Images are represented by their alt text and source, never loaded.
renderer.image = function inertImage({ href, text, tokens }) {
  const label = tokens
    ? linkLabel(this, tokens)
    : escapeHtml(text ?? '');
  const url = escapeHtml(href, true);
  return `<span class="md-image">[image${label ? `: ${label}` : ''}${url ? ` (${url})` : ''}]</span>`;
};

// Raw HTML is content, not markup. Marked's normal output remains available for
// Markdown structure (paragraphs, lists, code, blockquotes, and tables).
renderer.html = function literalHtml({ text }) {
  return escapeHtml(text);
};

// Task-list syntax must not create an interactive input control.
renderer.checkbox = function inertCheckbox({ checked }) {
  return checked ? '☑ ' : '☐ ';
};

// Keep alignment presentation in CSS. This avoids parser-generated inline
// attributes and leaves the app's CSP surface entirely static.
renderer.tablecell = function staticTableCell({ tokens, header, align }) {
  const type = header ? 'th' : 'td';
  const alignment = align ? ` md-table-cell-${align}` : '';
  return `<${type} class="md-table-cell${alignment}">${this.parser.parseInline(tokens)}</${type}>\n`;
};

const markedOptions = {
  gfm: true,
  breaks: true,
  renderer,
};

/**
 * Render assistant Markdown into safe, inert HTML for a message body.
 *
 * This is display-only: callers must persist and pass the original text, not
 * the returned HTML. An unfinished fenced block is rendered as a code block,
 * which keeps streaming output readable until the closing fence arrives.
 */
export function renderMarkdown(text) {
  if (text == null || text === '') return '';
  return marked.parse(String(text), markedOptions);
}

export { escapeHtml };
