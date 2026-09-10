import { defineConfig, type Plugin } from 'vitest/config';
// @ts-expect-error Server module is JavaScript and intentionally excluded from client bundles.
import { createProxy } from './server/proxy.mjs';
// @ts-expect-error Build helper is JavaScript and shared with the tests.
import { buildShellWorker } from './pwa/build-worker.mjs';
// @ts-expect-error Server modules are JavaScript.
import { openDatabase } from './server/db.mjs';
// @ts-expect-error Server modules are JavaScript.
import { createState } from './server/state.mjs';
// @ts-expect-error Server modules are JavaScript.
import { createBrowse } from './server/browse.mjs';
const api: Plugin = { name: 'heybuddy-api', configureServer(server) { const handlers = [createProxy(), createState({ db: openDatabase('data/dev.sqlite') }), createBrowse()]; server.middlewares.use((req, res, next) => { void (async () => { for (const handle of handlers) if (await handle(req, res)) return; next(); })().catch(next); }); } };
// Emits dist/sw.js with the precache list taken from the real bundle, so the offline shell always matches the build.
const shellWorker: Plugin = { name: 'shell-worker', apply: 'build', generateBundle(_options, bundle) { const { source } = buildShellWorker(Object.keys(bundle)); this.emitFile({ type: 'asset', fileName: 'sw.js', source }); } };
export default defineConfig({ base: './', test: { include: ['tests/**/*.test.ts'] }, plugins: [api, shellWorker], build: { target: 'es2022', rollupOptions: { maxParallelFileOps: 16 } }, worker: { format: 'es' } });
