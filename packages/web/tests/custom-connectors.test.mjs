import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createCustomConnectors, callWebSocket } from '../server/customConnectors.mjs';
const workspace = '11111111-1111-4111-8111-111111111111';
async function withServer(handler, fn) {
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise(r => server.close(r)); }
}
const response = (text, status = 200) => Object.assign(Readable.from([text]), { statusCode: status, headers: {} });
test('REST connector pins public DNS and forwards only the session authorization and explicit input', async () => {
  let captured;
  const handler = createCustomConnectors({ env: { WORKSPACE_AUTH_REQUIRED: 'false' }, resolve: async () => [{ address: '93.184.216.34' }], transport: async (url, options) => { captured = { url, ...options }; return response('{"ok":true}'); } });
  await withServer(handler, async origin => {
    const res = await fetch(origin + '/api/connectors/call', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Workspace-Id': workspace }, body: JSON.stringify({ transport: 'rest', url: 'https://example.com/endpoint', method: 'POST', input: { task: 'fixture' }, authorization: 'Bearer session-credential' }) });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).result, '{"ok":true}');
    assert.equal(captured.address, '93.184.216.34');
    assert.equal(captured.headers.Authorization, 'Bearer session-credential');
    assert.deepEqual(JSON.parse(captured.body), { task: 'fixture' });
  });
});
test('private destinations, credentials in URLs, invalid protocols and cross-origin calls never dispatch', async () => {
  let called = 0;
  const handler = createCustomConnectors({ env: { WORKSPACE_AUTH_REQUIRED: 'false' }, resolve: async () => [{ address: '127.0.0.1' }], transport: async () => { called++; return response('bad'); } });
  await withServer(handler, async origin => {
    const post = (url, ownOrigin = origin) => fetch(origin + '/api/connectors/call', { method: 'POST', headers: { Origin: ownOrigin, 'Content-Type': 'application/json', 'X-Workspace-Id': workspace }, body: JSON.stringify({ transport: 'rest', url }) });
    assert.equal((await post('https://localhost/secret')).status, 403);
    assert.equal((await post('https://user:secret@example.com')).status, 400);
    assert.equal((await post('http://example.com')).status, 400);
    assert.equal((await post('https://example.com', 'https://evil.test')).status, 403);
    assert.equal(called, 0);
  });
});
test('WebSocket connects with pinned DNS, sends one JSON request and closes after one text response', async () => {
  let options; let message; let terminated = false;
  class Socket extends EventEmitter {
    constructor(_url, opts) { super(); options = opts; queueMicrotask(() => this.emit('open')); }
    send(text) { message = text; queueMicrotask(() => this.emit('message', Buffer.from('{"result":42}'), false)); }
    terminate() { terminated = true; }
  }
  const result = await callWebSocket('wss://example.com/tool', { authorization: 'Bearer fixture', address: '93.184.216.34', signal: new AbortController().signal, input: { question: 'test' }, Socket });
  assert.equal(result, '{"result":42}');
  assert.deepEqual(JSON.parse(message), { question: 'test' });
  options.lookup('example.com', {}, (err, ip, family) => { assert.equal(err, null); assert.equal(ip, '93.184.216.34'); assert.equal(family, 4); });
  assert.equal(options.followRedirects, false); assert.equal(terminated, true);
});
