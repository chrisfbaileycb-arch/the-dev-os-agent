import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDatabase } from '../server/db.mjs';
import { openSettings, cleanTiers, cleanTunable } from '../server/settings.mjs';
import { createAdmin, makeSession, validSession } from '../server/admin.mjs';
import { createProxy } from '../server/proxy.mjs';
import { decrypt, encrypt, decryptAny } from '../server/secrets.mjs';
import { freeModels, paidTierStatus, setAdminTiers, freeTierStatus } from '../server/freetier.mjs';
import { normalizeModelList } from '../server/models.mjs';

const TOKEN = 'a-long-admin-token-for-tests';

async function withServer(handlers, fn) {
  const server = createServer((req, res) => { (async () => { for (const h of handlers) if (await h(req, res)) return; res.writeHead(404); res.end(); })(); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise(r => server.close(r)); }
}
const call = (url, path, { method = 'GET', body, cookie, origin } = {}) => fetch(url + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });

async function login(url) {
  const r = await call(url, '/api/admin/login', { method: 'POST', body: { token: TOKEN }, origin: url });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie');
  assert.match(cookie, /^hb_admin=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Path=\/api\/admin/);
  return cookie.split(';')[0];
}

test.afterEach(() => setAdminTiers(null));

test('secrets round-trip and refuse the wrong key', () => {
  const sealed = encrypt('sk-or-v1-abcdef', 'secret-one');
  assert.notEqual(sealed, 'sk-or-v1-abcdef');
  assert.equal(decrypt(sealed, 'secret-one'), 'sk-or-v1-abcdef');
  assert.equal(decrypt(sealed, 'secret-two'), null);
  assert.equal(decryptAny(sealed, ['secret-two', 'secret-one']), 'sk-or-v1-abcdef');
});

test('tier config is validated: unknown providers drop out and free wins over paid', () => {
  const t = cleanTiers({ mode: 'manual', free: [{ id: 'a', provider: 'groq', label: 'A' }, { id: 'x', provider: 'nope' }], paid: [{ id: 'A', provider: 'openai' }, { id: 'b', provider: 'openai' }] });
  assert.equal(t.mode, 'manual');
  assert.deepEqual(t.free, [{ id: 'a', provider: 'groq', label: 'A' }]);
  assert.deepEqual(t.paid, [{ id: 'b', provider: 'openai' }]);
  assert.equal(cleanTunable('FREE_MAX_PER_HOUR', '25'), '25');
  assert.throws(() => cleanTunable('FREE_MAX_PER_HOUR', 'lots'), /between/);
  assert.equal(cleanTunable('FREE_TIER_DISABLED', true), 'true');
  assert.throws(() => cleanTunable('NOT_A_SETTING', '1'), /Unknown/);
});

test('admin tiers shape the free and paid pools the proxy reads', () => {
  setAdminTiers({ mode: 'auto', free: [{ id: 'openai/gpt-4o-mini', provider: 'openrouter', label: 'GPT-4o mini' }], paid: [{ id: 'gpt-4o', provider: 'openai', label: 'GPT-4o' }, { id: 'groq/llama-3.1-8b-instant', provider: 'groq' }] });
  const env = { OPENROUTER_API_KEY: 'k1', GROQ_API_KEY: 'k2', OPENAI_API_KEY: 'k3', SERVER_CREDIT_ACCESS_TOKEN: 'tok' };
  const free = freeModels(env, []);
  assert.equal(free[0].id, 'openai/gpt-4o-mini');
  assert.equal(free[0].envKey, 'OPENROUTER_API_KEY');
  // Moved to the paid tier, so it leaves the automatic free pool even though it is a static entry.
  assert.ok(!free.some(m => m.id === 'groq/llama-3.1-8b-instant'));
  assert.ok(free.some(m => m.id === 'groq/llama-3.3-70b-versatile'));
  const status = freeTierStatus(env, []);
  assert.equal(status.labels['openai/gpt-4o-mini'], 'GPT-4o mini');
  const paid = paidTierStatus(env);
  assert.equal(paid.enabled, true);
  assert.deepEqual(paid.models, ['gpt-4o', 'groq/llama-3.1-8b-instant']);
  assert.equal(paid.providers['gpt-4o'], 'openai');
  // Without the access token the tier is configured but not open.
  assert.equal(paidTierStatus({ ...env, SERVER_CREDIT_ACCESS_TOKEN: '' }).enabled, false);
  // Manual mode: exactly the operator's list.
  setAdminTiers({ mode: 'manual', free: [{ id: 'only/this', provider: 'groq' }], paid: [] });
  assert.deepEqual(freeModels(env, ['discovered/free']).map(m => m.id), ['only/this']);
});

test('the model list normalizer keeps a plain id list plain and reads labels and free flags where given', () => {
  assert.deepEqual(normalizeModelList('groq', { data: [{ id: 'llama' }] }), [{ id: 'llama' }]);
  assert.deepEqual(normalizeModelList('openrouter', { data: [{ id: 'x/y:free', name: 'Y', pricing: { prompt: '0', completion: '0' } }, { id: 'x/z', name: 'Z', pricing: { prompt: '0.1', completion: '0.2' } }] }), [{ id: 'x/y:free', label: 'Y', free: true }, { id: 'x/z', label: 'Z' }]);
  assert.deepEqual(normalizeModelList('google', { data: [{ id: 'models/gemini-2.5-flash' }] }), [{ id: 'gemini-2.5-flash' }]);
  assert.deepEqual(normalizeModelList('cohere', { models: [{ name: 'command-a', endpoints: ['chat'] }, { name: 'embed-v4', endpoints: ['embed'] }] }), [{ id: 'command-a' }]);
  assert.equal(normalizeModelList('openai', { nope: [] }), null);
});

test('the dashboard is off without ADMIN_TOKEN and refuses a wrong token', async () => {
  const db = openDatabase(':memory:');
  const settings = await openSettings({ db, env: {} });
  await withServer([createAdmin({ db, env: {}, settings, log: () => {} })], async url => {
    const status = await (await call(url, '/api/admin/status')).json();
    // No credential yet, but a deployment with storage offers first-run setup instead of refusing.
    assert.deepEqual(status, { configured: false, authenticated: false, persistent: true, setup: true, source: 'none', storage: true });
    assert.equal((await call(url, '/api/admin/config')).status, 503);
  });
  const env = { ADMIN_TOKEN: TOKEN };
  const s2 = await openSettings({ db, env });
  await withServer([createAdmin({ db, env, settings: s2, log: () => {} })], async url => {
    // With an environment token the setup route is closed for good and sign-in is the only way in.
    assert.deepEqual(await (await call(url, '/api/admin/status')).json(), { configured: true, authenticated: false, persistent: true, setup: false, source: 'environment', storage: true });
    assert.equal((await call(url, '/api/admin/setup', { method: 'POST', body: { token: 'another-long-password' }, origin: url })).status, 403);
    assert.equal((await call(url, '/api/admin/login', { method: 'POST', body: { token: 'wrong' }, origin: url })).status, 401);
    assert.equal((await call(url, '/api/admin/config')).status, 401);
    // A cross-origin write is refused before the token is even checked.
    assert.equal((await call(url, '/api/admin/login', { method: 'POST', body: { token: TOKEN }, origin: 'https://elsewhere.example' })).status, 403);
  });
});

test('a deployment with no ADMIN_TOKEN can be set up from the page, once', async () => {
  const db = openDatabase(':memory:');
  const settings = await openSettings({ db, env: {} });
  const handler = createAdmin({ db, env: {}, settings, log: () => {} });
  await withServer([handler], async url => {
    // The password is a one-time decision: too short is refused, cross-origin is refused.
    assert.equal((await call(url, '/api/admin/setup', { method: 'POST', body: { token: 'short' }, origin: url })).status, 400);
    assert.equal((await call(url, '/api/admin/setup', { method: 'POST', body: { token: 'a-long-enough-password' }, origin: 'https://elsewhere.example' })).status, 403);
    assert.equal((await call(url, '/api/admin/setup', { method: 'POST', body: { token: 'a-long-enough-password' }, origin: url })).status, 200);
    // Setting it closes setup and opens the dashboard with the password just chosen.
    assert.deepEqual(await (await call(url, '/api/admin/status')).json(), { configured: true, authenticated: false, persistent: true, setup: false, source: 'dashboard', storage: true });
    assert.equal((await call(url, '/api/admin/setup', { method: 'POST', body: { token: 'a-second-password-choice' }, origin: url })).status, 403);
    assert.equal((await call(url, '/api/admin/login', { method: 'POST', body: { token: 'a-long-enough-password' }, origin: url })).status, 200);
    assert.equal((await call(url, '/api/admin/login', { method: 'POST', body: { token: 'a-second-password-choice' }, origin: url })).status, 401);
  });
  // The session cookie is signed with something only this server holds, not with the empty string
  // a missing ADMIN_TOKEN would otherwise leave behind: a forged cookie must not be accepted.
  const env = {};
  assert.equal(validSession(makeSession(env, 1_000), env, 2_000), true, 'the pre-setup env signs with the empty string');
  await withServer([handler], async url => {
    assert.equal((await call(url, '/api/admin/config', { headers: { cookie: 'hb_admin=' + makeSession(env, Date.now()) } })).status, 401);
  });
  // A deployment with no storage cannot remember a password, so setup is not offered at all.
  const volatile = await openSettings({ db: { allSettings: async () => [] }, env: {} });
  await withServer([createAdmin({ db: null, env: {}, settings: volatile, log: () => {} })], async url => {
    assert.equal((await (await call(url, '/api/admin/status')).json()).setup, false);
    assert.equal((await call(url, '/api/admin/setup', { method: 'POST', body: { token: 'a-long-enough-password' }, origin: url })).status, 503);
  });
});

test('a stored key is sealed in the database, overlays the environment, and funds the next request', async () => {
  const db = openDatabase(':memory:');
  const env = { ADMIN_TOKEN: TOKEN, GROQ_API_KEY: 'env-groq' };
  const settings = await openSettings({ db, env });
  let seenAuth = null;
  const proxy = createProxy({ env, settings, discover: async () => {}, discoverOpenRouter: async () => {}, transport: async (url, options) => { seenAuth = options.headers.Authorization; const { Readable } = await import('node:stream'); const s = Readable.from([Buffer.from('{"data":[{"id":"m"}]}')]); s.statusCode = 200; s.headers = { 'content-type': 'application/json' }; return s; } });
  await withServer([createAdmin({ db, env, settings, log: () => {} }), proxy], async url => {
    const cookie = await login(url);
    let config = await (await call(url, '/api/admin/config', { cookie })).json();
    const groq = config.providers.find(p => p.provider === 'groq');
    assert.equal(groq.source, 'environment');
    assert.equal(groq.hint, '…groq');
    const r = await call(url, '/api/admin/keys', { method: 'PUT', body: { provider: 'openrouter', key: 'sk-or-dashboard-key\n' }, cookie, origin: url });
    assert.equal(r.status, 200);
    config = await r.json();
    const or = config.providers.find(p => p.provider === 'openrouter');
    assert.equal(or.source, 'dashboard');
    assert.equal(or.hint, '…-key');
    // Sealed at rest: the plaintext is nowhere in the database.
    const row = db.getSetting('key:openrouter');
    assert.match(row, /^v1:/);
    assert.ok(!row.includes('dashboard-key'));
    assert.equal(settings.env().OPENROUTER_API_KEY, 'sk-or-dashboard-key');
    // And the proxy uses it for a credits-mode request without a restart.
    await settings.setTunable('SERVER_CREDIT_ACCESS_TOKEN', 'plan-token');
    const m = await fetch(url + '/api/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'openrouter', serverAccessToken: 'plan-token' }) });
    assert.equal(m.status, 200);
    assert.equal(seenAuth, 'Bearer sk-or-dashboard-key');
    // Deleting it falls back to nothing (there was no environment value).
    await call(url, '/api/admin/keys', { method: 'PUT', body: { provider: 'openrouter', key: '' }, cookie, origin: url });
    assert.equal(settings.env().OPENROUTER_API_KEY, undefined);
    // A second open of the same database reads the stored settings back.
    await settings.setKey('groq', 'dash-groq');
    const again = await openSettings({ db, env });
    assert.equal(again.env().GROQ_API_KEY, 'dash-groq');
    // Tiers save and publish.
    const t = await call(url, '/api/admin/tiers', { method: 'PUT', body: { mode: 'auto', free: [{ id: 'llama-3.1-8b-instant', provider: 'groq', label: 'Llama 8B' }], paid: [{ id: 'gpt-4o', provider: 'openai' }] }, cookie, origin: url });
    const cfg = await t.json();
    assert.equal(cfg.tiers.free.length, 1);
    assert.ok(cfg.published.free.models.includes('llama-3.1-8b-instant'));
    assert.equal(cfg.published.free.labels['llama-3.1-8b-instant'], 'Llama 8B');
    // gpt-4o is configured as paid but no OpenAI key is held, so it is not published.
    assert.deepEqual(cfg.published.paid.models, []);
    assert.equal(cfg.published.paid.configured, true);
    // Logout clears the cookie.
    const out = await call(url, '/api/admin/logout', { method: 'POST', body: {}, cookie, origin: url });
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  });
});

test('discover uses the stored key against the provider and returns labelled models', async () => {
  const db = openDatabase(':memory:');
  const env = { ADMIN_TOKEN: TOKEN };
  const settings = await openSettings({ db, env });
  await settings.setKey('anthropic', 'sk-ant-test');
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, headers: init.headers }); return { ok: true, status: 200, json: async () => ({ data: [{ id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' }] }) }; };
  await withServer([createAdmin({ db, env, settings, log: () => {}, fetchImpl })], async url => {
    const cookie = await login(url);
    const r = await call(url, '/api/admin/discover', { method: 'POST', body: { provider: 'anthropic' }, cookie, origin: url });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { provider: 'anthropic', models: [{ id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' }] });
    assert.equal(calls[0].url, 'https://api.anthropic.com/v1/models');
    assert.equal(calls[0].headers['x-api-key'], 'sk-ant-test');
    const missing = await call(url, '/api/admin/discover', { method: 'POST', body: { provider: 'google' }, cookie, origin: url });
    assert.equal(missing.status, 400);
  });
});

test('sessions expire and are bound to the token', () => {
  const env = { ADMIN_TOKEN: TOKEN };
  const s = makeSession(env, 1_000);
  assert.equal(validSession(s, env, 2_000), true);
  assert.equal(validSession(s, env, 1_000 + 13 * 3_600_000), false);
  assert.equal(validSession(s, { ADMIN_TOKEN: 'other-token-value' }, 2_000), false);
  assert.equal(validSession('garbage', env, 2_000), false);
});
