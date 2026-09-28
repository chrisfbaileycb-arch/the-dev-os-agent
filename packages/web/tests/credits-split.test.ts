import { afterEach, describe, expect, it, vi } from 'vitest';
import { creditsFor, creditsForUsage, ratesFor, weightFor, CREDIT_WEIGHTS } from '../src/lib/catalog';
import { makeEntry } from '../src/lib/store';
import { complete } from '../src/lib/provider';
import { defaultConnection } from '../src/lib/providers';

afterEach(() => vi.unstubAllGlobals());
const sse = (...events: object[]) => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
const signal = () => new AbortController().signal;

describe('pricing input and output separately', () => {
  it('output costs five times input, anchored to the class weight', () => {
    const r = ratesFor('deepseek/deepseek-r1');
    expect(r.output).toBeCloseTo(r.input * 5);
    expect(r.input).toBeCloseTo(CREDIT_WEIGHTS.reasoning / 2);
  });

  it('charges exactly the blended weight at a three-to-one input-to-output mix', () => {
    for (const model of ['groq/llama-3.1-8b-instant', 'vendor/mystery-model', 'deepseek/deepseek-r1']) {
      expect(creditsForUsage(model, { input: 3000, output: 1000 }, 'credits')).toBeCloseTo(creditsFor(model, 4000, 'credits'), 2);
    }
  });

  it('charges more for output-heavy work and less for input-heavy work', () => {
    const model = 'vendor/mystery-model';
    const blended = creditsFor(model, 4000, 'credits');
    expect(creditsForUsage(model, { input: 1000, output: 3000 }, 'credits')).toBeGreaterThan(blended);
    expect(creditsForUsage(model, { input: 3900, output: 100 }, 'credits')).toBeLessThan(blended);
  });

  it('never charges a BYOK run and handles empty or invalid usage', () => {
    expect(creditsForUsage('deepseek/deepseek-r1', { input: 1000, output: 1000 }, 'byok')).toBe(0);
    expect(creditsForUsage('deepseek/deepseek-r1', { input: 0, output: 0 }, 'credits')).toBe(0);
    expect(creditsForUsage('deepseek/deepseek-r1', { input: -5, output: NaN }, 'credits')).toBe(0);
    expect(weightFor('vendor/mystery-model')).toBe(CREDIT_WEIGHTS.standard);
  });
});

describe('the ledger row', () => {
  const base = { sessionId: 's', model: 'vendor/mystery-model', mode: 'credits' as const };
  it('prices by direction when the split is known, keeping the row shape', () => {
    const entry = makeEntry({ ...base, tokens: 4000, usage: { input: 1000, output: 3000 } });
    expect(entry.tokens).toBe(4000);
    expect(entry.credits).toBe(creditsForUsage(base.model, { input: 1000, output: 3000 }, 'credits'));
    expect(Object.keys(entry).sort()).toEqual(['at', 'credits', 'id', 'mode', 'model', 'sessionId', 'tier', 'tokens']);
  });
  it('prices tokens beyond the split at the blended rate', () => {
    const entry = makeEntry({ ...base, tokens: 5000, usage: { input: 1000, output: 3000 } });
    const expected = creditsForUsage(base.model, { input: 1000, output: 3000 }, 'credits') + creditsFor(base.model, 1000, 'credits');
    expect(entry.credits).toBeCloseTo(expected, 2);
  });
  it('falls back to the blended rate with no split', () => {
    expect(makeEntry({ ...base, tokens: 4000 }).credits).toBe(creditsFor(base.model, 4000, 'credits'));
  });
});

describe('reading usage from provider streams', () => {
  it('reads prompt and completion tokens from an OpenAI-shaped stream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse({ choices: [{ delta: { content: 'Hi' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 } })));
    const result = await complete(defaultConnection('groq'), 's', 'p', signal());
    expect(result).toMatchObject({ text: 'Hi', tokens: 150, inputTokens: 120, outputTokens: 30 });
  });
  it('reads message_start and message_delta from a native Anthropic stream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse({ type: 'message_start', message: { usage: { input_tokens: 200 } } }, { type: 'content_block_delta', delta: { text: 'Hey' } }, { type: 'message_delta', usage: { output_tokens: 40 } }, { type: 'message_stop' })));
    const result = await complete(defaultConnection('anthropic'), 's', 'p', signal());
    expect(result).toMatchObject({ text: 'Hey', tokens: 240, inputTokens: 200, outputTokens: 40 });
  });
  it('omits the split when the provider reports only a total', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse({ choices: [{ delta: { content: 'Hi' }, finish_reason: 'stop' }], usage: { total_tokens: 99 } })));
    const result = await complete(defaultConnection('groq'), 's', 'p', signal());
    expect(result.tokens).toBe(99);
    expect(result.inputTokens).toBeUndefined();
    expect(result.outputTokens).toBeUndefined();
  });
});
