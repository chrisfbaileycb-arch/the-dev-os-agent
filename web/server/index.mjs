import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProxy } from './proxy.mjs';
import { openDatabase } from './db.mjs';
import { createState } from './state.mjs';
import { createBrowse } from './browse.mjs';
import { createMcp } from './mcp.mjs';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const dataFile = process.env.DATA_FILE || resolve(process.cwd(), process.env.DATA_DIR || 'data', 'heybuddy.sqlite');
const db = openDatabase(dataFile);
const handlers = [createProxy(), createState({ db }), createBrowse(), createMcp()];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png' };
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
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': cacheControl(file), 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self' blob:; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" });
    if (req.method === 'HEAD') res.end(); else createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.requestTimeout = 135_000;
server.listen(Number(process.env.PORT || 4173), '0.0.0.0', () => console.log(`Hey Buddy server is ready. Workspace data: ${dataFile}`));
