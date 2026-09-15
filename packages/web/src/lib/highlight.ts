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
