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

/** Turn a raw browser script into the single-file document the preview can execute. */
export function wrapScriptDocument(script: string, css = ''): string {
  const wrapped = `(function() {\n  function __runScript() {\n${script}\n  }\n  if (document.readyState !== 'loading') {\n    __runScript();\n  } else {\n    window.addEventListener('DOMContentLoaded', __runScript);\n  }\n})();`;
  return `<!DOCTYPE html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>html, body { margin: 0; overflow: hidden; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #111; }${css}</style></head><body><script>\n${wrapped}\n</script></body></html>`;
}

function wrapHtmlFragment(html: string): string {
  if (/<(?:!doctype\s+html|html\b)/i.test(html)) return html;
  return `<!DOCTYPE html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>html, body { margin: 0; min-height: 100vh; background: #111; }</style></head><body>${html}</body></html>`;
}

function looksLikeExecutableScript(text: string): boolean {
  const code = text.trim();
  return code.length > 0 && /(?:\b(?:const|let|var|function|class)\s+|=>|document\.|window\.|addEventListener\s*\(|getElementById\s*\(|requestAnimationFrame\s*\()/m.test(code);
}


const RELATIVE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\bimport\s+)['"](\.{1,2}\/[^'"]*|\/[^'"]+)['"]/g;
const CANDIDATE_SUFFIXES = ['', '.tsx', '.ts', '.jsx', '.js', '.css', '.json', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];

/**
 * Relative imports a project's source files make that no project file satisfies.
 *
 * A reply cut off mid-project (a provider stream error, a free-tier output cap) often leaves the
 * first closed fence — `src/main.tsx` — importing `./App` and `./index.css` that never arrived.
 * Such a set looks like a project but can only fail in the bundler, so it is reported here and
 * treated as incomplete rather than runnable.
 */
export function missingLocalImports(files: ProjectFile[]): string[] {
  const known = new Set(files.map(f => f.path));
  const missing: string[] = [];
  for (const file of files) {
    if (!/\.(tsx?|jsx?|mjs)$/.test(file.path)) continue;
    const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
    for (const m of file.content.matchAll(RELATIVE_IMPORT)) {
      const spec = m[1];
      const parts: string[] = [];
      for (const part of (spec.startsWith('/') ? spec.slice(1) : dir ? `${dir}/${spec}` : spec).split('/')) {
        if (part === '' || part === '.') continue;
        if (part === '..') parts.pop(); else parts.push(part);
      }
      const target = parts.join('/');
      if (!CANDIDATE_SUFFIXES.some(suffix => known.has(target + suffix))) missing.push(`${file.path} -> ${spec}`);
    }
  }
  return missing;
}

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
  // A closed first file followed by an unfinished script is still an unfinished project.
  if ((text.match(/```/g) ?? []).length % 2 === 1) return null;
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
    // A set whose own imports dangle was truncated; it is not a project, so the recovery pass runs.
    const incomplete = missingLocalImports(files).length > 0;
    if (isReact && !incomplete) {
      const entry = reactEntry(paths);
      if (entry) return { files, entry, dependencies, kind: 'react' };
    }
    const html = paths.find(p => /\.html?$/.test(p));
    if (html) return { files, entry: html, dependencies, kind: 'html' };
    if (!incomplete) return null;
    // Incomplete: fall through so a sibling html fence or bare document can still carry the reply.
  }
  const htmlFences = found.filter(f => f.lang === 'html' || f.lang === 'htm');
  if (htmlFences.length === 1) {
    const doc = htmlFences[0].body.replace(/\n$/, '');
    const content = wrapHtmlFragment(stitchFragments(doc, codeBlocks(text, new Set([doc]))) ?? doc);
    return { files: [{ path: 'index.html', content }], entry: 'index.html', dependencies: {}, kind: 'html' };
  }
  // A complete document the reply carried directly, not inside any fence.
  const bare = rawDocument(text);
  if (bare) {
    const content = wrapHtmlFragment(stitchFragments(bare, codeBlocks(text, new Set([bare]))) ?? bare);
    return { files: [{ path: 'index.html', content }], entry: 'index.html', dependencies: {}, kind: 'html' };
  }
  // A single raw JS fence is a common game response. Give it a DOM shell rather than showing it
  // as inert transcript text; sibling CSS is preserved inside the generated style tag.
  const scriptFences = found.filter(f => ['js', 'javascript'].includes(f.lang) && !f.path);
  if (scriptFences.length === 1 && looksLikeExecutableScript(scriptFences[0].body)) {
    const css = found.filter(f => f.lang === 'css' && !f.path).map(f => f.body).join('\n');
    return { files: [{ path: 'index.html', content: wrapScriptDocument(scriptFences[0].body, css) }], entry: 'index.html', dependencies: {}, kind: 'html' };
  }
  // Also accept a complete/raw script in a response without markdown fences when it has clear DOM
  // or browser-loop syntax. Plain prose remains a non-project.
  if (!found.length && looksLikeExecutableScript(text) && !/<(?:html|body|script)\b/i.test(text)) {
    return { files: [{ path: 'index.html', content: wrapScriptDocument(text.trim()) }], entry: 'index.html', dependencies: {}, kind: 'html' };
  }
  return null;
}

/** The newest runnable reply stays visible while a follow-up is still being written. */
export function latestPreviewReply(messages: { role: string; content: string; runId?: string }[]): string {
  const replies = messages.filter(message => message.role === 'assistant' && !message.runId).reverse();
  return replies.find(message => parseProject(message.content))?.content ?? replies[0]?.content ?? '';
}

/**
 * A reference inside an HTML file resolved to one of the project's own files, or null.
 *
 * The sandbox shell serves no project files — the whole project reaches it as one document — so
 * every `href="styles.css"` and `src="app.js"` the model wrote has to be folded into that
 * document, and the model does not write them consistently: `styles.css`, `./styles.css`,
 * `/styles.css`, `css/styles.css` when the fence said `styles.css`, or the reverse. So the lookup
 * tries the path relative to the entry file's directory, then the bare path, then a basename
 * match when exactly one project file has that basename. A URL that points off the project
 * (http, data, a protocol-relative CDN) is never a project file and is left alone.
 */
export function resolveLocalRef(ref: string, files: Record<string, string>, entry: string): string | null {
  const raw = ref.trim().replace(/[?#].*$/, '');
  if (!raw || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) return null;
  const clean = raw.replace(/^\.?\//, '');
  const dir = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/')) : '';
  const candidates = [dir ? `${dir}/${clean}` : clean, clean];
  for (const candidate of candidates) {
    const normalized = normalizeForLookup(candidate);
    if (Object.hasOwn(files, normalized)) return normalized;
  }
  const base = clean.slice(clean.lastIndexOf('/') + 1).toLowerCase();
  const byBase = Object.keys(files).filter(path => path.slice(path.lastIndexOf('/') + 1).toLowerCase() === base);
  return byBase.length === 1 ? byBase[0] : null;
}

function normalizeForLookup(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop(); else out.push(part);
  }
  return out.join('/');
}

/** A neutral stand-in for an image the model referenced but could not produce: the path, on grey. */
export function placeholderImage(name: string): string {
  const label = name.replace(/^.*\//, '').slice(0, 40).replace(/[<>&"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="#e6e8ef"/><path d="M200 280l90-110 70 80 50-55 90 85z" fill="#c9cdd9"/><circle cx="430" cy="140" r="34" fill="#c9cdd9"/><text x="320" y="360" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="20" fill="#6b7083" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * The React scope a generated app reaches for without importing.
 *
 * A model that writes `useState(0)` at the top level of a fenced file — no `import { useState }
 * from 'react'` in that file — used to build cleanly and then die at load with
 * "ReferenceError: useState is not defined", because an ES module has no such global and nothing
 * put it there. The same goes for `React.memo(...)` or `<React.Fragment>` in a file that never
 * bound `React`: the automatic JSX runtime covers plain JSX, not an explicit `React.` reference.
 *
 * The fix belongs here rather than in the worker's bundling options: esbuild's `inject` takes a
 * transform-time copy of each named export, which would mean writing these files to a disk that
 * does not exist in this sandbox, and `define` substitutes text, so injecting an expression like
 * `(globalThis.React&&globalThis.React.useState)` would splice a bare `React &&` into every call
 * site and break minification. An import statement prepended to the file that needs it is both
 * simpler and honest: it resolves through the same esm.sh plugin as any other import, so the
 * bundle carries one shared React.
 *
 * It has to be per file. Imports are module-scoped, so an import on the entry does nothing for a
 * hook called unimported in `src/components/Counter.tsx`; and a project that imports React in one
 * file can still forget `useEffect` in another.
 */
export const REACT_HOOK_NAMES = ['useState', 'useEffect', 'useReducer', 'useRef', 'useMemo', 'useCallback', 'useContext', 'useLayoutEffect', 'useId', 'useTransition', 'useDeferredValue'] as const;

const IMPORT_CLAUSE = /\bimport\s+(?:type\s+)?([\s\S]*?)\s+from\s*['"][^'"]+['"]/g;

/** Is `name` already a binding in this file — imported from anywhere, or declared locally? */
function isBound(source: string, name: string): boolean {
  for (const m of source.matchAll(IMPORT_CLAUSE)) if (new RegExp(`(?<![\\w$])${name}(?![\\w$])`).test(m[1])) return true;
  if (new RegExp(`\\b(?:const|let|var|function|class)\\s+${name}(?![\\w$])`).test(source)) return true;
  // `const { useState } = React` and friends.
  return new RegExp(`\\b(?:const|let|var)\\s*\\{[^}]*(?<![\\w$])${name}(?![\\w$])[^}]*\\}\\s*=`).test(source);
}

/**
 * The imports one source file needs prepended so it runs with a clean React scope, or '' if none.
 *
 * Only `.tsx`/`.jsx` files are read — hooks are component-local and components live there, and a
 * bare `useState(` in a plain .ts helper is far more likely to be a local mock than a missing
 * import. A hook counts as used when it appears as a call (`useState(`), not as a property
 * (`React.useState(`), which is covered by binding `React` instead.
 */
export function missingReactImports(file: ProjectFile): string {
  if (!/\.(tsx|jsx)$/.test(file.path)) return '';
  const src = file.content;
  const hooks = REACT_HOOK_NAMES.filter(name => new RegExp(`(?<![\\w$.])${name}\\s*\\(`).test(src) && !isBound(src, name));
  const needsReact = /(?<![\w$.])React\s*\./.test(src) && !isBound(src, 'React');
  const lines: string[] = [];
  if (needsReact) lines.push("import * as React from 'react';");
  if (hooks.length) lines.push(`import { ${hooks.join(', ')} } from 'react';`);
  return lines.join('\n');
}

/** Does any file in this project reach for React scope it never imported? */
export function needsReactHookFallback(files: ProjectFile[]): boolean {
  return files.some(file => missingReactImports(file) !== '');
}

/**
 * The project with each source file's missing React imports prepended, when any are missing.
 *
 * Returns the same object when nothing is, so callers can compare identity. This runs only on the
 * copy handed to the bundler: the visitor's own sources stay byte-identical in the Code view and in
 * anything they download or push.
 */
export function withReactHookImports(project: Project): Project {
  if (!needsReactHookFallback(project.files)) return project;
  const files = project.files.map(file => {
    const imports = missingReactImports(file);
    return imports ? { ...file, content: `${imports}\n${file.content}` } : file;
  });
  return { ...project, files };
}

/** Give a standalone React component a browser mount point for the preview build. */
export function preparePreviewProject(project: Project): Project {
  const hooked = withReactHookImports(project);
  if (hooked.kind !== 'react' || !/(?:^|\/)App\.[jt]sx$/.test(hooked.entry)) return hooked;
  const component = hooked.files.find(file => file.path === hooked.entry);
  if (!component || /\b(?:createRoot|ReactDOM\.render)\s*\(/.test(component.content)) return hooked;
  const entry = '__preview_main.tsx';
  const importPath = `./${hooked.entry.replace(/\.[jt]sx$/, '')}`;
  const hasDefault = /\bexport\s+default\b/.test(component.content);
  const hasNamedApp = /\bexport\s+(?:function|const|class)\s+App\b/.test(component.content);
  const hasLocalApp = /\b(?:function|const|class)\s+App\b/.test(component.content);
  if (!hasDefault && !hasNamedApp && !hasLocalApp) return hooked;
  const files = hooked.files.map(file => file.path === component.path && !hasDefault && !hasNamedApp
    ? { ...file, content: `${file.content}\nexport default App;` } : file);
  const importStatement = hasNamedApp ? `import { App } from '${importPath}';` : `import App from '${importPath}';`;
  return { ...hooked, entry, files: [...files, { path: entry, content: `import { createRoot } from 'react-dom/client';\n${importStatement}\ncreateRoot(document.getElementById('root')!).render(<App />);` }] };
}

const attr = (tag: string, name: string): string | null => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
};

/**
 * Fold a project's own stylesheets, scripts and SVGs into its HTML entry, and give every image
 * the model referenced but did not write a visible placeholder instead of a broken-image icon.
 *
 * A CDN reference (`https://…`) is untouched: the sandbox is allowed to fetch those itself. Only
 * references that resolve to a file in this project are inlined, so a `<link>` to Font Awesome
 * stays a `<link>` and a `<link>` to `styles.css` becomes the stylesheet's text in a `<style>`.
 */
export function inlineLocalAssets(html: string, files: Record<string, string>, entry: string): string {
  let out = html;
  out = out.replace(/<link\b[^>]*>/gi, tag => {
    const rel = attr(tag, 'rel') ?? '';
    const href = attr(tag, 'href');
    if (!/stylesheet/i.test(rel) || !href) return tag;
    const path = resolveLocalRef(href, files, entry);
    if (!path || !/\.css$/i.test(path)) return tag;
    return `<style data-inlined="${path}">\n${files[path]}\n</style>`;
  });
  out = out.replace(/<script\b([^>]*)>\s*<\/script>/gi, (tag, attrs: string) => {
    const src = attr(tag, 'src');
    if (!src) return tag;
    const path = resolveLocalRef(src, files, entry);
    if (!path) return tag;
    const type = attr(tag, 'type');
    const typeAttr = type && /module/i.test(type) ? ' type="module"' : '';
    void attrs;
    return `<script${typeAttr} data-inlined="${path}">\n${files[path].replace(/<\/script/gi, '<\\/script')}\n</script>`;
  });
  out = out.replace(/<img\b[^>]*>/gi, tag => {
    const src = attr(tag, 'src');
    if (!src || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src.trim())) return tag;
    const path = resolveLocalRef(src, files, entry);
    const replacement = path && /\.svg$/i.test(path)
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(files[path])}`
      : path ? null : placeholderImage(src);
    if (!replacement) return tag;
    return tag.replace(/\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, `src="${replacement}"`);
  });
  return out;
}
