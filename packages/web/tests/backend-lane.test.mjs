import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDatabase } from '../server/db.mjs';
import { openSettings, cleanTiers } from '../server/settings.mjs';
import { createAdmin, discoverForProvider } from '../server/admin.mjs';
import { keyFor, resolveTarget } from '../server/proxy.mjs';
import { FREE_MODELS, adminTierConfig, freeModel, freeModels, freeTierStatus, paidModels, setAdminTiers } from '../server/freetier.mjs';
import { REGISTRY, backendProviders, isBackendProvider, isShieldEligible } from '../server/providerRegistry.mjs';

// The backend lane: the operator's dashboard and everything this deployment funds are limited to
// Anthropic, OpenAI, Google, xAI, Groq and Cerebras (plus Meta, Azure and Bedrock once integrated). This file runs with
// the lane enforced, which is the default; the older funding-mechanics tests switch it off.

const TOKEN = 'a-long-admin-token-for-tests';
const NON_LANE = ['github', 'vercel', 'openrouter', 'cohere', 'venice', 'xkiro', 'aihubmix', 'cheaper-inference', 'omniroute', 'ollama', 'custom', 'cerebras', 'meta', 'azure', 'bedrock'];

test.afterEach(() => setAdminTiers(null));

async function withServer(handlers, fn) {
  const server = createServer((req, res) => { (async () => { for (const h of handlers) if (await h(req, res)) return; res.writeHead(404); res.end(); })(); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise(r => server.close(r)); }
}
const call = (url, path, { method = 'GET', body, cookie, origin } = {}) => fetch(url + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
async function login(url) {
  const r = await call(url, '/api/admin/login', { method: 'POST', body: { token: TOKEN }, origin: url });
  assert.equal(r.status, 200);
  return r.headers.get('set-cookie').split(';')[0];
}

test('the registry names the key lane: the same seven providers on the dashboard and for a visitor key', () => {
  const lane = ['anthropic', 'google', 'groq', 'huggingface', 'nvidia', 'openai', 'xai'];
  assert.deepEqual(backendProviders().sort(), lane);
  assert.deepEqual(backendProviders({ onlyIntegrated: false }).sort(), lane);
  for (const id of lane) assert.equal(isBackendProvider(id), true, id);
  for (const id of [...NON_LANE, 'not-a-provider', '', undefined]) assert.equal(isBackendProvider(id), false, String(id));
  // Hugging Face is on the lane by request. It is a relay, so it is not Shield-eligible.
  for (const r of REGISTRY) if (isBackendProvider(r.id) && r.id !== 'huggingface') assert.equal(isShieldEligible(r), true, r.id);
  assert.equal(isShieldEligible(REGISTRY.find(r => r.id === 'huggingface')), false);
  assert.equal(isShieldEligible(REGISTRY.find(r => r.id === 'github')), true);
  assert.equal(isShieldEligible(REGISTRY.find(r => r.id === 'xkiro')), false);
});

test('the dashboard picks are the only funded models: the built-in Groq and OpenRouter ids are gone', () => {
  assert.deepEqual(FREE_MODELS, []);
  const env = { GROQ_API_KEY: 'k', OPENROUTER_API_KEY: 'k', XKIRO_API_KEY: 'k', HF_TOKEN: 'k' };
  assert.deepEqual(freeModels(env, ['a/free']), []);
  // Groq retired these on a live key (404 "does not exist"); they must never be offered as free.
  for (const id of ['groq/llama-3.3-70b-versatile', 'groq/llama-3.1-8b-instant', 'openrouter/auto', 'meta-llama/llama-3.2-3b-instruct:free', 'a/free', 'Qwen/Qwen2.5-7B-Instruct']) assert.equal(freeModel(id, env, ['a/free']), undefined, id);
  assert.equal(freeTierStatus(env, ['a/free']).enabled, false);
  // A pick the operator made from Groq's live list is funded, and only with a key behind it.
  setAdminTiers({ mode: 'manual', free: [{ id: 'openai/gpt-oss-120b', provider: 'groq' }], paid: [] });
  assert.equal(freeModel('openai/gpt-oss-120b', env, [])?.provider, 'groq');
  assert.deepEqual(freeTierStatus(env, []).models, ['openai/gpt-oss-120b']);
  assert.deepEqual(freeTierStatus({}, []).models, []);
});

test('a dashboard pick from the lane is funded; one from outside it is dropped on save, on load and at the funding gate', () => {
  const picks = { mode: 'manual', free: [{ id: 'gpt-4.1-mini', provider: 'openai' }, { id: 'llama-3.3-70b', provider: 'venice' }], paid: [{ id: 'claude-sonnet-5-5', provider: 'anthropic' }, { id: 'x', provider: 'openrouter' }] };
  assert.deepEqual(cleanTiers(picks).free.map(m => m.provider), ['openai']);
  assert.deepEqual(cleanTiers(picks).paid.map(m => m.provider), ['anthropic']);
  setAdminTiers(picks);
  assert.deepEqual(adminTierConfig().free.map(m => m.provider), ['openai']);
  const env = { OPENAI_API_KEY: 'k', ANTHROPIC_API_KEY: 'k', VENICE_API_KEY: 'k', OPENROUTER_API_KEY: 'k' };
  assert.deepEqual(freeModels(env, []).map(m => m.id), ['gpt-4.1-mini']);
  assert.deepEqual(paidModels(env).map(m => m.id), ['claude-sonnet-5-5']);
  assert.equal(freeModel('llama-3.3-70b', env, []), undefined);
});

test('a plan token unlocks the deployment keys for the lane only, never for another provider', () => {
  const env = { PLAN_ACCESS_TOKENS: 'plan-token-0123456789', ANTHROPIC_API_KEY: 'sk-ant-env', GROQ_API_KEY: 'gsk-env', OPENROUTER_API_KEY: 'sk-or-env' };
  assert.equal(keyFor({ provider: 'anthropic', serverAccessToken: 'plan-token-0123456789' }, env), 'sk-ant-env');
  assert.equal(keyFor({ provider: 'groq', serverAccessToken: 'plan-token-0123456789' }, env), 'gsk-env');
  for (const provider of ['openrouter', 'xkiro']) assert.equal(keyFor({ provider, serverAccessToken: 'plan-token-0123456789' }, { ...env, XKIRO_API_KEY: 'xk-env' }), '', provider);
  // A visitor's own key is the own-key lane: it still goes to any provider.
  for (const provider of ['groq', 'openrouter', 'anthropic']) assert.equal(keyFor({ provider, apiKey: 'sk-mine' }, env), 'sk-mine', provider);
});

test('the dashboard stores keys for the lane only, and can still clear one left from before the split', async () => {
  const db = openDatabase(':memory:');
  const settings = await openSettings({ db, env: { ADMIN_TOKEN: TOKEN } });
  await settings.setKey('anthropic', 'sk-ant-dashboard');
  assert.equal(settings.env().ANTHROPIC_API_KEY, 'sk-ant-dashboard');
  for (const provider of ['openrouter', 'xkiro', 'venice', 'custom']) await assert.rejects(() => settings.setKey(provider, 'k'), /US backend providers/, provider);
  // A row stored before the lane existed is still removable.
  db.setSetting('key:openrouter', 'legacy-plain');
  await settings.reload();
  await settings.deleteKey('openrouter');
  assert.equal(db.getSetting('key:openrouter') ?? null, null);
  const flags = Object.fromEntries(settings.keyStatus({}).map(p => [p.provider, p.backend]));
  assert.equal(flags.anthropic, true);
  assert.equal(flags.groq, true);
  assert.equal(flags.nvidia, true);
  assert.equal(flags.huggingface, true);
  assert.equal(flags.cerebras, false);
  assert.equal(flags.xkiro, false);
  assert.equal(flags.openrouter, false);
});

test('the admin API lists the lane, parks leftover keys apart, says what is planned, and refuses to discover outside it', async () => {
  const db = openDatabase(':memory:');
  const env = { ADMIN_TOKEN: TOKEN, GROQ_API_KEY: 'env-groq' };
  const settings = await openSettings({ db, env });
  db.setSetting('key:venice', 'legacy-plain');
  await settings.reload();
  await withServer([createAdmin({ db, env, settings, log: () => {} })], async url => {
    const cookie = await login(url);
    const config = await (await call(url, '/api/admin/config', { cookie })).json();
    assert.deepEqual(config.providers.map(p => p.provider).sort(), ['anthropic', 'google', 'groq', 'huggingface', 'nvidia', 'openai', 'xai']);
    assert.ok(config.providers.every(p => p.backend === true));
    // Only a dashboard-stored leftover is offered for removal; an environment key has no row at all.
    assert.deepEqual(config.retired.map(p => p.provider), ['venice']);
    assert.deepEqual(config.planned, []);
    const save = await call(url, '/api/admin/keys', { method: 'PUT', body: { provider: 'openrouter', key: 'sk-or-x' }, cookie, origin: url });
    assert.ok(save.status >= 400, 'saving a key outside the lane is refused');
    const gone = await call(url, '/api/admin/keys', { method: 'PUT', body: { provider: 'venice', key: '' }, cookie, origin: url });
    assert.equal(gone.status, 200);
    assert.deepEqual((await gone.json()).retired, []);
    const discover = await call(url, '/api/admin/discover', { method: 'POST', body: { provider: 'xkiro' }, cookie, origin: url });
    assert.equal(discover.status, 400);
  });
  await assert.rejects(() => discoverForProvider('openrouter', { OPENROUTER_API_KEY: 'k' }), /US backend providers/);
});

test('NVIDIA NIM is on the key lane; Amazon Bedrock is not a key slot', async () => {
  assert.equal((await resolveTarget('nvidia', '', {})).base, 'https://integrate.api.nvidia.com/v1');
  await assert.rejects(() => resolveTarget('bedrock', '', {}), /Unsupported provider/);
  const db = openDatabase(':memory:');
  const settings = await openSettings({ db, env: { ADMIN_TOKEN: TOKEN } });
  await settings.setKey('nvidia', 'nvapi-test-key');
  assert.equal(settings.env().NVIDIA_API_KEY, 'nvapi-test-key');
  await assert.rejects(() => settings.setKey('bedrock', 'AKIAIOSFODNN7EXAMPLE'), /Unknown provider|US backend providers/);
  await assert.rejects(() => settings.setKey('openai', 'not-openai'), /sk-/);
  await assert.rejects(() => settings.setKey('meta', 'muse-key-for-test'), /US backend providers/);
  const env = { PLAN_ACCESS_TOKENS: 'plan-token-0123456789', NVIDIA_API_KEY: 'nv-env', META_API_KEY: 'muse-env' };
  assert.equal(keyFor({ provider: 'nvidia', serverAccessToken: 'plan-token-0123456789' }, env), 'nv-env');
  assert.equal(keyFor({ provider: 'meta', serverAccessToken: 'plan-token-0123456789' }, env), '');
  assert.equal(keyFor({ provider: 'bedrock', serverAccessToken: 'plan-token-0123456789' }, env), '');
});
