import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable, PassThrough } from 'node:stream';
import { createProxy, freeOutputCapFor } from '../server/proxy.mjs';
import { createState } from '../server/state.mjs';
import { openDatabase } from '../server/db.mjs';
import { openSettings } from '../server/settings.mjs';
import { setAdminTiers, paidTierStatus } from '../server/freetier.mjs';
import { planAccess, planHolder, planLimits, planCredits } from '../server/plans.mjs';
import { billingStatus } from '../server/billing.mjs';
import { createMeter } from '../server/meter.mjs';

const token = 'subscriber-token-long-enough';
const workspace = '3f2b8c1e-5d4a-4b6c-9e7f-0a1b2c3d4e5f';
const request = { provider: 'openai', model: 'gpt-4o', serverAccessToken: token, messages: [{ role: 'user', content: 'hello' }], max_tokens: 65536, plan: 'pro', pool: 1e9 };
const events = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: {"usage":{"prompt_tokens":100,"completion_tokens":200,"total_tokens":300}}\n\ndata: [DONE]\n\n';
const reply = (body = events) => { const r = Readable.from([body]); r.statusCode = 200; r.headers = { 'content-type': 'text/event-stream' }; return r; };
async function withApp(env, fn, options = {}) {
  const db = openDatabase(':memory:');
  setAdminTiers({ mode: 'manual', free: [], paid: [{ id: 'gpt-4o', provider: 'openai', label: 'GPT' }] });
  const proxy = createProxy({ env: { OPENAI_API_KEY: 'operator-key', ...env }, db, discover: async () => {}, discoverOpenRouter: async () => {}, transport: async (_url, options) => reply(), ...options });
  const state = createState({ env, db });
  const server = createServer(async (req, res) => { if (!await proxy(req, res) && !await state(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const post = (path, body, ws = workspace) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': ws }, body: JSON.stringify(body) });
  try { await fn({ post, db }); } finally { await new Promise(r => server.close(r)); db.close(); setAdminTiers(null); }
}

test('three plans publish their actual configurable limits and never reuse old checkout prices', () => {
  const status = billingStatus({ STRIPE_STARTER_URL: 'https://buy.stripe.com/old-price', PLAN_PREMIUM_CREDITS: '3000', BILLING_PRO_URL: 'https://buy.stripe.com/studio' });
  assert.deepEqual(status.plans.map(p => p.price), ['$25', '$50', '$100']);
  assert.deepEqual(status.plans.map(p => p.monthlyCredits), [1000, 3000, 6000]);
  assert.deepEqual(status.plans.map(p => p.maxOutputTokens), [16384, 32768, 65536]);
  assert.equal(status.plans[0].checkout, null);
  assert.equal(status.plans[2].checkout, 'https://buy.stripe.com/studio');
  assert.equal(planLimits('starter', { PLAN_STARTER_CREDITS: '0' }).monthlyCredits, 0);
  assert.equal(freeOutputCapFor({ FREE_MAX_OUTPUT_TOKENS: '1024' }), 16384);
});

test('existing deployment and dashboard defaults upgrade while custom caps remain effective', async () => {
  const db = openDatabase(':memory:');
  const env = { FREE_MAX_OUTPUT_TOKENS: '8192', PLAN_STARTER_MAX_OUTPUT_TOKENS: '8192', PLAN_PREMIUM_MAX_OUTPUT_TOKENS: '16384', PLAN_PRO_MAX_OUTPUT_TOKENS: '32768' };
  try {
    const settings = await openSettings({ db, env });
    await settings.setTunable('FREE_MAX_OUTPUT_TOKENS', '8192');
    await settings.setTunable('PLAN_PRO_MAX_OUTPUT_TOKENS', '32768');
    assert.equal(freeOutputCapFor(settings.env()), 16384);
    assert.deepEqual(billingStatus(settings.env()).plans.map(p => p.maxOutputTokens), [16384, 32768, 65536]);
    const displayed = Object.fromEntries(settings.tunableStatus().map(row => [row.name, row.value]));
    assert.equal(displayed.FREE_MAX_OUTPUT_TOKENS, '16384'); assert.equal(displayed.PLAN_PRO_MAX_OUTPUT_TOKENS, '65536');
    assert.equal(freeOutputCapFor({ FREE_MAX_OUTPUT_TOKENS: '12000' }), 12000);
    assert.equal(planLimits('premium', { PLAN_PREMIUM_MAX_OUTPUT_TOKENS: '24000' }).maxOutputTokens, 24000);
  } finally { db.close(); }
});

test('a model with a larger window receives the full Studio reply budget', async () => {
  let sent;
  await withApp({ PLAN_PRO_ACCESS_TOKENS: token, ANTHROPIC_API_KEY: 'operator-anthropic-key' }, async ({ post }) => {
    setAdminTiers({ mode: 'manual', free: [], paid: [{ id: 'claude-sonnet-4-6', provider: 'anthropic', label: 'Sonnet' }] });
    const result = await post('/api/chat', { ...request, model: 'claude-sonnet-4-6' });
    assert.equal(result.status, 200); await result.text(); assert.equal(sent.max_tokens, 65536);
  }, { transport: async (_url, options) => { sent = JSON.parse(options.body); return reply(); } });
});

test('server token controls tier, stable identity on upgrade, and revocation', () => {
  const starter = planAccess(token, { PLAN_STARTER_ACCESS_TOKENS: token });
  const pro = planAccess(token, { PLAN_STARTER_ACCESS_TOKENS: token, PLAN_PRO_ACCESS_TOKENS: token });
  assert.equal(starter.id, 'starter'); assert.equal(pro.id, 'pro');
  assert.equal(starter.workspace, pro.workspace);
  assert.equal(planHolder('wrong', { PLAN_PRO_ACCESS_TOKENS: token }), null);
  assert.equal(planAccess(token, {}), null);
  assert.equal(planAccess('short', { PLAN_PRO_ACCESS_TOKENS: 'short' }), null);
});

for (const [id, limit, pool] of [['starter', 16384, 1000], ['premium', 32768, 2500], ['pro', 65536, 6000]]) {
  test(`${id}: output and monthly balance come from server, with weighted provider usage`, async () => {
    let sent;
    const env = { [`PLAN_${id.toUpperCase()}_ACCESS_TOKENS`]: token };
    await withApp(env, async ({ post, db }) => {
      const r = await post('/api/chat', { ...request, provider: 'openrouter' }); assert.equal(r.status, 200); await r.text();
      assert.equal(sent.max_tokens, 16384, 'GPT-4o has a smaller window than some plans');
      assert.equal(db.usedThisMonth(planHolder(token, env)), 8.25);
      const balance = await (await post('/api/state/plan', { token, plan: 'pro', pool: 1e9 })).json();
      assert.equal(balance.pool, pool); assert.equal(balance.used, 8.25); assert.equal(balance.plan.id, id); assert.equal(balance.plan.maxOutputTokens, limit);
      assert.equal(balance.entry.mode, 'credits'); assert.equal(balance.entry.tokens, 300);
      assert.ok(!JSON.stringify(balance).includes(token)); assert.ok(!JSON.stringify(balance).includes('operator-key'));
      const other = await (await post('/api/state/plan', { token }, '11111111-2222-4333-8444-555555555555')).json();
      assert.equal(other.used, 8.25, 'rotating the browser workspace does not reset a subscription');
      assert.equal(paidTierStatus({ ...env, OPENAI_API_KEY: 'operator-key' }).enabled, true);
    }, { transport: async (_url, options) => { sent = JSON.parse(options.body); return reply(); } });
  });
}

test('exhaustion and zero allowance stop paid requests before spending keys, while personal keys still run', async () => {
  let calls = 0;
  const env = { PLAN_STARTER_ACCESS_TOKENS: token, PLAN_STARTER_CREDITS: '0' };
  await withApp(env, async ({ post }) => {
    assert.equal((await post('/api/chat', request)).status, 402); assert.equal(calls, 0);
    const own = await post('/api/chat', { ...request, apiKey: 'personal-key' }); assert.equal(own.status, 200); await own.text(); assert.equal(calls, 1);
    assert.equal((await post('/api/chat', { ...request, serverAccessToken: 'revoked' })).status, 401);
    assert.equal((await post('/api/state/plan', { token: 'revoked' })).status, 401);
  }, { transport: async () => { calls++; return reply(); } });
});

test('plan requests fail closed without usage storage', async () => {
  await withApp({ PLAN_STARTER_ACCESS_TOKENS: token }, async ({ post }) => {
    assert.equal((await post('/api/chat', request)).status, 503);
  }, { db: null, transport: async () => { throw Error('must not spend a key'); } });
});

test('concurrent requests cannot race past the same plan quota', async () => {
  let started; const ready = new Promise(r => { started = r; });
  const stream = new PassThrough(); stream.statusCode = 200; stream.headers = { 'content-type': 'text/event-stream' };
  await withApp({ PLAN_STARTER_ACCESS_TOKENS: token }, async ({ post }) => {
    const first = post('/api/chat', request); await ready;
    const second = await post('/api/chat', request); assert.equal(second.status, 429);
    stream.end(events); const r = await first; await r.text();
  }, { transport: async () => { started(); return stream; } });
});

test('allowance restricts the remaining reply window and usage already spent survives a tier change', async () => {
  let sent;
  const env = { PLAN_PRO_ACCESS_TOKENS: token, PLAN_PRO_CREDITS: '10' };
  await withApp(env, async ({ post, db }) => {
    db.recordUsage(planHolder(token, env), { model: 'gpt-4o', mode: 'credits', tokens: 10, credits: 9 });
    const r = await post('/api/chat', request); assert.equal(r.status, 402, 'too little remains for a 64-token reply');
    assert.equal(sent, undefined);
  }, { transport: async (_url, options) => { sent = JSON.parse(options.body); return reply(); } });
});

test('Anthropic native usage includes cached inputs and cumulative output, even without total_tokens', async () => {
  const meter = createMeter({ promptChars: 400 });
  const done = new Promise(r => meter.on('end', r)); meter.resume();
  meter.end('data: {"type":"message_start","message":{"usage":{"input_tokens":100,"cache_read_input_tokens":20,"output_tokens":1}}}\n\ndata: {"type":"content_block_delta","delta":{"text":"hi"}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":40}}\n\n'); await done;
  assert.deepEqual(meter.usage(), { input: 120, output: 40 }); assert.equal(meter.total(), 160);
  assert.equal(planCredits('claude-opus', meter.usage()), 2.4);
});

test('dashboard persists subscriber lists sealed and validates tokens and checkout URLs', async () => {
  const db = openDatabase(':memory:');
  try {
    const settings = await openSettings({ db, env: { SETTINGS_SECRET: 'test-seal-secret-long-enough' } });
    await settings.setTunable('PLAN_PRO_ACCESS_TOKENS', token);
    assert.ok(!db.getSetting('tunable:PLAN_PRO_ACCESS_TOKENS').includes(token));
    assert.equal(planAccess(token, settings.env()).id, 'pro');
    await assert.rejects(settings.setTunable('PLAN_PRO_ACCESS_TOKENS', 'too-short'));
    await assert.rejects(settings.setTunable('BILLING_PRO_URL', 'http://checkout.example'));
    await settings.setTunable('BILLING_PRO_URL', 'https://checkout.example/studio');
    assert.equal(billingStatus(settings.env()).plans[2].checkout, 'https://checkout.example/studio');
  } finally { db.close(); setAdminTiers(null); }
});
