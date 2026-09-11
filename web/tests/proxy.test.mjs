import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { createProxy, resolveTarget, normalizeModel, keyFor, fundingFor, publicAddress, validContent } from '../server/proxy.mjs';
const base = { provider: 'groq', apiKey: 'test-key-not-real', model: 'groq/llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'hello' }] };
async function withProxy(options, fn) { const handler = createProxy(options); const server = createServer((req,res) => { handler(req,res).then(handled => { if (!handled) { res.writeHead(404); res.end(); } }); }); await new Promise(r => server.listen(0,'127.0.0.1',r)); try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise(r => server.close(r)); } }
function stream(text, status = 200, type = 'text/event-stream') { const s = Readable.from([Buffer.from(text)]); s.statusCode = status; s.headers = { 'content-type': type }; return s; }
const post = (url, body, route = '/api/chat', headers = {}) => fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
test('fixed routes and model namespace handling', async () => { assert.equal((await resolveTarget('openrouter')).base,'https://openrouter.ai/api/v1'); assert.equal((await resolveTarget('groq')).base,'https://api.groq.com/openai/v1'); assert.equal((await resolveTarget('cohere')).nativeCohere,true); assert.equal(normalizeModel('groq','groq/llama-3.3-70b-versatile'),'llama-3.3-70b-versatile'); assert.equal(normalizeModel('openrouter','deepseek/deepseek-r1'),'deepseek/deepseek-r1'); });
test('server credits require explicit deployment authorization', () => { const env = { GROQ_API_KEY: 'server-secret', SERVER_CREDIT_ACCESS_TOKEN: 'access' }; assert.equal(keyFor({ provider:'groq' },env),''); assert.equal(keyFor({ provider:'groq', serverAccessToken:'wrong' },env),''); assert.equal(keyFor({ provider:'groq', serverAccessToken:'access' },env),'server-secret'); assert.equal(keyFor({ provider:'groq', apiKey:'visitor' },env),'visitor'); });
test('custom SSRF protections and exact Ollama bridge approval', async () => { await assert.rejects(resolveTarget('custom','http://localhost:11434/v1',{})); await assert.rejects(resolveTarget('custom','https://api.example.com/v1',{})); await assert.rejects(resolveTarget('custom','https://api.example.com/v1',{ CUSTOM_API_ORIGINS:'https://api.example.com' },async () => [{address:'127.0.0.1'}])); const target = await resolveTarget('custom','https://api.example.com/v1',{ CUSTOM_API_ORIGINS:'https://api.example.com' },async () => [{ address:'8.8.8.8' }]); assert.equal(target.address,'8.8.8.8'); assert.equal((await resolveTarget('custom','http://localhost:11434/v1',{ OLLAMA_BRIDGE_URL:'http://localhost:11434/v1' })).approvedBridge,true); await assert.rejects(resolveTarget('custom','http://localhost:11434/other',{ OLLAMA_BRIDGE_URL:'http://localhost:11434/v1' })); for (const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1']) assert.equal(publicAddress(ip),false); });
test('OpenRouter streams bytes and sets attribution headers', async () => { let captured; const events = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n'; await withProxy({ env:{APP_ORIGIN:'https://app.example'}, transport:async (url, options) => { captured = {url,...options}; return stream(events); } },async url => { const response = await post(url,{...base, provider:'openrouter',model:'deepseek/deepseek-r1'}); assert.equal(response.status,200); assert.match(response.headers.get('content-type'),/event-stream/); assert.equal(await response.text(),events); assert.equal(captured.url,'https://openrouter.ai/api/v1/chat/completions'); assert.equal(captured.headers['HTTP-Referer'],'https://app.example'); assert.equal(captured.headers['X-Title'],'Hey Buddy'); assert.equal(JSON.parse(captured.body).stream,true); }); });
test('Groq routing strips only the Groq prefix', async () => { await withProxy({ env:{},transport:async (url, options) => { assert.equal(url,'https://api.groq.com/openai/v1/chat/completions'); assert.equal(JSON.parse(options.body).model,'llama-3.3-70b-versatile'); return stream('data: [DONE]\n\n'); } },async url => { assert.equal((await post(url,base)).status,200); }); });
test('Cohere streams native v2 events', async () => { await withProxy({env:{},transport:async(url,options)=>{assert.equal(url,'https://api.cohere.com/v2/chat');assert.equal(JSON.parse(options.body).stream_options,undefined);return stream('event: message-end\ndata: {"type":"message-end"}\n\n');}},async url=>{const r=await post(url,{...base,provider:'cohere',model:'command-a-03-2025'});assert.equal(r.status,200);assert.match(await r.text(),/message-end/);}); });
test('an anonymous request is funded only for an allowlisted free model', async () => {
  // On the free allowlist and the deployment holds the key: the server pays, and the visitor streams.
  await withProxy({ env: { GROQ_API_KEY: 'server-key' }, transport: async (url, options) => { assert.equal(options.headers.Authorization, 'Bearer server-key'); assert.equal(JSON.parse(options.body).model, 'llama-3.3-70b-versatile'); return stream('data: [DONE]\n\n'); } },
    async url => { assert.equal((await post(url, { ...base, apiKey: '' })).status, 200); });
  // Not on the allowlist: refused outright, whatever keys the deployment holds.
  await withProxy({ env: { GROQ_API_KEY: 'server-key', OPENROUTER_API_KEY: 'server-key' }, transport: async () => { throw Error('must not call'); } },
    async url => { const r = await post(url, { ...base, apiKey: '', provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet' }); assert.equal(r.status, 401); assert.match(await r.text(), /needs a key/); });
  // On the allowlist but unfunded here, or switched off: still refused, but as a warming tier
  // rather than a key error — the visitor cannot act on the deployment's configuration.
  // tests/freetier.test.mjs asserts the message and code in full.
  await withProxy({ env: {}, transport: async () => { throw Error('must not call'); } },
    async url => { assert.equal((await post(url, { ...base, apiKey: '' })).status, 503); });
  await withProxy({ env: { GROQ_API_KEY: 'server-key', FREE_TIER_DISABLED: 'true' }, transport: async () => { throw Error('must not call'); } },
    async url => { assert.equal((await post(url, { ...base, apiKey: '' })).status, 503); });
});
test('openrouter/auto on the free tier is pinned to the zero-cost pool, never the paid router', async () => {
  await withProxy({ env: { OPENROUTER_API_KEY: 'server-key' }, transport: async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'meta-llama/llama-3.2-3b-instruct:free');
    assert.ok(body.models.every(m => m.endsWith(':free')));
    assert.ok(!JSON.stringify(body).includes('openrouter/auto'));
    return stream('data: [DONE]\n\n');
  } }, async url => { assert.equal((await post(url, { ...base, apiKey: '', provider: 'openrouter', model: 'openrouter/auto' })).status, 200); });
});
test('free-tier output is capped and the visitor cannot raise it', async () => {
  await withProxy({ env: { GROQ_API_KEY: 'server-key', FREE_MAX_OUTPUT_TOKENS: '256' }, transport: async (url, options) => { assert.equal(JSON.parse(options.body).max_tokens, 256); return stream('data: [DONE]\n\n'); } },
    async url => { assert.equal((await post(url, { ...base, apiKey: '', max_tokens: 4096 })).status, 200); });
});
test('funding resolution prefers the visitor key, then the access token, then the free allowlist', () => {
  const env = { GROQ_API_KEY: 'server-key', SERVER_CREDIT_ACCESS_TOKEN: 'access' };
  assert.deepEqual(fundingFor({ provider: 'groq', model: 'groq/llama-3.1-8b-instant', apiKey: 'visitor' }, env).mode, 'byok');
  assert.deepEqual(fundingFor({ provider: 'groq', model: 'openai/gpt-4o', serverAccessToken: 'access' }, env).mode, 'credits');
  assert.deepEqual(fundingFor({ provider: 'groq', model: 'groq/llama-3.1-8b-instant' }, env).mode, 'free');
  assert.deepEqual(fundingFor({ provider: 'groq', model: 'openai/gpt-4o' }, env).mode, 'none');
  // A model id is matched exactly: no prefix, suffix, or namespace trick reaches the server key.
  for (const model of ['groq/llama-3.1-8b-instant-plus', 'evil/groq/llama-3.1-8b-instant', 'groq/llama-3.1-8b-instant/../gpt-4o'])
    assert.deepEqual(fundingFor({ provider: 'groq', model }, env).mode, 'none', model);
});
test('401 and 429 are sanitized and propagated without secret response bodies', async () => { for (const status of [401,429]) await withProxy({env:{},transport:async()=>stream('secret body',status)},async url=>{const r=await post(url,base);assert.equal(r.status,status);const text=await r.text();assert.ok(!text.includes('secret body'));assert.match(text,status===401?/Invalid API key/:/rate limit/);}); });
test('model discovery uses GET upstream and normalizes catalog', async () => { await withProxy({env:{},transport:async(url,options)=>{assert.equal(url,'https://api.groq.com/openai/v1/models');assert.equal(options.method,'GET');return stream('{"data":[{"id":"model-one"}]}',200,'application/json');}},async url=>{const r=await post(url,base,'/api/models');assert.deepEqual(await r.json(),{data:[{id:'model-one'}]});}); });
test('validates messages and denies cross-origin browser requests', async () => { await withProxy({env:{},transport:async()=>{throw Error('must not call');}},async url=>{assert.equal((await post(url,{...base,messages:[{role:'admin',content:'x'}]})).status,400);assert.equal((await post(url,base,'/api/chat',{Origin:'https://evil.example'})).status,403);assert.equal((await post(url,{...base,max_tokens:99999})).status,400);}); });
test('does not follow upstream redirects', async()=>{await withProxy({env:{},transport:async()=>stream('',302)},async url=>{assert.equal((await post(url,base)).status,502);});});
test('rejects non-streaming upstream responses', async()=>{await withProxy({env:{},transport:async()=>stream('{}',200,'application/json')},async url=>{assert.equal((await post(url,base)).status,502);});});
test('accepts text and bounded image parts, and refuses images for native Cohere', async () => {
  const image = 'data:image/jpeg;base64,' + 'A'.repeat(400);
  assert.equal(validContent('hello'), true); assert.equal(validContent([{ type: 'text', text: 'hi' }, { type: 'image_url', image_url: { url: image } }]), true);
  assert.equal(validContent([{ type: 'image_url', image_url: { url: 'javascript:alert(1)' } }]), false); assert.equal(validContent([{ type: 'file', data: 'x' }]), false);
  assert.equal(validContent(Array.from({ length: 6 }, () => ({ type: 'image_url', image_url: { url: image } }))), false);
  await withProxy({ env:{}, transport:async (url, options) => { assert.ok(Array.isArray(JSON.parse(options.body).messages[0].content)); return stream('data: [DONE]\n\n'); } }, async url => {
    assert.equal((await post(url, { ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'what is this' }, { type: 'image_url', image_url: { url: image } }] }] })).status, 200);
    assert.equal((await post(url, { ...base, provider: 'cohere', model: 'command-a-03-2025', messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }, { type: 'image_url', image_url: { url: image } }] }] })).status, 400);
  });
});

test('the major vendors route to their own APIs on the visitor key', async () => {
  // Point 2 of the brief: a key the visitor supplies bills the visitor's account, so each
  // vendor is reached at its own endpoint rather than through an aggregator that would bill
  // somewhere else. The browser sends a base URL for display; the server ignores it for every
  // named provider and uses its own fixed map, or this proxy would forward keys anywhere.
  assert.equal((await resolveTarget('openai')).base, 'https://api.openai.com/v1');
  assert.equal((await resolveTarget('anthropic')).base, 'https://api.anthropic.com/v1');
  assert.equal((await resolveTarget('google')).base, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal((await resolveTarget('anthropic')).nativeAnthropic, true);
  assert.equal((await resolveTarget('openai')).nativeAnthropic, false);
  assert.equal((await resolveTarget('openai', 'https://attacker.example/v1', {})).base, 'https://api.openai.com/v1', 'a supplied base URL is ignored, not honoured');

  for (const [provider, model, host] of [['openai', 'gpt-4o', 'https://api.openai.com/v1'], ['google', 'gemini-2.5-flash', 'https://generativelanguage.googleapis.com/v1beta/openai']]) {
    let captured;
    await withProxy({ env: {}, transport: async (url, options) => { captured = { url, ...options }; return stream('data: [DONE]\n\n'); } }, async url => {
      assert.equal((await post(url, { ...base, provider, model, baseUrl: 'https://attacker.example/v1' })).status, 200);
    });
    assert.equal(captured.url, `${host}/chat/completions`);
    assert.equal(captured.headers.Authorization, 'Bearer test-key-not-real');
    assert.equal(JSON.parse(captured.body).model, model);
  }
});

test('Anthropic is translated to /v1/messages, headers and all', async () => {
  // Anthropic does not speak the OpenAI protocol: x-api-key rather than a bearer token, a
  // pinned API version, and a system prompt that is a top-level field. Left in the messages
  // array as role "system" it is rejected outright, so the translation is not cosmetic.
  let captured;
  await withProxy({ env: {}, transport: async (url, options) => { captured = { url, ...options }; return stream('event: message_stop\ndata: {"type":"message_stop"}\n\n'); } }, async url => {
    assert.equal((await post(url, { ...base, provider: 'anthropic', model: 'claude-sonnet-4-5', messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hello' }] })).status, 200);
  });
  assert.equal(captured.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(captured.headers['x-api-key'], 'test-key-not-real');
  assert.equal(captured.headers['anthropic-version'], '2023-06-01');
  assert.equal(captured.headers.Authorization, undefined, 'the bearer header would be ignored and leaks the key twice');
  const payload = JSON.parse(captured.body);
  assert.equal(payload.system, 'be brief');
  assert.deepEqual(payload.messages, [{ role: 'user', content: 'hello' }]);
  assert.equal(payload.max_tokens, 1024);
  assert.equal(payload.stream_options, undefined, 'an unknown field is a 400 there, not an ignored hint');
});

test('an inline image survives the Anthropic translation and a remote one is dropped', async () => {
  const { anthropicPayload } = await import('../server/proxy.mjs');
  const data = 'iVBORw0KGgo=';
  const inline = anthropicPayload('claude-sonnet-4-5', [{ role: 'user', content: [{ type: 'text', text: 'what is this' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${data}` } }] }], 512);
  assert.deepEqual(inline.messages[0].content, [{ type: 'text', text: 'what is this' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data } }]);
  // A hosted image URL would mean this server fetching an arbitrary address on the visitor's
  // behalf, which is an SSRF hole for a feature nobody asked for.
  const remote = anthropicPayload('claude-sonnet-4-5', [{ role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'https://example.com/cat.png' } }] }], 512);
  assert.deepEqual(remote.messages[0].content, [{ type: 'text', text: 'look' }]);
});

test('OpenAI reasoning models get max_completion_tokens, not max_tokens', async () => {
  // Sending the wrong one is a hard 400 with an opaque message on the o-series and GPT-5.
  const { outputLimit } = await import('../server/proxy.mjs');
  assert.deepEqual(outputLimit('openai', 'o3-mini', 800), { max_completion_tokens: 800 });
  assert.deepEqual(outputLimit('openai', 'gpt-5.1', 800), { max_completion_tokens: 800 });
  assert.deepEqual(outputLimit('openai', 'gpt-4o', 800), { max_tokens: 800 });
  assert.deepEqual(outputLimit('groq', 'o3-mini', 800), { max_tokens: 800 }, 'the rule is OpenAI-specific');
});

test('a vendor model with no key is refused before anything is sent', async () => {
  await withProxy({ env: {}, transport: async () => { throw new Error('must not reach the provider'); } }, async url => {
    for (const [provider, model] of [['openai', 'gpt-4o'], ['anthropic', 'claude-sonnet-4-5'], ['google', 'gemini-2.5-pro']]) {
      const response = await post(url, { provider, model, messages: [{ role: 'user', content: 'hi' }] });
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error.code, 'key_required');
    }
  });
});

test('a checkout URL is published only when it is one', async () => {
  // The Plans page renders a Subscribe button from this and nothing else. A URL that is not
  // HTTPS, or carries credentials, or is simply a typo, must read as "not configured" — sending
  // someone who is about to pay to an unintended destination is the failure worth preventing,
  // and a dead Subscribe button is worse than an honest one that says checkout is not open.
  const { billingStatus, checkoutUrl } = await import('../server/billing.mjs');
  assert.equal(checkoutUrl('https://buy.stripe.com/test_abc'), 'https://buy.stripe.com/test_abc');
  for (const bad of ['', '   ', 'http://buy.stripe.com/x', 'buy.stripe.com/x', 'https://user:pw@buy.stripe.com/x', 'https://buy.stripe.com/x#frag', 'not a url', undefined, null]) {
    assert.equal(checkoutUrl(bad), null, String(bad));
  }
  const none = billingStatus({});
  assert.equal(none.enabled, false);
  assert.deepEqual(none.plans.map(p => p.checkout), [null, null]);
  assert.deepEqual(none.plans.map(p => p.price), ['$12.90', '$24.90'], 'the price is shown even with no checkout');

  const one = billingStatus({ STRIPE_STARTER_URL: 'https://buy.stripe.com/starter' });
  assert.equal(one.enabled, true, 'one configured plan is enough to be selling something');
  assert.equal(one.plans.find(p => p.id === 'starter').checkout, 'https://buy.stripe.com/starter');
  assert.equal(one.plans.find(p => p.id === 'premium').checkout, null);
  assert.ok(!JSON.stringify(one).includes('sk_'), 'no processor secret is ever published here');
});

test('/api/providers reports billing alongside the free tier', async () => {
  await withProxy({ env: { STRIPE_PREMIUM_URL: 'https://buy.stripe.com/premium' } }, async url => {
    const body = await (await fetch(url + '/api/providers')).json();
    assert.equal(body.billing.enabled, true);
    assert.equal(body.billing.plans.find(p => p.id === 'premium').checkout, 'https://buy.stripe.com/premium');
    assert.equal(body.free.enabled, false, 'billing and the free tier are independent');
  });
});
