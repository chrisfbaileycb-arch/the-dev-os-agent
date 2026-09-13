import test from 'node:test';
import assert from 'node:assert/strict';
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

test('the sandbox policy blocks all network access, so a generated app cannot exfiltrate anything', () => {
  assert.match(SANDBOX_CSP, /connect-src 'none'/);
  assert.match(SANDBOX_CSP, /default-src 'none'/);
});
