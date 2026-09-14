// Turning an agent's reply into a runnable project.
//
// The old Output panel showed a reply's raw text, code fences and all — a transcript, not a
// build artifact. A visitor asking for an app wants to see the app, so this module looks for the
// shape of one: a set of files, each its own fenced block, and decides whether that set adds up
// to something a browser can run.
//
// The convention: a fenced block's info string is normally a language name ("ts", "html") for
// prose that happens to contain code. A block meant as a real project file says so by using its
// path instead — ```src/App.tsx rather than ```tsx. That is the one signal this module trusts.
// The roster's Coder prompt asks for exactly this, but replies arrive from many providers with
// varying discipline, so a few common near-misses are read too: `title="path"` / `filename="path"`
// attributes after a language name, and a `// path` or `# path` comment on the fence's first line.
//
// A lone ```html block — the common case before this module existed, and still the common case
// for a single-file game or demo — is treated as a complete one-file project. Anything that is
// only prose (no path-bearing fence, no lone html block) is not a project; the panel falls back
// to showing the reply as text, exactly as it always has.

export interface ProjectFile { path: string; content: string; }
export type ProjectKind = 'html' | 'react';
export interface Project { files: ProjectFile[]; entry: string; dependencies: Record<string, string>; kind: ProjectKind; }

const FENCE = /```([^\n`]*)\n([\s\S]*?)```/g;
const BARE_LANGUAGES = new Set(['html', 'htm', 'js', 'javascript', 'jsx', 'ts', 'typescript', 'tsx', 'css', 'json', 'python', 'py', 'bash', 'sh', 'shell', 'zsh', 'text', 'plain', 'plaintext', 'markdown', 'md', 'yaml', 'yml', 'sql', 'diff', '']);
/** A safe, relative project path: no leading slash, no drive letter, no `..` segment, no NUL. */
const SAFE_PATH = /^(?!\/)(?!.*\.\.(?:\/|$))(?!.*\\)[A-Za-z0-9._][A-Za-z0-9._\-\/]{0,199}$/;

export function isSafeProjectPath(path: string): boolean {
  return SAFE_PATH.test(path) && !path.includes('\0');
}

/** The path a fence declares, from its info string or a leading comment — or null if it is a bare language. */
function fencePath(info: string, body: string): string | null {
  const trimmed = info.trim();
  const attr = trimmed.match(/(?:title|filename|path)\s*=\s*"([^"]+)"/i) ?? trimmed.match(/(?:title|filename|path)\s*=\s*'([^']+)'/i);
  if (attr) return attr[1].trim();
  const firstToken = trimmed.split(/\s+/)[0] ?? '';
  if (firstToken && !BARE_LANGUAGES.has(firstToken.toLowerCase()) && /[./]/.test(firstToken)) return firstToken;
  const firstLine = body.split('\n', 1)[0] ?? '';
  const commented = firstLine.match(/^\s*(?:\/\/|#|<!--)\s*([A-Za-z0-9._\-/]+\.[A-Za-z0-9]+)\s*(?:-->)?\s*$/);
  if (commented && (BARE_LANGUAGES.has(firstToken.toLowerCase()) || !firstToken)) return commented[1];
  return null;
}

/** Every fenced block in a reply, with whatever path (if any) it declared and its own body. */
function fences(text: string): { path: string | null; lang: string; body: string }[] {
  const out: { path: string | null; lang: string; body: string }[] = [];
  for (const m of text.matchAll(FENCE)) {
    const info = m[1] ?? ''; const body = m[2] ?? '';
    out.push({ path: fencePath(info, body), lang: info.trim().split(/\s+/)[0]?.toLowerCase() ?? '', body });
  }
  return out;
}

/**
 * The code-ish fence bodies a reply carries, excluding any already serving as project content.
 *
 * Used to repair HTML documents whose scripts and stylesheets arrived as sibling fences: a ```js
 * block beside an ```html one is most often the file the HTML points at, so it is inlined rather
 * than left to 404 against the sandbox shell, which serves no project files.
 */
function codeBlocks(text: string, except: Set<string>): string[] {
  const CODEISH = new Set(['js', 'javascript', 'jsx', 'ts', 'typescript', 'tsx', 'css']);
  return fences(text).filter(f => !f.path && CODEISH.has(f.lang) && !except.has(f.body.replace(/\n$/, ''))).map(f => f.body);
}

/**
 * A complete HTML document as it arrived, including directly in the reply text rather than a
 * fence — some providers emit the document bare. Matching is lazy so the first `</html>` ends
 * it, rather than swallowing everything up to a second, unrelated occurrence.
 */
function rawDocument(text: string): string | null {
  const match = text.match(/<!DOCTYPE html[\s\S]*?<\/html>|<html[\s\S]*?<\/html>/i);
  return match ? match[0] : null;
}

/** A rough shape test: does this fenced block read as CSS rather than as code? */
function looksLikeCss(block: string): boolean {
  const body = block.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (!body) return false;
  if (body.startsWith('@')) return true;
  if (/\b(function|const|let|var|class|import|export|document\.|window\.|=>)/.test(body.slice(0, 400))) return false;
  return /^[.#]?[A-Za-z\[][^{}]*\{/.test(body) && body.includes(':');
}

/**
 * Fold sibling code blocks into an HTML document so the script and stylesheet references a reply
 * wrote actually resolve, instead of 404ing against the sandbox shell, which serves no project
 * files. Each external reference is replaced with the next unconsumed sibling of its kind, and a
 * reference with no sibling left is dropped, which keeps the document runnable either way. Blocks
 * that no tag claimed join the document itself — but only where they cannot run twice, so a
 * document that already carries an inline script or style is left alone. Content that arrived
 * with no wrappers at all (a canvas, a few divs) gains the shell it needs.
 *
 * Returns null when nothing changed, which tells the caller to keep the text verbatim. A
 * self-contained document therefore comes back untouched.
 */
export function stitchFragments(doc: string, blocks: string[]): string | null {
  const scriptQueue = [...blocks.filter(b => !looksLikeCss(b))];
  const styleQueue = [...blocks.filter(looksLikeCss)];
  let out = doc.trim();
  let changed = false;

  out = out.replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']*["'][^>]*>\s*<\/script>/gi, () => {
    changed = true;
    const next = scriptQueue.shift();
    return next === undefined ? '' : `<script>\n${next}\n</script>`;
  });
  out = out.replace(/<link\b[^>]*rel\s*=\s*["']?stylesheet["']?[^>]*>/gi, () => {
    changed = true;
    const next = styleQueue.shift();
    return next === undefined ? '' : `<style>\n${next}\n</style>`;
  });

  const leftovers = [
    scriptQueue.length && !/<script\b/i.test(out) ? `<script>\n${scriptQueue.join('\n')}\n</script>` : '',
    styleQueue.length && !/<style\b/i.test(out) ? `<style>\n${styleQueue.join('\n')}\n</style>` : '',
  ].filter(Boolean);
  if (leftovers.length && /<\/body>/i.test(out)) {
    out = out.replace(/<\/body>/i, `${leftovers.join('\n')}\n</body>`);
    changed = true;
  } else if (leftovers.length && !/<(html|body)\b/i.test(out)) {
    out = `<!doctype html>\n<html><head><meta charset="utf-8" /></head><body>\n${out}\n${leftovers.join('\n')}\n</body></html>`;
    changed = true;
  }
  return changed ? out : null;
}

function parsePackageJson(text: string): Record<string, string> {
  try {
    const data = JSON.parse(text) as { dependencies?: unknown };
    const deps = data.dependencies;
    if (!deps || typeof deps !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [name, version] of Object.entries(deps)) if (typeof version === 'string') out[name] = version;
    return out;
  } catch { return {}; }
}

const REACT_ENTRY_PRIORITY = ['src/main.tsx', 'src/main.jsx', 'src/index.tsx', 'src/index.jsx', 'main.tsx', 'main.jsx', 'index.tsx', 'index.jsx', 'src/App.tsx', 'src/App.jsx', 'App.tsx', 'App.jsx'];

function reactEntry(paths: string[]): string | null {
  for (const candidate of REACT_ENTRY_PRIORITY) if (paths.includes(candidate)) return candidate;
  return paths.find(p => /\.(tsx|jsx)$/.test(p)) ?? null;
}

/**
 * Read a project out of an agent's reply, or return null when the reply is not one.
 *
 * Multi-file wins whenever at least one fence declared a real path: those files are the project,
 * verbatim, and any bare-language fences alongside them (an explanatory snippet, say) are ignored
 * rather than folded in. Failing that, a single ```html fence — the legacy shape — is a one-file
 * project on its own, with any sibling ```js / ```css fences stitched into it so the references
 * the model wrote resolve instead of 404ing. A complete document carried bare in the reply text
 * is read the same way. Anything that is only prose is not a project; the panel falls back to
 * showing the reply as text, exactly as it always has.
 */
export function parseProject(text: string): Project | null {
  const found = fences(text);
  const pathed = found.filter((f): f is { path: string; lang: string; body: string } => f.path !== null && isSafeProjectPath(f.path));
  if (pathed.length > 0) {
    const files: ProjectFile[] = [];
    const seen = new Set<string>();
    for (const f of pathed) { if (seen.has(f.path)) continue; seen.add(f.path); files.push({ path: f.path, content: f.body.replace(/\n$/, '') }); }
    const pkg = files.find(f => f.path === 'package.json' || f.path.endsWith('/package.json'));
    const dependencies = pkg ? parsePackageJson(pkg.content) : {};
    const paths = files.map(f => f.path);
    const isReact = paths.some(p => /\.(tsx|jsx)$/.test(p)) || 'react' in dependencies;
    if (isReact) {
      const entry = reactEntry(paths);
      if (entry) return { files, entry, dependencies, kind: 'react' };
    }
    const html = paths.find(p => /\.html?$/.test(p));
    if (html) return { files, entry: html, dependencies, kind: 'html' };
    return null;
  }
  const htmlFences = found.filter(f => f.lang === 'html' || f.lang === 'htm');
  if (htmlFences.length === 1) {
    const doc = htmlFences[0].body.replace(/\n$/, '');
    const content = stitchFragments(doc, codeBlocks(text, new Set([doc]))) ?? doc;
    return { files: [{ path: 'index.html', content }], entry: 'index.html', dependencies: {}, kind: 'html' };
  }
  // A complete document the reply carried directly, not inside any fence.
  const bare = rawDocument(text);
  if (bare) {
    const content = stitchFragments(bare, codeBlocks(text, new Set([bare]))) ?? bare;
    return { files: [{ path: 'index.html', content }], entry: 'index.html', dependencies: {}, kind: 'html' };
  }
  return null;
}
