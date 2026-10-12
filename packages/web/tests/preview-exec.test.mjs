import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import esbuildNs from 'esbuild-wasm/lib/browser.js';
import { chromium } from 'playwright';
import { Window } from 'happy-dom';
import { previewRuntimeModules } from '../server/previewRuntime.mjs';
const require = createRequire(import.meta.url);
const esbuild = esbuildNs.default ?? esbuildNs;
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
const files = {
  'main.tsx': `import { createRoot } from 'react-dom/client';
import React, { createContext, useContext, useState } from 'react';
import { useContext as externalContext } from 'fixture-context-package';
const Context = createContext('wrong default');
function Child() { const n = externalContext(Context); return <p id="context">{n}</p>; }
function App() { const [n, setN] = useState(0); return <Context.Provider value="provider works"><Child /><p id="count">Count: {n}</p><button id="inc" onClick={() => setN(n+1)}>Increment</button></Context.Provider>; }
createRoot(document.getElementById('root')).render(<App />);`,
};
let html;
async function compilePreview() {
  if (html) return html;
  await esbuild.initialize({ wasmModule: new WebAssembly.Module(readFileSync(require.resolve('esbuild-wasm/esbuild.wasm'))), worker: false });
  const compiled = await esbuild.build({ stdin: { contents: readFileSync(new URL('../src/lib/bundle/plugin.ts', import.meta.url), 'utf8'), loader: 'ts' }, write: false, format: 'esm' });
  const { projectPlugin } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
  const fetchFixture = async url => {
    assert.equal(url, 'https://esm.sh/fixture-context-package');
    return new Response(`export { useContext } from '/react@18.2.0/es2022/react.mjs';`);
  };
  const result = await esbuild.build({ entryPoints: ['main.tsx'], bundle: true, write: false, format: 'iife', target: 'es2020', jsx: 'automatic', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [projectPlugin(files, { react: '18.2.0', 'react-dom': '19.3.0' }, fetchFixture, previewRuntimeModules())], outdir: '/out' });
  assert.equal(result.errors.length, 0);
  html = `<!doctype html><html><head></head><body><div id="root"></div><script>${result.outputFiles.find(f => f.path.endsWith('.js')).text}</script></body></html>`;
  return html;
}
test('preview React context and hooks share one isolated runtime even across versioned third-party imports', async () => {
  const window = new Window({ url: 'https://preview.example', settings: { enableJavaScriptEvaluation: true } });
  const errors = []; window.addEventListener('error', e => errors.push(e.message));
  try {
    window.document.write(await compilePreview());
    await window.happyDOM.whenAsyncComplete();
    assert.equal(window.document.querySelector('#context')?.textContent, 'provider works');
    assert.equal(window.document.querySelector('#count')?.textContent, 'Count: 0');
    window.document.querySelector('#inc').click();
    await window.happyDOM.whenAsyncComplete();
    assert.equal(window.document.querySelector('#count')?.textContent, 'Count: 1');
    assert.deepEqual(errors, []);
  } finally { await window.happyDOM.close(); }
});
const hasChromium = existsSync(chromium.executablePath());
test('the same context preview runs in Chromium', { skip: hasChromium ? false : 'Chromium download unavailable in this environment' }, async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.setContent(await compilePreview());
    assert.equal(await page.textContent('#context'), 'provider works');
    await page.click('#inc'); assert.equal(await page.textContent('#count'), 'Count: 1'); assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
