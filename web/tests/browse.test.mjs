import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { allowedHost, checkTarget, createBrowse } from '../server/browse.mjs';
const html = `<!doctype html><html lang="en"><head><title>Blocky's Eatery</title><meta name="description" content="Family diner since 1998"><link rel="canonical" href="https://example.com/eatery"><meta name="robots" content="index,follow"><meta property="og:title" content="Blocky's"></head><body><h1>Welcome to Blocky's</h1><h2>Menu</h2><p>Breakfast all day. Pancakes, eggs, coffee.</p><a href="/menu">See the menu</a><a href="https://maps.example/blockys">Directions</a></body></html>`;
async function withFixture(fn) {
  const server = createServer((req, res) => { if (req.url === '/slow') return; res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.closeAllConnections?.(); await new Promise(r => server.close(r)); }
}
test('allowlist rules and target checks', async () => {
  assert.equal(allowedHost('example.com', {}), false);
  assert.equal(allowedHost('example.com', { BROWSE_ALLOWED_HOSTS: '*' }), true);
  assert.equal(allowedHost('shop.example.com', { BROWSE_ALLOWED_HOSTS: 'example.com' }), true);
  assert.equal(allowedHost('evil.example.net', { BROWSE_ALLOWED_HOSTS: 'example.com, *.other.org' }), false);
  await assert.rejects(checkTarget('ftp://example.com', { env: { BROWSE_ALLOWED_HOSTS: '*' } }), /http and https/);
  await assert.rejects(checkTarget('https://example.com', { env: {} }), /allowlist/);
  await assert.rejects(checkTarget('https://example.com', { env: { BROWSE_ALLOWED_HOSTS: '*' }, resolve: async () => [{ address: '10.0.0.5' }] }), /Private/);
  assert.equal((await checkTarget('https://example.com/page', { env: { BROWSE_ALLOWED_HOSTS: 'example.com' }, resolve: async () => [{ address: '93.184.216.34' }] })).pathname, '/page');
});
test('inspects a page with headless Chromium and enforces the hourly budget', async () => { await withFixture(async base => {
  const browse = createBrowse({ env: { BROWSE_MAX_PER_HOUR: '2' }, allowPrivate: true });
  try {
    const report = await browse.inspect(base + '/', 'ws-test');
    assert.equal(report.status, 200); assert.equal(report.title, "Blocky's Eatery"); assert.equal(report.description, 'Family diner since 1998');
    assert.equal(report.canonical, 'https://example.com/eatery'); assert.equal(report.robots, 'index,follow'); assert.equal(report.lang, 'en');
    assert.deepEqual(report.h1, ["Welcome to Blocky's"]); assert.equal(report.headingCount, 2); assert.equal(report.og['og:title'], "Blocky's");
    assert.match(report.text, /Pancakes, eggs, coffee/); assert.ok(report.wordCount > 5); assert.equal(report.links.length, 2); assert.equal(report.links[1].text, 'Directions');
    await browse.inspect(base + '/', 'ws-test');
    await assert.rejects(browse.inspect(base + '/', 'ws-test'), /budget/);
  } finally { await browse.close(); }
}); });
test('the HTTP route validates input and never touches private hosts without the test override', async () => { await withFixture(async base => {
  const browse = createBrowse({ env: { BROWSE_ALLOWED_HOSTS: '*' } });
  const server = createServer((req, res) => { browse(req, res).then(handled => { if (!handled) { res.writeHead(404); res.end(); } }); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/browse`;
    const post = (body, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await fetch(url)).status, 405);
    assert.equal((await post({})).status, 400);
    assert.equal((await post({ url: base + '/' })).status, 403);
    assert.equal((await post({ url: 'https://example.com' }, { Origin: 'https://evil.example' })).status, 403);
  } finally { await new Promise(r => server.close(r)); await browse.close(); }
}); });
