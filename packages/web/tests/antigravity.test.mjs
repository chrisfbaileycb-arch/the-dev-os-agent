import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { ANTIGRAVITY_AGENT, ANTIGRAVITY_MODEL, clampTokenCap, createEngine, interactionBody, runAntigravity } from '../server/antigravity.mjs';

test('new and reused environments are offline and never receive connector tools', () => {
  const body = interactionBody({ input: 'draft the note', maxTotalTokens: 12, skills: [] });
  assert.equal(body.agent, ANTIGRAVITY_AGENT);
  assert.equal(body.agent_config.model, ANTIGRAVITY_MODEL);
  assert.equal(body.agent_config.max_total_tokens, clampTokenCap(12));
  assert.deepEqual(body.environment, { type: 'remote', network: 'disabled' });
  assert.deepEqual(body.tools, [{ type: 'code_execution' }]);
  assert.equal(JSON.stringify(body).includes('temperature'), false);
  const reused = interactionBody({ input: 'again', environmentId: 'env-9', skills: [] });
  assert.deepEqual(reused.environment, { type: 'remote', network: 'disabled', environment_id: 'env-9' });
  assert.throws(() => interactionBody({ skills: [{ name: 'lookup', url: 'https://mcp.example' }] }), /External connectors are disabled/);
});

test('every enabled external connector is refused before any credential upload or run', async () => {
  for (const skill of [
    { name: 'github', url: 'https://api.githubcopilot.com/mcp/', token: 'private-token' },
    { name: 'innocent_lookup', url: 'https://mcp.example', enabled: true },
    { name: 'invalid', url: 'http://localhost', transport: 'sse' },
  ]) {
    let calls = 0;
    const result = await runAntigravity({ key: 'engine-key', skills: [skill], fetchImpl: async () => { calls++; throw new Error('must not call'); } });
    assert.equal(calls, 0);
    assert.equal(result.status, 403);
    assert.match(result.events[0].message, /No connector credentials or run request were sent/);
    assert.equal(result.events.some(event => event.type === 'approval'), false);
  }
});

test('a client text approval never bypasses the external tool policy', async () => {
  let calls = 0;
  const result = await runAntigravity({ key: 'key', continueApproved: 'github.send_message', fetchImpl: async () => { calls++; } });
  assert.equal(calls, 0);
  assert.equal(result.status, 403);
  assert.match(result.events[0].message, /text approval cannot authorize/);
});

test('an offline run uses only its explicit key header and reports completed work honestly', async () => {
  const calls = [];
  const result = await runAntigravity({ key: 'engine-key', input: 'draft the note', skills: [{ demo: true }, { enabled: false }], fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ output_text: 'done', environment_id: 'sandbox-1', steps: [{ name: 'send_message', result: 'unexpected completed event' }] }), { headers: { 'Content-Type': 'application/json' } });
  } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.endsWith('/interactions'), true);
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'engine-key');
  assert.equal(calls[0].init.body.includes('engine-key'), false);
  assert.equal(result.events.some(event => event.type === 'approval'), false);
  assert.equal(result.events.at(-1).type, 'done');
});

test('missing personal key never uses an operator environment key', async () => {
  let calls = 0;
  const engine = createEngine({ env: { ANTIGRAVITY_API_KEY: 'operator-secret' }, fetchImpl: async () => { calls++; } });
  const req = Readable.from([Buffer.from('{"input":"go"}')]);
  Object.assign(req, { url: '/api/engine', method: 'POST', headers: {} });
  let status, response;
  const res = { writeHead(value) { status = value; }, end(value) { response = value; } };
  assert.equal(await engine(req, res), true);
  assert.equal(calls, 0);
  assert.equal(status, 403);
  assert.match(response, /Gemini chat key is not used/);
});

/** Drive one request through the handler and collect the status and body it wrote. */
async function call(req, engine) {
  let status = 0; const chunks = [];
  const res = { writeHead(value) { status = value; }, write(value) { chunks.push(String(value)); }, end(value) { if (value) chunks.push(String(value)); } };
  const handled = await engine(req, res);
  return { handled, status, body: chunks.join('') || undefined };
}

test('a cross-origin engine request is refused before any upstream call', async () => {
  let calls = 0;
  const engine = createEngine({ env: { APP_ORIGIN: 'https://app.example' }, fetchImpl: async () => { calls++; } });
  const req = Readable.from([Buffer.from('{"input":"go"}')]);
  Object.assign(req, { url: '/api/engine', method: 'POST', headers: { origin: 'https://evil.example', host: 'app.example', 'x-engine-key': 'engine-key' } });
  const { handled, status, body } = await call(req, engine);
  assert.equal(handled, true);
  assert.equal(calls, 0);
  assert.equal(status, 403);
  assert.match(body, /Cross-origin/);
});

test('the same-origin request still runs, and the hourly budget then refuses the next one', async () => {
  const engine = createEngine({ env: { APP_ORIGIN: 'https://app.example', ENGINE_MAX_PER_HOUR: '1' }, fetchImpl: async () => new Response(JSON.stringify({ output_text: 'ok' }), { headers: { 'Content-Type': 'application/json' } }) });
  const sameOrigin = () => {
    const req = Readable.from([Buffer.from('{"input":"go"}')]);
    Object.assign(req, { url: '/api/engine', method: 'POST', socket: { remoteAddress: '203.0.113.7' }, headers: { origin: 'https://app.example', host: 'app.example', 'x-engine-key': 'engine-key' } });
    return req;
  };
  const first = await call(sameOrigin(), engine);
  assert.equal(first.status, 200);
  const second = await call(sameOrigin(), engine);
  assert.equal(second.status, 429);
  assert.match(second.body, /limit reached/);
});
