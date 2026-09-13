import type { Loader, OnResolveArgs, Plugin, PluginBuild } from 'esbuild-wasm';

// One esbuild plugin covering both halves of a project's imports: the visitor's own files, held
// in memory rather than on a disk that does not exist, and everything else, fetched from esm.sh
// at build time so the bundle that reaches the preview iframe needs no further network access.
//
// Two made-up namespaces carry that split through esbuild's resolve/load cycle: `vfs` for a
// project file, `http` for anything pulled from esm.sh. A relative import inside an `http` module
// stays in `http`, resolved against the URL that produced it — esm.sh's own modules import each
// other by root-relative path, which is exactly what a browser's URL resolution already knows how
// to do with a base. A relative import inside `vfs` stays in `vfs`. Anything else — a bare
// specifier like "react" — is not on disk and was never going to be, so it always means esm.sh.

const LOADERS: Record<string, Loader> = { '.tsx': 'tsx', '.ts': 'ts', '.jsx': 'jsx', '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.css': 'css', '.json': 'json' };
const loaderFor = (path: string): Loader => LOADERS[path.slice(path.lastIndexOf('.'))] ?? 'text';
/** Bare-specifier resolution order when an import omits its extension, folder-import last. */
const CANDIDATES = ['', '.tsx', '.ts', '.jsx', '.js', '.css', '.json', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];

/** Collapse `a/./b/../c` to `a/c` without touching a real filesystem — there is none here. */
function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop(); else out.push(part);
  }
  return out.join('/');
}

/**
 * The esm.sh URL for a bare import, honoring a version pinned in the project's own package.json.
 *
 * Exported so the version-pinning rule is unit-testable without spinning up esbuild: a scoped
 * package's name is its first two path segments ("@radix-ui/react-slot"), an unscoped one just
 * its first, and whatever follows is a subpath export ("react-dom/client" -> "/client") that
 * esm.sh serves directly off the same package.
 *
 * No `?bundle` on these URLs, deliberately. esm.sh's `?bundle` makes a module carry private,
 * inlined copies of all of its dependencies — so a project importing both `react` and
 * `react-dom/client` ends up with two unrelated Reacts in the bundle: react-dom's private one
 * installs the hooks dispatcher on its own copy, the app's `useState` reads from the other, and
 * every component crashes with "Cannot read properties of null (reading 'useState')" at first
 * render. Without it, esm.sh serves ordinary modules whose imports resolve to shared, canonical
 * esm.sh URLs, and esbuild's path-keyed dedupe folds them into the single copy the app expects.
 */
export function esmUrl(specifier: string, dependencies: Record<string, string>): string {
  const scoped = specifier.startsWith('@');
  const segments = specifier.split('/');
  const name = scoped ? segments.slice(0, 2).join('/') : segments[0];
  const subpath = segments.slice(scoped ? 2 : 1).join('/');
  const pinned = dependencies[name]?.replace(/^[\^~]/, '');
  const base = pinned ? `${name}@${pinned}` : name;
  return `https://esm.sh/${base}${subpath ? `/${subpath}` : ''}`;
}

export interface ResolveFailure { text: string; }

/**
 * Resolve a relative import against a `vfs` importer's directory, probing `CANDIDATES` for the
 * first path the project actually has. Returns null rather than throwing when nothing matches,
 * so the caller can report exactly which import failed and from where.
 */
export function resolveRelative(path: string, importer: string, files: Record<string, string>): string | null {
  const dir = importer.includes('/') ? importer.slice(0, importer.lastIndexOf('/')) : '';
  const joined = path.startsWith('/') ? path.slice(1) : dir ? `${dir}/${path}` : path;
  const target = normalize(joined);
  for (const suffix of CANDIDATES) if (Object.hasOwn(files, target + suffix)) return target + suffix;
  return null;
}

export function projectPlugin(files: Record<string, string>, dependencies: Record<string, string>, fetchImpl: typeof fetch = fetch): Plugin {
  const httpCache = new Map<string, string>();
  return {
    name: 'hey-buddy-project',
    setup(build: PluginBuild) {
      build.onResolve({ filter: /.*/ }, (args: OnResolveArgs) => {
        if (args.namespace === 'http') {
          if (args.path.startsWith('.') || args.path.startsWith('/')) return { path: new URL(args.path, args.importer).toString(), namespace: 'http' };
          return { path: esmUrl(args.path, dependencies), namespace: 'http' };
        }
        if (args.kind === 'entry-point') return { path: normalize(args.path), namespace: 'vfs' };
        if (args.path.startsWith('.') || args.path.startsWith('/')) {
          const resolved = resolveRelative(args.path, args.importer, files);
          if (!resolved) return { errors: [{ text: `Cannot find "${args.path}", imported from "${args.importer}".` }] };
          return { path: resolved, namespace: 'vfs' };
        }
        return { path: esmUrl(args.path, dependencies), namespace: 'http' };
      });
      build.onLoad({ filter: /.*/, namespace: 'vfs' }, args => {
        if (!Object.hasOwn(files, args.path)) return { errors: [{ text: `"${args.path}" is not one of the project's files.` }] };
        return { contents: files[args.path], loader: loaderFor(args.path) };
      });
      build.onLoad({ filter: /.*/, namespace: 'http' }, async args => {
        const cached = httpCache.get(args.path);
        if (cached !== undefined) return { contents: cached, loader: 'js' };
        let response: Response;
        try { response = await fetchImpl(args.path); }
        catch { return { errors: [{ text: `Could not reach ${args.path}.` }] }; }
        if (!response.ok) return { errors: [{ text: `${args.path} answered HTTP ${response.status}.` }] };
        const text = await response.text();
        httpCache.set(args.path, text);
        return { contents: text, loader: 'js' };
      });
    },
  };
}
