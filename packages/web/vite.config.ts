import { defineConfig, type Plugin } from 'vitest/config';
// @ts-expect-error Server module is JavaScript and intentionally excluded from client bundles.
import { createProxy } from './server/proxy.mjs';
// @ts-expect-error Server modules are JavaScript.
import { createAuth } from './server/auth.mjs';
// @ts-expect-error Server modules are JavaScript.
import { createAdmin } from './server/admin.mjs';
// @ts-expect-error Server modules are JavaScript.
import { openSettings } from './server/settings.mjs';
// @ts-expect-error Build helper is JavaScript and shared with the tests.
import { buildShellWorker } from './pwa/build-worker.mjs';
// @ts-expect-error Server modules are JavaScript.
import { openDatabase } from './server/db.mjs';
// @ts-expect-error Server modules are JavaScript.
import { createState } from './server/state.mjs';
// @ts-expect-error Server modules are JavaScript.
import { createBrowse } from './server/browse.mjs';
// @ts-expect-error Server modules are JavaScript.
import { createMcp } from './server/mcp.mjs';
// @ts-expect-error Server modules are JavaScript.
import { createFetcher } from './server/fetch.mjs';
// @ts-expect-error Server modules are JavaScript.
import { createGithub } from './server/github.mjs';
// @ts-expect-error Server modules are JavaScript.
import { createJobs, openJobs } from './server/jobs.mjs';
const api: Plugin = { name: 'heybuddy-api', async configureServer(server) { const db = openDatabase('data/dev.sqlite'); const settings = await openSettings({ db }); const auth = createAuth({ db }); const handlers = [auth, createAdmin({ db, settings }), createProxy({ db, settings }), createState({ db, settings }), createBrowse(), createMcp(), createFetcher(), createGithub(), createJobs({ jobs: openJobs(db.raw()) })]; server.middlewares.use((req: { url?: string }, res, next) => { if (new URL(req.url ?? '/', 'http://dev').pathname === '/admin') req.url = '/'; void (async () => { for (const handle of handlers) if (await handle(req, res)) return; next(); })().catch(next); }); } };
// Emits dist/sw.js with the precache list taken from the real bundle, so the offline shell always matches the build.
const shellWorker: Plugin = { name: 'shell-worker', apply: 'build', generateBundle(_options, bundle) { const { source } = buildShellWorker(Object.keys(bundle)); this.emitFile({ type: 'asset', fileName: 'sw.js', source }); } };

/**
 * Why the dev server answers "Blocked request. This host is not allowed." on a hosted workspace.
 *
 * Vite 6.0.9+/7 hardened `server.allowedHosts` after CVE-2025-31125: the default is now
 * localhost-only, and any request whose Host header is not on the list is refused with a 403
 * before a single route runs. That default is right for a laptop and wrong for every cloud IDE,
 * container, or preview URL — which is how this app is actually developed and demoed. The
 * symptom is the worst kind: the port is open, `curl` gets a response, and the page the visitor
 * sees is a bare Vite error about hostnames, so it reads as "the DevServer does not connect"
 * rather than as one missing setting.
 *
 * `allowedHosts: true` accepts any Host header. That is safe *here* specifically, because this is
 * the dev server: `npm run dev` is a local/workspace tool, and the origin checks that matter for
 * real traffic live in the API handlers (`checkOrigin` in server/state.mjs, the APP_ORIGIN match
 * in proxy.mjs) and in the CSP the production server sends. Nothing about the dev server's host
 * allowlist protects those, so widening it costs nothing and unblocks every proxied hostname.
 */
const devHosts = { host: '0.0.0.0', allowedHosts: true as const, strictPort: false };

/**
 * Which port the dev server listens on.
 *
 * The default of 5173 is the local habit, but this app is normally developed in a hosted workspace
 * where the public URL is bound to one specific port — the sandbox forwards, say, 12000 and nothing
 * else. `strictPort: false` then works against the developer: 5173 is often taken by a leftover
 * process, Vite quietly starts on 5174, and the proxied URL serves nothing. That reads exactly like
 * "the dev server does not connect" even though a server is running and healthy one port over.
 *
 * So the port is taken from `PORT` when the environment names one, which is how every hosting
 * platform communicates it, and it becomes strict: if the operator asked for 12000 and 12000 is
 * held by another process, failing loudly at startup is far better than coming up somewhere the
 * visitor's URL does not point.
 */
// `process` is a Node global and this config is compiled by the client tsconfig, which is
// deliberately DOM-only. Reading it through a narrow local type keeps that boundary — nothing else
// in the repo gains a Node global, and no @types/node is pulled into the client compile.
const nodeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
const port = Number.parseInt(nodeProcess?.env?.PORT ?? '', 10);
const devPort = Number.isInteger(port) && port > 0 ? { port, strictPort: true } : {};

export default defineConfig({
  base: './',
  plugins: [api, shellWorker],
  server: { ...devHosts, ...devPort },
  preview: { ...devHosts, ...devPort },
  test: { include: ['tests/**/*.test.ts'] },
  build: { target: 'es2022' },
  worker: { format: 'es' },
});
