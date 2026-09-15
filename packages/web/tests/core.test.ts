import { describe, expect, it, vi } from 'vitest';
import { Agent } from '../src/vendor/ruflo/agent';
import { Task } from '../src/vendor/ruflo/task';
import { safeJsonParse } from '../src/vendor/ruflo/json-security';
import { makeTasks, executeRun, selectAgent } from '../src/lib/orchestrator';
import { retrieve, PromptCache } from '../src/lib/memory';
import { complete, listModels, ProviderError, validateEndpoint } from '../src/lib/provider';
import { providers, defaultConnection } from '../src/lib/providers';
import { catalog, findModel, weightFor } from '../src/lib/catalog';
import { inferenceFor } from '../src/lib/providers';
import { exportRun } from '../src/lib/storage';
import type { StartMessage, Run } from '../src/lib/types';
const message = (): StartMessage => ({ type: 'start', runId: crypto.randomUUID(), goal: 'Design browser knowledge search', workflow: 'build', connection: { mode: 'remote', endpoint: 'https://api.example.com/v1', model: 'test-model', token: 'never-export-this-token', maxTokens: 512 }, knowledge: [{ id: 'note', title: 'Browser knowledge', content: 'Use keyword search for the first version.', createdAt: new Date().toISOString() }] });

describe('Ruflo browser adaptation', () => {
  it('keeps lifecycle transitions and dependencies', () => { const t = Task.create({ title: 'test', description: '', type: 'review', dependencies: ['previous'] }); expect(t.areDependenciesSatisfied(new Set())).toBe(false); expect(t.areDependenciesSatisfied(new Set(['previous']))).toBe(true); expect(() => t.start()).toThrow(); t.queue(); t.assign('agent'); t.start(); t.complete('done'); expect(t.status).toBe('completed'); expect(t.output).toBe('done'); });
  it('matches agents by capability', () => { const agents = ['planning', 'review'].map(type => Agent.create({ name: type, role: 'custom', domain: 'browser', capabilities: [type] })); const t = Task.create({ title: 'review', description: '', type: 'review' }); expect(selectAgent(agents, t)?.name).toBe('review'); });
  it('builds a five-stage dependency graph', () => { for (const workflow of ['build', 'research', 'review'] as const) { const tasks = makeTasks(workflow); expect(tasks).toHaveLength(5); expect(tasks[1].dependencies).toEqual([tasks[0].id]); expect(tasks[3].dependencies).toEqual([tasks[1].id, tasks[2].id]); } });
  it('strips dangerous object keys', () => { const value = safeJsonParse<{ safe: number }>(' {"safe":1,"__proto__":{"polluted":true},"constructor":{},"nested":{"prototype":1}} '); expect(value.safe).toBe(1); expect(Object.hasOwn(value, '__proto__')).toBe(false); expect(Object.hasOwn(value, 'constructor')).toBe(false); });
});

describe('memory', () => {
  it('retrieves matching notes but not irrelevant notes', () => { const docs = message().knowledge; expect(retrieve('browser search', docs)).toHaveLength(1); expect(retrieve('gardening', docs)).toHaveLength(0); });
  it('evicts the least recently used exact prompt', () => { const cache = new PromptCache(2); cache.set('a', 'A'); cache.set('b', 'B'); expect(cache.get('a')).toBe('A'); cache.set('c', 'C'); expect(cache.get('b')).toBeUndefined(); cache.clear(); expect(cache.get('a')).toBeUndefined(); });
});

describe('AIHubMix provider', () => {
  // A subsidized OpenAI-compatible gateway added alongside the others: free models on the
  // visitor's own key, never the deployment's allowance.
  it('is registered with its fixed endpoint and free-model seeds', () => {
    expect(providers.aihubmix).toBeDefined();
    expect(providers.aihubmix.endpoint).toBe('https://aihubmix.com/v1');
    expect(providers.aihubmix.models.length).toBeGreaterThan(0);
    expect(providers.aihubmix.models.every(m => m.endsWith('-free'))).toBe(true);
  });

  it('builds a default connection like any named provider', () => {
    const c = defaultConnection('aihubmix');
    expect(c.provider).toBe('aihubmix');
    expect(c.endpoint).toBe('https://aihubmix.com/v1');
    expect(c.model).toBe('gpt-5.5-free');
  });

  it('carries catalog entries that resolve by id and price as fast models', () => {
    expect(findModel('coding-glm-5.1-free')?.provider).toBe('aihubmix');
    // Tier 'free' is reserved for deployment-funded ids (see workspace.test.ts). AIHubMix models
    // are free on the visitor's own key, which is exactly what 'byok' means; they would answer
    // 401 without that key, so they must never read as zero-config.
    expect(findModel('gpt-5.5-free')?.tier).toBe('byok');
    expect(weightFor('gpt-5.5-free')).toBe(0.5);
    expect(catalog.filter(m => m.provider === 'aihubmix').every(m => m.tier === 'byok')).toBe(true);
    expect(catalog.filter(m => m.provider === 'aihubmix').length).toBeGreaterThanOrEqual(8);
  });

  it('is never treated as free-tier funded: its models bill the visitor key', () => {
    // The deployment funds xKiro gateway ids, not AIHubMix ones, so an unchosen mode resolves
    // to BYOK — and a deliberate 'byok' or 'credits' is returned untouched.
    expect(inferenceFor('gpt-5.5-free', undefined, ['kimi-for-coding-free'])).toBe('byok');
    expect(inferenceFor('gpt-5.5-free', 'byok', ['kimi-for-coding-free'])).toBe('byok');
    expect(inferenceFor('gpt-5.5-free', 'credits', [])).toBe('credits');
  });
});

describe('Hugging Face provider', () => {
  // HF's Inference Providers router: one token pays every underlying host for hundreds of
  // open-weights models, with a small monthly credit on every HF account. Same BYOK shape
  // as AIHubMix — free on the visitor's key, never the deployment's allowance.
  it('is registered with the router endpoint and open-model seeds', () => {
    expect(providers.huggingface).toBeDefined();
    expect(providers.huggingface.endpoint).toBe('https://router.huggingface.co/v1');
    expect(providers.huggingface.models.length).toBeGreaterThan(0);
    expect(providers.huggingface.models.every(m => m.includes('/'))).toBe(true); // HF ids are namespaced like org/model
  });

  it('builds a default connection like any named provider', () => {
    const c = defaultConnection('huggingface');
    expect(c.provider).toBe('huggingface');
    expect(c.endpoint).toBe('https://router.huggingface.co/v1');
    expect(c.model).toBe('Qwen/Qwen2.5-7B-Instruct'); // low-compute serverless models lead the seed
  });

  it('carries catalog entries that resolve by id and classify sensibly', () => {
    expect(findModel('openai/gpt-oss-120b')?.provider).toBe('huggingface');
    // Small serverless models are 'byok' — free on the token's monthly credit, still a token.
    expect(findModel('Qwen/Qwen2.5-7B-Instruct')?.tier).toBe('byok');
    expect(findModel('meta-llama/Llama-3.1-8B-Instruct')?.tier).toBe('byok');
    // Reasoning stays 'pro': the deployment never funds a chain-of-thought by default.
    expect(findModel('deepseek-ai/DeepSeek-R1:auto')?.tier).toBe('pro');
    expect(weightFor('meta-llama/Llama-3.1-8B-Instruct')).toBe(0.5); // small open model reads as fast
    expect(weightFor('deepseek-ai/DeepSeek-R1:auto')).toBe(15); // reasoning weights ride the model name, not the vendor
    expect(catalog.filter(m => m.provider === 'huggingface').length).toBeGreaterThanOrEqual(6);
  });

  it('is never treated as deployment-funded free tier', () => {
    expect(inferenceFor('openai/gpt-oss-120b', undefined, ['some-gateway-id'])).toBe('byok');
    expect(inferenceFor('deepseek-ai/DeepSeek-R1:fastest', 'byok', [])).toBe('byok');
  });
});

describe('OmniRoute provider', () => {
  it('keeps OmniRoute as an unconfigured future adapter', () => {
    expect(providers.omniroute).toBeDefined();
    expect(providers.omniroute.endpoint).toBe('');
    expect(providers.omniroute.models).toEqual([]);
  });

  it('builds an empty default connection until the future adapter is configured', () => {
    const c = defaultConnection('omniroute');
    expect(c.provider).toBe('omniroute');
    expect(c.endpoint).toBe('');
    expect(c.model).toBe('');
  });

  it('keeps future OmniRoute catalog entries non-free and non-customer-selectable', () => {
    // Cost depends on a future operator installation, so these entries cannot claim a customer
    // price classification. The picker deliberately omits the disabled adapter from its groups.
    expect(findModel('auto')?.provider).toBe('omniroute');
    expect(findModel('auto')?.tier).toBe('pro');
    expect(findModel('auto/coding')?.tier).toBe('pro');
    expect(weightFor('auto/fast')).toBe(3);
    expect(catalog.filter(m => m.provider === 'omniroute').every(m => m.tier === 'pro')).toBe(true);
  });

  it('is never treated as deployment-funded from the client side', () => {
    // /api/providers is the only thing that can fund an id here — the operator's server list —
    // so the client inferenceFor() never reaches that conclusion from the name.
    expect(inferenceFor('auto', undefined, ['kimi-for-coding-free'])).toBe('byok');
    expect(inferenceFor('auto', 'byok', [])).toBe('byok');
  });
});

describe('streaming provider client', () => {
  it.each(['https://user:secret@api.example.com/v1', 'https://api.example.com/v1?key=secret', 'file:///tmp/test'])('rejects invalid base URL %s', endpoint => { expect(() => validateEndpoint(endpoint)).toThrow(); });
  it('accepts bridge URLs for server-side validation', () => { expect(validateEndpoint('http://localhost:11434/v1/')).toBe('http://localhost:11434/v1'); });
  it('streams text deltas through the unified proxy', async () => {
    const events = 'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\ndata: {"choices":[{"delta":{"content":"world"},"finish_reason":"stop"}],"usage":{"total_tokens":7}}\n\ndata: [DONE]\n\n';
    const mock = vi.fn().mockResolvedValue(new Response(events, { headers: { 'Content-Type': 'text/event-stream' } })); vi.stubGlobal('fetch',mock);
    try { const deltas: string[] = []; const result = await complete(message().connection,'system','goal',new AbortController().signal,text=>deltas.push(text)); expect(result).toEqual({text:'Hello world',tokens:7}); expect(deltas).toEqual(['Hello ','Hello world']); const [url, init] = mock.mock.calls[0]; expect(url).toBe('/api/chat'); expect(init.redirect).toBe('error'); expect(JSON.parse(init.body).provider).toBe('custom'); expect(JSON.parse(init.body).messages).toHaveLength(2); } finally { vi.unstubAllGlobals(); }
  });
  it('normalizes native Cohere streaming events', async () => { const events = 'event: content-delta\ndata: {"type":"content-delta","delta":{"message":{"content":{"text":"Cohere text"}}}}\n\nevent: message-end\ndata: {"type":"message-end","delta":{"usage":{"tokens":{"input_tokens":4,"output_tokens":3}}}}\n\n'; vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(events,{headers:{'Content-Type':'text/event-stream'}}))); try { expect(await complete({...message().connection,provider:'cohere'},'s','p',new AbortController().signal)).toEqual({text:'Cohere text',tokens:7}); } finally { vi.unstubAllGlobals(); } });
  it.each([401,429])('handles HTTP %s without crashing',async status=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status})));try{await expect(complete(message().connection,'s','p',new AbortController().signal)).rejects.toBeInstanceOf(ProviderError);}finally{vi.unstubAllGlobals();}});
  it('rejects truncated streams',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',{headers:{'Content-Type':'text/event-stream'}})));try{await expect(complete(message().connection,'s','p',new AbortController().signal)).rejects.toThrow('ended before completion');}finally{vi.unstubAllGlobals();}});
  it('loads models through the same-origin proxy', async () => { const mock=vi.fn().mockResolvedValue(new Response(JSON.stringify({data:[{id:'test-model'},{id:2},{id:'named',label:'Named',free:true}]}))); vi.stubGlobal('fetch',mock); try { expect(await listModels(message().connection,new AbortController().signal)).toEqual([{id:'test-model'},{id:'named',label:'Named',free:true}]);expect(mock.mock.calls[0][0]).toBe('/api/models'); } finally { vi.unstubAllGlobals(); } });
});

describe('worker orchestration', () => {
  it('runs real dependency order with two parallel specialists', async () => { let active = 0; let peak = 0; const prompts: string[] = []; const snapshots: Run[] = []; const call = vi.fn(async (_c, _s, prompt) => { active++; peak = Math.max(peak, active); prompts.push(prompt); await new Promise(r => setTimeout(r, 5)); active--; return { text: `output-${prompts.length}`, tokens: 10 }; }); const run = await executeRun(message(), new AbortController().signal, r => snapshots.push(r), call); expect(run.status).toBe('completed'); expect(run.steps.every(s => s.status === 'completed')).toBe(true); expect(peak).toBe(2); expect(run.calls).toBe(5); expect(run.tokens).toBe(50); expect(run.contextTitles).toEqual(['Browser knowledge']); expect(prompts[3]).toContain('Analyze requirements:'); expect(prompts[3]).toContain('Design the solution:'); expect(exportRun(run)).not.toContain('never-export-this-token'); expect(JSON.stringify(snapshots)).not.toContain('never-export-this-token'); });
  it('does not retry non-retryable failures', async () => { const call = vi.fn(async () => { throw new ProviderError('Authorization failed'); }); const run = await executeRun(message(), new AbortController().signal, () => {}, call); expect(run.status).toBe('failed'); expect(call).toHaveBeenCalledTimes(1); expect(run.steps[0].status).toBe('failed'); expect(run.steps.slice(1).every(s => s.status === 'cancelled')).toBe(true); });
  it('retries transient failures within the two-attempt limit', async () => { let count = 0; const call = vi.fn(async () => { if (++count === 1) throw new ProviderError('Temporary outage', true); return { text: 'ok', tokens: 1 }; }); const run = await executeRun(message(), new AbortController().signal, () => {}, call); expect(run.status).toBe('completed'); expect(run.calls).toBe(6); expect(run.steps[0].attempts).toBe(1); });
  it('stops after bounded transient retries', async () => { const call = vi.fn(async () => { throw new ProviderError('Temporary outage', true); }); const run = await executeRun(message(), new AbortController().signal, () => {}, call); expect(run.status).toBe('failed'); expect(call).toHaveBeenCalledTimes(2); });
  it('cancels active and downstream work', async () => { const controller = new AbortController(); const call = vi.fn(async () => { controller.abort(new DOMException('Stopped', 'AbortError')); throw controller.signal.reason; }); const run = await executeRun(message(), controller.signal, () => {}, call); expect(run.status).toBe('cancelled'); expect(run.steps.every(s => s.status === 'cancelled')).toBe(true); expect(call).toHaveBeenCalledTimes(1); });
  it('always executes workflow stages through the live provider callback', async () => {
    const input = message();
    const call = vi.fn(async () => ({ text: 'live provider output', tokens: 1 }));
    const run = await executeRun(input, new AbortController().signal, () => {}, call);
    expect(run.status).toBe('completed');
    expect(run.calls).toBe(5);
    expect(run.tokens).toBe(5);
    expect(call).toHaveBeenCalled();
    expect(run.steps.every(s => s.output === 'live provider output')).toBe(true);
  });
});
