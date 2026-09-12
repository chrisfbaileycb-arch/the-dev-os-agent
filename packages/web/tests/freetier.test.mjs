import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { FREE_TIER_UNAVAILABLE, createProxy } from '../server/proxy.mjs';
import { openDatabase } from '../server/db.mjs';
import { FREE_MODELS, XKIRO_DEFAULT_BASE, createBurstLimiter, creditsForTokens, freeModel, freeModels, freeTierStatus, fundedModels, isFrontier, routeFreeRequest, setXkiroCatalog, xkiroBase, xkiroCatalog, xkiroPool } from '../server/freetier.mjs';
import { createMeter, deltaLength, usageFrom } from '../server/meter.mjs';

const workspace = '3f2b8c1e-5d4a-4b6c-9e7f-0a1b2c3d4e5f';
const base = { provider: 'groq', model: 'groq/llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'hello' }] };

/**
 * Free gateway ids as the real catalogue reports them, used wherever a test needs a discovered
 * pool. Deliberately taken from the live gateway rather than invented: `openai/gpt-5.3-codex-spark`
 * is in there because it is free at $0/$0 and the old FRONTIER pattern refused to fund it.
 */
const DISCOVERED = ['deepseek/deepseek-v4-flash', 'openai/gpt-5.3-codex-spark', 'qwen/qwen3.8-max:free'];
/** Seed the discovered pool for one test and hand back a cleanup that empties it again. */
function discovered(ids = DISCOVERED) { setXkiroCatalog(ids); return () => setXkiroCatalog([]); }

function stream(text, status = 200, type = 'text/event-stream') { const s = Readable.from([Buffer.from(text)]); s.statusCode = status; s.headers = { 'content-type': type }; return s; }
async function withProxy(options, fn) {
  // Discovery is stubbed out by default: these tests assert how requests are funded and routed,
  // and reaching a live gateway to do it would make them slow, flaky, and dependent on somebody
  // else's uptime. tests/discovery.test.mjs is where the real catalogue is exercised.
  const handler = createProxy({ discover: async () => {}, ...options });
  const server = createServer((req, res) => { handler(req, res).then(handled => { if (!handled) { res.writeHead(404); res.end(); } }); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise(r => server.close(r)); }
}
const chat = (url, body, headers = {}) => fetch(url + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspace, ...headers }, body: JSON.stringify(body) });

test('the UI catalog claims no free models of its own', () => {
  // This replaces a parity check between two hand-written lists. Both were wrong in the same way
  // — they named gateway ids that either did not exist or were paid — so comparing them to each
  // other passed while the tier 404'd on every request. The only durable version of this test is
  // that the browser has no free list to be wrong about: it renders what /api/providers reports.
  const catalog = readFileSync(new URL('../src/lib/catalog.ts', import.meta.url), 'utf8');
  assert.ok(!/zeroConfig/.test(catalog), 'catalog.ts must not declare zero-config models');
  assert.ok(!/tier: 'free'/.test(catalog), "catalog.ts must not claim any model is 'free'");
  for (const id of ['deepseek/deepseek-chat', 'z-ai/glm-5.2', 'qwen/qwen-2.5-72b-instruct', 'moonshotai/kimi-k2.7-code']) {
    assert.ok(!catalog.includes(id), `${id} is a gateway id and must not be hardcoded in the UI`);
  }
});

test('the deployment never funds a frontier model from its own key', () => {
  // The whole point of the zero-config tier is that a stranger can use it without paying. That
  // only stays affordable while what it funds is cheap per token: one reasoning run can cost
  // fifty short completions for the same visible answer, and the ledger meters both at the flat
  // FREE_WEIGHT. So frontier ids are refused wherever they come from, the operator's own
  // XKIRO_FREE_MODELS included — a pasted gateway catalogue is how that pool gets opened by
  // accident, and the bill for it lands on the operator.
  for (const id of ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'openai/gpt-5', 'deepseek/deepseek-r1', 'openai/o3-mini', 'x-ai/grok-4', 'google/gemini-2.5-pro', 'qwen/qwq-32b-reasoning']) {
    assert.equal(isFrontier(id), true, id);
    // An operator naming it in XKIRO_FREE_MODELS cannot conjure it into the pool either, because
    // that variable now intersects with what the gateway reported rather than replacing it.
    assert.equal(freeModel(id, { XKIRO_FREE_MODELS: id, XKIRO_API_KEY: 'k' }, DISCOVERED), undefined, `${id} must not be fundable`);
  }
  for (const m of FREE_MODELS) assert.equal(isFrontier(m.id), false, `${m.id} is shipped as free`);
});

test('a discovered gateway model is funded on its price, not on its name', () => {
  // The FRONTIER pattern guesses cost from an id, and it guessed wrong: gpt-5.3-codex-spark is
  // $0 in and $0 out on the gateway, and `gpt-[45]` matched it, so the tier refused to serve a
  // model that costs nothing. A discovered id carries the gateway's own price, which settles the
  // question the pattern was approximating, so the pattern does not apply to it.
  const env = { XKIRO_API_KEY: 'k' };
  assert.equal(isFrontier('openai/gpt-5.3-codex-spark'), true, 'the old pattern still matches it');
  assert.equal(freeModel('openai/gpt-5.3-codex-spark', env, DISCOVERED)?.provider, 'xkiro');
  assert.ok(freeTierStatus(env, DISCOVERED).models.includes('openai/gpt-5.3-codex-spark'));
  // The static Groq and OpenRouter entries are still guarded, because a name is all we know there.
  assert.equal(freeModel('groq/llama-3.3-70b-versatile', { GROQ_API_KEY: 'k' }, [])?.provider, 'groq');
});

test('the funded list says which provider serves each model', () => {
  // The browser used to infer this from the id prefix and sent every non-Groq free model to
  // OpenRouter the moment a visitor added their own key.
  const status = freeTierStatus({ GROQ_API_KEY: 'k', XKIRO_API_KEY: 'k' }, DISCOVERED);
  assert.equal(status.providers['groq/llama-3.3-70b-versatile'], 'groq');
  assert.equal(status.providers['deepseek/deepseek-v4-flash'], 'xkiro');
  assert.deepEqual(Object.keys(status.providers).sort(), [...status.models].sort());
});

test('the discovered pool is what the gateway reported, deduplicated and bounded', () => {
  const restore = discovered(['a/one', ' a/two ', 'a/one', '', 42, null, 'x'.repeat(201)]);
  try {
    assert.deepEqual(xkiroCatalog(), ['a/one', 'a/two'], 'blank, oversized and non-string ids are dropped');
    assert.deepEqual(freeTierStatus({ XKIRO_API_KEY: 'k' }).models, ['a/one', 'a/two'], 'module state feeds the proxy');
  } finally { restore(); }
  assert.deepEqual(xkiroCatalog(), []);
  assert.equal(freeTierStatus({ XKIRO_API_KEY: 'k' }).enabled, false, 'no catalogue means no free tier');
});

test('only exact allowlist ids resolve, and only when the deployment funds them', () => {
  assert.equal(freeModel('groq/llama-3.3-70b-versatile')?.provider, 'groq');
  assert.equal(freeModel('GROQ/LLAMA-3.3-70B-VERSATILE')?.provider, 'groq', 'case is normalised');
  for (const bad of ['groq/llama-3.3-70b', 'llama-3.3-70b-versatile', 'openai/gpt-4o', '', null, undefined, 42]) assert.equal(freeModel(bad), undefined);
  assert.equal(freeTierStatus({}).enabled, false);
  assert.deepEqual(freeTierStatus({ GROQ_API_KEY: 'k' }, []).models, ['groq/llama-3.3-70b-versatile', 'groq/llama-3.1-8b-instant']);
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
    // Only what these two keys fund — the gateway entries stay out until its key is present.
    assert.equal(body.free.models.length, 6);
    assert.ok(!body.free.models.some(id => id.startsWith('deepseek/')));
    // And the discovery report rides along, so an operator can see why the pool is the size it is.
    assert.equal(body.gatewayCatalog.discovered, false);
    assert.deepEqual(body.gatewayCatalog.models, []);
    assert.equal(body.gatewayCatalog.url, XKIRO_DEFAULT_BASE);
  });
  // The health check must still answer 200 on a deployment with nothing configured.
  await withProxy({ env: {}, transport: async () => { throw Error('must not call'); } }, async url => {
    const body = await (await fetch(url + '/api/providers')).json();
    assert.equal(body.free.enabled, false);
    assert.deepEqual(body.free.models, []);
  });
});

test('the warming-up message is identical in the server and the browser', () => {
  // The browser shows its own copy on states the server never sees (a failed /api/providers),
  // so the two constants must match exactly or a visitor gets two different explanations.
  const client = readFileSync(new URL('../src/lib/deployment.ts', import.meta.url), 'utf8');
  const match = client.match(/export const FREE_TIER_WARMING = '([^']+)'/);
  assert.ok(match, 'FREE_TIER_WARMING is declared in src/lib/deployment.ts');
  assert.equal(match[1], FREE_TIER_UNAVAILABLE);
  assert.match(FREE_TIER_UNAVAILABLE, /warming up/);
});

test('an allowlisted model this deployment cannot fund reads as a warming tier, not a key error', async () => {
  // No provider keys at all.
  await withProxy({ env: {}, transport: async () => { throw Error('must not call'); } }, async url => {
    const response = await chat(url, base);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.message, FREE_TIER_UNAVAILABLE);
    assert.equal(body.error.code, 'free_tier_unavailable');
  });
  // Switched off deliberately: same story for the visitor, who cannot act on the difference.
  await withProxy({ env: { GROQ_API_KEY: 'k', FREE_TIER_DISABLED: 'true' }, transport: async () => { throw Error('must not call'); } }, async url => {
    assert.equal((await chat(url, base)).status, 503);
  });
  // A model that was never free still asks for a key, because that is the honest fix.
  await withProxy({ env: {}, transport: async () => { throw Error('must not call'); } }, async url => {
    const response = await chat(url, { ...base, provider: 'openrouter', model: 'openai/gpt-4o' });
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error.code, 'key_required');
    assert.match(body.error.message, /needs a key/);
  });
});

test('an upstream failure on a server-funded request is never reported as the visitor key', async () => {
  for (const status of [401, 403, 429, 500]) {
    await withProxy({ env: { GROQ_API_KEY: 'expired-server-key' }, db: null, transport: async () => stream('nope', status) }, async url => {
      const response = await chat(url, base);
      assert.equal(response.status, 503, `upstream ${status}`);
      const body = await response.json();
      assert.equal(body.error.message, FREE_TIER_UNAVAILABLE);
      assert.ok(!/API key|permissions/i.test(body.error.message), 'never blames the visitor key');
    });
  }
  // The same upstream 401 on a BYOK request still says what it means: that key really is bad.
  await withProxy({ env: {}, transport: async () => stream('nope', 401) }, async url => {
    const response = await chat(url, { ...base, apiKey: 'visitor-key' });
    assert.equal(response.status, 401);
    assert.match((await response.json()).error.message, /Invalid API key/);
  });
});

test('quota and burst refusals carry codes the browser can branch on', async () => {
  const db = openDatabase(':memory:');
  try {
    db.recordUsage(workspace, { model: 'groq/llama-3.3-70b-versatile', tokens: 100_000, credits: 50 });
    await withProxy({ env: { GROQ_API_KEY: 'k', FREE_CREDIT_MONTHLY_POOL: '10' }, db, transport: async () => { throw Error('must not call'); } }, async url => {
      assert.equal((await (await chat(url, base)).json()).error.code, 'free_tier_exhausted');
    });
  } finally { db.close(); }
  await withProxy({ env: { GROQ_API_KEY: 'k', FREE_MAX_PER_HOUR: '1' }, transport: async () => stream('data: [DONE]\n\n') }, async url => {
    await chat(url, base);
    assert.equal((await (await chat(url, base)).json()).error.code, 'free_tier_busy');
  });
});

test('xKiro funds the free tier on its own, and clears the warming-up state', () => {
  // One key plus a discovered catalogue, and the tier reports enabled with the gateway's own ids.
  const env = { XKIRO_API_KEY: 'k' };
  const status = freeTierStatus(env, DISCOVERED);
  assert.equal(status.enabled, true);
  assert.deepEqual(status.models, DISCOVERED);
  // No Groq or OpenRouter ids leak in when only the gateway key is present.
  assert.ok(!status.models.some(id => id.startsWith('groq/') || id.startsWith('openrouter/')));
  // A key with nothing discovered funds nothing: better an honest empty tier than a guessed one.
  assert.equal(freeTierStatus(env, []).enabled, false);
  assert.equal(freeTierStatus({}, DISCOVERED).enabled, false);
  assert.equal(freeTierStatus({ ...env, FREE_TIER_DISABLED: 'true' }, DISCOVERED).enabled, false);
});

test('XKIRO_FREE_MODELS narrows the discovered pool and can no longer widen it', () => {
  // It used to replace the pool wholesale, which is how an unchecked id — or a whole pasted
  // catalogue — became something the operator's key paid for. Narrowing is the real use case:
  // "of the forty models the gateway gives away, fund these two".
  assert.deepEqual(xkiroPool({}, DISCOVERED), DISCOVERED, 'no override means the whole discovered pool');
  assert.deepEqual(xkiroPool({ XKIRO_FREE_MODELS: ' qwen/qwen3.8-max:free , deepseek/deepseek-v4-flash ' }, DISCOVERED), ['qwen/qwen3.8-max:free', 'deepseek/deepseek-v4-flash']);
  assert.deepEqual(xkiroPool({ XKIRO_FREE_MODELS: 'anthropic/claude-sonnet-4.6' }, DISCOVERED), [], 'an id the gateway did not give away is refused');
  assert.deepEqual(xkiroPool({ XKIRO_FREE_MODELS: '   ' }, DISCOVERED), DISCOVERED, 'blank means no narrowing');
  // Before discovery answers there is nothing to intersect with, so a configured list is honoured
  // rather than treated as empty — a one-request window at boot that /api/providers waits out.
  assert.deepEqual(xkiroPool({ XKIRO_FREE_MODELS: 'a/b' }, []), ['a/b']);

  const env = { XKIRO_API_KEY: 'k', XKIRO_FREE_MODELS: 'deepseek/deepseek-v4-flash' };
  assert.equal(freeModel('deepseek/deepseek-v4-flash', env, DISCOVERED)?.provider, 'xkiro');
  assert.equal(freeModel('qwen/qwen3.8-max:free', env, DISCOVERED), undefined, 'narrowed out');
  assert.deepEqual(fundedModels(env, DISCOVERED).map(m => m.id), ['deepseek/deepseek-v4-flash']);
});

test('several provider keys stack into one pool', () => {
  const both = freeTierStatus({ GROQ_API_KEY: 'k', XKIRO_API_KEY: 'k' }, DISCOVERED).models;
  assert.ok(both.includes('groq/llama-3.3-70b-versatile'));
  assert.ok(both.includes('deepseek/deepseek-v4-flash'));
  assert.equal(both.length, 2 + DISCOVERED.length);
});

test('xKiro routes to its gateway with the server key and an unmodified model id', async () => {
  const restore = discovered();
  let captured;
  try {
    await withProxy({ env: { XKIRO_API_KEY: 'gateway-key' }, transport: async (url, options) => { captured = { url, ...options }; return stream('data: [DONE]\n\n'); } }, async url => {
      assert.equal((await chat(url, { provider: 'xkiro', model: 'deepseek/deepseek-v4-flash', messages: [{ role: 'user', content: 'hi' }] })).status, 200);
    });
  } finally { restore(); }
  assert.equal(captured.url, `${XKIRO_DEFAULT_BASE}/chat/completions`);
  assert.equal(captured.headers.Authorization, 'Bearer gateway-key');
  const body = JSON.parse(captured.body);
  // The gateway names its own models; nothing is stripped or rewritten on the way through.
  assert.equal(body.model, 'deepseek/deepseek-v4-flash');
  assert.equal(body.stream, true);
  assert.deepEqual(body.stream_options, { include_usage: true });
});

test('a visitor cannot point the free tier at an xKiro model this deployment did not offer', async () => {
  const restore = discovered();
  try {
    await withProxy({ env: { XKIRO_API_KEY: 'gateway-key', XKIRO_FREE_MODELS: 'deepseek/deepseek-v4-flash' }, transport: async () => { throw Error('must not call'); } }, async url => {
      // Not discovered at all.
      let response = await chat(url, { provider: 'xkiro', model: 'some-expensive-model', messages: [{ role: 'user', content: 'hi' }] });
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error.code, 'key_required');
      // Discovered and free, but narrowed out by XKIRO_FREE_MODELS.
      response = await chat(url, { provider: 'xkiro', model: 'qwen/qwen3.8-max:free', messages: [{ role: 'user', content: 'hi' }] });
      assert.equal(response.status, 401);
    });
  } finally { restore(); }
});

test('an xKiro stream is metered to the free ledger like any other funded model', async () => {
  const db = openDatabase(':memory:');
  const restore = discovered();
  try {
    await withProxy({ env: { XKIRO_API_KEY: 'gateway-key' }, db, transport: async () => stream('data: {"usage":{"total_tokens":4000}}\n\ndata: [DONE]\n\n') }, async url => {
      assert.equal((await chat(url, { provider: 'xkiro', model: 'openai/gpt-5.3-codex-spark', messages: [{ role: 'user', content: 'hi' }] })).status, 200);
      assert.equal(db.usedThisMonth(workspace, new Date(), 'free'), 2, '4,000 tokens at 0.5 credits per 1K');
      assert.equal(db.latestEntry(workspace, 'free').model, 'openai/gpt-5.3-codex-spark');
    });
  } finally { restore(); db.close(); }
});

test('XKIRO_BASE_URL steers the gateway, and a bad value falls back rather than breaking', async () => {
  assert.equal(xkiroBase({}), XKIRO_DEFAULT_BASE);
  assert.equal(xkiroBase({ XKIRO_BASE_URL: 'https://api.xkiro.com/v1/' }), XKIRO_DEFAULT_BASE, 'a trailing slash is normalised');
  assert.equal(xkiroBase({ XKIRO_BASE_URL: 'https://eu.xkiro.example/v1' }), 'https://eu.xkiro.example/v1');
  // Operator-set but still checked: a typo should not take the tier down with a puzzling error.
  for (const bad of ['http://api.xkiro.com/v1', 'not a url', 'https://u:p@api.xkiro.com/v1', 'https://api.xkiro.com/v1?k=1', '   '])
    assert.equal(xkiroBase({ XKIRO_BASE_URL: bad }), XKIRO_DEFAULT_BASE, bad);

  const restore = discovered();
  let captured;
  try {
    await withProxy({ env: { XKIRO_API_KEY: 'k', XKIRO_BASE_URL: 'https://eu.xkiro.example/v1' }, transport: async (url, options) => { captured = { url, ...options }; return stream('data: [DONE]\n\n'); } }, async url => {
      assert.equal((await chat(url, { provider: 'xkiro', model: 'deepseek/deepseek-v4-flash', messages: [{ role: 'user', content: 'hi' }] })).status, 200);
    });
  } finally { restore(); }
  assert.equal(captured.url, 'https://eu.xkiro.example/v1/chat/completions');
});
