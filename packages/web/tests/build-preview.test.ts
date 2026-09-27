import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILD_DELIVERY_RULES, ensureRunnableBuild, expectsRunnablePreview } from '../src/lib/buildPreview';
import { chatTurn } from '../src/lib/chat';
import { defaultConnection } from '../src/lib/providers';
import type { Completion, Connection } from '../src/lib/types';

const page = '```index.html\n<!doctype html><html><body>Hello</body></html>\n```';
const request = (draft: string) => ({ goal: 'Build a landing page for my restaurant', draft, connection: defaultConnection(), signal: new AbortController().signal });
afterEach(() => vi.unstubAllGlobals());

describe('automatic build preview delivery', () => {
  it('asks for runnable output for web deliverables and follow-ups, not a standalone function', () => {
    expect(expectsRunnablePreview('Build a landing page')).toBe(true);
    expect(expectsRunnablePreview('Add the menu to it', true)).toBe(true);
    expect(expectsRunnablePreview('Write a TypeScript retry function')).toBe(false);
    expect(BUILD_DELIVERY_RULES).toContain('The visitor should not have to ask for HTML');
  });

  it('accepts a runnable first response without another paid model call', async () => {
    const complete = vi.fn(async (): Promise<Completion> => ({ text: '', tokens: 0 }));
    expect(await ensureRunnableBuild(request(page), complete)).toEqual({ text: page, tokens: 0, repaired: false });
    expect(complete).not.toHaveBeenCalled();
  });

  it('automatically completes a CSS fragment into a runnable entry', async () => {
    const complete = vi.fn(async (_connection: Connection, _system: string, _prompt: string, _signal: AbortSignal): Promise<Completion> => ({ text: page, tokens: 145 }));
    const result = await ensureRunnableBuild(request('```css\n.hero { color: red; }\n```'), complete);
    expect(result).toEqual({ text: page, tokens: 145, repaired: true });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][1]).toContain('complete runnable project');
    expect(complete.mock.calls[0][2]).toContain('Build a landing page for my restaurant');
  });

  it('keeps the draft and reports failure if the second response still has no entry', async () => {
    const complete = vi.fn(async (): Promise<Completion> => ({ text: '```css\nbody{}\n```', tokens: 60 }));
    const result = await ensureRunnableBuild(request('original draft'), complete);
    expect(result.text).toBe('original draft');
    expect(result.tokens).toBe(60);
    expect(result.issue).toMatch(/did not finish a runnable preview/);
  });

  it('sends the runnable delivery contract to the model on a Build turn', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: page }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await chatTurn({ connection: defaultConnection(), personaId: 'coder', history: [], input: 'Build a landing page', attachments: [], knowledge: [], signal: new AbortController().signal, buildPreview: true });
    expect(result.text).toBe(page);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.messages[0].content).toContain(BUILD_DELIVERY_RULES);
  });
});
