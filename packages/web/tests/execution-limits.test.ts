import { expect, it, vi } from 'vitest';
import { executeRun, MAX_STAGE_TURNS, MAX_WORKFLOW_CALLS } from '../src/lib/orchestrator';
import { chatTurn, MAX_CHAT_TURNS } from '../src/lib/chat';
import { complete, listModels, ProviderError } from '../src/lib/provider';
import { defaultConnection, inferenceFor } from '../src/lib/providers';
import type { StartMessage } from '../src/lib/types';

const event = (text: string) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });

it('the separate HF backend sends a personal token without an Experiment flag', async () => {
  const fetchMock = vi.fn(async () => event('HF fixture reply')); vi.stubGlobal('fetch', fetchMock);
  try {
    await complete({ ...defaultConnection('huggingface-backend'), model: 'fixture-model', token: 'hf_personal_fixture' }, 'system', 'prompt', new AbortController().signal);
    const options = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0][1];
    expect(options.headers).not.toHaveProperty('X-Forge-Is-Experimental');
    expect(JSON.parse(String(options.body))).toMatchObject({ provider: 'huggingface-backend', apiKey: 'hf_personal_fixture' });
  } finally { vi.unstubAllGlobals(); }
});

it('five stages can make at most three calls each, including retries', async () => {
  vi.useFakeTimers();
  try {
    const turns = new Map<string, number>();
    const call = vi.fn(async (_connection, _system, prompt: string) => {
      const stage = prompt.split('YOUR STAGE: ')[1]; const count = (turns.get(stage) ?? 0) + 1; turns.set(stage, count);
      if (count < MAX_STAGE_TURNS) throw new ProviderError('temporary failure', true);
      return { text: 'done', tokens: 1 };
    });
    const message: StartMessage = { type: 'start', runId: 'bounded-run', goal: 'Review this test fixture', workflow: 'review', connection: { ...defaultConnection('groq'), model: 'test-model', token: 'fixture-key' }, knowledge: [] };
    const pending = executeRun(message, new AbortController().signal, () => {}, call);
    await vi.runAllTimersAsync(); const run = await pending;
    expect(run.status).toBe('completed'); expect(call).toHaveBeenCalledTimes(MAX_WORKFLOW_CALLS);
    expect(turns.size).toBe(5); expect([...turns.values()]).toEqual(Array(5).fill(MAX_STAGE_TURNS));
  } finally { vi.useRealTimers(); }
});

it('an endlessly recursive tool response stops after three model requests and two tools', async () => {
  const fetchMock = vi.fn(async () => event('TOOL {"tool":"read_fixture","args":{}}'));
  const runTool = vi.fn(async () => 'untrusted fixture'); vi.stubGlobal('fetch', fetchMock);
  try {
    const result = await chatTurn({ connection: { ...defaultConnection('groq'), token: 'fixture-personal' }, personaId: 'browser', history: [], input: 'Read this fixture', attachments: [], knowledge: [], tools: [{ name: 'read_fixture', description: 'Read a fixture', run: runTool }], signal: new AbortController().signal });
    expect(fetchMock).toHaveBeenCalledTimes(MAX_CHAT_TURNS); expect(runTool).toHaveBeenCalledTimes(2); expect(result.text).toContain('limit of 2');
  } finally { vi.unstubAllGlobals(); }
});

it('Experiment sends isolation headers for discovery and chat even with a legacy funding preference', async () => {
  const fetchMock = vi.fn(async (url: string) => url === '/api/models' ? new Response('{"data":[{"id":"test-model"}]}') : event('reply'));
  vi.stubGlobal('fetch', fetchMock);
  try {
    const c = { ...defaultConnection('openrouter'), model: 'test-model', token: 'fixture-personal', inference: 'credits' as const };
    await listModels(c, new AbortController().signal); await complete(c, 's', 'p', new AbortController().signal);
    for (const [, options] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(options.headers).toHaveProperty('X-Forge-Is-Experimental', 'true');
      expect(JSON.parse(String(options.body)).apiKey).toBe('fixture-personal');
    }
    expect(inferenceFor(' Lab/Model-A ', undefined, [' LAB/MODEL-A '])).toBe('free');
    expect(inferenceFor('lab/modela', undefined, ['lab/model-a'])).toBe('byok');
  } finally { vi.unstubAllGlobals(); }
});
