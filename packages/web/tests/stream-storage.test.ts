import { afterEach, describe, expect, it, vi } from 'vitest';
import { sseEvents, complete } from '../src/lib/provider';
import { clearProviderStorage, defaultConnection, persistConnection, initialProvider, switchProvider, forgetKeys, loadConnection } from '../src/lib/providers';
const encoder = new TextEncoder();
afterEach(() => vi.unstubAllGlobals());
describe('incremental streaming edge cases', () => {
  it('decodes split UTF-8, CRLF, comments and multi-line events', async () => {
    const bytes = encoder.encode(': heartbeat\r\nevent: token\r\ndata: {"text":\r\ndata: "🌐"}\r\n\r\ndata: [DONE]\r\n\r\n');
    const stream = new ReadableStream<Uint8Array>({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } });
    const events = []; for await (const event of sseEvents(stream)) events.push(event);
    expect(events).toEqual([{event:'token',data:'{"text":\n"🌐"}'},{event:'',data:'[DONE]'}]);
  });
  it('rejects in-stream provider errors', async () => { vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('event: error\ndata: {"error":{"message":"sensitive upstream content"}}\n\n',{headers:{'Content-Type':'text/event-stream'}}))); await expect(complete(defaultConnection('groq'),'s','p',new AbortController().signal)).rejects.toThrow('Provider reported a streaming error'); });
  it('does not start requests for an already aborted operation',async()=>{const call=vi.fn();vi.stubGlobal('fetch',call);const c=new AbortController();c.abort();await expect(complete(defaultConnection('groq'),'s','p',c.signal)).rejects.toThrow();expect(call).not.toHaveBeenCalled();});
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
    expect(loadConnection('anthropic').maxTokens).toBe(1024);
  });

  it('loads token only if saveKey is true', () => {
    const storage = setup();
    storage.set('ft-provider-cohere', JSON.stringify({ saveKey: true, token: 'my-secret' }));
    expect(loadConnection('cohere').token).toBe('my-secret');

    storage.set('ft-provider-cohere', JSON.stringify({ saveKey: false, token: 'my-secret' }));
    expect(loadConnection('cohere').token).toBe('');
  });
});
