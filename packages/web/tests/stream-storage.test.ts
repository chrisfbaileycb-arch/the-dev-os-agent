import { afterEach, describe, expect, it, vi } from 'vitest';
import { sseEvents, complete } from '../src/lib/provider';
import { clearProviderStorage, defaultConnection, persistConnection, initialProvider, switchProvider, forgetKeys, loadConnection, effectiveOutputLimit } from '../src/lib/providers';
const encoder = new TextEncoder();
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('incremental streaming edge cases', () => {
  it('decodes split UTF-8, CRLF, comments and multi-line events', async () => {
    const bytes = encoder.encode(': heartbeat\r\nevent: token\r\ndata: {"text":\r\ndata: "🌐"}\r\n\r\ndata: [DONE]\r\n\r\n');
    const stream = new ReadableStream<Uint8Array>({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } });
    const events = []; for await (const event of sseEvents(stream)) events.push(event);
    expect(events).toEqual([{event:'token',data:'{"text":\n"🌐"}'},{event:'',data:'[DONE]'}]);
  });
  it('rejects in-stream provider errors', async () => { vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('event: error\ndata: {"error":{"message":"sensitive upstream content"}}\n\n',{headers:{'Content-Type':'text/event-stream'}}))); await expect(complete(defaultConnection('groq'),'s','p',new AbortController().signal)).rejects.toThrow('Provider reported a streaming error'); });
  it('does not start requests for an already aborted operation',async()=>{const call=vi.fn();vi.stubGlobal('fetch',call);const c=new AbortController();c.abort();await expect(complete(defaultConnection('groq'),'s','p',c.signal)).rejects.toThrow();expect(call).not.toHaveBeenCalled();});

  it('keeps a healthy build alive beyond ten minutes, including provider heartbeat gaps', async () => {
    vi.useFakeTimers();
    let stream!: ReadableStreamDefaultController<Uint8Array>; let requestSignal!: AbortSignal;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      requestSignal = init.signal as AbortSignal;
      const body = new ReadableStream<Uint8Array>({ start(c) { stream = c; requestSignal.addEventListener('abort', () => c.error(requestSignal.reason)); } });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    }));
    const pending = complete(defaultConnection('anthropic'), 'system', 'build', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    stream.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Finished build"}}]}\n\n'));
    for (let i = 0; i < 7; i++) {
      await vi.advanceTimersByTimeAsync(100_000);
      expect(requestSignal.aborted).toBe(false);
      stream.enqueue(encoder.encode(': provider heartbeat\n\n'));
    }
    stream.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')); stream.close();
    expect((await pending).text).toBe('Finished build');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops a silent provider instead of waiting indefinitely for a larger reply', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => new Response(new ReadableStream<Uint8Array>({ start(c) { init.signal!.addEventListener('abort', () => c.error(init.signal!.reason)); } }), { headers: { 'content-type': 'text/event-stream' } })));
    const pending = expect(complete(defaultConnection(), 'system', 'build', new AbortController().signal)).rejects.toThrow('Provider request timed out');
    await vi.advanceTimersByTimeAsync(126_000); await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
});
describe('per-provider browser key storage', () => {
  function setup() { const values = new Map<string,string>(); vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)}); clearProviderStorage(); return values; }
  it('does not persist keys unless explicitly enabled and never persists server access tokens',()=>{const values=setup();persistConnection({...defaultConnection('groq'),token:'user-secret',serverAccessToken:'server-access'});expect(values.get('ft-provider-groq')).not.toContain('user-secret');expect(values.get('ft-provider-groq')).not.toContain('server-access');});
  it('persists opted-in keys separately and remembers active provider',()=>{const values=setup();persistConnection({...defaultConnection('groq'),token:'user-secret',saveKey:true});expect(JSON.parse(values.get('ft-provider-groq')!).token).toBe('user-secret');expect(initialProvider().provider).toBe('groq');const openrouter=switchProvider(initialProvider(),'openrouter');expect(openrouter.token).toBe('');});
  it('removes saved keys when persistence is disabled',()=>{const values=setup();persistConnection({...defaultConnection('groq'),token:'user-secret',saveKey:true});persistConnection({...defaultConnection('groq'),token:'user-secret',saveKey:false});expect(values.get('ft-provider-groq')).not.toContain('user-secret');});
  it('forget all clears keys without changing active provider',()=>{const values=setup();persistConnection({...defaultConnection('groq'),token:'groq-test',saveKey:true});persistConnection({...defaultConnection('cohere'),token:'cohere-test',saveKey:true});forgetKeys();expect(values.get('ft-active-provider')).toBe('cohere');expect([...values.values()].join(' ')).not.toContain('groq-test');expect([...values.values()].join(' ')).not.toContain('cohere-test');});
});

describe('loadConnection', () => {
  function setup() { const values = new Map<string,string>(); vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)}); clearProviderStorage(); return values; }

  it('returns default connection when nothing is in localStorage', () => {
    setup();
    const conn = loadConnection('openai');
    expect(conn).toEqual(defaultConnection('openai'));
  });

  it('recovers gracefully from invalid JSON in localStorage', () => {
    const storage = setup();
    storage.set('ft-provider-openai', '{ invalid json ');
    const conn = loadConnection('openai');
    expect(conn).toEqual(defaultConnection('openai'));
  });

  it('merges stored model properly and preserves endpoint unless custom', () => {
    const storage = setup();
    storage.set('ft-provider-openai', JSON.stringify({ model: 'gpt-4o', endpoint: 'https://hacked.com' }));
    const conn = loadConnection('openai');
    expect(conn.model).toBe('gpt-4o');
    expect(conn.endpoint).toBe('https://api.openai.com/v1'); // Default endpoint preserved
  });

  it('allows custom endpoints for custom provider', () => {
    const storage = setup();
    storage.set('ft-provider-custom', JSON.stringify({ model: 'my-model', endpoint: 'https://my-custom.com' }));
    const conn = loadConnection('custom');
    expect(conn.endpoint).toBe('https://my-custom.com');
  });

  it('validates inference mode, defaulting to byok if invalid', () => {
    const storage = setup();
    storage.set('ft-provider-groq', JSON.stringify({ inference: 'free' }));
    expect(loadConnection('groq').inference).toBe('free');

    storage.set('ft-provider-groq', JSON.stringify({ inference: 'not-a-mode' }));
    expect(loadConnection('groq').inference).toBe('byok');
  });

  it('validates maxTokens, keeping valid ones and defaulting invalid ones', () => {
    const storage = setup();
    storage.set('ft-provider-anthropic', JSON.stringify({ maxTokens: 4096 }));
    expect(loadConnection('anthropic').maxTokens).toBe(4096);

    storage.set('ft-provider-anthropic', JSON.stringify({ maxTokens: 1337 }));
    expect(loadConnection('anthropic').maxTokens).toBe(16384);
    // The old 1,024 default was too short for a complete app; a saved 1,024 is upgraded.
    storage.set('ft-provider-anthropic', JSON.stringify({ maxTokens: 1024 }));
    expect(loadConnection('anthropic').maxTokens).toBe(16384);
    storage.set('ft-provider-anthropic', JSON.stringify({ maxTokens: 8192 }));
    expect(loadConnection('anthropic').maxTokens).toBe(16384);
  });

  it('uses the backend cap for a saved default, retaining explicit shorter and custom reply limits', () => {
    const storage = setup();
    storage.set('ft-provider-anthropic', JSON.stringify({ inference: 'free', maxTokens: 8192 }));
    const migrated = loadConnection('anthropic');
    expect(effectiveOutputLimit(migrated, 65000)).toBe(65000);
    const shorter = { ...migrated, maxTokens: 8192, customOutputLimit: true };
    const reload = () => { const saved = storage.get('ft-provider-anthropic')!; clearProviderStorage(); storage.set('ft-provider-anthropic', saved); return loadConnection('anthropic'); };
    persistConnection(shorter);
    expect(effectiveOutputLimit(reload(), 65000)).toBe(8192);
    persistConnection({ ...shorter, maxTokens: 65000 });
    expect(reload().maxTokens).toBe(65000);
    expect(effectiveOutputLimit({ ...migrated, inference: 'credits' }, 32768)).toBe(32768);
    expect(effectiveOutputLimit({ ...migrated, model: 'gpt-4o' }, 65000)).toBe(16384);
    expect(effectiveOutputLimit({ ...migrated, inference: 'byok' }, 65000)).toBe(16384);
  });

  it('loads token only if saveKey is true', () => {
    const storage = setup();
    storage.set('ft-provider-cohere', JSON.stringify({ saveKey: true, token: 'my-secret' }));
    expect(loadConnection('cohere').token).toBe('my-secret');

    storage.set('ft-provider-cohere', JSON.stringify({ saveKey: false, token: 'my-secret' }));
    expect(loadConnection('cohere').token).toBe('');
  });
});
