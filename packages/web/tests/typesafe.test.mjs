import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createTypesafe, cleanQuestions } from '../server/typesafe.mjs';

const questions = { team: { type: 'choice', instructions: 'Which team handles this?', criteria: { billing: 'Payments', technical: 'Bugs' } } };

async function withRouter(env, fn, options = {}) {
  const handler = createTypesafe({ env, ...options });
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const post = (body, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/typesafe/systemone`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try { await fn(post); } finally { await new Promise(r => server.close(r)); }
}

test('the router is off unless a deployment opts in', async () => {
  await withRouter({}, async post => {
    const r = await post({ apiKey: 'jev_test_key', state: 'hi', questions });
    assert.equal(r.status, 503); assert.equal((await r.json()).error.code, 'typesafe_disabled');
  });
});

test('a request without a personal key is refused and never funded', async () => {
  let calls = 0;
  await withRouter({ TYPESAFE_ENABLED: 'true' }, async post => {
    const r = await post({ state: 'hi', questions });
    assert.equal(r.status, 401); assert.equal((await r.json()).error.code, 'key_required');
  }, { fetchImpl: async () => { calls++; return new Response('{}'); } });
  assert.equal(calls, 0);
});

test('a personal key is forwarded server-side and the answer passes through', async () => {
  let seen;
  const fetchImpl = async (url, options) => { seen = { url, options }; return new Response(JSON.stringify({ model: 'jev-1.13.0', answers: { team: { type: 'choice', choice: 'billing', confidence: 0.9 } }, usage: { input_tokens: 12 } }), { headers: { 'Content-Type': 'application/json' } }); };
  await withRouter({ TYPESAFE_ENABLED: 'true' }, async post => {
    const r = await post({ apiKey: 'jev_personal_fixture', state: 'I was charged twice.', questions });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.answers.team.choice, 'billing'); assert.equal(body.model, 'jev-1.13.0');
    assert.equal(seen.url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(seen.options.headers.Authorization, 'Bearer jev_personal_fixture');
    const sent = JSON.parse(seen.options.body);
    assert.equal(sent.state, 'I was charged twice.'); assert.equal(sent.model, 'jev-latest');
    assert.deepEqual(sent.questions, questions);
  }, { fetchImpl });
});

test('an upstream rejection is reported plainly and never echoes the key', async () => {
  await withRouter({ TYPESAFE_ENABLED: 'true' }, async post => {
    const r = await post({ apiKey: 'jev_bad_fixture', state: 'hi', questions });
    assert.equal(r.status, 401); const text = await r.text();
    assert.equal(JSON.parse(text).error.code, 'key_rejected'); assert.ok(!text.includes('jev_bad_fixture'));
  }, { fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'invalid key jev_bad_fixture' } }), { status: 401 }) });
});

test('a malformed question is rejected before any upstream call', async () => {
  let calls = 0;
  await withRouter({ TYPESAFE_ENABLED: 'true' }, async post => {
    for (const bad of [{ team: { type: 'score', instructions: 'x', criteria: ['only one level'] } }, { team: { type: 'wat', instructions: 'x' } }]) {
      const r = await post({ apiKey: 'jev_personal_fixture', state: 'hi', questions: bad });
      assert.equal(r.status, 400);
    }
  }, { fetchImpl: async () => { calls++; return new Response('{}'); } });
  assert.equal(calls, 0);
});

test('a cross-origin call is refused', async () => {
  await withRouter({ TYPESAFE_ENABLED: 'true' }, async post => {
    const r = await post({ apiKey: 'jev_personal_fixture', state: 'hi', questions }, { Origin: 'https://attacker.invalid' });
    assert.equal(r.status, 403);
  }, { fetchImpl: async () => new Response('{}') });
});

test('cleanQuestions bounds the question set and normalizes each type', () => {
  const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`q${i}`, { type: 'noul', instructions: 'yes?' }]));
  assert.throws(() => cleanQuestions(many), /at most 20/);
  const cleaned = cleanQuestions({
    urgent: { type: 'noul', instructions: 'Urgent?' },
    team: { type: 'choice', instructions: 'Which team?', criteria: { billing: null, technical: 'Bugs' } },
    impact: { type: 'score', instructions: 'How bad?', criteria: ['Cosmetic', 'Blocked'] },
  });
  assert.deepEqual(cleaned, {
    urgent: { type: 'noul', instructions: 'Urgent?' },
    team: { type: 'choice', instructions: 'Which team?', criteria: { billing: null, technical: 'Bugs' } },
    impact: { type: 'score', instructions: 'How bad?', criteria: ['Cosmetic', 'Blocked'] },
  });
});
