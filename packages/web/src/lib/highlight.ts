const TOKEN = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\n]*|\/\*[\s\S]*?\*\/|\b\d+(?:\.\d+)?\b|\b(?:const|let|var|function|return|if|else|for|while|class|new|import|from|export|default|async|await|true|false|null|undefined)\b)/g;

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Small, safe syntax coloring for the Code tab; it never evaluates or injects source HTML. */
export function highlightCode(source: string): string {
  let out = '';
  let last = 0;
  for (const match of source.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    out += escapeHtml(source.slice(last, index));
    const token = match[0];
    const kind = token.startsWith('//') || token.startsWith('/*') ? 'comment'
      : token.startsWith('"') || token.startsWith("'") || token.startsWith('`') ? 'string'
        : /^\d/.test(token) ? 'number' : 'keyword';
    out += `<span class="syntax-${kind}">${escapeHtml(token)}</span>`;
    last = index + token.length;
  }
  return out + escapeHtml(source.slice(last));
}

/** One gutter row, right-aligned by CSS. Every row carries a number, so heights always match. */
function gutterRow(value: number): string {
  return `<span class="gutter-line">${value}</span>`;
}

/**
 * The line-number gutter beside a highlighted `<pre>`.
 *
 * Markup rather than CSS counters, because the code pane scrolls as one block and the numbers have
 * to scroll with it at exactly the same `line-height`; two independent counting schemes drift the
 * moment either side's font metrics change. Both come from `source.split('\n').length`, so the
 * gutter can never show more or fewer rows than the code it sits next to.
 */
export function renderGutter(source: string): string {
  const total = source.split('\n').length;
  let out = '';
  for (let i = 1; i <= total; i++) out += gutterRow(i);
  return out;
}
