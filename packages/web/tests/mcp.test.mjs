import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { checkServer, createMcp, rpc } from '../server/mcp.mjs';

// A tiny Streamable HTTP MCP server: initialize issues a session id, tools/list and tools/call
// require it, and answers alternate between JSON and SSE to exercise both parsers.
function fakeMcp({ sse = false, expectToken } = {}) {
  const calls = [];
  const server = createServer((req, res) => {
    let body = ''; req.on('data', c => { body += c; }); req.on('end', () => {
      const message = JSON.parse(body); calls.push(message.method);
      if (expectToken && req.headers.authorization !== `Bearer ${expectToken}`) { res.writeHead(401); res.end(); return; }
      const reply = (result, headers = {}) => { const payload = JSON.stringify({ jsonrpc: '2.0', id: message.id, result }); if (sse) { res.writeHead(200, { 'Content-Type': 'text/event-stream', ...headers }); res.end(`event: message\ndata: ${payload}\n\n`); } else { res.writeHead(200, { 'Content-Type': 'application/json', ...headers }); res.end(payload); } };
      if (message.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } }, { 'Mcp-Session-Id': 'sess-1' });
      if (message.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
      if (req.headers['mcp-session-id'] !== 'sess-1') { res.writeHead(404); res.end(); return; }
      if (message.method === 'tools/list') return reply({ tools: [{ name: 'lookup_order', description: 'Find an order by number', inputSchema: { type: 'object', properties: { number: { type: 'string' } } } }] });
      if (message.method === 'tools/call') return reply({ content: [{ type: 'text', text: `Order ${message.params.arguments.number}: shipped` }], isError: false });
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'no such method' } }));
    });
  });
  return { server, calls, start: () => new Promise(r => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}/mcp`))), stop: () => new Promise(r => server.close(r)) };
}

test('checks MCP server urls before connecting', async () => {
  await assert.rejects(checkServer('http://example.com/mcp'), /https/);
  await assert.rejects(checkServer('https://user:pw@example.com/mcp'), /credentials/);
  await assert.rejects(checkServer('https://example.com/mcp', { resolve: async () => [{ address: '192.168.1.9' }] }), /Private/);
  assert.equal((await checkServer('https://example.com/mcp', { resolve: async () => [{ address: '93.184.216.34' }] })).hostname, 'example.com');
});

for (const sse of [false, true]) test(`initializes once, lists and calls tools (${sse ? 'SSE' : 'JSON'} answers)`, async () => {
  const fake = fakeMcp({ sse, expectToken: 'secret' }); const url = await fake.start();
  try {
    const mcp = createMcp({ env: {}, allowPrivate: true });
    const list = await mcp.call(url, 'tools/list', {}, 'Bearer secret', 'ws');
    assert.equal(list.tools[0].name, 'lookup_order');
    const result = await mcp.call(url, 'tools/call', { name: 'lookup_order', arguments: { number: '42' } }, 'Bearer secret', 'ws');
    assert.equal(result.content[0].text, 'Order 42: shipped');
    assert.deepEqual(fake.calls, ['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
    await assert.rejects(rpc(url, { jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} }, { authorization: 'Bearer wrong' }), /rejected the token/);
  } finally { await fake.stop(); }
});

test('the HTTP route validates input, enforces the budget, and blocks private hosts by default', async () => {
  const fake = fakeMcp(); const url = await fake.start();
  const mcp = createMcp({ env: { MCP_MAX_PER_HOUR: '2' }, allowPrivate: false });
  const server = createServer((req, res) => { mcp(req, res).then(handled => { if (!handled) { res.writeHead(404); res.end(); } }); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const route = `http://127.0.0.1:${server.address().port}/api/mcp`;
    const post = body => fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': 'ws-a' }, body: JSON.stringify(body) });
    assert.equal((await fetch(route)).status, 405);
    assert.equal((await post({ url, method: 'drop/tables' })).status, 400);
    assert.equal((await post({ url, method: 'tools/list' })).status, 400);
    const blocked = await post({ url: 'https://example.com/mcp', method: 'tools/list' });
    assert.ok([403, 502].includes(blocked.status));
    assert.equal((await post({ url: 'https://example.com/mcp', method: 'tools/list' })).status, 429);
  } finally { await new Promise(r => server.close(r)); await fake.stop(); }
});
