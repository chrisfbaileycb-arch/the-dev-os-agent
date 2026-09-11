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
  // On the allowlist but this deployment funds nothing: still refused.
  await withProxy({ env: {}, transport: async () => { throw Error('must not call'); } },
    async url => { assert.equal((await post(url, { ...base, apiKey: '' })).status, 401); });
  // Explicitly switched off by the operator.
  await withProxy({ env: { GROQ_API_KEY: 'server-key', FREE_TIER_DISABLED: 'true' }, transport: async () => { throw Error('must not call'); } },
    async url => { assert.equal((await post(url, { ...base, apiKey: '' })).status, 401); });
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
