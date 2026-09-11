import { afterEach, describe, expect, it, vi } from 'vitest';
import { CREDIT_WEIGHTS, catalog, creditsFor, estimateTokens, tierFor, weightFor } from '../src/lib/catalog';
import { computeBalance, makeEntry, merge, type LedgerEntry, type Session } from '../src/lib/store';
import { SAFETY_BASELINE, composePrompt, personaById, personas, skills } from '../src/lib/roster';
import { inspectPageSpec, parseToolCall, summarizeReport, toolProtocol } from '../src/lib/tools';
import { mcpToolSpecs, slug, type McpConnection } from '../src/lib/mcp';
import { activeTools, defaultSettings, parseRepo } from '../src/lib/connectors';
import { retrieve } from '../src/lib/memory';
import { chatTurn } from '../src/lib/chat';
import { defaultConnection, inferenceFor } from '../src/lib/providers';

afterEach(() => vi.unstubAllGlobals());

describe('catalog and credit weights', () => {
  it('maps catalog models and guesses unknown ones conservatively', () => {
    expect(weightFor('groq/llama-3.1-8b-instant')).toBe(CREDIT_WEIGHTS.fast); expect(weightFor('llama-3.3-70b-versatile')).toBe(CREDIT_WEIGHTS.fast);
    expect(weightFor('deepseek/deepseek-r1')).toBe(CREDIT_WEIGHTS.reasoning); expect(weightFor('anthropic/claude-3.5-haiku')).toBe(CREDIT_WEIGHTS.standard);
    expect(weightFor('vendor/mystery-model')).toBe(CREDIT_WEIGHTS.standard); expect(weightFor('vendor/tiny-3b')).toBe(CREDIT_WEIGHTS.fast); expect(weightFor('vendor/o3-pro')).toBe(CREDIT_WEIGHTS.reasoning);
    expect(tierFor('groq/llama-3.3-70b-versatile')).toBe('free'); expect(tierFor('openai/gpt-4o')).toBe('pro'); expect(tierFor('vendor/mystery-model')).toBe('pro');
  });
  it('charges credits only in platform mode', () => {
    expect(creditsFor('groq/llama-3.1-8b-instant', 2000, 'credits')).toBe(1); expect(creditsFor('deepseek/deepseek-r1', 1000, 'credits')).toBe(15);
    expect(creditsFor('deepseek/deepseek-r1', 1000, 'byok')).toBe(0); expect(creditsFor('deepseek/deepseek-r1', 1000, 'demo')).toBe(0); expect(creditsFor('deepseek/deepseek-r1', 0, 'credits')).toBe(0);
    expect(creditsFor('groq/llama-3.1-8b-instant', 1, 'credits')).toBe(0.01); expect(estimateTokens('abcdefgh')).toBe(2);
  });
});

describe('ledger and workspace merge', () => {
  const month = new Date().toISOString().slice(0, 7);
  const entry = (over: Partial<LedgerEntry>): LedgerEntry => ({ id: crypto.randomUUID(), at: `${month}-05T10:00:00.000Z`, sessionId: 's', model: 'groq/llama-3.1-8b-instant', tier: 'free', mode: 'credits', tokens: 2000, credits: 1, ...over });
  it('computes the monthly balance from platform-mode entries only', () => {
    const balance = computeBalance([entry({}), entry({ mode: 'byok', credits: 0 }), entry({ credits: 2.5 }), entry({ at: '2000-01-01T00:00:00.000Z', credits: 99 })], 100, 'local');
    expect(balance).toEqual({ pool: 100, used: 3.5, remaining: 96.5, month, source: 'local' });
    expect(computeBalance([entry({ credits: 500 })], 100).remaining).toBe(0);
  });
  it('builds entries with the tier and credit weight of the model', () => {
    const e = makeEntry({ sessionId: 's', model: 'openai/gpt-4o', mode: 'credits', tokens: 1000 }); expect(e.tier).toBe('pro'); expect(e.credits).toBe(15);
    expect(makeEntry({ sessionId: 's', model: 'openai/gpt-4o', mode: 'byok', tokens: 1000 }).credits).toBe(0);
  });
  it('merges by newest session and unions runs and ledger, reporting what to push', () => {
    const s = (id: string, updatedAt: string, title: string): Session => ({ id, title, persona: 'operator', createdAt: updatedAt, updatedAt, messages: [] });
    const local = { sessions: [s('a', '2026-09-10T02:00:00.000Z', 'local newer'), s('c', '2026-09-10T01:00:00.000Z', 'local only')], runs: [], ledger: [entry({ id: 'l1' })] };
    const server = { sessions: [s('a', '2026-09-10T01:00:00.000Z', 'server older'), s('b', '2026-09-10T01:00:00.000Z', 'server only')], runs: [], ledger: [entry({ id: 'l1' }), entry({ id: 'l2' })], pool: 100, freePool: 400, freeUsed: 0, free: { enabled: true, models: [], providers: {}, monthlyCredits: 400, perHour: 40 } };
    const merged = merge(local, server);
    expect(merged.sessions.map(x => x.title).sort()).toEqual(['local newer', 'local only', 'server only']); expect(merged.ledger).toHaveLength(2);
    expect(merged.toPush.sessions.map(x => x.id)).toEqual(['a', 'c']); expect(merged.toPush.ledger).toHaveLength(0);
    expect(merge(local, null).toPush.sessions).toHaveLength(0);
  });
});

describe('duplicate model ids across providers', () => {
  it('charges the highest weight when one id is listed both cheap and expensive', () => {
    // A gateway can offer cheaply what another provider bills for — DeepSeek R1 was listed
    // twice until the frontier guard took it out of the free pool. Taking the first catalog
    // match rather than the dearest would under-charge the credit pool 30x for the paid route,
    // so the guarantee is pinned here against a duplicate injected on purpose.
    catalog.push({ id: 'deepseek/deepseek-r1', provider: 'xkiro', label: 'DeepSeek R1', tier: 'free', weight: CREDIT_WEIGHTS.fast, zeroConfig: true, note: 'test fixture' });
    try {
      expect(catalog.filter(m => m.id === 'deepseek/deepseek-r1').length).toBe(2);
      expect(weightFor('deepseek/deepseek-r1')).toBe(CREDIT_WEIGHTS.reasoning);
      expect(creditsFor('deepseek/deepseek-r1', 1000, 'credits')).toBe(15);
    } finally { catalog.pop(); }
  });
  it('keeps every frontier model out of the shipped free group', () => {
    // The server refuses to fund these; the dropdown must not offer them as free either.
    for (const m of catalog.filter(m => m.zeroConfig)) {
      expect(m.tier).toBe('free');
      expect(m.weight).toBe(CREDIT_WEIGHTS.fast);
      expect(/claude|opus|sonnet|gpt-[45]|[/_.-]r1$/i.test(m.id)).toBe(false);
    }
    for (const id of ['deepseek/deepseek-r1', 'anthropic/claude-3.5-sonnet', 'openai/gpt-4o']) {
      expect(catalog.find(m => m.id === id)?.zeroConfig).toBeFalsy();
    }
  });
  it('leaves single-listed models exactly as before', () => {
    expect(weightFor('z-ai/glm-5.2')).toBe(CREDIT_WEIGHTS.fast);
    expect(weightFor('openai/gpt-4o')).toBe(CREDIT_WEIGHTS.reasoning);
    expect(weightFor('vendor/mystery-model')).toBe(CREDIT_WEIGHTS.standard);
  });
});

describe('payment routing', () => {
  const funded = ['groq/llama-3.3-70b-versatile', 'groq/llama-3.1-8b-instant'];
  it('routes a funded free model through the free tier and never spends the visitor key on it', () => {
    expect(inferenceFor('groq/llama-3.3-70b-versatile', 'byok', funded)).toBe('free');
    expect(inferenceFor('GROQ/LLAMA-3.3-70B-VERSATILE', 'byok', funded)).toBe('free');
  });
  it('routes a free model this host does not fund to the visitor own key', () => {
    // Otherwise the browser would strip the key the request actually needs and the send fails.
    expect(inferenceFor('mistralai/mistral-nemo:free', 'byok', funded)).toBe('byok');
    expect(inferenceFor('mistralai/mistral-nemo:free', 'free', funded)).toBe('byok');
  });
  it('keeps a free model on the free tier before the funded list is known', () => {
    // On first paint /api/providers has not answered; flipping a returning free-tier visitor to
    // BYOK for a frame would ask them for a key they never needed.
    expect(inferenceFor('mistralai/mistral-nemo:free', 'free')).toBe('free');
    expect(inferenceFor('groq/llama-3.1-8b-instant', undefined)).toBe('free');
  });
  it('leaves a pro model on whatever the visitor chose, defaulting to their own key', () => {
    expect(inferenceFor('openai/gpt-4o', 'free', funded)).toBe('byok');
    expect(inferenceFor('openai/gpt-4o', 'credits', funded)).toBe('credits');
    expect(inferenceFor('anthropic/claude-3.5-sonnet', undefined, funded)).toBe('byok');
  });
  it('follows the server, not the compiled catalog, when the two disagree', () => {
    // A deployment can fund a model this build never compiled in, and one it lists as key-only
    // (FREE_TIER_ALLOW_FRONTIER). Billing the visitor for what the host already pays for is the
    // worse of the two errors, so the funded list wins in both directions.
    expect(inferenceFor('vendor/brand-new-model', 'byok', ['vendor/brand-new-model'])).toBe('free');
    expect(inferenceFor('deepseek/deepseek-r1', 'byok', ['deepseek/deepseek-r1'])).toBe('free');
    expect(inferenceFor('groq/llama-3.3-70b-versatile', 'byok', [])).toBe('byok');
  });
});

describe('roster', () => {
  it('puts the safety baseline first in every prompt and keeps five stage skills', () => {
    for (const p of personas) expect(composePrompt(p).startsWith(SAFETY_BASELINE)).toBe(true);
    expect(skills.map(s => s.role)).toEqual(['planner', 'researcher', 'core-architect', 'reviewer', 'queen-coordinator']);
    expect(composePrompt(personaById('reviewer'), personaById('auditor'))).toContain('started by the Financial Auditor');
    expect(personaById('nope').id).toBe('operator'); expect(personaById('browser').tools).toEqual(['inspect_page']);
  });
  it('parses only the documented tool call shape', () => {
    const specs = [inspectPageSpec];
    expect(parseToolCall('TOOL {"tool":"inspect_page","url":"https://a.example"}\n', specs)).toEqual({ tool: 'inspect_page', args: { url: 'https://a.example' } });
    expect(parseToolCall('TOOL {"tool":"inspect_page","args":{"url":"https://b.example"}}', specs)).toEqual({ tool: 'inspect_page', args: { url: 'https://b.example' } });
    expect(parseToolCall('Sure. TOOL {"tool":"inspect_page","url":"x"}', specs)).toBeNull(); expect(parseToolCall('TOOL {"tool":"delete_everything"}', specs)).toBeNull(); expect(parseToolCall('TOOL not json', specs)).toBeNull();
    expect(toolProtocol(specs)).toContain('inspect_page');
    expect(summarizeReport({ url: 'u', status: 200, title: 't', description: 'd', canonical: '', robots: '', lang: 'en', h1: ['H'], headingCount: 1, og: { 'og:title': 'x' }, wordCount: 3, text: 'a b c', links: [{ href: 'h', text: '' }], elapsedMs: 5 })).toContain('(no text) -> h');
  });
  it('turns enabled MCP connections into named chat tools', () => {
    const conn: McpConnection = { id: 'c1', name: 'Shop Orders', url: 'https://mcp.example/orders', token: '', saveToken: false, enabled: true, tools: [{ name: 'lookup_order', description: 'Find an order', inputSchema: { properties: { number: { type: 'string' } }, required: ['number'] } }] };
    const specs = mcpToolSpecs([conn, { ...conn, id: 'c2', enabled: false }]);
    expect(slug('Shop Orders')).toBe('shop_orders'); expect(specs).toHaveLength(1); expect(specs[0].name).toBe('shop_orders.lookup_order'); expect(specs[0].description).toContain('"number": string');
    expect(parseToolCall('TOOL {"tool":"shop_orders.lookup_order","args":{"number":"42"}}', specs)?.args).toEqual({ number: '42' });
  });
});

describe('chat turn', () => {
  const sse = (text: string) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }], usage: { total_tokens: 40 } })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  it('runs the tool loop for the Browser Agent and records the trace', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { calls.push(url); if (url === '/api/browse') return new Response(JSON.stringify({ url: 'https://shop.example', status: 200, title: 'Shop', description: '', canonical: '', robots: '', lang: '', h1: [], headingCount: 0, og: {}, wordCount: 2, text: 'hello world', links: [], elapsedMs: 1 }), { headers: { 'Content-Type': 'application/json' } }); const body = JSON.parse(String(init.body)); return body.messages[1].content.includes('TOOL RESULT') ? sse('The page title is Shop.') : sse('TOOL {"tool":"inspect_page","url":"https://shop.example"}'); }));
    const deltas: string[] = []; const traces: string[] = [];
    const tools = activeTools({ settings: { ...defaultSettings(), web: { enabled: false }, knowledge: { enabled: false } }, mcp: [], knowledge: [], search: retrieve, personaTools: ['inspect_page'] });
    const result = await chatTurn({ connection: { ...defaultConnection('groq'), token: 'k' }, personaId: 'browser', history: [], input: 'Check https://shop.example', attachments: [], knowledge: [], tools, signal: new AbortController().signal, onDelta: t => deltas.push(t), onTool: t => traces.push(t.summary) });
    expect(result.text).toBe('The page title is Shop.'); expect(result.tools).toHaveLength(1); expect(result.tools[0].ok).toBe(true); expect(traces[0]).toContain('Shop'); expect(result.tokens).toBe(80);
    expect(calls).toEqual(['/api/chat', '/api/browse', '/api/chat']); expect(deltas.some(d => d.startsWith('TOOL'))).toBe(false);
  });
  it('stays scripted in preview mode and never calls the network', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const result = await chatTurn({ connection: { mode: 'demo', endpoint: '', model: '', token: '', maxTokens: 512 }, personaId: 'auditor', history: [], input: 'Reconcile March', attachments: [], knowledge: [{ id: 'n', title: 'March ledger', content: 'March totals reconcile to the bank', createdAt: '' }], signal: new AbortController().signal });
    expect(result.text).toContain('SCRIPTED PREVIEW'); expect(result.text).toContain('Financial Auditor'); expect(result.contextTitles).toEqual(['March ledger']); expect(fetchMock).not.toHaveBeenCalled();
  });
});
