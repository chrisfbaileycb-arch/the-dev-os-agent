import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  CATALOG_MAX_MODELS, CATALOG_RETRY_MS, CATALOG_TTL_MS,
  catalogModels, catalogStatus, ensureCatalog, fetchCatalog, freeIds, isFreeModel, normalizeCatalog, resetCatalog,
} from '../server/discovery.mjs';
import { XKIRO_DEFAULT_BASE, freeTierStatus, xkiroCatalog } from '../server/freetier.mjs';
import { createProxy } from '../server/proxy.mjs';

// Discovery is what replaced the hand-written free-model list, so these tests cover both halves of
// the reason it exists: that the filter is right about what "free" means, and that the list it
// produces is what the gateway is actually serving today. The second half needs the network, and is
// the one test in this repo allowed to use it — a purely offline suite is exactly what let six
// fabricated model ids ship as a working free tier.
//
// The gateway is stubbed at the fetch boundary rather than run as a local server, because
// xkiroBase() accepts HTTPS only: pointing XKIRO_BASE_URL at http://127.0.0.1 is refused and falls
// back to the real gateway, which would quietly turn every test here into a live one.

const model = (over = {}) => ({ id: 'vendor/model', access_tier: 'free', pricing: { input: 0, output: 0 }, ...over });
const payload = (...models) => ({ object: 'list', data: models });
const ok = body => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
const failing = status => ({ ok: false, status, text: async () => 'nope' });

/** A stubbed gateway. `reply` may be a value or a function of the call count, for changing answers. */
function gateway(reply) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, headers: options?.headers ?? {} });
    return typeof reply === 'function' ? reply(calls.length) : reply;
  };
  return { fetchImpl, calls };
}

test('free means the gateway said free and charges nothing, not one or the other', () => {
  assert.equal(isFreeModel(model()), true);
  // The label alone is not enough. A catalogue that ever disagrees with itself has to fall on the
  // side that does not spend the operator's money.
  assert.equal(isFreeModel(model({ pricing: { input: 0.091, output: 0.182 } })), false, 'priced input is not free');
  assert.equal(isFreeModel(model({ pricing: { input: 0, output: 6 } })), false, 'priced output is not free');
  assert.equal(isFreeModel(model({ access_tier: 'paid' })), false);
  assert.equal(isFreeModel(model({ access_tier: 'premium' })), false);
  // And the price alone is not enough either: no pricing block means nothing was promised.
  assert.equal(isFreeModel(model({ pricing: undefined })), false);
  for (const bad of [null, undefined, 42, 'free', {}, model({ id: '' }), model({ id: 'x'.repeat(201) })]) {
    assert.equal(isFreeModel(bad), false);
  }
});

test('the catalogue is normalised, deduplicated and bounded before anything reads it', () => {
  const models = normalizeCatalog(payload(
    model({ id: 'a/one', display_name: 'One', context_length: 1000, capabilities: { vision: true, reasoning: false } }),
    model({ id: ' a/two ', access_tier: 'paid', pricing: { input: 1, output: 2 } }),
    model({ id: 'a/one', display_name: 'Duplicate' }),
    { id: 42 }, null, 'nonsense',
    model({ id: 'a/three', display_name: '   ' }),
  ));
  assert.deepEqual(models.map(m => m.id), ['a/one', 'a/two', 'a/three'], 'trimmed, deduplicated, junk dropped');
  assert.deepEqual(models[0], { id: 'a/one', label: 'One', tier: 'free', free: true, context: 1000, vision: true, reasoning: false });
  assert.equal(models[1].free, false);
  assert.equal(models[1].tier, 'paid', "the gateway's own word is kept for the UI");
  assert.equal(models[2].label, 'a/three', 'a blank display name falls back to the id');
  assert.deepEqual(freeIds(models), ['a/one', 'a/three'], 'only the paid entry is left out');

  assert.deepEqual(normalizeCatalog(undefined), []);
  assert.deepEqual(normalizeCatalog({ data: 'not an array' }), []);
  const flood = normalizeCatalog(payload(...Array.from({ length: CATALOG_MAX_MODELS + 50 }, (_, i) => model({ id: `a/${i}` }))));
  assert.equal(flood.length, CATALOG_MAX_MODELS, 'a gateway cannot grow into a memory problem');
});

test('the catalogue is read from the configured base, with the key only when there is one', async () => {
  const { fetchImpl, calls } = gateway(ok(payload(model({ id: 'a/one' }))));
  // The public catalogue is enough to learn which models are free, so a first deploy is never
  // blocked on a key being set.
  await fetchCatalog({}, { fetchImpl });
  await fetchCatalog({ XKIRO_API_KEY: ' gw-key\n' }, { fetchImpl });
  // A key holding a character that cannot go in a header would throw while the request is being
  // built, which reads as an unreachable host; it is dropped rather than allowed to do that.
  await fetchCatalog({ XKIRO_API_KEY: 'bad\u0001key' }, { fetchImpl });
  await fetchCatalog({ XKIRO_BASE_URL: 'https://eu.xkiro.example/v1' }, { fetchImpl });

  assert.equal(calls[0].url, `${XKIRO_DEFAULT_BASE}/models`);
  assert.equal(calls[3].url, 'https://eu.xkiro.example/v1/models', 'XKIRO_BASE_URL steers discovery too');
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[1].headers.Authorization, 'Bearer gw-key', 'a pasted newline is trimmed, not rejected');
  assert.equal(calls[2].headers.Authorization, undefined);
  assert.match(calls[0].headers['User-Agent'], /^HeyBuddy\//, 'a request with no User-Agent is what bot filters refuse');
});

test('a gateway that answers with nothing usable is a failure, not an empty free tier', async () => {
  await assert.rejects(() => fetchCatalog({}, { fetchImpl: gateway(ok({ object: 'list', data: [] })).fetchImpl }), /no usable models/);
  await assert.rejects(() => fetchCatalog({}, { fetchImpl: gateway(failing(500)).fetchImpl }), /HTTP 500/);
  await assert.rejects(() => fetchCatalog({}, { fetchImpl: gateway({ ok: true, status: 200, text: async () => '<html>' }).fetchImpl }), /not JSON/);
  await assert.rejects(() => fetchCatalog({}, { fetchImpl: gateway({ ok: true, status: 200, text: async () => 'x'.repeat(4_000_001) }).fetchImpl }), /too large/);
});

test('one fetch per TTL, shared by concurrent callers, and published to the free tier', async () => {
  resetCatalog();
  const { fetchImpl, calls } = gateway(ok(payload(
    model({ id: 'a/free' }),
    model({ id: 'a/paid', access_tier: 'paid', pricing: { input: 1, output: 1 } }),
  )));
  try {
    // Ten simultaneous page loads must produce one request, not ten.
    await Promise.all(Array.from({ length: 10 }, () => ensureCatalog({}, { fetchImpl, now: 1000 })));
    assert.equal(calls.length, 1, 'single flight');
    await ensureCatalog({}, { fetchImpl, now: 1000 + CATALOG_TTL_MS - 1 });
    assert.equal(calls.length, 1, 'still inside the TTL');

    assert.deepEqual(catalogModels().map(m => m.id), ['a/free', 'a/paid']);
    // The point of the whole module: the funding decision now reads what the gateway reported.
    assert.deepEqual(xkiroCatalog(), ['a/free']);
    assert.deepEqual(freeTierStatus({ XKIRO_API_KEY: 'k' }).models, ['a/free']);
    assert.deepEqual(catalogStatus(), { discovered: true, count: 2, free: 1, at: new Date(1000).toISOString(), error: null });

    await ensureCatalog({}, { fetchImpl, now: 1000 + CATALOG_TTL_MS + 1 });
    assert.equal(calls.length, 2, 'the TTL expires and it refreshes');
  } finally { resetCatalog(); }
  assert.deepEqual(xkiroCatalog(), [], 'reset clears the published list too');
});

test('a gateway that goes down keeps the last catalogue instead of emptying the tier', async () => {
  resetCatalog();
  const logged = [];
  let down = false;
  const { fetchImpl, calls } = gateway(() => down ? failing(503) : ok(payload(model({ id: 'a/free' }))));
  try {
    await ensureCatalog({}, { fetchImpl, now: 0 });
    assert.deepEqual(xkiroCatalog(), ['a/free']);

    down = true;
    const stale = await ensureCatalog({}, { fetchImpl, now: CATALOG_TTL_MS + 1, log: m => logged.push(m) });
    // Degrading to "slightly stale" is the difference between a visitor seeing an older model list
    // and a visitor seeing a product that looks broken.
    assert.deepEqual(stale.models.map(m => m.id), ['a/free'], 'the good catalogue survives');
    assert.deepEqual(xkiroCatalog(), ['a/free']);
    assert.equal(catalogStatus().discovered, true, 'still serving a real catalogue');
    assert.match(catalogStatus().error, /HTTP 503/, 'but the operator is told what broke');
    assert.match(logged[0], /^\[discovery\] xKiro catalogue unavailable: /);

    // A failure shortens the clock to the retry window rather than waiting out a whole TTL.
    down = false;
    const attempted = calls.length;
    await ensureCatalog({}, { fetchImpl, now: CATALOG_TTL_MS + CATALOG_RETRY_MS });
    assert.equal(calls.length, attempted, 'inside the retry window nothing is attempted');
    assert.match(catalogStatus().error, /HTTP 503/);
    await ensureCatalog({}, { fetchImpl, now: CATALOG_TTL_MS + CATALOG_RETRY_MS + 2 });
    assert.equal(calls.length, attempted + 1);
    assert.equal(catalogStatus().error, null, 'past it, it recovers on its own');
  } finally { resetCatalog(); }
});

test('a cold gateway leaves the free tier closed and says so, rather than guessing', async () => {
  resetCatalog();
  try {
    await ensureCatalog({ XKIRO_API_KEY: 'k' }, { fetchImpl: gateway(failing(503)).fetchImpl, now: 0, log: () => {} });
    // This is the honest outcome, and the one the old code got wrong: it advertised five models it
    // had never checked, so the tier reported enabled and answered 404 on the first message.
    assert.equal(freeTierStatus({ XKIRO_API_KEY: 'k' }).enabled, false);
    assert.deepEqual(freeTierStatus({ XKIRO_API_KEY: 'k' }).models, []);
    assert.equal(catalogStatus().discovered, false);
    assert.match(catalogStatus().error, /HTTP 503/);
  } finally { resetCatalog(); }
});

test('/api/providers publishes the discovered catalogue with the tier of every model', async () => {
  resetCatalog();
  const { fetchImpl } = gateway(ok(payload(
    model({ id: 'a/free', display_name: 'Free One' }),
    model({ id: 'a/paid', display_name: 'Paid One', access_tier: 'paid', pricing: { input: 1, output: 6 } }),
  )));
  const env = { XKIRO_API_KEY: 'gw-key-do-not-leak' };
  const handler = createProxy({
    env,
    transport: async () => { throw Error('must not call'); },
    discover: (e, options) => ensureCatalog(e, { ...options, fetchImpl }),
  });
  const server = createServer((req, res) => { handler(req, res).then(handled => { if (!handled) { res.writeHead(404); res.end(); } }); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/providers`);
    const text = await response.text();
    assert.ok(!text.includes('gw-key-do-not-leak'), 'the key never rides along with the catalogue');
    const body = JSON.parse(text);
    // The free half funds the free tier; the paid half is what a visitor picks from on their own
    // key, which is why the whole catalogue is published and not just the funded part.
    assert.deepEqual(body.free.models, ['a/free']);
    assert.equal(body.free.enabled, true);
    assert.equal(body.gatewayCatalog.discovered, true);
    assert.equal(body.gatewayCatalog.url, XKIRO_DEFAULT_BASE);
    assert.deepEqual(body.gatewayCatalog.models.map(m => [m.id, m.label, m.tier, m.free]), [
      ['a/free', 'Free One', 'free', true],
      ['a/paid', 'Paid One', 'paid', false],
    ]);
  } finally { await new Promise(r => server.close(r)); resetCatalog(); }
});

/**
 * The test that would have caught the original bug.
 *
 * Every offline assertion above can pass while the ids we advertise are fiction, which is exactly
 * what happened: `deepseek/deepseek-chat`, `deepseek/deepseek-r1` and `qwen/qwen-2.5-72b-instruct`
 * did not exist on the gateway, and `z-ai/glm-5.2`, `z-ai/glm-5.3-flash` and
 * `moonshotai/kimi-k2.7-code` were paid or premium. So CI reaches the real catalogue and checks
 * that what this code would fund is what the gateway says it gives away.
 *
 * Set SKIP_UPSTREAM_TESTS=1 to skip it on a machine with no outbound network. CI does not.
 */
test('the live gateway catalogue agrees with what this build would fund', { skip: process.env.SKIP_UPSTREAM_TESTS === '1' ? 'SKIP_UPSTREAM_TESTS=1' : false }, async () => {
  resetCatalog();
  try {
    const raw = await fetch(`${XKIRO_DEFAULT_BASE}/models`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    assert.equal(raw.ok, true, `${XKIRO_DEFAULT_BASE}/models answered HTTP ${raw.status}`);
    const live = await raw.json();
    assert.ok(Array.isArray(live.data) && live.data.length > 0, 'the gateway published a catalogue');

    const models = await fetchCatalog({});
    const ids = new Set(models.map(m => m.id));
    const free = freeIds(models);
    assert.ok(free.length > 0, 'the gateway gives away at least one model');

    // Every id this build would fund exists upstream, is labelled free, and costs nothing.
    const upstream = new Map(live.data.filter(m => m && typeof m.id === 'string').map(m => [m.id, m]));
    for (const id of free) {
      const entry = upstream.get(id);
      assert.ok(entry, `${id} would be funded but the gateway does not serve it`);
      assert.equal(entry.access_tier, 'free', `${id} is funded but the gateway calls it ${entry.access_tier}`);
      assert.equal(Number(entry.pricing?.input), 0, `${id} is funded but has priced input`);
      assert.equal(Number(entry.pricing?.output), 0, `${id} is funded but has priced output`);
    }
    // And nothing the gateway gives away is silently dropped, which is the other half of the
    // guarantee: the old FRONTIER name-pattern refused a $0 model because its id said "gpt-5".
    for (const entry of live.data) {
      if (!isFreeModel(entry)) continue;
      assert.ok(ids.has(entry.id), `${entry.id} is free upstream but was dropped while normalising`);
      assert.ok(free.includes(entry.id), `${entry.id} is free upstream but this build would not fund it`);
    }

    // Finally through the same path the server uses, so the published list is the checked one.
    await ensureCatalog({}, { now: Date.now() });
    assert.deepEqual(xkiroCatalog(), free);
    assert.deepEqual(freeTierStatus({ XKIRO_API_KEY: 'k' }).models, free);
  } finally { resetCatalog(); }
});
