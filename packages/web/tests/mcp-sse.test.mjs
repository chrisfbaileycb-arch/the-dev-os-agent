import test from 'node:test';
import assert from 'node:assert/strict';
import { SseSession } from '../server/mcp.mjs';

// A fake HTTP+SSE MCP server: GET opens a stream that announces an endpoint, and every POST to
// that endpoint is answered on the stream with a result carrying the same id.
function fakeServer({ endpoint = '/messages?session=abc' } = {}) {
  let push;
  const posts = [];
  const fetchImpl = async (url, init) => {
    if (init.method === 'GET') {
      const stream = new ReadableStream({ start(controller) { push = text => controller.enqueue(new TextEncoder().encode(text)); push(`event: endpoint\ndata: ${endpoint}\n\n`); } });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    const message = JSON.parse(init.body); posts.push({ url, message });
    if (message.id !== undefined) setTimeout(() => push(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { echoed: message.method } })}\n\n`), 5);
    return new Response(null, { status: 202 });
  };
  return { fetchImpl, posts };
}

test('an SSE session posts to the announced endpoint and matches replies by id', async () => {
  const server = fakeServer();
  const session = new SseSession('https://mcp.example.com/sse', { fetchImpl: server.fetchImpl });
  assert.equal(await session.open(), 'https://mcp.example.com/messages?session=abc');
  const reply = await session.request({ jsonrpc: '2.0', id: 7, method: 'tools/list', params: {} });
  assert.deepEqual(reply.result, { echoed: 'tools/list' });
  assert.equal(server.posts[0].url, 'https://mcp.example.com/messages?session=abc');
  session.close();
});

test('an endpoint on another host is refused rather than followed', async () => {
  const server = fakeServer({ endpoint: 'http://169.254.169.254/latest' });
  const session = new SseSession('https://mcp.example.com/sse', { fetchImpl: server.fetchImpl });
  await assert.rejects(session.open(), /different host/);
});

test('a URL that is not an event stream says which transport to pick', async () => {
  const session = new SseSession('https://mcp.example.com/mcp', { fetchImpl: async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(session.open(), /Streamable HTTP/);
});
