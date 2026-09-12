import { afterEach, describe, expect, it, vi } from 'vitest';
import { CREDIT_WEIGHTS, catalog, creditsFor, estimateTokens, tierFor, weightFor } from '../src/lib/catalog';
import { computeBalance, makeEntry, merge, type LedgerEntry, type Session } from '../src/lib/store';
import { DIRECT_MODE_LABEL, SAFETY_BASELINE, businessPersonas, composePrompt, defaultPersonaId, generalPersonas, personaById, personas, skills, workflows } from '../src/lib/roster';
import { clearCustomAgents, createCustomAgent, customAgents, removeCustomAgent, validateDraft } from '../src/lib/customAgents';
import { inspectPageSpec, parseToolCall, summarizeReport, toolProtocol } from '../src/lib/tools';
import { mcpToolSpecs, slug, type McpConnection } from '../src/lib/mcp';
import { activeTools, defaultSettings, parseRepo } from '../src/lib/connectors';
import { retrieve } from '../src/lib/memory';
import { chatTurn } from '../src/lib/chat';
import { complete } from '../src/lib/provider';
import { loadDeployment, offlineDeployment } from '../src/lib/deployment';
import { defaultConnection, emptyKeyring, inferenceFor } from '../src/lib/providers';
import { canPayFor, emptyReason, fundedHere, hasAnyKey, keyedProviders } from '../src/lib/availability';

afterEach(() => vi.unstubAllGlobals());

describe('catalog and credit weights', () => {
  it('maps catalog models and guesses unknown ones conservatively', () => {
    expect(weightFor('groq/llama-3.1-8b-instant')).toBe(CREDIT_WEIGHTS.fast); expect(weightFor('vendor/model-flash')).toBe(CREDIT_WEIGHTS.fast);
    expect(weightFor('deepseek/deepseek-r1')).toBe(CREDIT_WEIGHTS.reasoning); expect(weightFor('anthropic/claude-3.5-haiku')).toBe(CREDIT_WEIGHTS.standard);
    expect(weightFor('vendor/mystery-model')).toBe(CREDIT_WEIGHTS.standard); expect(weightFor('vendor/tiny-3b')).toBe(CREDIT_WEIGHTS.fast); expect(weightFor('vendor/o3-pro')).toBe(CREDIT_WEIGHTS.reasoning);
    // Weights matter only for platform credits. A free-tier run is metered on the server at its
    // own flat rate, so an unlisted gateway model reading as 'pro' here costs a free visitor
    // nothing — which is why the catalog no longer needs an entry per discovered model.
    expect(tierFor('openai/gpt-4o')).toBe('pro'); expect(tierFor('vendor/mystery-model')).toBe('pro'); expect(tierFor('vendor/model-flash')).toBe('free');
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
    catalog.push({ id: 'deepseek/deepseek-r1', provider: 'xkiro', label: 'DeepSeek R1', tier: 'free', weight: CREDIT_WEIGHTS.fast, note: 'test fixture' });
    try {
      expect(catalog.filter(m => m.id === 'deepseek/deepseek-r1').length).toBe(2);
      expect(weightFor('deepseek/deepseek-r1')).toBe(CREDIT_WEIGHTS.reasoning);
      expect(creditsFor('deepseek/deepseek-r1', 1000, 'credits')).toBe(15);
    } finally { catalog.pop(); }
  });
  it('names no free models at all, so it cannot promise one the server will not fund', () => {
    // The whole class of bug this replaces: a compiled list claiming six models were free, none
    // of which the gateway served free, cross-checked only against another copy of itself. The
    // free list now comes from /api/providers and nothing here is allowed to compete with it.
    for (const m of catalog) expect(m.tier).toBe('pro');
    for (const id of ['deepseek/deepseek-chat', 'z-ai/glm-5.2', 'moonshotai/kimi-k2.7-code', 'groq/llama-3.3-70b-versatile', 'openrouter/auto']) {
      expect(catalog.find(m => m.id === id)).toBeUndefined();
    }
  });
  it('leaves single-listed models exactly as before', () => {
    expect(weightFor('openai/gpt-4o')).toBe(CREDIT_WEIGHTS.reasoning);
    expect(weightFor('vendor/mystery-model')).toBe(CREDIT_WEIGHTS.standard);
  });
});

describe('payment routing', () => {
  const funded = ['deepseek/deepseek-v4-flash', 'qwen/qwen3.8-max:free'];
  it('never overrides a mode the visitor chose on purpose', () => {
    // The bug this pins: choosing "Bring your own key" and then picking a model the deployment
    // happens to fund used to strip the key and reroute the request through the host's account.
    // An explicit instruction is not a hint, and a developer testing their own key against a
    // specific provider has a good reason for it.
    expect(inferenceFor('deepseek/deepseek-v4-flash', 'byok', funded)).toBe('byok');
    expect(inferenceFor('DEEPSEEK/DEEPSEEK-V4-FLASH', 'byok', funded)).toBe('byok');
    expect(inferenceFor('deepseek/deepseek-v4-flash', 'credits', funded)).toBe('credits');
    expect(inferenceFor('openai/gpt-4o', 'credits', funded)).toBe('credits');
  });
  it('picks the free tier only when nothing has been chosen yet', () => {
    expect(inferenceFor('deepseek/deepseek-v4-flash', undefined, funded)).toBe('free');
    expect(inferenceFor('anthropic/claude-3.5-sonnet', undefined, funded)).toBe('byok');
  });
  it('moves a free-tier run off a model the deployment has stopped funding', () => {
    // Otherwise the browser sends a keyless request the server will refuse, and the visitor is
    // told the tier is warming up when the real answer is that this model is not on the list.
    expect(inferenceFor('deepseek/deepseek-chat', 'free', funded)).toBe('byok');
    expect(inferenceFor('deepseek/deepseek-v4-flash', 'free', funded)).toBe('free');
    expect(inferenceFor('deepseek/deepseek-v4-flash', 'free', [])).toBe('byok');
  });
  it('changes nothing before the funded list has arrived', () => {
    // On first paint /api/providers has not answered; flipping a returning free-tier visitor to
    // BYOK for a frame would ask them for a key they never needed.
    expect(inferenceFor('deepseek/deepseek-v4-flash', 'free')).toBe('free');
    expect(inferenceFor('anything-at-all', undefined)).toBe('byok');
  });
  it('follows the server rather than any compiled list', () => {
    // A deployment can fund a model this build has never heard of. That is now the normal case:
    // every gateway model is discovered at runtime and none of them appear in the catalog.
    expect(inferenceFor('vendor/brand-new-model', undefined, ['vendor/brand-new-model'])).toBe('free');
    expect(inferenceFor('vendor/brand-new-model', undefined, [])).toBe('byok');
  });
});

describe('what a visitor can pay for', () => {
  const noFree = { enabled: false, models: [], providers: {}, monthlyCredits: 400, perHour: 40 };
  const someFree = { enabled: true, models: ['deepseek/deepseek-v4-flash'], providers: { 'deepseek/deepseek-v4-flash': 'xkiro' }, monthlyCredits: 400, perHour: 40 };
  const reach = (over: Partial<Parameters<typeof keyedProviders>[0]> = {}) => ({ free: noFree, keys: emptyKeyring(), credits: false, ...over });

  it('unlocks a provider the moment its key is typed, and only that provider', () => {
    // The gap this closes: reachability was one boolean taken from the active connection's token,
    // so a key pasted for Anthropic while the connection pointed at the gateway unlocked nothing
    // until you switched provider and saved — with the key sitting visible in the form.
    const r = reach({ keys: { ...emptyKeyring(), anthropic: 'sk-ant-typed' } });
    expect([...keyedProviders(r)]).toEqual(['anthropic']);
    expect(canPayFor('anthropic', r)).toBe(true);
    expect(canPayFor('openrouter', r)).toBe(false);
    expect(canPayFor('groq', r)).toBe(false);
    expect(hasAnyKey(r)).toBe(true);
  });
  it('counts the key in hand before it reaches the ring', () => {
    const r = reach({ token: 'gsk_in-hand', provider: 'groq' as const });
    expect(canPayFor('groq', r)).toBe(true);
    expect(canPayFor('openai', r)).toBe(false);
    // Whitespace is not a key.
    expect(hasAnyKey(reach({ token: '   ', provider: 'groq' as const }))).toBe(false);
    expect(hasAnyKey(reach({ keys: { ...emptyKeyring(), groq: '  ' } }))).toBe(false);
  });
  it('opens every provider on platform credits', () => {
    const r = reach({ credits: true });
    expect(canPayFor('anthropic', r)).toBe(true);
    expect(canPayFor('cohere', r)).toBe(true);
    // Credits are the deployment's budget, not a key of the visitor's.
    expect(hasAnyKey(r)).toBe(false);
  });
  it('never lets the free tier decide who pays', () => {
    // Deliberately absent from this module: a "free beats key" rule. Which budget pays is chosen
    // in Settings and respected verbatim; this answers only whether payment is possible at all.
    const r = reach({ free: someFree });
    expect(canPayFor('xkiro', r)).toBe(false);
    expect(fundedHere('deepseek/deepseek-v4-flash', someFree)).toBe(true);
    expect(fundedHere('DEEPSEEK/DEEPSEEK-V4-FLASH', someFree)).toBe(true);
    expect(fundedHere('  deepseek/deepseek-v4-flash  ', someFree)).toBe(true);
    expect(fundedHere('deepseek/deepseek-chat', someFree)).toBe(false);
    expect(fundedHere('deepseek/deepseek-v4-flash', noFree)).toBe(false);
  });
  it('says which kind of empty it is, because they need different answers', () => {
    // "Nothing is funded and you have no key" and "you have a key but not for this" are the same
    // empty list and different problems. One generic sentence sent people to check a status page
    // when the answer was a missing field.
    expect(emptyReason(reach())).toMatch(/funds no models and you have not added a key/);
    expect(emptyReason(reach({ free: someFree }))).toMatch(/No models are funded here right now/);
    expect(emptyReason(reach({ keys: { ...emptyKeyring(), openai: 'sk-x' } }))).toMatch(/No models match/);
  });
});

describe('a roster that is not opinionated by default', () => {
  it('opens on a general agent, not a business specialist', () => {
    // The workspace used to default to the Operational Executive, so asking for a function got a
    // plan with owners and dates. The neutral agent has to be the one you land on.
    expect(defaultPersonaId).toBe('assistant');
    expect(personaById(defaultPersonaId).group).toBe('general');
    expect(personas[0].group).toBe('general');
    expect(generalPersonas.map(p => p.id)).toEqual(['assistant', 'coder', 'chat']);
  });
  it('tells the general agents not to answer with a plan', () => {
    for (const p of generalPersonas) {
      expect(p.tools ?? []).toEqual([]);
      expect(p.role).toBeUndefined();
    }
    for (const id of ['assistant', 'coder']) {
      const prompt = personaById(id).prompt;
      expect(prompt).toContain('Answer directly');
      expect(prompt).toMatch(/Do not produce a plan/);
    }
    // The Coder must not claim to have run anything, since it cannot.
    expect(personaById('coder').prompt).toMatch(/Never claim to have run, tested, or verified/);
  });
  it('keeps every specialist and every workflow available', () => {
    // Nothing was removed; the ordering changed. A visitor who wants the Financial Auditor still
    // has it, and the five-stage workflows still exist behind the mode selector.
    expect(businessPersonas.map(p => p.id)).toEqual(['operator', 'auditor', 'reputation', 'browser']);
    expect(skills).toHaveLength(5);
    expect(Object.keys(workflows)).toEqual(['build', 'research', 'review']);
    expect(DIRECT_MODE_LABEL).toBe('Direct chat');
  });
});

describe('custom agents', () => {
  afterEach(() => clearCustomAgents());

  it('round-trips a written agent and makes it resolvable by id', () => {
    const created = createCustomAgent({ name: 'Rust reviewer', prompt: 'You review Rust for lifetimes.', role: 'Code review' });
    expect(created.id.startsWith('custom:')).toBe(true);
    expect(created.group).toBe('custom');
    expect(created.custom).toBe(true);
    expect(created.tagline).toBe('Code review');
    // The whole point: every caller holding an id resolves it without being rewired.
    expect(personaById(created.id).name).toBe('Rust reviewer');
    expect(composePrompt(personaById(created.id))).toContain('You review Rust for lifetimes.');
    expect(composePrompt(personaById(created.id)).startsWith(SAFETY_BASELINE)).toBe(true);
    expect(customAgents()).toHaveLength(1);
  });
  it('cannot collide with or shadow a built-in agent', () => {
    const created = createCustomAgent({ name: 'Assistant', prompt: 'Impersonator.', role: '' });
    expect(created.id).not.toBe('assistant');
    // A built-in id still resolves to the built-in, whatever a custom agent calls itself.
    expect(personaById('assistant').group).toBe('general');
    expect(personaById('assistant').prompt).not.toContain('Impersonator');
  });
  it('refuses a draft that is missing the two fields that matter', () => {
    expect(validateDraft({ name: '', prompt: 'x', role: '' })).toMatch(/name/);
    expect(validateDraft({ name: ' ', prompt: 'x', role: '' })).toMatch(/name/);
    expect(validateDraft({ name: 'A', prompt: '  ', role: '' })).toMatch(/system prompt/);
    // A role is a label, so an agent without one still works.
    expect(validateDraft({ name: 'A', prompt: 'Be terse.', role: '' })).toBeNull();
    expect(createCustomAgent({ name: 'A', prompt: 'Be terse.', role: '' }).tagline).toBe('Custom agent');
  });
  it('bounds what it stores, because the prompt reaches a model and the name reaches the screen', () => {
    const created = createCustomAgent({ name: 'N'.repeat(200), prompt: 'P'.repeat(9000), role: 'R'.repeat(200) });
    expect(created.name).toHaveLength(40);
    expect(created.prompt).toHaveLength(4000);
    expect(created.tagline).toHaveLength(60);
  });
  it('deleting one leaves a session that used it readable', () => {
    const created = createCustomAgent({ name: 'Temp', prompt: 'Be brief.', role: '' });
    expect(removeCustomAgent(created.id)).toEqual([]);
    // The old id now resolves to the default rather than throwing or rendering blank.
    expect(personaById(created.id).id).toBe(defaultPersonaId);
  });
});

describe('roster', () => {
  it('puts the safety baseline first in every prompt and keeps five stage skills', () => {
    for (const p of personas) expect(composePrompt(p).startsWith(SAFETY_BASELINE)).toBe(true);
    expect(skills.map(s => s.role)).toEqual(['planner', 'researcher', 'core-architect', 'reviewer', 'queen-coordinator']);
    expect(composePrompt(personaById('reviewer'), personaById('auditor'))).toContain('started by the Financial Auditor');
    expect(personaById('nope').id).toBe(defaultPersonaId); expect(personaById('browser').tools).toEqual(['inspect_page']);
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


describe('plans and checkout', () => {
  // A Subscribe button is a request for money, so the browser filters what it will act on: the
  // server already checks the URL, and checking twice costs nothing next to sending someone who
  // is about to pay somewhere unintended.
  afterEach(() => { vi.unstubAllGlobals(); });
  const reply = (billing: unknown) => new Response(JSON.stringify({ free: { enabled: false, models: [] }, billing }), { headers: { 'Content-Type': 'application/json' } });

  it('keeps a well-formed checkout URL and drops anything else', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ plans: [
      { id: 'starter', name: 'Starter', price: '$12.90', cadence: 'per month', checkout: 'https://buy.stripe.com/starter' },
      { id: 'premium', name: 'Premium', price: '$24.90', cadence: 'per month', checkout: 'http://buy.stripe.com/insecure' },
    ] })));
    const { billing } = await loadDeployment();
    expect(billing.enabled).toBe(true);
    expect(billing.plans[0].checkout).toBe('https://buy.stripe.com/starter');
    expect(billing.plans[1].checkout).toBeNull();
    expect(billing.plans[1].price).toBe('$24.90');
  });

  it('waits out a deployment that is still waking instead of giving up on it', async () => {
    // The bug this pins: on a free-plan instance the first request wakes the server and can take
    // longer than one timeout allows. A single attempt then reported the deployment unreachable,
    // and the app dropped into the scripted preview for the whole session over a cold start.
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error('timeout');
      return reply(undefined);
    }));
    const retries: number[] = [];
    const d = await loadDeployment(undefined, { onRetry: n => retries.push(n), sleep: async () => {} });
    expect(calls).toBe(3);
    expect(retries).toEqual([1, 2]);
    expect(d.reachable).toBe(true);
  });
  it('gives up after the last attempt and reports itself unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const d = await loadDeployment(undefined, { attempts: 2, sleep: async () => {} });
    expect(d).toEqual(offlineDeployment);
    // reachable false is the flag App uses to keep the connection alone rather than force demo mode.
    expect(d.reachable).toBe(false);
  });
  it('does not retry into a closed tab', async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => { calls++; throw new Error('aborted'); }));
    await loadDeployment(controller.signal, { attempts: 5, sleep: async () => {} });
    expect(calls).toBe(1);
  });

  it('treats a deployment with no checkout as not selling anything', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ plans: [{ id: 'starter', name: 'Starter', price: '$12.90', cadence: 'per month', checkout: null }] })));
    expect((await loadDeployment()).billing.enabled).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => reply(undefined)));
    expect((await loadDeployment()).billing).toEqual({ enabled: false, plans: [] });
    vi.stubGlobal('fetch', vi.fn(async () => reply('nonsense')));
    expect((await loadDeployment()).billing.plans).toEqual([]);
  });

  it('falls back to a deployment that sells nothing when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    // `sleep` is stubbed because the real backoff waits out a waking instance, which is the point
    // of it and not something a unit test should sit through.
    const d = await loadDeployment(undefined, { sleep: async () => {} });
    expect(d.reachable).toBe(false);
    expect(d.billing.enabled).toBe(false);
  });
});

describe('native provider stream shapes', () => {
  // Anthropic's SSE is not the OpenAI one and never sends [DONE] — message_stop terminates it,
  // and the token count arrives in two halves. Parsed as an OpenAI stream it yields no text and
  // then fails as "ended before completion", so this pins the normalization.
  afterEach(() => { vi.unstubAllGlobals(); });
  it('reads text and both halves of the token count from an Anthropic stream', async () => {
    const events = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":11}}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":" there"}}',
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":4}}',
      'event: message_stop\ndata: {"type":"message_stop"}',
    ].join('\n\n') + '\n\n';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(events, { headers: { 'Content-Type': 'text/event-stream' } })));
    const result = await complete({ ...defaultConnection('anthropic'), token: 'sk-ant' }, 'be brief', 'hi', new AbortController().signal);
    expect(result.text).toBe('Hello there');
    expect(result.tokens).toBe(15);
  });
});

describe('the provider keyring', () => {
  // A visitor who already pays OpenAI and Anthropic holds two keys, not one. Keys were always
  // stored per provider; what was missing was a way to enter more than the active one.
  //
  // Each case reloads the module after writing, because the round trip being tested is through
  // localStorage — an in-process cache answering from memory would prove nothing about what a
  // returning visitor gets.
  function stubStorage() {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => { data.set(k, v); },
      removeItem: (k: string) => { data.delete(k); },
    });
    return data;
  }
  const reload = async () => { vi.resetModules(); return import('../src/lib/providers'); };
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('keeps one key per provider and hands each back to its own provider', async () => {
    stubStorage();
    (await reload()).saveKeyring({ openai: 'sk-openai', anthropic: 'sk-ant', google: 'goog' });
    const fresh = await reload();
    const ring = fresh.loadKeyring();
    expect(ring.openai).toBe('sk-openai');
    expect(ring.anthropic).toBe('sk-ant');
    expect(ring.groq).toBe('');
    // Switching to a provider picks up that provider's key, so the model decides which is spent.
    expect(fresh.switchProvider(fresh.defaultConnection('groq'), 'anthropic').token).toBe('sk-ant');
    expect(fresh.switchProvider(fresh.defaultConnection('groq'), 'openai').token).toBe('sk-openai');
  });

  it('clears the stored key rather than remembering an empty one', async () => {
    const data = stubStorage();
    const mod = await reload();
    mod.saveKeyring({ openai: 'sk-openai' });
    mod.saveKeyring({ openai: '   ' });
    expect((await reload()).loadKeyring().openai).toBe('');
    expect(JSON.parse(data.get('ft-provider-openai') ?? '{}')).not.toHaveProperty('token');
  });

  it('writes nothing when the visitor declines to be remembered', async () => {
    const data = stubStorage();
    const mod = await reload();
    mod.saveKeyring({ openai: 'sk-openai', anthropic: 'sk-ant' });
    mod.saveKeyring(mod.emptyKeyring());
    for (const id of Object.keys(mod.providers)) expect(data.get(`ft-provider-${id}`) ?? '').not.toContain('sk-');
  });

  it('reaches each vendor at its own endpoint', () => {
    // The point of a direct key is that the vendor bills the visitor. Routing OpenAI through an
    // aggregator would bill somewhere else entirely.
    expect(defaultConnection('openai').endpoint).toBe('https://api.openai.com/v1');
    expect(defaultConnection('anthropic').endpoint).toBe('https://api.anthropic.com/v1');
    expect(defaultConnection('google').endpoint).toContain('generativelanguage.googleapis.com');
  });
});
