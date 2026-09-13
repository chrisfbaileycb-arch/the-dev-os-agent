import * as esbuild from 'esbuild-wasm';
import wasmURL from 'esbuild-wasm/esbuild.wasm?url';
import { projectPlugin } from '../lib/bundle/plugin';
import type { ProjectFile } from '../lib/project';

// Builds a project entirely inside this worker: esbuild-wasm compiles once here (kept warm across
// builds, since the wasm module itself is a few megabytes and initializing it is the slow part),
// and every import — the visitor's own files or an npm package fetched from esm.sh — is resolved
// by the plugin in lib/bundle/plugin.ts. Running in a worker keeps that compile off the UI thread
// and keeps the wasm instance out of the main bundle entirely.
//
// `worker: false` on initialize because esbuild's default behavior is to spawn its own worker to
// stay off the caller's thread — a good default on the main thread, redundant and one more nested
// worker-creation to explain in a CSP here, since this code already IS the worker.

export interface BuildRequest { id: string; files: ProjectFile[]; entry: string; dependencies: Record<string, string>; kind: 'html' | 'react'; }
export type BuildResponse =
  | { id: string; ok: true; html: string }
  | { id: string; ok: false; errors: string[] };

let ready: Promise<void> | null = null;
function ensureReady(): Promise<void> {
  if (!ready) ready = esbuild.initialize({ wasmURL, worker: false });
  return ready;
}

function formatMessage(m: { text: string; location: { file: string; line: number } | null }): string {
  return m.location ? `${m.location.file}:${m.location.line}: ${m.text}` : m.text;
}

/**
 * A single self-contained HTML document: the bundle inlined, ready to hand to the sandbox shell.
 *
 * No CSP meta tag here — a `srcdoc` document inherits and intersects its embedding page's policy
 * with anything it declares for itself, so a meta tag here could only ever narrow what the main
 * app's own strict policy already allows, never widen it. That is why this HTML is delivered
 * through postMessage into public/sandbox.html rather than straight into a `srcdoc` iframe: that
 * page is a real navigation with its own server-set policy, which is where the permissive rules
 * this bundle needs actually live. See server/index.mjs's SANDBOX_CSP for the rest of that story.
 */
function htmlShell(js: string, css: string): string {
  return `<!doctype html>\n<html><head><meta charset="utf-8" />\n<style>html,body{margin:0;padding:0;min-height:100%;} ${css}</style>\n</head><body><div id="root"></div>\n<script>\ntry {\n${js}\n} catch (err) {\n  document.body.innerHTML = '<pre style="color:#c0392b;white-space:pre-wrap;padding:12px;font:12px/1.5 monospace;">Runtime error: ' + (err && err.stack || err) + '</pre>';\n}\n</script>\n</body></html>`;
}

async function build(req: BuildRequest): Promise<BuildResponse> {
  await ensureReady();
  const files: Record<string, string> = {};
  for (const f of req.files) files[f.path] = f.content;
  if (req.kind === 'html') {
    // No bundling needed: the html file is the whole app, referenced siblings are inlined by hand
    // if present (a css/js file next to it) since the sandbox shell has no server-side reach into
    // this project to fetch them from.
    let html = files[req.entry] ?? '';
    for (const [path, content] of Object.entries(files)) {
      if (path === req.entry) continue;
      if (path.endsWith('.css')) html = html.replace(new RegExp(`<link[^>]+href=["']\\.?/?${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'g'), `<style>${content}</style>`);
      if (path.endsWith('.js')) html = html.replace(new RegExp(`<script[^>]+src=["']\\.?/?${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*></script>`, 'g'), `<script>${content}</script>`);
    }
    return { id: req.id, ok: true, html };
  }
  try {
    const result = await esbuild.build({
      entryPoints: [req.entry], bundle: true, write: false, format: 'iife', target: 'es2020',
      jsx: 'automatic', jsxImportSource: 'react', platform: 'browser', logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      plugins: [projectPlugin(files, req.dependencies)],
      outdir: '/out',
    });
    if (result.errors.length) return { id: req.id, ok: false, errors: result.errors.map(formatMessage) };
    const js = result.outputFiles?.find(f => f.path.endsWith('.js'))?.text ?? '';
    const css = result.outputFiles?.find(f => f.path.endsWith('.css'))?.text ?? '';
    return { id: req.id, ok: true, html: htmlShell(js, css) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The build failed.';
    const errors = typeof error === 'object' && error && 'errors' in error && Array.isArray((error as { errors: unknown }).errors)
      ? (error as { errors: { text: string; location: { file: string; line: number } | null }[] }).errors.map(formatMessage)
      : [message];
    return { id: req.id, ok: false, errors };
  }
}

self.onmessage = async (event: MessageEvent<BuildRequest>) => {
  const response = await build(event.data);
  self.postMessage(response);
};
