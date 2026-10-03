import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILD_DELIVERY_RULES, cssDraft, ensureRunnableBuild, expectsRunnablePreview, joinContinuation, needsPreviewRecovery, isContinuationRequest } from '../src/lib/buildPreview';
import { complete as providerComplete, ProviderError } from '../src/lib/provider';
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
    expect(complete.mock.calls[0][1]).toContain('under 13926 output tokens');
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

  it('preserves progress after three continuations instead of restarting', async () => {
    const complete = vi.fn(async (): Promise<Completion> => ({ text: 'more css', tokens: 10 }));
    const result = await ensureRunnableBuild(request(cut), complete);
    expect(result.repaired).toBe(false);
    expect(complete).toHaveBeenCalledTimes(3);
    expect(result.tokens).toBe(30);
    expect(result.text).toBe(cut + 'more css'.repeat(3));
    expect(result.truncated).toBe(true);
    expect(result.issue).toContain('progress is saved');
  });

  it('recovers web code generated in Chat while leaving complete replies and ordinary snippets alone', () => {
    expect(needsPreviewRecovery(cut)).toBe(true);
    expect(needsPreviewRecovery(page, false, true)).toBe(true);
    expect(needsPreviewRecovery(page)).toBe(false);
    expect(needsPreviewRecovery('```css\nbody { color: red; }\n```')).toBe(false);
    expect(needsPreviewRecovery('An ordinary answer', false, true)).toBe(false);
    expect(needsPreviewRecovery('```python\nprint(')).toBe(false);
    expect(isContinuationRequest('continue from where you left off')).toBe(true);
    expect(isContinuationRequest('please resume.')).toBe(true);
    expect(isContinuationRequest('Continue with a different design')).toBe(false);
  });

  it('joins a real streamed Chat continuation and retains separate usage for every call', async () => {
    const draft = '```index.html\n<!doctype html><html><body><button id="quest">Begin</button><script>\nlet holes = 0; document.getElementById("quest").addEventLis';
    const remainder = 'tener("click", () => { holes++; });\n</script></body></html>\n```';
    const stream = (text: string, finish: string) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: finish }], usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 } })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    const fetchMock = vi.fn().mockResolvedValueOnce(stream(draft, 'length')).mockResolvedValueOnce(stream(remainder, 'stop'));
    vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal; const connection = defaultConnection('anthropic');
    const first = await chatTurn({ connection, personaId: 'assistant', history: [], input: 'Build Knight Golf', attachments: [], knowledge: [], signal });
    expect(first.truncated).toBe(true);
    expect(needsPreviewRecovery(first.text, false, first.truncated)).toBe(true);
    const deltas: string[] = [];
    const recovered = await ensureRunnableBuild({ goal: 'Build Knight Golf', draft: first.text, truncated: first.truncated, connection, signal, onDelta: text => deltas.push(text) });
    expect(recovered.repaired).toBe(true); expect(recovered.truncated).toBeUndefined();
    expect(recovered.text).toBe(draft + remainder);
    expect(recovered.usage).toEqual({ input: 200, output: 100 });
    expect(first.tokens + recovered.tokens).toBe(600);
    expect(parseProject(recovered.text)?.files[0].content).toContain('addEventListener("click", () => { holes++; });');
    expect(deltas.at(-1)).toBe(draft + remainder);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).max_tokens).toBe(16384);
  });

  it('finishes later files even when the first HTML file is already closed', async () => {
    const draft = '```index.html\n<!doctype html><html><body><button>Begin</button></body></html>\n```\n';
    const complete = vi.fn(async (): Promise<Completion> => ({ text: '```app.js\ndocument.querySelector("button").onclick = () => alert("Quest begun");\n```', tokens: 50 }));
    const result = await ensureRunnableBuild({ ...request(draft), truncated: true }, complete);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(parseProject(result.text)?.files.map(f => f.path)).toEqual(['index.html', 'app.js']);
    expect(result.repaired).toBe(true);
  });

  it('retains newly streamed code if the provider fails during continuation', async () => {
    const complete = vi.fn(async (_c: Connection, _s: string, _p: string, _signal: AbortSignal, onDelta?: (text: string) => void): Promise<Completion> => {
      onDelta?.('ing: 1rem; }'); throw new ProviderError('Plan allowance exhausted', false, 402);
    });
    const result = await ensureRunnableBuild(request(cut), complete);
    expect(result.text).toBe(cut + 'ing: 1rem; }');
    expect(result.truncated).toBe(true); expect(result.issue).toContain('Plan allowance exhausted');
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('carries enough source context to retain earlier declarations and stops when cancelled', async () => {
    const draft = cut + '\nconst golfState = { holes: [] };\n' + '/* styling */'.repeat(1200);
    const controller = new AbortController();
    const complete = vi.fn(async (_c: Connection, _s: string, prompt: string): Promise<Completion> => {
      expect(prompt).toContain('golfState'); controller.abort(new Error('stopped')); throw controller.signal.reason;
    });
    await expect(ensureRunnableBuild({ ...request(draft), signal: controller.signal }, complete)).rejects.toThrow('stopped');
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

it('drains the stream after DONE before another request, retaining final reported usage', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"Finished"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\ndata: {"usage":{"prompt_tokens":40,"completion_tokens":60,"total_tokens":100}}\n\n', { headers: { 'content-type': 'text/event-stream' } })));
  const result = await providerComplete(defaultConnection(), 'system', 'prompt', new AbortController().signal);
  expect(result.tokens).toBe(100); expect(result.outputTokens).toBe(60);
});

it('detects native Anthropic token cutoffs without relying on the proxy sentinel', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('data: {"type":"content_block_delta","delta":{"text":"partial code"}}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":10}}\n\ndata: {"type":"message_stop"}\n\n', { headers: { 'content-type': 'text/event-stream' } })));
  expect((await providerComplete(defaultConnection('anthropic'), 'system', 'prompt', new AbortController().signal)).truncated).toBe(true);
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
