import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright';
import * as acorn from 'acorn';
import { sandboxDocument } from '../server/sandboxDocument.mjs';

// The sandbox shell's own functions, lifted out of public/sandbox.html so the test exercises the
// shipped code rather than a copy of it.
const shell = sandboxDocument();
const start = shell.indexOf('var MODULE_SYNTAX');
const end = shell.indexOf('// Refuse to render anything unless');
assert.ok(start > 0 && end > start, 'sandbox.html should define the script helpers before the origin check');
const SHIM = '<!--shim-->';
const { wrapClientScripts, importMapFor, withShim } = new Function('SHIM', 'acorn', `${shell.slice(start, end)}; return { wrapClientScripts, importMapFor, withShim };`)(SHIM, acorn);

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

test('a duplicate top-level declaration falls back to running that script in its own scope', () => {
  assert.match(wrapClientScripts('<script>const a = 1;</script>'), /has already been declared/);
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
const realShell = new Function('acorn', `${shell.slice(shell.indexOf('var SHIM'), end)}; return { withShim };`)(acorn);

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

// A second script that re-declares a top-level const or let cannot run as a real classic script: the
// browser refuses the whole script. Long generated pages do this often, and the old function wrapper
// hid it, so the shell runs such a script in its own scope instead of losing it.
const twoScripts = (second, extra = '') => `<html><head></head><body>${extra}<script>const META = { n: 1 }; document.title = 'first';</script><script>${second}</script></body></html>`;
const bannerText = page => page.evaluate(() => { const b = document.querySelector('[data-preview-error]'); return b ? b.textContent : null; });

test('a script that re-declares a const from an earlier script still runs, once', chromiumOnly, async () => {
  const html = twoScripts("const META = { n: 2 }; window.runs = (window.runs || 0) + 1; document.title = 'second-ran';");
  let runs; let banner;
  const { title } = await inChromium(realShell.withShim(html), async page => {
    await page.waitForFunction(() => document.title === 'second-ran');
    runs = await page.evaluate(() => window.runs); banner = await bannerText(page);
  });
  assert.equal(title, 'second-ran');
  assert.equal(runs, 1);
  assert.equal(banner, null);
});

test('functions declared in a script that fell back are still reachable from inline handlers', chromiumOnly, async () => {
  const html = twoScripts("const META = { n: 2 }; function pick() { document.title = 'picked-' + META.n; }", '<button id="b" onclick="pick()">go</button>');
  const { title } = await inChromium(realShell.withShim(html), page => page.click('#b'));
  assert.equal(title, 'picked-2');
});

test('a const declared in a script that fell back is visible to a later script', chromiumOnly, async () => {
  // Without this, a page's data array (BOOKS, here) vanished with the script that declared it.
  const html = twoScripts("const META = { n: 2 }; const BOOKS = ['a', 'b'];").replace('</body>', "<script>document.title = 'books-' + BOOKS.length;</script></body>");
  const { title } = await inChromium(realShell.withShim(html), page => page.waitForFunction(() => document.title.startsWith('books-')));
  assert.equal(title, 'books-2');
});

test('an arrow-function const from a script that fell back works from an inline handler', chromiumOnly, async () => {
  const html = twoScripts("const META = { n: 2 }; const pick = () => { document.title = 'picked-' + META.n; };", '<button id="b" onclick="pick()">go</button>');
  const { title } = await inChromium(realShell.withShim(html), page => page.click('#b'));
  assert.equal(title, 'picked-2');
});

test('the fallback never replaces a real global such as window.name', chromiumOnly, async () => {
  // `name` is declared inside a nested function here, so it is not the script's own: exporting it
  // would redefine window.name as a getter that returns itself.
  const html = twoScripts("const META = { n: 2 }; function helper() { let name = 'inner'; return name; } document.title = 'name-is-' + typeof window.name;");
  const { title } = await inChromium(realShell.withShim(html), page => page.waitForFunction(() => document.title.startsWith('name-is-')));
  assert.equal(title, 'name-is-string');
});

test('a declaration repeated inside one script is still reported, not hidden', chromiumOnly, async () => {
  const html = '<html><head></head><body><script>const META = 1; const META = 2;</script></body></html>';
  let banner = '';
  await inChromium(realShell.withShim(html), async page => { banner = await (await page.waitForSelector('[data-preview-error]')).textContent(); });
  assert.match(banner, /has already been declared/);
});

test('an unrelated error in a script is reported, and the script is not run a second time', chromiumOnly, async () => {
  const html = '<html><head></head><body><script>window.runs = (window.runs || 0) + 1; missingFunction();</script></body></html>';
  let banner = ''; let runs;
  await inChromium(realShell.withShim(html), async page => {
    banner = await (await page.waitForSelector('[data-preview-error]')).textContent();
    runs = await page.evaluate(() => window.runs);
  });
  assert.match(banner, /missingFunction is not defined/);
  assert.equal(runs, 1);
});

test('module initializers used by body onload remain callable after import resolution', chromiumOnly, async () => {
  const html = `<html><head></head><body onload="initCosmosEngine()"><canvas id="scene"></canvas><script type="module">
    import { color } from 'scene-fixture';
    function initCosmosEngine() { const ctx = document.getElementById('scene').getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); document.title = 'canvas-ready'; }
  </script></body></html>`;
  const prepared = realShell.withShim(html).replace('https://esm.sh/scene-fixture', 'https://fixture.test/scene.js');
  let pixel;
  const { errors, title } = await inChromium(prepared, async page => {
    await page.waitForFunction(() => document.title === 'canvas-ready', null, { timeout: 1500 });
    pixel = await page.evaluate(() => Array.from(document.querySelector('canvas').getContext('2d').getImageData(0, 0, 1, 1).data));
  }, page => page.route('https://fixture.test/scene.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export const color = "rgb(255, 0, 0)";' })));
  assert.deepEqual(errors, []); assert.equal(title, 'canvas-ready'); assert.deepEqual(pixel, [255, 0, 0, 255]);
});

test('a promoted module exposes only functions requested by inline handlers', chromiumOnly, async () => {
  const html = `<html><head></head><body><button id="b" onclick="startScene()">start</button><script>
    export function startScene() { document.title = 'started'; }
    function privateHelper() {}
  </script></body></html>`;
  const { errors, title } = await inChromium(realShell.withShim(html), async page => {
    await page.click('#b'); assert.equal(await page.evaluate(() => typeof window.privateHelper), 'undefined');
  });
  assert.deepEqual(errors, []); assert.equal(title, 'started');
});

test('async initialization failures are visible in the preview error banner', chromiumOnly, async () => {
  const html = '<html><head></head><body><script>Promise.reject(new Error("WebGL initialization failed"));</script></body></html>';
  await inChromium(realShell.withShim(html), async page => {
    const banner = await page.waitForSelector('[data-preview-error]', { timeout: 1500 });
    assert.match(await banner.textContent(), /WebGL initialization failed/);
  });
});

test('document DOM-ready initialization sees engine declarations from earlier scripts', chromiumOnly, async () => {
  const html = `<html><head><script>function initScene() { document.title = document.getElementById('scene') ? 'initialized' : 'missing-canvas'; }</script>
  <script>if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initScene()); else initScene();</script>
  </head><body><canvas id="scene"></canvas></body></html>`;
  const { errors, title } = await inChromium(realShell.withShim(html), () => {});
  assert.deepEqual(errors, []); assert.equal(title, 'initialized');
});

test('WebGL context loss is reported without blocking unrelated controls', chromiumOnly, async () => {
  const html = '<html><head></head><body><canvas id="scene"></canvas><button id="b" onclick="document.title=\'still-working\'">click</button></body></html>';
  await inChromium(realShell.withShim(html), async page => {
    await page.evaluate(() => document.querySelector('canvas').dispatchEvent(new Event('webglcontextlost')));
    assert.match(await bannerText(page), /WebGL context lost/);
    await page.click('#b'); assert.equal(await page.title(), 'still-working');
  });
});

test('module handler bridging preserves explicit globals and ignores control-flow keywords', chromiumOnly, async () => {
  const html = `<html><head></head><body><button id="b" onclick="if (true) startScene()">start</button><script>window.startScene = () => { document.title = 'explicit'; };</script><script type="module">
    function startScene() { document.title = 'module'; }
  </script></body></html>`;
  const { errors, title } = await inChromium(realShell.withShim(html), page => page.click('#b'));
  assert.deepEqual(errors, []); assert.equal(title, 'explicit');
});

test('module canvas initialization works through the served opaque sandbox and CSP', chromiumOnly, async () => {
  const { createServer } = await import('node:http');
  const { SANDBOX_CSP } = await import('../server/csp.mjs');
  const server = createServer((req, res) => {
    if (req.url === '/sandbox.html') { res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': SANDBOX_CSP }); res.end(shell); }
    else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<iframe sandbox="allow-scripts" src="/sandbox.html"></iframe>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ html: '<html><head></head><body onload="initCosmosEngine()"><canvas id="scene"></canvas><script>if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js");</script><script type="module">function initCosmosEngine(){const ctx=document.querySelector("canvas").getContext("2d");ctx.fillStyle="red";ctx.fillRect(0,0,1,1);document.title="ready"}</script></body></html>' }, '*'));
    const preview = page.frameLocator('iframe').frameLocator('#preview-frame');
    await preview.locator('canvas').waitFor();
    const frame = page.frames().find(frame => frame.url() === 'about:srcdoc');
    await frame.waitForFunction(() => document.title === 'ready');
    assert.equal(await frame.evaluate(() => self.origin), 'null');
    assert.equal(await frame.evaluate(() => 'serviceWorker' in navigator), false);
    assert.deepEqual(await frame.evaluate(() => Array.from(document.querySelector('canvas').getContext('2d').getImageData(0,0,1,1).data)), [255,0,0,255]);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('duplicate data script publishes comma-separated tables before later initialization', chromiumOnly, async () => {
  const html = `<html><head></head><body><script>const TRADITION_META = { version: 1 };</script><script>
    const TRADITION_META = { version: 2 }, TRADITIONS = ['a'], BOOKS = ['b', 'c'];
  </script><script>document.title = TRADITIONS.length + ':' + BOOKS.length;</script></body></html>`;
  const { errors, title } = await inChromium(realShell.withShim(html), () => {});
  assert.deepEqual(errors, []); assert.equal(title, '1:2');
});

test('a failed duplicate script does not hide tables needed to render the remaining UI', chromiumOnly, async () => {
  const html = `<html><head></head><body><script>const TRADITION_META = {};</script><script>
    const TRADITION_META = {}, BOOKS = ['a'];
    throw new Error('scene initialization failed');
  </script><script>document.title = 'books-' + BOOKS.length;</script></body></html>`;
  let banner;
  const { title } = await inChromium(realShell.withShim(html), async page => { banner = await bannerText(page); });
  assert.equal(title, 'books-1'); assert.match(banner, /scene initialization failed/);
});

test('duplicate fallback preserves destructured bindings without exporting nested locals or comment text', chromiumOnly, async () => {
  const html = `<html><head></head><body><script>const META = {};</script><script>
    const META = {}; const { books: BOOKS, traditions: TRADITIONS } = { books: ['a'], traditions: ['b'] };
    // const PHANTOM = 1;
    function helper() { const HIDDEN = 1; return HIDDEN; }
  </script><script>document.title = BOOKS.length + ':' + TRADITIONS.length + ':' + typeof window.HIDDEN + ':' + typeof window.PHANTOM;</script></body></html>`;
  const { errors, title } = await inChromium(realShell.withShim(html), () => {});
  assert.deepEqual(errors, []); assert.equal(title, '1:1:undefined:undefined');
});

test('a large JSON registry stays intact and is parsed before scene initialization', chromiumOnly, async () => {
  const data = { books: Array.from({ length: 5000 }, (_, id) => ({ id, title: 'book </script> <!-- <script> ` ${title}' })), traditions: ['a'] };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const html = `<html><head><script type="application/json" id="cosmos-data">${json}</script><script>
    const registry = JSON.parse(document.getElementById('cosmos-data').textContent);
    document.title = registry.books.length + ':' + registry.traditions.length;
  </script></head><body><canvas></canvas></body></html>`;
  const { errors, title } = await inChromium(realShell.withShim(html), async page => {
    assert.equal(await page.evaluate(() => JSON.parse(document.querySelector('#cosmos-data').textContent).books[4999].title), data.books[4999].title);
  });
  assert.deepEqual(errors, []); assert.equal(title, '5000:1');
});

test('Tailwind configuration waits for an explicitly asynchronous CDN script', chromiumOnly, async () => {
  const html = '<html><head><script async src="https://cdn.tailwindcss.com"></script><script>tailwind.config = { theme: {} }; document.title = "async-configured";</script></head><body></body></html>';
  const { errors, title } = await inChromium(realShell.withShim(html), () => {}, page => page.route('https://cdn.tailwindcss.com/**', async route => {
    await new Promise(resolve => setTimeout(resolve, 100));
    await route.fulfill({ contentType: 'text/javascript', body: 'window.tailwind = {};' });
  }));
  assert.deepEqual(errors, []); assert.equal(title, 'async-configured');
});
