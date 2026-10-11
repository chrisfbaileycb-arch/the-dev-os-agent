import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDatabase } from '../server/db.mjs';
import { createState } from '../server/state.mjs';
import { createWorkspaceSession, workspaceCookie, resolveWorkspace } from '../server/workspace.mjs';
import { createProxy } from '../server/proxy.mjs';
const env = { SESSION_SECRET: 'workspace-test-secret-that-is-long-enough' };
const one = '11111111-2222-4333-8444-555555555555';
const two = '22222222-2222-4333-8444-555555555555';
const cookie = id => `sf_workspace=${workspaceCookie(id, env.SESSION_SECRET)}`;

async function withApp(fn) {
  const db = openDatabase(':memory:');
  const handlers = [createWorkspaceSession({ env }), createState({ env, db })];
  const server = createServer(async (req, res) => { for (const h of handlers) if (await h(req, res)) return; res.writeHead(404); res.end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}`, db); } finally { await new Promise(resolve => server.close(resolve)); db.close(); }
}
test('a public UUID cannot read, replace, or delete another signed workspace', async () => {
  await withApp(async (url, db) => {
    const at = new Date().toISOString();
    db.upsertSessions(one, [{ id: 'private', title: 'Owner data', createdAt: at, updatedAt: at, persona: 'operator', messages: [] }]);
    for (const path of ['/api/state', '/api/state/usage', '/api/state/clear', '/api/state/delete']) {
      const method = path.endsWith('clear') || path.endsWith('delete') ? 'POST' : 'GET';
      const options = { method, headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': one }, ...(method === 'POST' ? { body: '{"sessions":["private"]}' } : {}) };
      assert.equal((await fetch(url + path, options)).status, 401);
      assert.equal((await fetch(url + path, { ...options, headers: { ...options.headers, Cookie: cookie(two) } })).status, 403);
    }
    assert.equal((await fetch(url + '/api/state', { headers: { Cookie: cookie(one), 'X-Workspace-Id': one } })).status, 200);
    assert.equal(db.state(one).sessions[0].title, 'Owner data');
  });
});
test('session creation ignores client UUIDs, renews the owned id, and rejects cross-origin calls', async () => {
  await withApp(async url => {
    const r = await fetch(url + '/api/workspace/session', { headers: { 'X-Workspace-Id': one } });
    assert.equal(r.status, 200); const id = (await r.json()).workspaceId;
    assert.notEqual(id, one);
    const issued = r.headers.get('set-cookie');
    assert.match(issued, /HttpOnly; SameSite=Strict; Path=\/api/);
    const next = await fetch(url + '/api/workspace/session', { headers: { Cookie: issued.split(';')[0] } });
    assert.equal((await next.json()).workspaceId, id);
    assert.equal((await fetch(url + '/api/workspace/session', { headers: { Origin: 'https://elsewhere.example' } })).status, 403);
  });
});
test('tampered, expired, rotated, and unconfigured workspace credentials fail closed', () => {
  const req = value => ({ headers: { cookie: 'sf_workspace=' + value } });
  const value = workspaceCookie(one, env.SESSION_SECRET, 1000);
  assert.equal(resolveWorkspace(req(value), env, 2000), one);
  assert.throws(() => resolveWorkspace(req(value.replace(one, two)), env, 2000), /signed session/);
  assert.throws(() => resolveWorkspace(req(value), env, 40 * 86400000), /signed session/);
  assert.throws(() => resolveWorkspace(req(value), { SESSION_SECRET: 'different-secret-that-is-long-enough' }, 2000), /signed session/);
  assert.throws(() => resolveWorkspace(req(value), {}, 2000), /not configured/);
});
test('disabled operator funding refuses plan and free calls before any upstream discovery or transport', async () => {
  let calls = 0;
  const proxy = createProxy({ env: { OPERATOR_FUNDING_DISABLED: 'true', OPENAI_API_KEY: 'sk-owner', SERVER_CREDIT_ACCESS_TOKEN: 'owner-plan-token' }, discover: async () => { calls++; }, discoverOpenRouter: async () => { calls++; }, transport: async () => { calls++; throw new Error('Must not dispatch'); } });
  const server = createServer((req, res) => proxy(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const token of ['', 'owner-plan-token']) {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'openai', model: 'gpt-4o', serverAccessToken: token, messages: [] }) });
      assert.equal(r.status, 503);
    }
    assert.equal(calls, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
