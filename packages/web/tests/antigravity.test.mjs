import assert from 'node:assert/strict';
import test from 'node:test';
import { ANTIGRAVITY_AGENT, ANTIGRAVITY_MODEL, clampTokenCap, interactionBody, liveMcpTools, needsApproval, runAntigravity } from '../server/antigravity.mjs';

test('the interactions body pins the current agent and never sends generation params', () => {
  const body = interactionBody({ input: 'ship the note', maxTotalTokens: 12, skills: [] });
  assert.equal(body.agent, ANTIGRAVITY_AGENT);
  assert.equal(body.agent, 'antigravity-preview-09-2026');
  assert.equal(body.agent_config.model, ANTIGRAVITY_MODEL);
  assert.equal(body.agent_config.max_total_tokens, clampTokenCap(12));
  assert.equal(body.environment, 'remote');
  assert.equal(Object.hasOwn(body, 'temperature'), false);
  assert.equal(Object.hasOwn(body.agent_config, 'temperature'), false);
  assert.equal(JSON.stringify(body).includes('temperature'), false);
  const reused = interactionBody({ input: 'again', environmentId: 'env-9', skills: [] });
  assert.equal(reused.environment_id, 'env-9');
  assert.equal(Object.hasOwn(reused, 'environment'), false);
});

test('MCP tokens stay in the credentials list, not on the tool the model sees', () => {
  const { tools, credentials } = liveMcpTools([
    { name: 'GitHub', url: 'https://api.githubcopilot.com/mcp/', token: 'ghp-secret', enabled: true },
    { name: 'Drill', demo: true, url: '', enabled: true },
    { name: 'Old', url: 'https://example.com/sse', transport: 'sse', enabled: true },
  ]);
  assert.equal(tools.length, 1);
  assert.equal(JSON.stringify(tools).includes('ghp-secret'), false);
  assert.equal(credentials[0].token, 'ghp-secret');
  assert.equal(tools[0].credential, credentials[0].id);
  assert.equal(needsApproval('code_execution'), false);
  assert.equal(needsApproval('google_search'), false);
  assert.equal(needsApproval('send_message'), true);
  assert.equal(needsApproval('mcp:github'), true);
});

test('credentials are stored before the interaction, and the engine key is only a header', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: init.body, key: init.headers['x-goog-api-key'] });
    return { ok: true, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ output_text: 'done', environment_id: 'sandbox-1' }) };
  };
  const result = await runAntigravity({
    key: 'engine-key',
    input: 'draft the note',
    skills: [{ name: 'github', url: 'https://api.githubcopilot.com/mcp/', token: 'ghp-secret', enabled: true }],
    fetchImpl,
  });
  assert.equal(calls[0].url.endsWith('/credentials'), true);
  assert.equal(calls[1].url.endsWith('/interactions'), true);
  assert.equal(calls[1].key, 'engine-key');
  assert.equal(calls[1].body.includes('engine-key'), false);
  assert.equal(calls[1].body.includes('ghp-secret'), false);
  assert.equal(calls[1].body.includes('antigravity-preview-09-2026'), true);
  assert.equal(result.events.some(event => event.type === 'environment' && event.id === 'sandbox-1'), true);
  assert.equal(result.events.at(-1).type, 'done');
});

test('a missing engine key does not fall through to a fetch', async () => {
  let called = false;
  const result = await runAntigravity({ key: '   ', input: 'go', fetchImpl: async () => { called = true; return { ok: false }; } });
  assert.equal(called, false);
  assert.equal(result.status, 403);
  assert.match(result.events[0].message, /Gemini chat key is not used/);
});
