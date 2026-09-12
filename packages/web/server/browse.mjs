import { lookup } from 'node:dns/promises';
import { HttpError, publicAddress } from './proxy.mjs';
import { checkOrigin } from './state.mjs';

// /api/browse: the Browser Agent's one tool. Opens a public page in headless Chromium and
// returns a structured report. Guardrails: explicit host allowlist, public IPv4 only (checked
// again on every request the page makes), no downloads, no credentials, hard timeouts, and a
// per-workspace hourly budget. Playwright is loaded lazily so the server runs without it.

const MAX_TEXT = 6000; const MAX_LINKS = 40; const NAV_TIMEOUT = 20_000;
const windows = new Map();

export function allowedHost(hostname, env = process.env) {
  const list = (env.BROWSE_ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return false;
  const host = hostname.toLowerCase();
  return list.some(rule => rule === '*' || rule === host || (rule.startsWith('*.') && host.endsWith(rule.slice(1))) || host.endsWith('.' + rule));
}
export async function checkTarget(rawUrl, { env = process.env, resolve = lookup, allowPrivate = false } = {}) {
  let url; try { url = new URL(rawUrl); } catch { throw new HttpError(400, 'Enter a valid page URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new HttpError(400, 'Only http and https pages can be inspected.');
  if (url.username || url.password) throw new HttpError(400, 'URLs with credentials are not allowed.');
  if (!allowPrivate && !allowedHost(url.hostname, env)) throw new HttpError(403, 'That host is not on this deployment\'s browse allowlist. Ask the administrator to set BROWSE_ALLOWED_HOSTS.');
  if (!allowPrivate) { const addresses = await resolve(url.hostname, { all: true }).catch(() => []); if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new HttpError(403, 'Private, reserved, or unresolvable destinations are blocked.'); }
  return url;
}

export async function inspectWithPage(page, url) {
  const started = Date.now();
  const response = await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  await page.waitForTimeout(400);
  const report = await page.evaluate(({ maxText, maxLinks }) => {
    const meta = name => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || document.querySelector(`meta[property="${name}"]`)?.getAttribute('content') || '';
    const og = {}; for (const el of document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"]')) { const k = el.getAttribute('property') || el.getAttribute('name'); const v = el.getAttribute('content'); if (k && v && Object.keys(og).length < 12) og[k] = v.slice(0, 200); }
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const links = []; for (const a of document.querySelectorAll('a[href]')) { const href = a.href; if (!/^https?:/.test(href)) continue; links.push({ href: href.slice(0, 300), text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) }); if (links.length >= maxLinks) break; }
    return { title: document.title.slice(0, 300), description: meta('description').slice(0, 500), canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '', robots: meta('robots').slice(0, 200), lang: document.documentElement.lang || '', h1: [...document.querySelectorAll('h1')].slice(0, 5).map(h => (h.textContent || '').trim().slice(0, 200)), headingCount: document.querySelectorAll('h1,h2,h3').length, og, wordCount: text ? text.split(' ').length : 0, text: text.slice(0, maxText), links };
  }, { maxText: MAX_TEXT, maxLinks: MAX_LINKS });
  return { url: page.url(), status: response?.status() ?? 0, ...report, elapsedMs: Date.now() - started };
}

export function createBrowse({ env = process.env, resolve = lookup, allowPrivate = false, launch } = {}) {
  let browserPromise = null; let idleTimer = null;
  const budget = Math.max(1, Number(env.BROWSE_MAX_PER_HOUR) || 30);
  async function browser() {
    if (!browserPromise) browserPromise = (async () => {
      const pw = launch ? null : await import('playwright').catch(() => null);
      if (!pw && !launch) throw new HttpError(503, 'The browser runner is not installed on this deployment.');
      try { return await (launch ? launch() : pw.chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })); }
      catch { browserPromise = null; throw new HttpError(503, 'The browser runner could not start on this deployment.'); }
    })();
    return browserPromise;
  }
  async function closeSoon() { clearTimeout(idleTimer); idleTimer = setTimeout(async () => { const b = await browserPromise?.catch(() => null); browserPromise = null; await b?.close().catch(() => {}); }, 60_000); idleTimer.unref?.(); }
  async function inspect(rawUrl, workspace) {
    const now = Date.now(); for (const [k, v] of windows) if (now - v.start > 3_600_000) windows.delete(k);
    const window = windows.get(workspace) || { start: now, count: 0 }; window.count++; windows.set(workspace, window);
    if (window.count > budget) throw new HttpError(429, `Browse budget reached (${budget} pages per hour). Try again later.`);
    const url = await checkTarget(rawUrl, { env, resolve, allowPrivate });
    const b = await browser();
    const context = await b.newContext({ javaScriptEnabled: true, acceptDownloads: false, viewport: { width: 1280, height: 900 }, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) HeyBuddyBrowserAgent/0.1 Chrome/120 Safari/537.36' });
    try {
      await context.route('**/*', async route => {
        const request = route.request(); const target = new URL(request.url());
        if (!['http:', 'https:'].includes(target.protocol) || ['image', 'media', 'font'].includes(request.resourceType())) return route.abort();
        if (!allowPrivate) { const ok = allowedHost(target.hostname, env) || request.resourceType() !== 'document'; const addresses = ok ? await resolve(target.hostname, { all: true }).catch(() => []) : []; if (!ok || !addresses.length || addresses.some(a => !publicAddress(a.address))) return route.abort(); }
        return route.continue();
      });
      const page = await context.newPage(); page.setDefaultTimeout(NAV_TIMEOUT);
      return await Promise.race([inspectWithPage(page, url), new Promise((_, reject) => setTimeout(() => reject(new HttpError(504, 'The page took too long to load.')), NAV_TIMEOUT + 10_000))]);
    } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(502, 'The page could not be loaded in the sandbox browser.'); }
    finally { await context.close().catch(() => {}); void closeSoon(); }
  }
  async function handler(req, res) {
    if (new URL(req.url, 'http://browse').pathname !== '/api/browse') return false;
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
      checkOrigin(req, env);
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Use application/json.');
      let size = 0; const chunks = []; for await (const chunk of req) { size += chunk.length; if (size > 10_000) throw new HttpError(413, 'Request is too large.'); chunks.push(chunk); }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON body.'); }
      if (typeof body?.url !== 'string' || body.url.length > 2000) throw new HttpError(400, 'A page url is required.');
      const workspace = typeof req.headers['x-workspace-id'] === 'string' ? req.headers['x-workspace-id'] : (req.socket.remoteAddress || 'unknown');
      json(200, await inspect(body.url, workspace)); return true;
    } catch (error) { json(error instanceof HttpError ? error.status : 500, { error: { message: error instanceof HttpError ? error.message : 'Browse failed.' } }); return true; }
  }
  handler.inspect = inspect;
  handler.close = async () => { clearTimeout(idleTimer); const b = await browserPromise?.catch(() => null); browserPromise = null; await b?.close().catch(() => {}); };
  return handler;
}
