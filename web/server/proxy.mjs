import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';

export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export function publicAddress(ip) {
  if (isIP(ip) === 6) return false; // Conservative: custom endpoints must resolve to public IPv4.
  if (isIP(ip) !== 4) return false;
  const [a,b] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
}
export async function resolveTarget(provider, baseUrl, env = process.env, resolve = lookup) {
  const fixed = { openrouter: 'https://openrouter.ai/api/v1', groq: 'https://api.groq.com/openai/v1', cohere: 'https://api.cohere.com/v2' };
  if (fixed[provider]) return { base: fixed[provider], nativeCohere: provider === 'cohere' };
  if (provider !== 'custom') throw new HttpError(400, 'Unsupported provider.');
  let url; try { url = new URL(baseUrl); } catch { throw new HttpError(400, 'Invalid custom baseUrl.'); }
  if (url.username || url.password || url.search || url.hash) throw new HttpError(400, 'Custom URLs cannot contain credentials, queries, or fragments.');
  const bridge = env.OLLAMA_BRIDGE_URL?.replace(/\/+$/, '');
  const base = url.toString().replace(/\/+$/, '');
  if (bridge && base === bridge) return { base, approvedBridge: true };
  if (url.protocol !== 'https:') throw new HttpError(400, 'Custom APIs require HTTPS. Local Ollama needs an administrator-approved bridge.');
  const allowed = (env.CUSTOM_API_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!allowed.includes(url.origin)) throw new HttpError(403, 'Custom API origin is not approved by this deployment. Ask the administrator to configure CUSTOM_API_ORIGINS.');
  const addresses = await resolve(url.hostname, { all: true });
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new HttpError(403, 'Private, reserved, or IPv6 custom destinations are blocked.');
  return { base, address: addresses[0].address };
}
export function normalizeModel(provider, model) {
  if (typeof model !== 'string' || !model.trim() || model.length > 200) throw new HttpError(400, 'A model identifier is required.');
  const value = model.trim(); return provider === 'groq' ? value.replace(/^groq\//, '') : value;
}
export function keyFor(body, env = process.env) {
  if (body.apiKey !== undefined && (typeof body.apiKey !== 'string' || body.apiKey.length > 8192 || /[\r\n]/.test(body.apiKey))) throw new HttpError(400, 'Invalid API key format.');
  if (body.apiKey?.trim()) return body.apiKey.trim();
  const expected = env.SERVER_CREDIT_ACCESS_TOKEN;
  const supplied = body.serverAccessToken;
  // Never expose environment-funded requests to anonymous visitors.
  if (!expected || typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return '';
  return env[{ openrouter: 'OPENROUTER_API_KEY', groq: 'GROQ_API_KEY', cohere: 'COHERE_API_KEY', custom: 'CUSTOM_API_KEY' }[body.provider]] || '';
}
export function errorMessage(status) {
  return status === 401 || status === 403 ? 'Invalid API key or insufficient provider permissions.' : status === 429 ? 'Provider rate limit reached. Wait and retry.' : status === 404 ? 'Provider endpoint or model was not found.' : status >= 500 ? 'Provider is temporarily unavailable.' : 'Provider rejected the request. Check the model and request settings.';
}
// Stream upstream bytes without buffering. Pinned DNS prevents custom-host rebinding.
export function upstream(url, { method = 'POST', headers, body, signal, address }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url); const transport = u.protocol === 'https:' ? https : http;
    const request = transport.request(u, { method, headers, signal, ...(address ? { lookup: (_host, options, callback) => options.all ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4) } : {}) }, resolve);
    request.on('error', reject); if (body) request.write(body); request.end();
  });
}
async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 256_000) throw new HttpError(413, 'Request is too large.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON body.'); }
}
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); }
const windows = new Map();
export function createProxy({ env = process.env, transport = upstream, resolve = lookup } = {}) {
  return async function handler(req, res) {
    const path = new URL(req.url, 'http://proxy').pathname;
    if (!['/api/chat','/api/models','/api/providers'].includes(path)) return false;
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 120_000);
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      if (path === '/api/providers' && req.method === 'GET') { json(res, 200, { ollamaBridge: env.OLLAMA_BRIDGE_URL || null }); return true; }
      if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
      const origin = req.headers.origin;
      const expectedOrigin = env.APP_ORIGIN;
      if (origin && (expectedOrigin ? origin !== expectedOrigin : new URL(origin).host !== req.headers.host)) throw new HttpError(403, 'Cross-origin requests are not allowed.');
      if (!String(req.headers['content-type']).startsWith('application/json')) throw new HttpError(415, 'Use application/json.');
      const ip = req.socket.remoteAddress || 'unknown'; const now = Date.now();
      for (const [k,v] of windows) if (now - v.start > 60_000) windows.delete(k);
      const window = windows.get(ip) || { start: now, count: 0 }; window.count++; windows.set(ip, window);
      if (window.count > 60) throw new HttpError(429, 'Proxy request limit reached. Wait one minute.');
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Expected an object.');
      const target = await resolveTarget(body.provider, body.baseUrl, env, resolve);
      const apiKey = keyFor(body, env);
      if (!apiKey && body.provider !== 'custom' && !(path === '/api/models' && body.provider === 'openrouter')) throw new HttpError(401, 'Add your provider API key. Public visitors cannot use server credits.');
      const headers = { 'Content-Type': 'application/json', Accept: path === '/api/chat' ? 'text/event-stream' : 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
      if (body.provider === 'openrouter') { headers['HTTP-Referer'] = env.APP_ORIGIN || 'https://github.com/chrisfbaileycb-arch/FreeToken'; headers['X-Title'] = 'FreeToken Web'; }
      let payload; let suffix;
      if (path === '/api/chat') {
        if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 100 || body.messages.some(m => !m || !['system','user','assistant'].includes(m.role) || typeof m.content !== 'string' || m.content.length > 150_000)) throw new HttpError(400, 'messages must contain standard role/content text pairs.');
        const max = body.max_tokens ?? 1024;
        if (!Number.isInteger(max) || max < 1 || max > 4096) throw new HttpError(400, 'max_tokens must be 1–4096.');
        payload = JSON.stringify({ model: normalizeModel(body.provider, body.model), messages: body.messages, stream: true, max_tokens: max, ...(!target.nativeCohere && body.provider !== 'custom' ? { stream_options: { include_usage: true } } : {}) });
        suffix = target.nativeCohere ? '/chat' : '/chat/completions';
      } else suffix = '/models';
      const upstreamUrl = path === '/api/models' && target.nativeCohere ? 'https://api.cohere.com/v1/models' : target.base + suffix;
      const response = await transport(upstreamUrl, { method: path === '/api/models' ? 'GET' : 'POST', headers, body: payload, signal: controller.signal, address: target.address });
      const status = response.statusCode || 502;
      if (status < 200 || status >= 300) { response.destroy(); throw new HttpError(status >= 300 && status < 400 ? 502 : status, errorMessage(status)); }
      if (path === '/api/models') {
        let size = 0; const chunks = [];
        for await (const chunk of response) { size += chunk.length; if (size > 4_000_000) { response.destroy(); throw new HttpError(502, 'Model catalog too large.'); } chunks.push(chunk); }
        let data; try { data = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new HttpError(502, 'Invalid model catalog.'); }
        const entries = target.nativeCohere ? data.models : data.data;
        if (!Array.isArray(entries)) throw new HttpError(502, 'Unsupported model catalog format.');
        json(res, 200, { data: entries.map(m => ({ id: target.nativeCohere ? m.name : m.id })).filter(m => typeof m.id === 'string').slice(0, 2000) }); return true;
      }
      if (!String(response.headers['content-type']).includes('text/event-stream')) { response.destroy(); throw new HttpError(502, 'The provider did not return an SSE stream.'); }
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-store, no-transform', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' }); res.flushHeaders();
      // Cohere native events are passed through unchanged; the browser normalizes them.
      response.pipe(res);
      await new Promise((resolve, reject) => { response.on('end', resolve); response.on('error', reject); res.on('close', resolve); });
      return true;
    } catch (error) {
      if (!res.headersSent) json(res, error instanceof HttpError ? error.status : 502, { error: { message: error instanceof HttpError ? error.message : controller.signal.aborted ? 'Provider request timed out.' : 'Could not connect to provider.' } });
      else if (!res.destroyed) { res.write(`event: error\ndata: ${JSON.stringify({ error: { message: 'Provider stream interrupted. Please retry.' } })}\n\n`); res.end(); }
      return true;
    } finally { clearTimeout(timeout); }
  };
}
