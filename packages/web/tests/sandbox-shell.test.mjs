import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright';

// The sandbox shell's own functions, lifted out of public/sandbox.html so the test exercises the
// shipped code rather than a copy of it.
const shell = readFileSync(new URL('../public/sandbox.html', import.meta.url), 'utf8');
const start = shell.indexOf('var MODULE_SYNTAX');
const end = shell.indexOf('// Refuse to render anything unless');
assert.ok(start > 0 && end > start, 'sandbox.html should define the script helpers before the origin check');
const SHIM = '<!--shim-->';
const { wrapClientScripts, importMapFor, withShim } = new Function('SHIM', `${shell.slice(start, end)}; return { wrapClientScripts, importMapFor, withShim };`)(SHIM);

test('an inline classic script that imports becomes an unwrapped module', () => {
  const out = wrapClientScripts("<script>\nimport * as THREE from 'three';\nconsole.log(THREE);\n</script>");
  assert.match(out, /<script type="module">/);
  assert.doesNotMatch(out, /__runScript/);
  assert.match(out, /import \* as THREE from 'three';/);
});

test('a script that declares text/javascript keeps one type attribute, now module', () => {
  const out = wrapClientScripts('<script type="text/javascript" defer>\nimport x from "./x.js";\n</script>');
  assert.match(out, /<script  defer type="module">/);
  assert.equal((out.match(/type=/g) ?? []).length, 1);
});

test('module scripts are never wrapped, with or without imports', () => {
  const plain = '<script type="module">const a = await Promise.resolve(1);</script>';
  assert.equal(wrapClientScripts(plain), plain);
});

test('a classic script without module syntax is still deferred until the DOM is ready', () => {
  const out = wrapClientScripts('<script>document.title = "x";</script>');
  assert.match(out, /__runScript/);
  assert.match(out, /DOMContentLoaded/);
});

test('dynamic import() stays in a classic script, and non-JS script types are untouched', () => {
  assert.match(wrapClientScripts('<script>const m = import("./a.js");</script>'), /__runScript/);
  const json = '<script type="application/json">import x from "y"</script>';
  assert.equal(wrapClientScripts(json), json);
});

test('three gets one pinned import map, including its addons', () => {
  const html = wrapClientScripts("<script>import * as THREE from 'three';\nimport { OrbitControls } from 'three/addons/controls/OrbitControls.js';</script>");
  const map = JSON.parse(importMapFor(html).replace(/^<script type="importmap">|<\/script>$/g, '')).imports;
  assert.match(map.three, /three@[\d.]+\/build\/three\.module\.js$/);
  assert.match(map['three/addons/'], /three@[\d.]+\/examples\/jsm\/$/);
});

test('other bare packages come from esm.sh; relative and absolute specifiers are left alone', () => {
  const html = '<script type="module">import confetti from "canvas-confetti"; import d3 from "@scope/pkg/sub"; import a from "./a.js"; import b from "https://x.test/b.js";</script>';
  const map = JSON.parse(importMapFor(html).replace(/^<script type="importmap">|<\/script>$/g, '')).imports;
  assert.equal(map['canvas-confetti'], 'https://esm.sh/canvas-confetti');
  assert.equal(map['@scope/pkg'], 'https://esm.sh/@scope/pkg');
  assert.deepEqual(Object.keys(map).sort(), ['@scope/pkg', '@scope/pkg/', 'canvas-confetti', 'canvas-confetti/']);
});

test('no import map for pages with no bare imports, or that bring their own', () => {
  assert.equal(importMapFor('<script type="module">import "./a.js";</script>'), '');
  assert.equal(importMapFor('<script type="importmap">{"imports":{"three":"/t.js"}}</script><script type="module">import "three";</script>'), '');
});

test('the import map is placed ahead of the page scripts', () => {
  const out = withShim("<html><head><title>t</title></head><body><script>import * as THREE from 'three';</script></body></html>");
  assert.ok(out.indexOf('importmap') > 0 && out.indexOf('importmap') < out.indexOf('type="module"'));
  assert.ok(out.indexOf(SHIM) < out.indexOf('importmap'));
});

const hasChromium = existsSync(chromium.executablePath());
test('in Chromium a promoted inline script resolves a bare specifier through the generated map', { skip: hasChromium ? false : 'Chromium unavailable in this environment' }, async () => {
  // Point the map at a data: module so the check needs no network.
  const body = "<html><head></head><body><script>import { n } from 'three'; document.title = 'ok-' + n;</script></body></html>";
  const prepared = withShim(body).replace(/"three":"[^"]+"/, '"three":"data:text/javascript,export const n = 42;"');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setContent(prepared);
    await page.waitForFunction(() => document.title.startsWith('ok-'), null, { timeout: 5000 });
    assert.equal(await page.title(), 'ok-42');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
