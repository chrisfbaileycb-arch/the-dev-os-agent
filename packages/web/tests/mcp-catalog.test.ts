import { afterEach, expect, it, vi } from 'vitest';
import { callMcpTool, refreshTools, type McpConnection } from '../src/lib/mcp';
const conn: McpConnection = { id: 'conn', name: 'Fixture', url: 'https://tools.example/mcp', transport: 'http', enabled: true, token: 'private-key', saveToken: false, authHeader: 'x-api-key', tools: [] };
afterEach(() => { vi.unstubAllGlobals(); });
it('loads every catalog page without shortening names, descriptions, or nested schemas, using the selected auth header', async () => {
  const description = 'Detailed tool instructions '.repeat(500); const name = `tool_${'x'.repeat(100)}`;
  const schema = { type: 'object', properties: { nested: { oneOf: [{ type: 'string' }, { type: 'number' }], description: 'Nested schema' } }, required: ['nested'] };
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { const body = JSON.parse(String(init.body)); requests.push(body); return new Response(JSON.stringify({ result: body.params.cursor ? { tools: [{ name: 'next', description: 'Second page', inputSchema: schema }] } : { tools: [{ name, description, inputSchema: schema }], nextCursor: 'page2' } })); }));
  const tools = await refreshTools(conn, new AbortController().signal);
  expect(tools).toHaveLength(2); expect(tools[0]).toEqual({ name, description, inputSchema: schema });
  expect(requests[0].apiKey).toBe('private-key'); expect(requests[0].authorization).toBeUndefined(); expect(requests[1].params).toEqual({ cursor: 'page2' });
});
it('rejects a repeated catalog cursor instead of registering an incomplete list', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result: { tools: [{ name: 'x', description: '' }], nextCursor: 'same' } }))));
  await expect(refreshTools(conn, new AbortController().signal)).rejects.toThrow(/repeated a cursor/);
});
it('retains full text/structured responses and binary embedded resources for artifact exports', async () => {
  const text = 'Complete stdout\n'.repeat(2000);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result: { content: [{ type: 'text', text }, { type: 'image', data: 'AAECA/8=', mimeType: 'image/png' }, { type: 'resource', resource: { text: '<html>Preview</html>', mimeType: 'text/html' } }], structuredContent: { files: ['src/complete.ts'] } } }))));
  const result = await callMcpTool(conn, 'read', {}, new AbortController().signal);
  expect(typeof result).toBe('object'); if (typeof result === 'string') throw new Error('Expected structured tool output');
  expect(result.output).toContain(text); expect(result.output).toContain('src/complete.ts'); expect(result.artifacts).toHaveLength(2);
  expect(result.artifacts?.[0].content).toBe('AAECA/8='); expect(result.artifacts?.[1].content).toBe('<html>Preview</html>');
});
