import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { CSP, SANDBOX_CSP } from '../server/csp.mjs';

// Exercise the actual production entry point, not only its individual route helpers.
// Run after `npm run build`, as CI does: an API-only health check missed a broken page.
test('production serves the workspace, admin, sandbox, and built assets with their policies', { timeout: 20000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'signal-forge-http-'));
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { PATH: process.env.PATH, PORT: String(port), DATA_FILE: join(dir, 'data.sqlite'), FREE_TIER_DISABLED: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('server is ready')) resolve(); });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Production server exited before startup (${code}).`)));
  });
  const base = `http://127.0.0.1:${port}`;
  const home = await fetch(base);
  assert.equal(home.status, 200, 'a healthy API must also serve the workspace page');
  assert.equal(home.headers.get('content-security-policy'), CSP);
  const html = await home.text();
  assert.match(html, /id="root"/);
  const asset = html.match(/src="(\.\/assets\/[^\"]+\.js)"/)?.[1];
  assert.ok(asset, 'the built page has a JavaScript entry point');
  const script = await fetch(new URL(asset, base + '/'));
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);
  assert.match(script.headers.get('cache-control'), /immutable/);
  assert.equal((await fetch(base + '/admin')).status, 200);
  const sandbox = await fetch(base + '/sandbox.html');
  assert.equal(sandbox.status, 200);
  assert.equal(sandbox.headers.get('content-security-policy'), SANDBOX_CSP);
  const head = await fetch(base, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await fetch(base + '/missing-file.js')).status, 404);
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
});
