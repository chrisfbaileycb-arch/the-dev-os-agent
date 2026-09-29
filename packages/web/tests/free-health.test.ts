import { describe, expect, it } from 'vitest';
import { firstHealthyFree } from '../src/lib/freeHealth';

describe('free-tier default', () => {
  it('skips models that answer 503 and picks the first that streams', async () => {
    const tried: string[] = [];
    const fetcher = (async (_url: string, init: RequestInit) => {
      const id = JSON.parse(String(init.body)).model; tried.push(id);
      return new Response(id === 'qwen-ok' ? 'data: {}\n\n' : 'warming up', { status: id === 'qwen-ok' ? 200 : 503 });
    }) as typeof fetch;
    const id = await firstHealthyFree(['deepseek-dead', 'deepseek-dead-2', 'qwen-ok', 'later'], () => 'xkiro', new AbortController().signal, 4, fetcher);
    expect(id).toBe('qwen-ok');
    expect(tried).toEqual(['deepseek-dead', 'deepseek-dead-2', 'qwen-ok']);
  });
  it('returns null when nothing answers', async () => {
    const fetcher = (async () => new Response('', { status: 503 })) as typeof fetch;
    expect(await firstHealthyFree(['a', 'b'], () => undefined, new AbortController().signal, 4, fetcher)).toBeNull();
  });
});
