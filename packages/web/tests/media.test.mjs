import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createMedia, mediaRequest, mediaResult } from '../server/media.mjs';
const workspace = '11111111-1111-4111-8111-111111111111';
const callId = '22222222-2222-4222-8222-222222222222';
const fixtureKey = 'test-media-session-credential';
const imageBody = () => ({ provider: 'nano-banana', tool: 'nano_banana_generate_image', key: fixtureKey, model: 'gemini-nano-banana-2.1', args: { prompt: 'A product hero image' }, callId });
async function withServer(handler, fn) {
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise(resolve => server.close(resolve)); }
}
test('image requests use only the supplied key, an allowlisted model, fixed URL, and stateless interactions', () => {
  const request = mediaRequest(imageBody());
  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(request.headers['x-goog-api-key'], fixtureKey);
  assert.deepEqual(request.body, { model: 'gemini-nano-banana-2.1', input: [{ type: 'text', text: 'A product hero image' }], store: false });
  for (const patch of [{ key: '' }, { model: 'a-conversation-only-model' }, { provider: 'unknown' }, { callId: 'invalid' }, { key: 'header\rinjection' }]) assert.throws(() => mediaRequest({ ...imageBody(), ...patch }));
});
test('HeyGen uses the v3 avatar contract and idempotency; status requests cannot submit another job', () => {
  const body = { provider: 'heygen', tool: 'heygen_generate_video', key: fixtureKey, avatarId: 'avatar-id', voiceId: 'voice-id', callId, args: { script: 'Hello world', aspect_ratio: '9:16' } };
  const request = mediaRequest(body);
  assert.equal(request.url, 'https://api.heygen.com/v3/videos');
  assert.equal(request.headers['Idempotency-Key'], callId);
  assert.deepEqual(request.body, { type: 'avatar', avatar_id: 'avatar-id', voice_id: 'voice-id', script: 'Hello world', aspect_ratio: '9:16', output_format: 'mp4' });
  const status = mediaRequest({ ...body, tool: 'heygen_video_status', args: { video_id: 'v_123' } });
  assert.equal(status.method, 'GET'); assert.equal(status.url, 'https://api.heygen.com/v3/videos/v_123'); assert.equal(status.body, undefined);
  assert.throws(() => mediaRequest({ ...body, tool: 'heygen_video_status', args: { video_id: '../../admin' } }));
  assert.throws(() => mediaRequest({ ...body, avatarId: '' }));
});
test('image results preserve every binary image and public response, excluding model thought steps', () => {
  const result = mediaResult('nano-banana', { steps: [{ type: 'thought', summary: [{ type: 'text', text: 'private reasoning' }] }, { type: 'model_output', content: [{ type: 'text', text: 'Here are two assets.' }, { type: 'image', mime_type: 'image/png', data: 'AAECA/8=' }, { type: 'image', mime_type: 'image/webp', data: 'BAUG' }] }] }, callId);
  assert.equal(result.artifacts.length, 2); assert.equal(result.artifacts[0].content, 'AAECA/8=');
  assert.match(result.output, /two assets/); assert.doesNotMatch(JSON.stringify(result), /private reasoning/);
  assert.throws(() => mediaResult('nano-banana', { steps: [{ type: 'model_output', content: [{ type: 'image', mime_type: 'image/svg+xml', data: 'eA==' }] }] }, callId));
  assert.throws(() => mediaResult('nano-banana', { steps: [] }, callId));
});
test('video results keep complete download manifests without collecting arbitrary provider fields', () => {
  const result = mediaResult('heygen', { data: { id: 'v_123', status: 'completed', video_url: 'https://files.heygen.ai/video/test.mp4', duration: 12, secret: 'unwanted' } }, callId);
  assert.equal(result.artifacts[0].encoding, 'utf8'); assert.equal(JSON.parse(result.artifacts[0].content).videoUrl, 'https://files.heygen.ai/video/test.mp4');
  assert.doesNotMatch(JSON.stringify(result), /unwanted/);
  assert.throws(() => mediaResult('heygen', { data: { id: 'v_123', status: 'failed', failure_message: 'Render failed' } }, callId), /Render failed/);
});
test('media endpoint requires workspace ownership, rejects foreign origins, and never falls back to ENV credentials', async () => {
  let calls = 0;
  const handler = createMedia({ env: { SESSION_SECRET: 's'.repeat(40), GEMINI_API_KEY: 'must-not-be-used' }, fetchImpl: async () => { calls++; throw new Error('Should not dispatch'); } });
  await withServer(handler, async origin => {
    const post = (ownOrigin, body) => fetch(origin + '/api/media/call', { method: 'POST', headers: { Origin: ownOrigin, 'Content-Type': 'application/json', 'X-Workspace-Id': workspace }, body: JSON.stringify(body) });
    assert.equal((await post(origin, imageBody())).status, 401);
    assert.equal((await post('https://evil.example', imageBody())).status, 403);
    assert.equal(calls, 0);
  });
});
test('media endpoint forwards once, rejects redirects, exports binary images, and redacts echoed credentials', async () => {
  let calls = 0; let captured;
  const handler = createMedia({ env: { WORKSPACE_AUTH_REQUIRED: 'false', GEMINI_API_KEY: 'unused-env-key' }, fetchImpl: async (url, init) => {
    calls++; captured = { url, ...init };
    return new Response(JSON.stringify({ steps: [{ type: 'model_output', content: [{ type: 'text', text: `echo ${fixtureKey}` }, { type: 'image', mime_type: 'image/png', data: 'AAECA/8=' }] }] }));
  } });
  await withServer(handler, async origin => {
    const post = body => fetch(origin + '/api/media/call', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Workspace-Id': workspace }, body: JSON.stringify(body) });
    const response = await post(imageBody()); assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.artifacts[0].content, 'AAECA/8='); assert.doesNotMatch(JSON.stringify(result), new RegExp(fixtureKey));
    assert.equal(calls, 1); assert.equal(captured.redirect, 'error'); assert.equal(captured.headers['x-goog-api-key'], fixtureKey);
    assert.equal((await post({ ...imageBody(), key: '' })).status, 400); assert.equal(calls, 1);
  });
});
test('provider failures are trapped and never automatically retried', async () => {
  let calls = 0;
  const handler = createMedia({ env: { WORKSPACE_AUTH_REQUIRED: 'false' }, fetchImpl: async () => { calls++; return new Response(JSON.stringify({ error: { message: `quota exhausted for ${fixtureKey}` } }), { status: 429 }); } });
  await withServer(handler, async origin => {
    const response = await fetch(origin + '/api/media/call', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Workspace-Id': workspace }, body: JSON.stringify(imageBody()) });
    assert.equal(response.status, 429); assert.doesNotMatch(JSON.stringify(await response.json()), new RegExp(fixtureKey)); assert.equal(calls, 1);
  });
});
