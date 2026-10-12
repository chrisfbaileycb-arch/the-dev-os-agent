import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { backendEnabled, backendStatus, hfBackendBase } from '../server/backends.mjs';
import { backendProviders, shieldProviders } from '../server/providerRegistry.mjs';
import { openDatabase } from '../server/db.mjs';
import { openSettings, cleanTunable } from '../server/settings.mjs';
import { createAdmin, discoverForProvider } from '../server/admin.mjs';
import { createProxy, keyFor, resolveTarget } from '../server/proxy.mjs';
import { setAdminTiers, freeModels, paidModels } from '../server/freetier.mjs';

const provider = 'huggingface-backend';
const endpoint = 'https://fixture.us-east-1.aws.endpoints.huggingface.cloud/v1';
const body = { provider, model: 'fixture-model', apiKey: 'hf_personal_fixture', messages: [{ role: 'user', content: 'hello' }], max_tokens: 1000, baseUrl: 'https://attacker.invalid/v1' };
const baseEnv = { HF_BACKEND_ENABLED: 'true', HF_BACKEND_API_KEY: 'hf_owner_fixture', HF_TOKEN: 'hf_experiment_fixture', OPERATOR_FUNDING_DISABLED: 'true', DAILY_SERVER_BUDGET_USD: '0' };
function stream() { const s = Readable.from(['data: {"usage":{"prompt_tokens":1,"completion_tokens":2}}\n\ndata: [DONE]\n\n']); s.statusCode = 200; s.headers = { 'content-type': 'text/event-stream' }; return s; }
async function serve(options, fn) {
  const db = openDatabase(':memory:'); const proxy = createProxy({ env: baseEnv, db, storage: { durable: true }, discover: async () => {}, discoverOpenRouter: async () => {}, ...options });
  const server = createServer((req, res) => { void proxy(req, res); }); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const post = (b = body, path = '/api/chat', headers = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(b) });
  try { await fn(post, db); } finally { await new Promise(r => server.close(r)); db.close(); setAdminTiers(null); }
}

test('US and HF availability are independent; HF is never Shield', async () => {
  assert.equal(backendEnabled('openai', {}), true); assert.equal(backendEnabled(provider, {}), false);
  assert.equal(backendStatus({ US_BACKEND_ENABLED: 'false', HF_BACKEND_ENABLED: 'true' }).huggingface, true);
  assert.deepEqual(backendProviders({ env: { US_BACKEND_ENABLED: 'false', HF_BACKEND_ENABLED: 'true' } }), [provider]);
  assert.ok(!shieldProviders().includes(provider));
  await assert.rejects(resolveTarget('openai', '', { US_BACKEND_ENABLED: 'false' }), e => e.code === 'backend_disabled');
  await assert.rejects(resolveTarget(provider, '', {}), e => e.code === 'backend_disabled');
});

test('HF endpoint configuration refuses arbitrary hosts, URL tricks, ports and invalid models', () => {
  assert.equal(hfBackendBase(''), 'https://router.huggingface.co/v1');
  assert.equal(hfBackendBase(endpoint.replace('/v1', '')), endpoint);
  for (const url of ['http://router.huggingface.co/v1', 'https://router.huggingface.co.attacker.invalid/v1', 'https://router.huggingface.co:123/v1', 'https://u:p@router.huggingface.co/v1', endpoint + '?key=x', endpoint + '/chat/completions', 'https://127.0.0.1/v1']) assert.throws(() => hfBackendBase(url));
  assert.equal(cleanTunable('HF_BACKEND_MODELS', ' my-model, my-model, other '), 'my-model,other');
  assert.throws(() => cleanTunable('HF_BACKEND_MODELS', 'x'.repeat(201)));
});

test('backend switches persist without destroying sealed keys or configured tiers', async () => {
  const db = openDatabase(':memory:'); const env = { SESSION_SECRET: 'fixture-session-secret-that-is-long', HF_BACKEND_ENABLED: 'true' };
  try {
    let settings = await openSettings({ db, env }); await settings.setKey(provider, 'hf_owner_fixture');
    await settings.setTiers({ mode: 'manual', free: [{ id: 'fixture-model', provider }] });
    await settings.setTunable('HF_BACKEND_ENABLED', 'false');
    assert.equal(freeModels(settings.env()).length, 0); assert.equal(settings.tiers().free.length, 1);
    settings = await openSettings({ db, env }); assert.equal(settings.env().HF_BACKEND_ENABLED, 'false');
    assert.ok(!db.getSetting('key:' + provider).includes('hf_owner_fixture'));
    await settings.setTunable('HF_BACKEND_ENABLED', 'true'); assert.equal(freeModels(settings.env()).length, 1);
    assert.equal(settings.env().HF_BACKEND_API_KEY, 'hf_owner_fixture');
    assert.ok(!paidModels({ ...settings.env(), HF_BACKEND_ENABLED: 'false' }).length);
  } finally { db.close(); setAdminTiers(null); }
});

test('personal HF calls use only the configured router and personal token; off blocks dispatch', async () => {
  let calls = 0;
  await serve({ transport: async (url, options) => { calls++; assert.equal(url, 'https://router.huggingface.co/v1/chat/completions'); assert.equal(options.headers.Authorization, 'Bearer hf_personal_fixture'); return stream(); } }, async post => { const r = await post(); assert.equal(r.status, 200); await r.text(); });
  await serve({ env: { ...baseEnv, HF_BACKEND_ENABLED: 'false' }, transport: async () => { calls++; return stream(); } }, async post => { const r = await post(); assert.equal(r.status, 403); assert.equal((await r.json()).error.code, 'backend_disabled'); });
  await serve({ env: { ...baseEnv, US_BACKEND_ENABLED: 'false' }, transport: async () => { calls++; return stream(); } }, async post => { const r = await post({ ...body, provider: 'openai' }); assert.equal(r.status, 403); await r.text(); });
  assert.equal(calls, 1);
});

test('dedicated endpoints use configured models and cannot be redirected by the browser', async () => {
  let calls = 0;
  await serve({ env: { ...baseEnv, HF_BACKEND_BASE_URL: endpoint, HF_BACKEND_MODELS: 'fixture-model' }, transport: async (url, options) => { calls++; assert.equal(url, endpoint + '/chat/completions'); assert.equal(JSON.parse(options.body).model, 'fixture-model'); return stream(); } }, async post => {
    const listed = await post(body, '/api/models'); assert.deepEqual(await listed.json(), { data: [{ id: 'fixture-model' }], configured: true }); assert.equal(calls, 0);
    const wrong = await post({ ...body, model: 'other' }); assert.equal(wrong.status, 400); await wrong.text(); assert.equal(calls, 0);
    const valid = await post(); assert.equal(valid.status, 200); await valid.text(); assert.equal(calls, 1);
  });
});

test('Experiment flags still demand personal keys; HF funding retains zero-budget and separate-key gates', async () => {
  assert.equal(keyFor({ provider, serverAccessToken: 'fixture-plan-0123456789' }, { HF_BACKEND_ENABLED: 'true', HF_TOKEN: 'hf_experiment', SERVER_CREDIT_ACCESS_TOKEN: 'fixture-plan-0123456789' }), '');
  let calls = 0; setAdminTiers({ mode: 'manual', free: [{ id: 'fixture-model', provider }] });
  await serve({ env: { ...baseEnv, OPERATOR_FUNDING_DISABLED: 'false', FREE_CREDIT_MONTHLY_POOL: '400' }, transport: async () => { calls++; return stream(); } }, async post => {
    const { apiKey, ...keyless } = body;
    for (const flag of [{ 'X-Forge-Is-Experimental': 'true' }, {}]) {
      const r = await post(keyless, '/api/chat', flag); assert.equal(r.status, flag['X-Forge-Is-Experimental'] ? 401 : 402); await r.text();
    }
    assert.equal(calls, 0);
  });
});

test('HF discovery needs no account-profile scope, and dedicated models are explicitly configured', async () => {
  const calls = [];
  const models = await discoverForProvider(provider, baseEnv, async (url, options) => { calls.push(url); assert.equal(options.headers.Authorization, 'Bearer hf_owner_fixture'); return new Response('{"data":[{"id":"fixture-model"}]}'); });
  assert.deepEqual(calls, ['https://router.huggingface.co/v1/models']); assert.equal(models[0].id, 'fixture-model');
  const dedicated = await discoverForProvider(provider, { ...baseEnv, HF_BACKEND_BASE_URL: endpoint, HF_BACKEND_MODELS: 'fixture-model' }, async () => { throw Error('No inference or account probe should run'); });
  assert.deepEqual(dedicated, [{ id: 'fixture-model', label: 'fixture-model' }]);
});

test('a keyless HF selection cannot silently use a US key, or the reverse', async () => {
  let calls = 0;
  const env = { ...baseEnv, OPERATOR_FUNDING_DISABLED: 'false', OPENAI_API_KEY: 'sk_owner_fixture', FREE_CREDIT_MONTHLY_POOL: '400' };
  await serve({ env, transport: async () => { calls++; return stream(); } }, async post => {
    const { apiKey, ...keyless } = body;
    for (const [requested, routed] of [[provider, 'openai'], ['openai', provider]]) {
      setAdminTiers({ mode: 'manual', free: [{ id: 'fixture-model', provider: routed }] });
      const response = await post({ ...keyless, provider: requested });
      assert.equal(response.status, 403); assert.equal((await response.json()).error.code, 'backend_model_mismatch');
    }
    assert.equal(calls, 0);
  });
});

test('setup status exposes only the Render environment link, never the bootstrap code', async () => {
  const db = openDatabase(':memory:'); const env = { ADMIN_BOOTSTRAP_TOKEN: 'fixture-bootstrap-secret-long-enough', RENDER_SERVICE_ID: 'srv-fixture123' }; const settings = await openSettings({ db, env });
  const handler = createAdmin({ db, env, settings }); const server = createServer((req, res) => { void handler(req, res); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try { const r = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/status`); const text = await r.text(); assert.ok(!text.includes(env.ADMIN_BOOTSTRAP_TOKEN)); assert.equal(JSON.parse(text).setupEnvironmentUrl, 'https://dashboard.render.com/web/srv-fixture123/env'); }
  finally { await new Promise(r => server.close(r)); db.close(); }
});
