import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import esbuildNs from 'esbuild-wasm/lib/browser.js';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
// Resolution through the package, not a hand-counted path: npm hoists this to the workspace root.
const esbuildWasmPath = require.resolve('esbuild-wasm/esbuild.wasm');

// The full preview pipeline, executed for real: build a small React app with esbuild-wasm and the
// same plugin the preview worker uses — fetching react and react-dom from esm.sh, exactly as a
// visitor's build does — then run the finished HTML in headless Chromium and click the button.
//
// This test exists because both preview bugs so far were invisible to every cheaper check: a
// `?bundle` suffix on esm.sh URLs put two private copies of React in one bundle (react-dom
// installed the hooks dispatcher on its copy, the app's useState read from the other, every
// component crashed), and a strict CSP silently stopped the script from running at all. Neither
// shows up as a build error — only executing the app catches them.

const esbuild = esbuildNs.default ?? esbuildNs;
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;

const files = {
  'src/main.tsx': "import { createRoot } from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById('root')).render(<App />);\n",
  'src/App.tsx': "import { useState } from 'react';\nimport './App.css';\nexport default function App() {\n  const [n, setN] = useState(0);\n  return <div className=\"app\"><p id=\"count\">Count: {n}</p><button id=\"inc\" onClick={() => setN(n + 1)}>Increment</button></div>;\n}\n",
  'src/App.css': '.app { padding: 12px; }',
};
const dependencies = { react: '18.2.0', 'react-dom': '18.2.0' };

/** The preview plugin is TypeScript; node's test runner can't load that, so esbuild itself — already required here — compiles it on the fly. */
async function loadProjectPlugin() {
  const source = readFileSync(fileURLToPath(new URL('../src/lib/bundle/plugin.ts', import.meta.url)), 'utf8');
  const compiled = await esbuild.build({ stdin: { contents: source, loader: 'ts' }, write: false, format: 'esm', logLevel: 'silent' });
  const text = compiled.outputFiles[0].text;
  const mod = await import('data:text/javascript;base64,' + Buffer.from(text).toString('base64'));
  return mod.projectPlugin;
}

test('a built React app runs in a real browser and its state works', async () => {
  const wasmModule = new WebAssembly.Module(readFileSync(esbuildWasmPath));
  await esbuild.initialize({ wasmModule, worker: false });
  const projectPlugin = await loadProjectPlugin();
  const result = await esbuild.build({
    entryPoints: ['src/main.tsx'], bundle: true, write: false, format: 'iife', target: 'es2020',
    jsx: 'automatic', jsxImportSource: 'react', platform: 'browser', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [projectPlugin(files, dependencies)],
    outdir: '/out',
  });
  assert.equal(result.errors.length, 0);
  const js = result.outputFiles.find(f => f.path.endsWith('.js')).text;
  const css = result.outputFiles.find(f => f.path.endsWith('.css'))?.text ?? '';
  // The same shell the preview worker emits. No CSP meta tag: that is the point — the preview
  // shell's policy comes from the server response, not from the document.
  const html = `<!doctype html><html><head><meta charset="utf-8" /><style>html,body{margin:0;padding:0;min-height:100%;} ${css}</style></head><body><div id="root"></div><script>\ntry {\n${js}\n} catch (err) {\n  document.body.innerHTML = '<pre>' + (err && err.stack || err) + '</pre>';\n}\n</script></body></html>`;

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.setContent(html);
    await page.waitForSelector('#inc', { timeout: 15_000 });
    const before = await page.textContent('#count');
    assert.match(before, /Count: 0/);
    assert.equal(errors.length, 0, `the app threw: ${errors.join('; ')}`);
    await page.click('#inc');
    await page.click('#inc');
    const after = await page.textContent('#count');
    assert.match(after, /Count: 2/);
  } finally { await browser.close(); }
}, 120_000);
