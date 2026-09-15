import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CSP, SANDBOX_CSP, cspFor } from '../server/csp.mjs';

const root = '/srv/app/dist/';

test('every ordinary file gets the strict app policy', () => {
  assert.equal(cspFor(root + 'index.html', root), CSP);
  assert.equal(cspFor(root + 'assets/index-abc123.js', root), CSP);
  assert.equal(cspFor(root + 'manifest.webmanifest', root), CSP);
});

test('sandbox.html, and only sandbox.html, gets the permissive preview policy', () => {
  assert.equal(cspFor(root + 'sandbox.html', root), SANDBOX_CSP);
  assert.notEqual(cspFor(root + 'sandbox.html', root), cspFor(root + 'index.html', root));
});

test('a file that merely contains "sandbox.html" in its path does not match', () => {
  assert.equal(cspFor(root + 'not-sandbox.html', root), CSP);
  assert.equal(cspFor(root + 'nested/sandbox.html', root), CSP);
});

test('the strict policy has no unsafe-inline and no unsafe-eval anywhere', () => {
  assert.doesNotMatch(CSP, /unsafe-inline/);
  assert.doesNotMatch(CSP, /'unsafe-eval'/);
});

test('the sandbox policy lets a generated page look like a web page: CDN styles, fonts, images, scripts', () => {
  // Every one of these was blocked before, which rendered a portfolio site as unstyled Times New
  // Roman with broken image icons. The host app is protected by the iframe's opaque origin (no
  // allow-same-origin on the embedding frame), not by starving the page of the public internet.
  assert.match(SANDBOX_CSP, /style-src [^;]*https:/);
  assert.match(SANDBOX_CSP, /font-src [^;]*https:/);
  assert.match(SANDBOX_CSP, /img-src [^;]*https:/);
  assert.match(SANDBOX_CSP, /script-src [^;]*https:/);
  assert.match(SANDBOX_CSP, /connect-src [^;]*https:/);
});

test("the sandbox policy never grants 'self': the sandboxed document has an opaque origin and must not be able to name this one", () => {
  assert.doesNotMatch(SANDBOX_CSP, /'self'/);
  assert.match(SANDBOX_CSP, /default-src 'none'/);
  assert.match(SANDBOX_CSP, /object-src 'none'/);
  assert.match(SANDBOX_CSP, /form-action 'none'/);
});

test('the preview frame is embedded without allow-same-origin, which is what keeps the visitor\'s keys out of reach', () => {
  const panel = readFileSync(new URL('../src/ui/OutputPanel.tsx', import.meta.url), 'utf8');
  const sandboxAttr = panel.match(/sandbox="([^"]+)"/)?.[1] ?? '';
  assert.match(sandboxAttr, /allow-scripts/);
  assert.doesNotMatch(sandboxAttr, /allow-same-origin/);
  assert.doesNotMatch(sandboxAttr, /allow-top-navigation/);
});

test('the sandbox shell gives the page in-memory storage, since an opaque origin has none of its own', () => {
  const shell = readFileSync(new URL('../public/sandbox.html', import.meta.url), 'utf8');
  assert.match(shell, /localStorage/);
  assert.match(shell, /sessionStorage/);
  assert.match(shell, /Object\.defineProperty\(window,n/);
});
