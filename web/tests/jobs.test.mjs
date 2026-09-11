import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDatabase } from '../server/db.mjs';
import { createJobs, openJobs } from '../server/jobs.mjs';
import { STAGES, executeJob } from '../server/worker.mjs';

const workspace = '3f2b8c1e-5d4a-4b6c-9e7f-0a1b2c3d4e5f';
const other = '11111111-2222-4333-8444-555555555555';
const TOKEN = 'worker-secret';
const request = { goal: 'Plan the week', workflow: 'build', connection: { provider: 'groq', model: 'groq/llama-3.1-8b-instant', maxTokens: 512 } };

async function withJobs(env, fn) {
  const db = openDatabase(':memory:');
  const jobs = openJobs(db);
  const handler = createJobs({ env, jobs });
  const server = createServer((req, res) => { handler(req, res).then(handled => { if (!handled) { res.writeHead(404); res.end(); } }); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try { await fn(`http://127.0.0.1:${server.address().port}`, jobs); } finally { await new Promise(r => server.close(r)); db.close(); }
}
const browser = (url, method, body, id = workspace) => fetch(url + '/api/jobs' + (method === 'GET' && body ? `?id=${body}` : ''), { method, headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': id }, body: method === 'POST' ? JSON.stringify(body) : undefined });
const worker = (url, route, body, token = TOKEN) => fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

test('the worker routes reject anything without the shared token', async () => {
  await withJobs({ WORKER_TOKEN: TOKEN }, async url => {
    for (const bad of ['', 'wrong', 'worker-secre', 'worker-secretx']) assert.equal((await worker(url, '/api/jobs/claim', {}, bad)).status, 401);
    assert.equal((await worker(url, '/api/jobs/claim', {})).status, 200);
  });
  // With no token configured at all, the worker surface is closed entirely.
  await withJobs({}, async url => { assert.equal((await worker(url, '/api/jobs/claim', {}, '')).status, 401); });
});

test('enqueueing needs a worker to have checked in, and a valid workflow request', async () => {
  await withJobs({ WORKER_TOKEN: TOKEN }, async url => {
    // Nothing has claimed yet, so the browser is told to run the workflow itself.
    const early = await browser(url, 'POST', { request });
    assert.equal(early.status, 503);
    assert.match((await early.json()).error.message, /No background worker/);

    await worker(url, '/api/jobs/claim', {});
    assert.equal((await browser(url, 'POST', { request })).status, 202);
    assert.equal((await browser(url, 'POST', { request: { ...request, workflow: 'mystery' } })).status, 400);
    assert.equal((await browser(url, 'POST', { request: { ...request, goal: '' } })).status, 400);
    // A queued job waits on disk, so it must never be allowed to carry a credential.
    for (const secret of [{ token: 'sk-visitor' }, { apiKey: 'sk-visitor' }, { serverAccessToken: 'admin' }]) {
      const refused = await browser(url, 'POST', { request: { ...request, connection: { ...request.connection, ...secret } } });
      assert.equal(refused.status, 400, JSON.stringify(secret));
      assert.match((await refused.json()).error.message, /cannot carry a key/);
    }
    assert.equal((await browser(url, 'POST', { request: { ...request, connection: { ...request.connection, inference: 'byok' } } })).status, 400);
    assert.equal((await fetch(url + '/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': 'not-a-uuid' }, body: '{}' })).status, 400);
  });
});

test('a job runs claim to finish, and stays inside its own workspace', async () => {
  await withJobs({ WORKER_TOKEN: TOKEN }, async url => {
    await worker(url, '/api/jobs/claim', {});
    const { job } = await (await browser(url, 'POST', { request })).json();
    assert.equal(job.status, 'queued');

    const claimed = (await (await worker(url, '/api/jobs/claim', {})).json()).job;
    assert.equal(claimed.id, job.id);
    assert.equal(claimed.workspaceId, workspace);
    assert.equal(claimed.request.goal, 'Plan the week');
    // A leased job is not handed to a second worker.
    assert.equal((await (await worker(url, '/api/jobs/claim', {})).json()).job, null);

    await worker(url, '/api/jobs/update', { id: job.id, run: { status: 'running', steps: [{ status: 'completed' }] } });
    const progress = await (await browser(url, 'GET', job.id)).json();
    assert.equal(progress.job.status, 'running');
    assert.equal(progress.job.run.steps.length, 1);

    await worker(url, '/api/jobs/finish', { id: job.id, status: 'completed', run: { status: 'completed', tokens: 42 } });
    const done = await (await browser(url, 'GET', job.id)).json();
    assert.equal(done.job.status, 'completed');
    assert.equal(done.job.run.tokens, 42);

    // Another workspace cannot read it, even knowing the id.
    assert.equal((await browser(url, 'GET', job.id, other)).status, 404);
  });
});

test('an expired lease is reclaimed once, then failed rather than retried forever', async () => {
  await withJobs({ WORKER_TOKEN: TOKEN }, async (url, jobs) => {
    const { id } = jobs.enqueue(workspace, request);
    const future = new Date(Date.now() + 10 * 60_000);
    assert.equal(jobs.claim().id, id);
    assert.equal(jobs.claim(future).id, id, 'the expired lease is reclaimed');
    assert.equal(jobs.claim(new Date(Date.now() + 20 * 60_000)), null, 'the attempt limit stops the loop');
    assert.equal(jobs.get(workspace, id).status, 'failed');
  });
});

test('every workflow the browser can request has a five-stage server plan', () => {
  for (const workflow of ['build', 'research', 'review']) {
    assert.equal(STAGES[workflow].length, 5, workflow);
    assert.deepEqual(STAGES[workflow][0].deps, []);
    assert.deepEqual(STAGES[workflow][3].deps, [1, 2]);
    assert.deepEqual(STAGES[workflow][4].deps, [0, 1, 2, 3]);
  }
});

test('the worker runs the stages in order and feeds each one its upstream output', async () => {
  const prompts = [];
  const fetchImpl = async (url, options) => {
    prompts.push(JSON.parse(options.body).messages[1].content);
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: `stage-${prompts.length}` } }], usage: { total_tokens: 10 } })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  const run = await executeJob({ id: crypto.randomUUID(), workspaceId: workspace, request }, { fetchImpl });
  assert.equal(run.status, 'completed');
  assert.equal(run.calls, 5);
  assert.equal(run.tokens, 50);
  assert.ok(run.steps.every(s => s.status === 'completed'));
  // The final stage reads all four earlier outputs.
  for (const earlier of ['stage-1', 'stage-2', 'stage-3', 'stage-4']) assert.ok(prompts[4].includes(earlier), earlier);
});

test('a failed stage cancels the rest instead of pressing on with a hole in the chain', async () => {
  let call = 0;
  const fetchImpl = async () => {
    if (++call === 2) return new Response(JSON.stringify({ error: { message: 'Provider rate limit reached.' } }), { status: 429 });
    return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  };
  const run = await executeJob({ id: crypto.randomUUID(), workspaceId: workspace, request }, { fetchImpl });
  assert.equal(run.status, 'failed');
  assert.equal(run.steps[0].status, 'completed');
  assert.equal(run.steps[1].status, 'failed');
  assert.match(run.steps[1].error, /rate limit/);
  assert.ok(run.steps.slice(2).every(s => s.status === 'cancelled'));
});
