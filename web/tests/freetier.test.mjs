import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { createProxy } from '../server/proxy.mjs';
import { openDatabase } from '../server/db.mjs';
import { FREE_MODELS, createBurstLimiter, creditsForTokens, freeModel, freeTierStatus, routeFreeRequest } from '../server/freetier.mjs';
import { createMeter, deltaLength, usageFrom } from '../server/meter.mjs';

const workspace = '3f2b8c1e-5d4a-4b6c-9e7f-0a1b2c3d4e5f';
const base = { provider: 'groq', model: 'groq/llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'hello' }] };

function stream(text, status = 200, type = 'text/event-stream') { const s = Readable.from([Buffer.from(text)]); s.statusCode = status; s.headers = { 'content-type': type }; return s; }
async function withProxy(options, fn) {
  const handler = createProxy(options);
  const server = createServer((req, res) => { handler(req, res).then(handled => { if (!handled) { res.writeHead(404); res.end(); } }); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise(r => server.close(r)); }
}
const chat = (url, body, headers = {}) => fetch(url + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspace, ...headers }, body: JSON.stringify(body) });

test('the UI catalog and the server allowlist name exactly the same free models', () => {
  // The dropdown must never offer a model the proxy will refuse to fund, so the two lists are
  // compared literally. Adding a free model means adding it in both places.
  const catalog = readFileSync(new URL('../src/lib/catalog.ts', import.meta.url), 'utf8');
  const uiIds = [...catalog.matchAll(/\{ id: '([^']+)'[^}]*zeroConfig: true/g)].map(m => m[1]);
  assert.deepEqual([...uiIds].sort(), [...new Set(FREE_MODELS.map(m => m.id))].sort());
  assert.ok(uiIds.includes('groq/llama-3.3-70b-versatile'));
  assert.ok(uiIds.includes('openrouter/auto'));
});

test('only exact allowlist ids resolve, and only when the deployment funds them', () => {
  assert.equal(freeModel('groq/llama-3.3-70b-versatile')?.provider, 'groq');
  assert.equal(freeModel('GROQ/LLAMA-3.3-70B-VERSATILE')?.provider, 'groq', 'case is normalised');
  for (const bad of ['groq/llama-3.3-70b', 'llama-3.3-70b-versatile', 'openai/gpt-4o', '', null, undefined, 42]) assert.equal(freeModel(bad), undefined);
  assert.equal(freeTierStatus({}).enabled, false);
  assert.deepEqual(freeTierStatus({ GROQ_API_KEY: 'k' }).models, ['groq/llama-3.3-70b-versatile', 'groq/llama-3.1-8b-instant']);
  assert.equal(freeTierStatus({ GROQ_API_KEY: 'k', FREE_TIER_DISABLED: 'true' }).enabled, false);
  assert.equal(freeTierStatus({ GROQ_API_KEY: 'k' }).monthlyCredits, 400);
});

test('free routing strips the Groq namespace and fans openrouter/auto out over the free pool', () => {
  assert.deepEqual(routeFreeRequest(freeModel('groq/llama-3.1-8b-instant')), { model: 'llama-3.1-8b-instant' });
  const auto = routeFreeRequest(freeModel('openrouter/auto'));
  assert.equal(auto.model, 'meta-llama/llama-3.2-3b-instruct:free');
  assert.ok(auto.models.length >= 2 && auto.models.every(m => m.endsWith(':free')));
  assert.deepEqual(routeFreeRequest(freeModel('mistralai/mistral-nemo:free')), { model: 'mistralai/mistral-nemo:free' });
});

test('credits are charged at the fast weight and rounded up to two decimals', () => {
  assert.equal(creditsForTokens(2000), 1);
  assert.equal(creditsForTokens(1), 0.01);
  assert.equal(creditsForTokens(0), 0);
  assert.equal(creditsForTokens(-5), 0);
});

test('the burst limiter bounds one network address per hour', () => {
  let now = 0;
  const take = createBurstLimiter({ FREE_MAX_PER_HOUR: '2' }, () => now);
  assert.equal(take('1.2.3.4').ok, true);
  assert.equal(take('1.2.3.4').ok, true);
  assert.equal(take('1.2.3.4').ok, false);
  assert.equal(take('5.6.7.8').ok, true, 'other callers are unaffected');
  now = 3_700_000;
  assert.equal(take('1.2.3.4').ok, true, 'the window rolls over');
});

test('the meter reads the provider usage block, and estimates only when none arrives', async () => {
  assert.equal(usageFrom({ usage: { total_tokens: 120 } }), 120);
  assert.equal(usageFrom({ delta: { usage: { tokens: { input_tokens: 4, output_tokens: 3 } } } }), 7);
  assert.equal(usageFrom({ usage: { prompt_tokens: 10, completion_tokens: 5 } }), 15);
  assert.equal(usageFrom({ choices: [{ delta: { content: 'hi' } }] }), 0);
  assert.equal(deltaLength({ choices: [{ delta: { content: 'hello' } }] }), 5);

  const reported = createMeter({ promptChars: 400 });
  reported.end('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: {"usage":{"total_tokens":99}}\n\ndata: [DONE]\n\n');
  for await (const _ of reported) { /* drain */ }
  assert.equal(reported.total(), 99);
  assert.equal(reported.reportedByProvider(), true);

  const silent = createMeter({ promptChars: 400 });
  silent.end('data: {"choices":[{"delta":{"content":"abcd"}}]}\n\ndata: [DONE]\n\n');
  for await (const _ of silent) { /* drain */ }
  assert.equal(silent.reportedByProvider(), false);
  assert.equal(silent.total(), 101, '(400 prompt chars + 4 output chars) / 4');
});

test('the meter passes every byte through unchanged', async () => {
  const events = 'data: {"choices":[{"delta":{"content":"one"}}]}\n\ndata: {"choices":[{"delta":{"content":"two"}}]}\n\ndata: [DONE]\n\n';
  const meter = createMeter({});
  const chunks = [];
  meter.on('data', c => chunks.push(c));
  const done = new Promise(r => meter.on('end', r));
  Readable.from([Buffer.from(events.slice(0, 30)), Buffer.from(events.slice(30))]).pipe(meter);
  await done;
  assert.equal(Buffer.concat(chunks).toString(), events);
});

test('a zero-config stream is billed to the ledger from the bytes that crossed the wire', async () => {
  const db = openDatabase(':memory:');
  const events = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: {"usage":{"total_tokens":2000}}\n\ndata: [DONE]\n\n';
  try {
    await withProxy({ env: { GROQ_API_KEY: 'server-key' }, db, transport: async () => stream(events) }, async url => {
      assert.equal((await chat(url, base)).status, 200);
      // 2,000 tokens at 0.5 credits per 1K.
      assert.equal(db.usedThisMonth(workspace, new Date(), 'free'), 1);
      const entry = db.latestEntry(workspace, 'free');
      assert.equal(entry.tokens, 2000); assert.equal(entry.credits, 1); assert.equal(entry.model, 'groq/llama-3.3-70b-versatile');
      // A different workspace has its own budget.
      assert.equal(db.usedThisMonth('11111111-2222-4333-8444-555555555555', new Date(), 'free'), 0);
    });
  } finally { db.close(); }
});

test('a BYOK stream is never billed to the free pool', async () => {
  const db = openDatabase(':memory:');
  try {
    await withProxy({ env: { GROQ_API_KEY: 'server-key' }, db, transport: async () => stream('data: {"usage":{"total_tokens":9000}}\n\ndata: [DONE]\n\n') }, async url => {
      assert.equal((await chat(url, { ...base, apiKey: 'visitor-key' })).status, 200);
      assert.equal(db.usedThisMonth(workspace, new Date(), 'free'), 0);
    });
  } finally { db.close(); }
});

test('an exhausted monthly allowance refuses the request before any upstream call', async () => {
  const db = openDatabase(':memory:');
  try {
    db.recordUsage(workspace, { model: 'groq/llama-3.3-70b-versatile', tokens: 100_000, credits: 50 });
    await withProxy({ env: { GROQ_API_KEY: 'server-key', FREE_CREDIT_MONTHLY_POOL: '10' }, db, transport: async () => { throw Error('must not call'); } }, async url => {
      const response = await chat(url, base);
      assert.equal(response.status, 402);
      assert.match((await response.json()).error.message, /free credits for the month/);
    });
  } finally { db.close(); }
});

test('the hourly burst cap answers 429 rather than spending the deployment key', async () => {
  const db = openDatabase(':memory:');
  try {
    await withProxy({ env: { GROQ_API_KEY: 'server-key', FREE_MAX_PER_HOUR: '1' }, db, transport: async () => stream('data: [DONE]\n\n') }, async url => {
      assert.equal((await chat(url, base)).status, 200);
      const second = await chat(url, base);
      assert.equal(second.status, 429);
      assert.match((await second.json()).error.message, /requests an hour/);
    });
  } finally { db.close(); }
});

test('/api/providers advertises the tier without ever leaking a key', async () => {
  await withProxy({ env: { GROQ_API_KEY: 'server-key-do-not-leak', OPENROUTER_API_KEY: 'other-secret' }, transport: async () => { throw Error('must not call'); } }, async url => {
    const response = await fetch(url + '/api/providers');
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(!text.includes('server-key-do-not-leak') && !text.includes('other-secret'));
    const body = JSON.parse(text);
    assert.equal(body.free.enabled, true);
    assert.equal(body.free.models.length, FREE_MODELS.length);
  });
  // The health check must still answer 200 on a deployment with nothing configured.
  await withProxy({ env: {}, transport: async () => { throw Error('must not call'); } }, async url => {
    const body = await (await fetch(url + '/api/providers')).json();
    assert.equal(body.free.enabled, false);
    assert.deepEqual(body.free.models, []);
  });
});
