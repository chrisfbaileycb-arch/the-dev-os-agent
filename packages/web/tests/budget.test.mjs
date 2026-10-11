import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { openDatabase } from '../server/db.mjs';
import { createDailyBudget, costNanos, dailyBudgetNanos } from '../server/budget.mjs';
import { createProxy } from '../server/proxy.mjs';
import { createBurstLimiter, setAdminTiers, xkiroPool } from '../server/freetier.mjs';
import { isFreeModel } from '../server/discovery.mjs';
import { createMeter } from '../server/meter.mjs';

const rate = { provider: 'openai', model: 'test-model', inputUsdPerMillion: 1, outputUsdPerMillion: 2, requestUsd: 0, maxInputTokens: 2048, outputIncludesReasoning: true };
const env = { DAILY_SERVER_BUDGET_USD: '.003', MANAGED_MODEL_COST_BOUNDS_JSON: JSON.stringify([rate]), OPENAI_API_KEY: 'fixture-owner', FREE_CREDIT_MONTHLY_POOL: '400', FREE_MAX_OUTPUT_TOKENS: '64' };
const messages = [{ role: 'user', content: 'hello' }];
const body = { provider: 'openai', model: 'test-model', messages, max_tokens: 1000 };
const stream = (events = 'data: [DONE]\n\n', status = 200) => { const r = Readable.from([events]); r.statusCode = status; r.headers = { 'content-type': 'text/event-stream' }; return r; };
async function serve(options, fn) {
  const db = openDatabase(':memory:');
  setAdminTiers({ mode: 'manual', free: [{ id: 'test-model', provider: 'openai' }] });
  const proxy = createProxy({ env, db, storage: { durable: true }, discover: async () => {}, discoverOpenRouter: async () => {}, ...options });
  const server = createServer((req, res) => { void proxy(req, res); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const post = (b = body, headers = {}, route = '/api/chat') => fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(b) });
  try { await fn(post, db); } finally { await new Promise(r => server.close(r)); db.close(); setAdminTiers({}); }
}

test('USD reservations survive reopening, concurrent attempts, and workspace clear', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-budget-')); const file = join(dir, 'db.sqlite');
  let db = openDatabase(file);
  try {
    const make = () => createDailyBudget({ db, env, storage: { durable: true } });
    const attempts = await Promise.allSettled(Array.from({ length: 6 }, () => make().reserve('openai', 'test-model', messages, 64)));
    assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
    assert.ok(attempts.filter(r => r.status === 'rejected').every(r => r.reason.code === 'free_tier_exhausted'));
    db.clear('any-workspace'); db.close(); db = openDatabase(file);
    await assert.rejects(make().reserve('openai', 'test-model', messages, 64), e => e.code === 'free_tier_exhausted');
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('settlement is one-shot, and daily reset does not refund yesterday into today', async () => {
  const db = openDatabase(':memory:'); let now = new Date('2026-10-11T23:59:59Z');
  const budget = createDailyBudget({ db, env, storage: { durable: true }, now: () => now });
  try {
    const first = await budget.reserve('openai', 'test-model', messages, 64);
    now = new Date('2026-10-12T00:00:00Z'); await budget.reserve('openai', 'test-model', messages, 64);
    await budget.settle(first, { input: 10, output: 20 }); await budget.settle(first, { input: 0, output: 0 });
    assert.equal(db.raw().prepare('SELECT charged_nanos FROM daily_server_budget WHERE day=?').get('2026-10-11').charged_nanos, costNanos(rate, 10, 20));
    await assert.rejects(budget.reserve('openai', 'test-model', messages, 64), e => e.code === 'free_tier_exhausted');
  } finally { db.close(); }
});

test('absent, invalid, zero budgets, unknown rates and ephemeral storage fail closed', async () => {
  const db = openDatabase(':memory:');
  try {
    for (const value of [undefined, '', '0', '-1', 'NaN', 'Infinity', '10001']) assert.equal(dailyBudgetNanos({ DAILY_SERVER_BUDGET_USD: value }), 0);
    for (const configuration of [{}, { ...env, MANAGED_MODEL_COST_BOUNDS_JSON: '[]' }, { ...env, MANAGED_MODEL_COST_BOUNDS_JSON: '{' }]) await assert.rejects(createDailyBudget({ db, env: configuration, storage: { durable: true } }).reserve('openai', 'test-model', messages, 64));
    await assert.rejects(createDailyBudget({ db, env, storage: { durable: false } }).reserve('openai', 'test-model', messages, 64));
    await assert.rejects(createDailyBudget({ db, env, storage: { durable: true } }).reserve('openai', 'test-model', [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/x.png' } }] }], 64));
  } finally { db.close(); }
});

test('provider usage outside approved bounds freezes the shared day', async () => {
  const db = openDatabase(':memory:'); const budget = createDailyBudget({ db, env: { ...env, DAILY_SERVER_BUDGET_USD: '100' }, storage: { durable: true } });
  try { const reservation = await budget.reserve('openai', 'test-model', messages, 64); await budget.settle(reservation, { input: 2049, output: 1 }); await assert.rejects(budget.reserve('openai', 'test-model', messages, 64), e => e.code === 'free_tier_exhausted'); }
  finally { db.close(); }
});

test('proxy refuses parallel and retry spending before dispatch, while BYOK wins', async () => {
  let calls = 0;
  await serve({ transport: async (_url, options) => { calls++; assert.equal(JSON.parse(options.body).max_tokens, 64); return stream(); } }, async post => {
    const replies = await Promise.all(Array.from({ length: 5 }, () => post())); await Promise.all(replies.map(r => r.text()));
    assert.equal(replies.filter(r => r.status === 200).length, 1); assert.equal(calls, 1);
  });
  calls = 0;
  await serve({ env: { ...env, OPENAI_API_KEY_POOL: ['a', 'b', 'c', 'd'] }, transport: async () => { calls++; return stream('', 429); } }, async post => {
    const r = await post(); assert.equal((await r.json()).error.code, 'free_tier_exhausted'); assert.equal(calls, 1);
  });
  await serve({ env: { ...env, DAILY_SERVER_BUDGET_USD: '0', OPERATOR_FUNDING_DISABLED: 'true' }, transport: async (_url, options) => { assert.equal(options.headers.Authorization, 'Bearer fixture-personal'); return stream(); } }, async post => { const r = await post({ ...body, apiKey: 'fixture-personal' }); assert.equal(r.status, 200); await r.text(); });
});

test('Experiment header, metadata and provider require a personal key before any discovery', async () => {
  let calls = 0; const forbidden = async () => { calls++; throw Error('must not call'); };
  await serve({ discover: forbidden, discoverOpenRouter: forbidden, transport: forbidden, env: { ...env, SERVER_CREDIT_ACCESS_TOKEN: 'fixture-plan-token' } }, async post => {
    for (const [b, headers] of [[body, { 'X-Forge-Is-Experimental': 'true' }], [{ ...body, experimental: true }, {}], [{ ...body, provider: 'openrouter' }, {}], [{ ...body, provider: 'huggingface', serverAccessToken: 'fixture-plan-token' }, {}]]) {
      for (const route of ['/api/chat', '/api/models']) { const r = await post(b, headers, route); assert.equal(r.status, 401); assert.equal((await r.json()).error.code, 'key_required'); }
    }
    assert.equal(calls, 0);
  });
});

test('a large credential pool still makes only three attempts, keeping every failed charge', async () => {
  let calls = 0;
  await serve({ env: { ...env, DAILY_SERVER_BUDGET_USD: '100', OPENAI_API_KEY_POOL: ['a', 'b', 'c', 'd', 'e'] }, log: () => {}, transport: async () => { calls++; return stream('', 429); } }, async (post, db) => {
    const response = await post(); assert.equal(response.status, 503); await response.text();
    assert.equal(calls, 3);
    assert.equal(db.raw().prepare('SELECT COUNT(*) AS count FROM server_budget_attempts WHERE settled=0').get().count, 3);
    assert.equal(db.raw().prepare('SELECT charged_nanos FROM daily_server_budget').get().charged_nanos, 3 * costNanos(rate, rate.maxInputTokens, 64));
  });
});

test('fully completed valid usage releases unused reservation before the next request', async () => {
  const usage = 'data: {"usage":{"prompt_tokens":10,"completion_tokens":20}}\n\ndata: [DONE]\n\n';
  await serve({ transport: async () => stream(usage) }, async (post, db) => {
    for (let i = 0; i < 5; i++) { const response = await post(); assert.equal(response.status, 200); await response.text(); }
    assert.equal(db.raw().prepare('SELECT charged_nanos FROM daily_server_budget').get().charged_nanos, 5 * costNanos(rate, 10, 20));
  });
});

test('an unusable supplied personal key cannot fall back to an owner key', async () => {
  let calls = 0;
  await serve({ transport: async () => { calls++; return stream(); } }, async (post, db) => {
    const response = await post({ ...body, apiKey: 'fixture-smart-quote\u201c' });
    assert.equal(response.status, 400); await response.text(); assert.equal(calls, 0);
    assert.equal(db.raw().prepare('SELECT COUNT(*) AS count FROM server_budget_attempts').get().count, 0);
  });
});

test('rolling fingerprint/IP quotas resist User-Agent rotation and cache churn', () => {
  let now = 0; const take = createBurstLimiter({ FREE_MAX_PER_HOUR: '2' }, () => now, 4);
  assert.equal(take('ip-a', 'ua-a').ok, true); now = 3_599_000; assert.equal(take('ip-a', 'ua-a').ok, true);
  now = 3_600_000; assert.equal(take('ip-a', 'ua-b').ok, true); assert.equal(take('ip-a', 'ua-c').ok, false);
  assert.equal(take('ip-b', 'ua-a').ok, false, 'cache saturation does not evict recent quotas');
  now = 7_200_000; assert.equal(take('ip-b', 'ua-a').ok, true);
});

test('gateway matching returns canonical ids and rejects cold, premium and invalid zero pricing', () => {
  assert.deepEqual(xkiroPool({ XKIRO_FREE_MODELS: 'LAB/MODEL-A,lab/modela,lab/paid' }, ['Lab/Model-A']), ['Lab/Model-A']);
  assert.deepEqual(xkiroPool({ XKIRO_FREE_MODELS: 'lab/anything' }, []), []);
  for (const bad of [null, false, '', ' ', undefined]) assert.equal(isFreeModel({ id: 'lab/model', access_tier: 'free', pricing: { input: bad, output: 0 } }), false);
});

test('partial and unreported streams never qualify for a USD refund', async () => {
  for (const events of ['data: {"usage":{"prompt_tokens":1,"completion_tokens":2}}\n\n', 'data: [DONE]\n\n']) {
    const meter = createMeter(); meter.end(events); for await (const _ of meter) {} assert.equal(meter.finalUsage(), null);
  }
});
