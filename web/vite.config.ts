import { defineConfig } from 'vitest/config';
// @ts-expect-error Server module is JavaScript and intentionally excluded from client bundles.
import { createProxy } from './server/proxy.mjs';
export default defineConfig({ base: './', test: { include: ['tests/**/*.test.ts'] }, plugins: [{ name: 'freetoken-api', configureServer(server) { const handler = createProxy(); server.middlewares.use((req, res, next) => { void handler(req, res).then((handled: boolean) => { if (!handled) next(); }).catch(next); }); } }], build: { target: 'es2022', rollupOptions: { maxParallelFileOps: 16 } }, worker: { format: 'es' } });
