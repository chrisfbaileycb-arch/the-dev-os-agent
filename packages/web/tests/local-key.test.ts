import { afterEach, expect, it, vi } from 'vitest';
import { complete, listModels } from '../src/lib/provider';
import { defaultConnection } from '../src/lib/providers';
afterEach(() => vi.unstubAllGlobals());
it('an optional local key is sent only to the loopback server for discovery and inference', async () => {
  const call = vi.fn(async (url: string) => url.endsWith('/models')
    ? new Response(JSON.stringify({ data: [{ id: 'my-local-model' }] }), { headers: { 'Content-Type': 'application/json' } })
    : new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }));
  vi.stubGlobal('fetch', call);
  const c = { ...defaultConnection('ollama'), endpoint: 'http://localhost:1234/v1', model: 'my-local-model', token: 'local-only-token' };
  const signal = new AbortController().signal;
  expect((await complete(c, 'system', 'hello', signal)).text).toBe('hi');
  await listModels(c, signal);
  expect(call).toHaveBeenCalledTimes(2);
  for (const [url, options] of call.mock.calls as unknown as [string, RequestInit][]) {
    expect(url).toMatch(/^http:\/\/localhost:1234\/v1\//);
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer local-only-token');
  }
  await expect(complete({ ...c, endpoint: 'https://remote.example:1234/v1' }, 'system', 'hello', signal)).rejects.toThrow('Only this machine');
  expect(call).toHaveBeenCalledTimes(2);
});
