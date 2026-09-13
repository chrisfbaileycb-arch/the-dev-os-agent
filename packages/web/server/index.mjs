import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createProxy } from './proxy.mjs';
import { openDatabase } from './db.mjs';
import { openPostgresDb } from './pgdb.mjs';
import { createState } from './state.mjs';
import { createBrowse } from './browse.mjs';
import { createMcp } from './mcp.mjs';
import { createFetcher } from './fetch.mjs';
import { createGithub } from './github.mjs';
import { createJobs, openJobs } from './jobs.mjs';
import { createAuth } from './auth.mjs';
import { catalogStatus, ensureCatalog } from './discovery.mjs';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
// Workspace data: Postgres when DATABASE_URL is set, SQLite otherwise.
// Jobs are always SQLite — they are transient hand-offs and must never carry credentials.
let db, jobsSqlite;
if (process.env.DATABASE_URL) {
  db = await openPostgresDb(process.env.DATABASE_URL);
  jobsSqlite = new DatabaseSync(':memory:');
  console.log('Workspace data: Postgres');
} else {
  const dataFile = process.env.DATA_FILE || resolve(process.cwd(), process.env.DATA_DIR || 'data', 'heybuddy.sqlite');
  const sqliteDb = openDatabase(dataFile);
  db = sqliteDb;
  jobsSqlite = sqliteDb.raw();
  console.log(`Workspace data: ${dataFile}`);
}
const jobs = openJobs(jobsSqlite);
const auth = createAuth({ db, env: process.env });
const handlers = [auth, createProxy({ db }), createState({ db }), createBrowse(), createMcp(), createFetcher(), createGithub(), createJobs({ jobs })];
// Finished jobs are a transient hand-off, not a record; the run itself lands in the workspace store.
setInterval(() => jobs.prune(new Date(Date.now() - 24 * 3_600_000).toISOString()), 3_600_000).unref();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png' };
// script-src carries 'wasm-unsafe-eval' and connect-src reaches esm.sh for exactly one reason:
// the live-preview bundler. It runs esbuild-wasm in a same-origin worker to compile a generated
// project and fetches its npm imports from esm.sh at build time, so the sandboxed preview iframe
// itself never needs network access — the finished bundle is inlined into that iframe's srcdoc.
// Nothing else on this app needed either grant; both are as narrow as the feature requires.
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self' https://esm.sh; worker-src 'self' blob:; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
// Hashed assets are immutable; the shell, the manifest, and the service worker must revalidate so a new build reaches installed apps.
const cacheControl = (file) => file.startsWith(root + 'assets' + sep) ? 'public, max-age=31536000, immutable' : 'no-cache';
const server = createServer(async (req, res) => {
  for (const handle of handlers) if (await handle(req, res)) return;
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://app').pathname);
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) throw new Error('Invalid path');
    if (!(await stat(file)).isFile()) throw new Error('Not a file');
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': cacheControl(file), 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP });
    if (req.method === 'HEAD') res.end(); else createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.requestTimeout = 135_000;
server.listen(Number(process.env.PORT || 4173), '0.0.0.0', () => console.log('Hey Buddy server is ready.'));

// Warm the gateway catalogue at boot so the first visitor does not pay for the discovery request,
// and so the log says on startup how large the free tier actually is. Never awaited and never
// fatal: the server must come up and answer its health check whether or not the gateway is up.
void ensureCatalog().then(() => {
  const status = catalogStatus();
  if (status.discovered) console.log(`Gateway catalogue: ${status.count} models, ${status.free} free.`);
  else console.error(`Gateway catalogue unavailable at startup: ${status.error}. The free tier stays closed until it answers.`);
});
// Refresh on the same clock as the cache TTL, so a model that changes tier is picked up without a
// redeploy and a visitor never triggers a cold fetch mid-session.
setInterval(() => void ensureCatalog(), 3_600_000).unref();
