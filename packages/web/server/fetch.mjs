import { lookup } from 'node:dns/promises';
import { HttpError, publicAddress, upstream } from './proxy.mjs';
import { checkOrigin } from './state.mjs';

// /api/fetch: the URL crawler connector. A browser cannot read an arbitrary external page —
// CORS forbids it — so the text snapshot is taken here and handed back same-origin.
//
// This is deliberately *not* the Browser Agent. /api/browse drives real Chromium, executes the
// page's JavaScript, and is therefore locked to an explicit host allowlist. This route only
// issues a plain GET and converts the bytes to text: no scripts run, no cookies are sent, no
// subresources are loaded. That much smaller blast radius is why it can be open to any public
// host by default while /api/browse stays closed.
//
// Guardrails: http/https only, public IPv4 only with the resolved address pinned for the
// connection (so a name cannot rebind to a private host between the check and the request),
// no credentials in the URL, redirects followed manually and re-validated at each hop, a hard
// byte cap, and a per-workspace hourly budget.

const MAX_BYTES = 1_500_000;
const MAX_TEXT = 12_000;
const MAX_LINKS = 40;
const MAX_REDIRECTS = 3;
const TIMEOUT = 20_000;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#039': "'", '#x27': "'" };

/** Decode the handful of entities that actually show up in extracted body text. */
export function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, name) => {
    const key = name.toLowerCase();
    if (Object.hasOwn(ENTITIES, key)) return ENTITIES[key];
    if (key.startsWith('#x')) { const code = parseInt(key.slice(2), 16); return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match; }
    if (key.startsWith('#')) { const code = Number(key.slice(1)); return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match; }
    return match;
  });
}

const attribute = (tag, name) => tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'))?.slice(2).find(v => v !== undefined) ?? '';

/**
 * Turn an HTML document into the structured snapshot an agent can reason over: title,
 * description, headings, readable text, and outbound links. Script, style, and template
 * contents are dropped entirely rather than flattened into the text.
 */
export function extract(html, baseUrl) {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const title = decodeEntities(stripped.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  let description = '';
  for (const tag of stripped.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = (attribute(tag, 'name') || attribute(tag, 'property')).toLowerCase();
    if ((name === 'description' || name === 'og:description') && !description) description = decodeEntities(attribute(tag, 'content')).replace(/\s+/g, ' ').trim().slice(0, 500);
  }
  const headings = (stripped.match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi) ?? [])
    .map(h => decodeEntities(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 20);
  const links = [];
  for (const tag of stripped.match(/<a\b[^>]*href\s*=\s*[^>]*>/gi) ?? []) {
    if (links.length >= MAX_LINKS) break;
    let href; try { href = new URL(decodeEntities(attribute(tag, 'href')), baseUrl); } catch { continue; }
    if (href.protocol !== 'http:' && href.protocol !== 'https:') continue;
    links.push({ href: href.toString().slice(0, 300) });
  }
  // Block-level tags become line breaks so lists and paragraphs survive the flattening.
  const text = decodeEntities(stripped.replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|blockquote)\s*>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v ]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').split('\n').map(l => l.trim()).join('\n').trim();
  return { title, description, headings, wordCount: text ? text.split(/\s+/).length : 0, text: text.slice(0, MAX_TEXT), truncated: text.length > MAX_TEXT, links };
}

/** Validate a target and pin the public IPv4 it resolved to, so the connection cannot be rebound. */
export async function checkTarget(rawUrl, { env = process.env, resolve = lookup, allowPrivate = false } = {}) {
  let url; try { url = new URL(rawUrl); } catch { throw new HttpError(400, 'Enter a valid http or https URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new HttpError(400, 'Only http and https URLs can be fetched.');
  if (url.username || url.password) throw new HttpError(400, 'URLs with credentials are not allowed.');
  const allow = (env.FETCH_ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (allow.length && !allow.some(rule => rule === '*' || rule === url.hostname.toLowerCase() || url.hostname.toLowerCase().endsWith('.' + rule.replace(/^\*\./, '')))) {
    throw new HttpError(403, 'That host is not on this deployment\'s fetch allowlist.');
  }
  if (allowPrivate) return { url, address: undefined };
  const addresses = await resolve(url.hostname, { all: true }).catch(() => []);
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new HttpError(403, 'Private, reserved, or unresolvable destinations are blocked.');
  return { url, address: addresses[0].address };
}

async function readAll(response) {
  let size = 0; const chunks = [];
  for await (const chunk of response) {
    size += chunk.length;
    if (size > MAX_BYTES) { response.destroy(); throw new HttpError(413, 'That page is larger than this connector will read (1.5 MB).'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createFetcher({ env = process.env, resolve = lookup, transport = upstream, allowPrivate = false } = {}) {
  const budget = Math.max(1, Number(env.FETCH_MAX_PER_HOUR) || 60);
  const windows = new Map();

  /** Fetch one URL, following a bounded number of redirects and re-checking every hop. */
  async function snapshot(rawUrl, workspace) {
    const at = Date.now();
    for (const [key, value] of windows) if (at - value.start > 3_600_000) windows.delete(key);
    const window = windows.get(workspace) ?? { start: at, count: 0 };
    window.count++; windows.set(workspace, window);
    if (window.count > budget) throw new HttpError(429, `Fetch budget reached (${budget} pages an hour). Try again later.`);

    let current = rawUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const { url, address } = await checkTarget(current, { env, resolve, allowPrivate });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT);
      let response;
      try {
        response = await transport(url.toString(), {
          method: 'GET', address, signal: controller.signal,
          headers: { Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5', 'Accept-Language': 'en', 'User-Agent': 'Mozilla/5.0 (compatible; HeyBuddyFetch/0.1; +https://github.com/chrisfbaileycb-arch/the-dev-os-agent)' },
        });
      } catch { throw new HttpError(502, controller.signal.aborted ? 'That page took too long to answer.' : 'Could not reach that URL.'); }
      finally { clearTimeout(timer); }

      const status = response.statusCode ?? 502;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.destroy();
        if (hop === MAX_REDIRECTS) throw new HttpError(502, 'That URL redirected too many times.');
        try { current = new URL(location, url).toString(); } catch { throw new HttpError(502, 'That URL redirected somewhere invalid.'); }
        continue;
      }
      const type = String(response.headers['content-type'] || '');
      if (!/^(text\/|application\/(json|xml|xhtml))/i.test(type) && type) { response.destroy(); throw new HttpError(415, `That URL returned ${type.split(';')[0]}, which this connector cannot read as text.`); }
      const body = (await readAll(response)).toString('utf8');
      const report = /html|xml/i.test(type) ? extract(body, url.toString()) : { title: '', description: '', headings: [], wordCount: body.split(/\s+/).length, text: body.slice(0, MAX_TEXT), truncated: body.length > MAX_TEXT, links: [] };
      return { url: url.toString(), status, contentType: type.split(';')[0] || 'text/plain', ...report };
    }
    throw new HttpError(502, 'That URL redirected too many times.');
  }

  async function handler(req, res) {
    if (new URL(req.url, 'http://fetch').pathname !== '/api/fetch') return false;
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
      checkOrigin(req, env);
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Use application/json.');
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > 10_000) throw new HttpError(413, 'Request is too large.'); chunks.push(chunk); }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON body.'); }
      if (typeof body?.url !== 'string' || body.url.length > 2000) throw new HttpError(400, 'A url is required.');
      const workspace = typeof req.headers['x-workspace-id'] === 'string' ? req.headers['x-workspace-id'] : (req.socket.remoteAddress || 'unknown');
      json(200, await snapshot(body.url, workspace));
      return true;
    } catch (error) { json(error instanceof HttpError ? error.status : 500, { error: { message: error instanceof HttpError ? error.message : 'Fetch failed.' } }); return true; }
  }
  handler.snapshot = snapshot;
  return handler;
}
