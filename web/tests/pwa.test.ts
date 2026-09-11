import { describe, expect, it } from 'vitest';
// @ts-expect-error Build helper is JavaScript and shared with vite.config.ts.
import { buildShellWorker } from '../pwa/build-worker.mjs';

type Handler = (event: { request: { url: string; method: string; mode: string }; respondWith: (r: Promise<Response> | Response) => void; waitUntil: (p: Promise<unknown>) => void }) => void;
const origin = 'https://app.example';
const request = (path: string, mode = 'no-cors', method = 'GET') => ({ url: origin + path, method, mode });

// Boots the generated worker with a fake ServiceWorkerGlobalScope and Cache API so routing can be asserted.
function boot(source: string, fetchImpl: (input: { url: string }) => Promise<Response>) {
  const handlers: Record<string, Handler> = {};
  const store = new Map<string, Response>();
  const key = (r: { url: string } | string) => (typeof r === 'string' ? r : r.url);
  const cache = { addAll: async (urls: string[]) => { for (const u of urls) store.set(u, new Response('shell:' + u)); }, put: async (r: { url: string }, res: Response) => { store.set(r.url, res); }, match: async (r: { url: string } | string) => store.get(key(r)) };
  const deleted: string[] = [];
  const caches = { open: async () => cache, match: async (r: { url: string } | string) => store.get(key(r)), keys: async () => ['shell-old', 'shell-' + version(source)], delete: async (k: string) => { deleted.push(k); return true; } };
  const self = { addEventListener: (type: string, fn: Handler) => { handlers[type] = fn; }, registration: { scope: origin + '/' }, location: { origin }, skipWaiting: async () => undefined, clients: { claim: async () => undefined } };
  new Function('self', 'caches', 'fetch', source)(self, caches, fetchImpl);
  return { handlers, store, deleted };
}
const version = (source: string) => /const VERSION = '([0-9a-f]+)'/.exec(source)![1];
async function dispatch(handler: Handler, req: ReturnType<typeof request>) {
  let response: Promise<Response> | undefined; const waits: Promise<unknown>[] = [];
  handler({ request: req, respondWith: r => { response = Promise.resolve(r); }, waitUntil: p => { waits.push(p); } });
  await Promise.all(waits); return response ? await response : undefined;
}

describe('shell worker build', () => {
  it('precaches the static shell plus every emitted script and stylesheet', () => {
    const { shell, version: v, source } = buildShellWorker(['index.html', 'assets/index-abc123.js', 'assets/index-abc123.css', 'assets/swarm.worker-def456.js', 'icons/icon-192.png', 'licenses/RUFLO-MIT.txt']);
    expect(shell).toEqual(expect.arrayContaining(['index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'assets/index-abc123.js', 'assets/index-abc123.css', 'assets/swarm.worker-def456.js']));
    expect(shell).not.toContain('licenses/RUFLO-MIT.txt');
    expect(v).toMatch(/^[0-9a-f]{12}$/); expect(source).toContain(`'shell-' + VERSION`); expect(source).not.toContain('__SHELL__');
  });
  it('changes version when the bundle changes and stays stable otherwise', () => {
    const a = buildShellWorker(['assets/index-1.js']); const b = buildShellWorker(['assets/index-1.js']); const c = buildShellWorker(['assets/index-2.js']);
    expect(a.version).toBe(b.version); expect(a.version).not.toBe(c.version);
  });
});

describe('shell worker routing', () => {
  const { source } = buildShellWorker(['assets/index-1.js', 'assets/swarm.worker-2.js']);
  it('caches the shell on install and purges old caches on activate', async () => {
    const { handlers, store, deleted } = boot(source, async () => new Response('net'));
    await dispatch(handlers.install, request('/'));
    expect([...store.keys()]).toEqual(expect.arrayContaining([origin + '/index.html', origin + '/manifest.webmanifest', origin + '/assets/index-1.js', origin + '/assets/swarm.worker-2.js']));
    await dispatch(handlers.activate, request('/'));
    expect(deleted).toEqual(['shell-old']);
  });
  it('never intercepts the API, other origins, or non-GET requests', async () => {
    const { handlers } = boot(source, async () => { throw new Error('must not fetch'); });
    expect(await dispatch(handlers.fetch, request('/api/providers'))).toBeUndefined();
    expect(await dispatch(handlers.fetch, request('/api/chat', 'cors', 'POST'))).toBeUndefined();
    expect(await dispatch(handlers.fetch, { url: 'https://api.groq.com/openai/v1/models', method: 'GET', mode: 'cors' })).toBeUndefined();
    expect(await dispatch(handlers.fetch, request('/unknown.txt'))).toBeUndefined();
  });
  it('serves hashed assets cache first and fills the cache on a miss', async () => {
    let fetches = 0; const { handlers, store } = boot(source, async () => { fetches++; return new Response('fresh'); });
    const first = await dispatch(handlers.fetch, request('/assets/index-1.js'));
    expect(await first!.text()).toBe('fresh'); expect(fetches).toBe(1);
    await new Promise(r => setTimeout(r, 0)); expect(store.has(origin + '/assets/index-1.js')).toBe(true);
    const second = await dispatch(handlers.fetch, request('/assets/index-1.js'));
    expect(await second!.text()).toBe('fresh'); expect(fetches).toBe(1);
  });
  it('navigations go to the network and fall back to the cached shell offline', async () => {
    let offline = false; const { handlers } = boot(source, async () => { if (offline) throw new TypeError('Failed to fetch'); return new Response('live page'); });
    await dispatch(handlers.install, request('/'));
    expect(await (await dispatch(handlers.fetch, request('/?source=pwa', 'navigate')))!.text()).toBe('live page');
    offline = true;
    expect(await (await dispatch(handlers.fetch, request('/?source=pwa', 'navigate')))!.text()).toBe('shell:' + origin + '/index.html');
  });
});
