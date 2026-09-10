import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDatabase } from '../server/db.mjs';
import { createState, validateEntry } from '../server/state.mjs';
const ws = '3f2b8c1e-5d4a-4b6c-9e7f-0a1b2c3d4e5f';
async function withState(env, fn) {
  const db = openDatabase(':memory:'); const handler = createState({ env, db });
  const server = createServer((req, res) => { handler(req, res).then(handled => { if (!handled) { res.writeHead(404); res.end(); } }); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try { await fn(`http://127.0.0.1:${server.address().port}`, db); } finally { await new Promise(r => server.close(r)); db.close(); }
}
const call = (url, method, body, headers = {}) => fetch(url + '/api/state', { method, headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': ws, ...headers }, body: body ? JSON.stringify(body) : undefined });
const now = new Date().toISOString();
const session = { id: 's1', title: 'Weekly plan', persona: 'operator', createdAt: now, updatedAt: now, messages: [{ id: 'm1', role: 'user', content: 'hi', at: now }] };
const entry = { id: 'l1', at: now, sessionId: 's1', model: 'groq/llama-3.3-70b-versatile', tier: 'free', mode: 'credits', tokens: 2000, credits: 1 };

test('requires a workspace id and rejects cross-origin callers', async () => { await withState({ APP_ORIGIN: 'https://app.example' }, async url => {
  assert.equal((await fetch(url + '/api/state')).status, 400);
  assert.equal((await call(url, 'GET', undefined, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await call(url, 'GET', undefined, { Origin: 'https://app.example' })).status, 200);
}); });
test('stores sessions, runs, and ledger entries per workspace and reports the monthly pool', async () => { await withState({ CREDIT_MONTHLY_POOL: '5000' }, async (url, db) => {
  const post = await call(url, 'POST', { sessions: [session], ledger: [entry], runs: [{ id: 'r1', goal: 'g', workflow: 'build', mode: 'remote', model: 'm', status: 'completed', startedAt: now, steps: [], tokens: 10, calls: 1, cacheHits: 0, contextTitles: [], sessionId: 's1' }] });
  assert.equal(post.status, 200); assert.deepEqual(await post.json(), { ok: true, used: 1, pool: 5000 });
  const state = await (await call(url, 'GET')).json();
  assert.equal(state.sessions.length, 1); assert.equal(state.runs.length, 1); assert.equal(state.ledger.length, 1); assert.equal(state.pool, 5000);
  assert.equal(db.usedThisMonth(ws), 1);
  const other = await fetch(url + '/api/state', { headers: { 'X-Workspace-Id': '11111111-2222-4333-8444-555555555555' } });
  assert.equal((await other.json()).sessions.length, 0);
}); });
test('newer session wins, ledger entries are idempotent, clear removes everything', async () => { await withState({}, async url => {
  await call(url, 'POST', { sessions: [session], ledger: [entry] });
  const later = { ...session, title: 'Renamed', updatedAt: new Date(Date.now() + 1000).toISOString() };
  await call(url, 'POST', { sessions: [later, { ...session, title: 'Stale' }], ledger: [entry, entry] });
  const state = await (await call(url, 'GET')).json();
  assert.equal(state.sessions[0].title, 'Renamed'); assert.equal(state.ledger.length, 1);
  assert.equal((await fetch(url + '/api/state/clear', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': ws }, body: '{}' })).status, 200);
  assert.equal((await (await call(url, 'GET')).json()).sessions.length, 0);
}); });
test('validates shapes and refuses oversized batches', async () => { await withState({}, async url => {
  assert.equal((await call(url, 'POST', { sessions: [{ id: 'bad' }] })).status, 400);
  assert.equal((await call(url, 'POST', { ledger: [{ ...entry, credits: -1 }] })).status, 400);
  assert.equal((await call(url, 'POST', { ledger: Array.from({ length: 101 }, (_, i) => ({ ...entry, id: 'l' + i })) })).status, 400);
  assert.throws(() => validateEntry({ ...entry, mode: 'stolen' }));
}); });
