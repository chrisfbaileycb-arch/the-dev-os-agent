import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILD_DELIVERY_RULES, cssDraft, ensureRunnableBuild, expectsRunnablePreview, joinContinuation } from '../src/lib/buildPreview';
import { chatTurn } from '../src/lib/chat';
import { parseProject } from '../src/lib/project';
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
    expect(result.tokens).toBe(145);
    expect(result.repaired).toBe(true);
    expect(parseProject(result.text)?.files[0].content).toContain('.hero { color: red; }');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][1]).toContain('complete runnable project');
    expect(complete.mock.calls[0][2]).toContain('Build a landing page for my restaurant');
  });

  it('keeps existing CSS when a short markup completion fits the output cap', async () => {
    const draft = '```css\n.hero { color: red; }\n```';
    expect(cssDraft(draft)).toBe('.hero { color: red; }');
    const complete = vi.fn(async (_connection: Connection, _system: string): Promise<Completion> => ({ text: '```html\n<!doctype html><html><head></head><body><h1 class="hero">Hello</h1></body></html>\n```', tokens: 85 }));
    const result = await ensureRunnableBuild(request(draft), complete);
    expect(result.repaired).toBe(true);
    const html = parseProject(result.text)?.files[0].content;
    expect(html).toContain('<style>\n.hero { color: red; }\n</style>');
    expect(html).toContain('<h1 class="hero">Hello</h1>');
    expect(complete.mock.calls[0][1]).toContain('under 700 output tokens');
  });

  it('keeps the draft and reports failure if the second response still has no entry', async () => {
    const complete = vi.fn(async (): Promise<Completion> => ({ text: '```css\nbody{}\n```', tokens: 60 }));
    const result = await ensureRunnableBuild(request('original draft'), complete);
    expect(result.text).toBe('original draft');
    expect(result.tokens).toBe(60);
    expect(result.issue).toMatch(/stopped before finishing a runnable page/);
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

describe('resuming a reply cut off by the output limit', () => {
  const cut = '```html\n<!doctype html><html><head><style>\n.logo { font-size: 1.5rem; }\n.btn { display: inline-block; padd';

  it('continues from where it stopped instead of restarting', async () => {
    const chunks = ['ing: 1rem; }\n</style></head><body><h1 class="logo">Hi</h1>', '</body></html>\n```'];
    const complete = vi.fn(async (_c: Connection, _s: string, _p: string, _sig: AbortSignal): Promise<Completion> => ({ text: chunks.shift() ?? '', tokens: 100 }));
    const result = await ensureRunnableBuild(request(cut), complete);
    expect(result.repaired).toBe(true);
    expect(result.tokens).toBe(200);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(String(complete.mock.calls[0][2])).toContain('padd');
    const html = parseProject(result.text)?.files[0].content ?? '';
    expect(html).toContain('.btn { display: inline-block; padding: 1rem; }');
    expect(html).toContain('<h1 class="logo">Hi</h1>');
  });

  it('drops a code fence the model reopened', async () => {
    const complete = vi.fn(async (): Promise<Completion> => ({ text: '```html\ning: 1rem; }</style></head><body>ok</body></html>\n```', tokens: 50 }));
    const result = await ensureRunnableBuild(request(cut), complete);
    expect(parseProject(result.text)?.files[0].content).toContain('padding: 1rem; }</style>');
  });

  it('gives up after three continuations and falls back to the compact pass', async () => {
    const complete = vi.fn(async (): Promise<Completion> => ({ text: 'more css', tokens: 10 }));
    const result = await ensureRunnableBuild(request(cut), complete);
    expect(result.repaired).toBe(false);
    expect(complete).toHaveBeenCalledTimes(4);
    expect(result.tokens).toBe(40);
  });
});

describe('joining a continuation to the reply it resumes', () => {
  it('drops the repeated tail so words are not glued together', () => {
    expect(joinContinuation('<p>Dynamic preview links that', 'links that adapt to your workflow</p>')).toBe('<p>Dynamic preview links that adapt to your workflow</p>');
  });
  it('joins mid-word cuts directly when nothing was repeated', () => {
    expect(joinContinuation('.btn { padd', 'ing: 1rem; }')).toBe('.btn { padding: 1rem; }');
  });
  it('handles a repeated tail that ends mid-word', () => {
    expect(joinContinuation('display: inline-block; padd', 'inline-block; padding: 1rem; }')).toBe('display: inline-block; padding: 1rem; }');
  });
  it('does not treat a short accidental match as overlap', () => {
    expect(joinContinuation('<div>a</div>', '</div><p>b</p>')).toBe('<div>a</div></div><p>b</p>');
  });
});
