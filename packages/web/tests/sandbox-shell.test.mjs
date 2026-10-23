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

test("the shell's own script is one element: no literal closing tag or comment opener inside it", () => {
  // The helper tests above slice functions out of this file as text, so they cannot see this: a
  // closing-tag sequence anywhere in the shell's script, even in a comment, ends the element there and
  // the message listener below it is never registered, so every preview is blank.
  assert.equal((shell.match(/<\/script/gi) ?? []).length, 1, 'exactly one closing tag: the real end of the script');
  assert.equal((shell.match(/<!--/g) ?? []).length, 0);
});

test('a script that sets tailwind.config runs at once when tailwind is loaded, and otherwise waits for the DOM', () => {
  const out = wrapClientScripts('<script>tailwind.config = { theme: {} }</script>');
  assert.match(out, /typeof tailwind !== "undefined" \|\| document\.readyState/);
  // No other script gets that shortcut.
  assert.doesNotMatch(wrapClientScripts('<script>document.title = "x";</script>'), /typeof tailwind/);
});

test('deferred code is handed to a script element, so its top-level names stay global', () => {
  const out = wrapClientScripts('<script>function go(){}</script>');
  assert.match(out, /createElement\("script"\)/);
  // The page's own code is data to the wrapper, never the body of a function that would scope it.
  assert.doesNotMatch(out, /function __runScript\(\)\{\n\s*function go/);
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

// What the page actually does once the shell has rewritten it. These run in Chromium rather than
// reading the output as text, because whether a handler can reach a function is a matter of how the
// browser scopes the code, not of how the string looks.
const chromiumOnly = { skip: hasChromium ? false : 'Chromium unavailable in this environment' };
// The real shim, not the placeholder above: it carries the DOMContentLoaded rescue and the error banner.
const realShell = new Function(`${shell.slice(shell.indexOf('var SHIM'), end)}; return { withShim };`)();

async function inChromium(prepared, act, setup = async () => {}) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await setup(page);
    await page.setContent(prepared);
    await act(page);
    return { errors, title: await page.title() };
  } finally { await browser.close(); }
}

for (const [name, declaration] of [
  ['a function declaration', "function scrollToSection(id) { document.title = 'clicked-' + id; }"],
  ['a const arrow function', "const scrollToSection = (id) => { document.title = 'clicked-' + id; };"],
  ['a var function expression', "var scrollToSection = function (id) { document.title = 'clicked-' + id; };"],
]) {
  test(`an inline onclick can call ${name} declared in the page's script`, chromiumOnly, async () => {
    // The nav buttons generated pages ship (`onclick="scrollToSection('x')"`) threw "is not defined"
    // while the script was wrapped in a function.
    const html = `<html><head></head><body><button id="b" onclick="scrollToSection('x')">go</button><script>${declaration}</script></body></html>`;
    const { errors, title } = await inChromium(withShim(html), page => page.click('#b'));
    assert.deepEqual(errors, []);
    assert.equal(title, 'clicked-x');
  });
}

test('a body onload attribute can call a function the page script declares', chromiumOnly, async () => {
  // `<body onload="initializeApp()">` sits near the top of the document and fires after load, so the
  // deferred script has to have run, in the global scope, by then.
  const html = "<html><head></head><body onload=\"initializeApp()\"><script>function initializeApp() { document.title = 'initialized'; }</script></body></html>";
  const { errors, title } = await inChromium(withShim(html), page => page.waitForFunction(() => document.title === 'initialized'));
  assert.deepEqual(errors, []);
  assert.equal(title, 'initialized');
});

test('page script still waits for the DOM, so a script in the head can find elements below it', chromiumOnly, async () => {
  const html = "<html><head><script>document.title = document.getElementById('late') ? 'saw-late' : 'missing';</script></head><body><p id='late'>x</p></body></html>";
  const { errors, title } = await inChromium(withShim(html), () => {});
  assert.deepEqual(errors, []);
  assert.equal(title, 'saw-late');
});

test('a DOMContentLoaded listener registered from deferred page code still runs', chromiumOnly, async () => {
  const html = "<html><head></head><body><script>document.addEventListener('DOMContentLoaded', function () { document.title = 'listener-ran'; });</script></body></html>";
  const { title } = await inChromium(realShell.withShim(html), page => page.waitForFunction(() => document.title === 'listener-ran'));
  assert.equal(title, 'listener-ran');
});

test('text in the page script that looks like a comment opener or a tag cannot break the wrapper', chromiumOnly, async () => {
  // `<!--` followed by `<script` puts an HTML parser into a state where the wrapper's own </script> is ignored.
  const html = '<html><head></head><body><script>document.title = "a<!--<script>b";</script></body></html>';
  const { errors, title } = await inChromium(withShim(html), () => {});
  assert.deepEqual(errors, []);
  assert.equal(title, 'a<!--<script>b');
});

test('an error thrown by deferred page code is still reported in the error banner', chromiumOnly, async () => {
  const html = '<html><head></head><body><script>missingFunction();</script></body></html>';
  let banner = '';
  await inChromium(realShell.withShim(html), async page => { banner = await (await page.waitForSelector('[data-preview-error]')).textContent(); });
  assert.match(banner, /missingFunction is not defined/);
});

// The Play CDN is stubbed at the network layer: these check ordering, which is the shell's business, not the library's.
const tailwindStub = page => page.route('https://cdn.tailwindcss.com/**', route => route.fulfill({ contentType: 'text/javascript', body: 'window.tailwind = {};' }));

test('tailwind.config runs in place when the library is already loaded, as the Play CDN documents', chromiumOnly, async () => {
  // The probe names both readyState and DOMContentLoaded, so the shell leaves it unwrapped and it runs
  // at parse time: it sees the config only if the config ran in place rather than waiting for the DOM.
  const html = '<html><head><script src="https://cdn.tailwindcss.com"></script><script>tailwind.config = { theme: {} };</script><script>/* DOMContentLoaded */ window.seen = typeof tailwind.config + "|" + document.readyState;</script></head><body></body></html>';
  let seen = '';
  const { errors } = await inChromium(withShim(html), async page => { seen = await page.evaluate(() => window.seen); }, tailwindStub);
  assert.deepEqual(errors, []);
  assert.equal(seen, 'object|loading');
});

test('tailwind.config written above the CDN tag still works, because it waits for the library', chromiumOnly, async () => {
  // Models write this order too. Left to run in place it throws "tailwind is not defined".
  const html = '<html><head><script>tailwind.config = { theme: {} }; document.title = "configured";</script><script src="https://cdn.tailwindcss.com"></script></head><body></body></html>';
  const { errors, title } = await inChromium(withShim(html), () => {}, tailwindStub);
  assert.deepEqual(errors, []);
  assert.equal(title, 'configured');
});
