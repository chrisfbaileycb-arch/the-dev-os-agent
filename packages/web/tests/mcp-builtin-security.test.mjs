import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicFetchTarget, executeBuiltinTool, matchBuiltinMcp } from '../server/mcpRegistry.mjs';

// executeBuiltinTool runs with no caller identity and no per-workspace scoping (see mcp.mjs's
// handler: it checks the destination URL, not who is asking). The `fs` and `database` tools used
// to do real filesystem and sqlite access anyway, against the server's own working directory and
// its one shared sqlite file — reachable by any caller who could POST to /api/mcp. These tests
// pin that down: both must now refuse to run at all, and the two tools left as real fetches must
// refuse a private/internal destination.
//
// executeBuiltinTool never rejects: every failure path (see its outer try/catch) resolves to
// { isError: true, content: [...] }, so these tests check that shape rather than a rejection.

async function callsBlocked(mcp, toolName, args) {
  const out = await executeBuiltinTool(mcp, toolName, args, { workspace: 'attacker' });
  return out.isError === true;
}

test('fs and database builtin tools are disabled, not executed', async () => {
  const fs = matchBuiltinMcp('https://fs.mcp.internal/x');
  const db = matchBuiltinMcp('https://database.mcp.internal/x');
  assert.ok(fs && db);
  for (const [mcp, toolName, args] of [
    [fs, 'read_file', { path: 'package.json' }],
    [fs, 'write_file', { path: 'pwned.txt', content: 'x' }],
    [fs, 'list_directory', { path: '.' }],
    [fs, 'search_files', { query: 'x' }],
    [db, 'execute_query', { query: 'select * from sessions' }],
    [db, 'introspect_schema', {}],
  ]) {
    const out = await executeBuiltinTool(mcp, toolName, args, { workspace: 'attacker' });
    assert.equal(out.isError, true, `${mcp.id}.${toolName} must refuse to run`);
    assert.match(out.content[0].text, /disabled/i);
  }
});

test('playwright.navigate and firecrawl.scrape_url refuse private and loopback destinations', async () => {
  const playwright = matchBuiltinMcp('https://playwright.mcp.internal/x');
  const firecrawl = matchBuiltinMcp('https://firecrawl.dev/mcp/x');
  for (const target of ['http://127.0.0.1:9/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/', 'http://localhost/']) {
    assert.ok(await callsBlocked(playwright, 'navigate', { url: target }), `navigate should refuse ${target}`);
    assert.ok(await callsBlocked(firecrawl, 'scrape_url', { url: target }), `scrape_url should refuse ${target}`);
  }
});

test('assertPublicFetchTarget allows a hostname that resolves publicly and rejects malformed or private input', async () => {
  const publicResolve = async () => [{ address: '93.184.216.34' }];
  const url = await assertPublicFetchTarget('https://example.com/page', publicResolve);
  assert.equal(url.hostname, 'example.com');
  await assert.rejects(assertPublicFetchTarget('not a url', publicResolve), /valid URL/i);
  await assert.rejects(assertPublicFetchTarget('ftp://example.com/', publicResolve), /http/i);
  await assert.rejects(assertPublicFetchTarget('https://user:pw@example.com/', publicResolve), /credentials/i);
  await assert.rejects(assertPublicFetchTarget('https://internal.example/', async () => [{ address: '10.0.0.5' }]), /blocked/i);
  // DNS-rebinding note: this only checks the address the hostname resolves to *now*; the actual
  // fetch() call resolves again to connect, same as mcp.mjs's checkServer (see the comment on
  // assertPublicFetchTarget in server/mcpRegistry.mjs).
});
