import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { createBurstLimiter, creditsForTokens, freeModel, freeTierStatus, monthlyPool, routeFreeRequest } from './freetier.mjs';
import { createMeter } from './meter.mjs';

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
/**
 * Who pays for this request, decided entirely on the server.
 *
 *   byok    the visitor's own key, taken from the request body
 *   credits this deployment's keys, unlocked by the administrator's access token
 *   free    this deployment's keys, unlocked only for an allowlisted zero-config model
 *   none    nothing funds it; the caller gets a 401 explaining how to proceed
 *
 * The free branch is deliberately last and deliberately narrow: it matches the model id
 * exactly against FREE_MODELS, so no amount of creative naming in the request body can point
 * a server-funded request at a paid model.
 */
export function fundingFor(body, env = process.env) {
  const supplied = keyFor(body, env);
  if (supplied) return { mode: typeof body.apiKey === 'string' && body.apiKey.trim() ? 'byok' : 'credits', apiKey: supplied };
  if (env.FREE_TIER_DISABLED === 'true') return { mode: 'none', apiKey: '' };
  const entry = freeModel(body.model);
  const key = entry && env[entry.envKey];
  return key ? { mode: 'free', apiKey: key, entry } : { mode: 'none', apiKey: '' };
}

// Text content, or OpenAI-style parts: text plus up to five bounded data-URL or https images.
export function validContent(content) {
  if (typeof content === 'string') return content.length <= 150_000;
  if (!Array.isArray(content) || !content.length || content.length > 8) return false;
  let images = 0;
  for (const part of content) {
    if (!part || typeof part !== 'object') return false;
    if (part.type === 'text') { if (typeof part.text !== 'string' || part.text.length > 150_000) return false; continue; }
    if (part.type === 'image_url') { const url = part.image_url?.url; if (typeof url !== 'string' || !(/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(url) && url.length <= 3_000_000) && !(/^https:\/\//.test(url) && url.length <= 2000)) return false; if (++images > 5) return false; continue; }
    return false;
  }
  return true;
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
async function readBody(req, limit = 256_000) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new HttpError(413, 'Request is too large.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON body.'); }
}
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); }
const windows = new Map();
export function createProxy({ env = process.env, transport = upstream, resolve = lookup, db = null } = {}) {
  const takeBurst = createBurstLimiter(env);
  const freeOutputCap = Math.min(4096, Math.max(64, Number(env.FREE_MAX_OUTPUT_TOKENS ?? 1024) || 1024));
  return async function handler(req, res) {
    const path = new URL(req.url, 'http://proxy').pathname;
    if (!['/api/chat','/api/models','/api/providers'].includes(path)) return false;
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 120_000);
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      // Read before the browser sends anything, so the model dropdown knows which entries are
      // live on this deployment and the first message never fails with a surprise.
      if (path === '/api/providers' && req.method === 'GET') { json(res, 200, { ollamaBridge: env.OLLAMA_BRIDGE_URL || null, free: freeTierStatus(env) }); return true; }
      if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
      const origin = req.headers.origin;
      const expectedOrigin = env.APP_ORIGIN;
      if (origin && (expectedOrigin ? origin !== expectedOrigin : new URL(origin).host !== req.headers.host)) throw new HttpError(403, 'Cross-origin requests are not allowed.');
      if (!String(req.headers['content-type']).startsWith('application/json')) throw new HttpError(415, 'Use application/json.');
      const ip = req.socket.remoteAddress || 'unknown'; const now = Date.now();
      for (const [k,v] of windows) if (now - v.start > 60_000) windows.delete(k);
      const window = windows.get(ip) || { start: now, count: 0 }; window.count++; windows.set(ip, window);
      if (window.count > 60) throw new HttpError(429, 'Proxy request limit reached. Wait one minute.');
      const body = await readBody(req, path === '/api/chat' ? 12_000_000 : 256_000);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Expected an object.');
      const funding = fundingFor(body, env);
      // A zero-config request is funded per model, so the provider comes from the allowlist
      // entry rather than from the request body.
      const provider = funding.mode === 'free' ? funding.entry.provider : body.provider;
      const target = await resolveTarget(provider, body.baseUrl, env, resolve);
      const apiKey = funding.apiKey;
      if (!apiKey && provider !== 'custom' && !(path === '/api/models' && provider === 'openrouter')) throw new HttpError(401, 'That model needs a key. Pick a free model, or add your own OpenRouter or Groq key in Settings.');
      const workspace = typeof req.headers['x-workspace-id'] === 'string' ? req.headers['x-workspace-id'].slice(0, 64) : ip;
      if (funding.mode === 'free' && path === '/api/chat') {
        const burst = takeBurst(ip);
        if (!burst.ok) throw new HttpError(429, `Free tier limit reached: ${burst.limit} requests an hour from one network. Add your own key in Settings, or try again later.`);
        const pool = monthlyPool(env);
        const used = db ? db.usedThisMonth(workspace, new Date(), 'free') : 0;
        if (pool <= 0 || used >= pool) throw new HttpError(402, `This workspace has used its ${pool} free credits for the month. Add your own OpenRouter or Groq key in Settings — both offer free accounts — or wait for the monthly reset.`);
      }
      const headers = { 'Content-Type': 'application/json', Accept: path === '/api/chat' ? 'text/event-stream' : 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
      if (provider === 'openrouter') { headers['HTTP-Referer'] = env.APP_ORIGIN || 'https://github.com/chrisfbaileycb-arch/FreeToken'; headers['X-Title'] = 'Hey Buddy'; }
      let payload; let suffix;
      if (path === '/api/chat') {
        if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 100 || body.messages.some(m => !m || !['system','user','assistant'].includes(m.role) || !validContent(m.content))) throw new HttpError(400, 'messages must contain standard role/content text pairs, optionally with up to five image parts.');
        if (target.nativeCohere && body.messages.some(m => Array.isArray(m.content))) throw new HttpError(400, 'Cohere native chat does not accept images here. Choose a vision model on OpenRouter or Groq.');
        const requested = body.max_tokens ?? 1024;
        if (!Number.isInteger(requested) || requested < 1 || requested > 4096) throw new HttpError(400, 'max_tokens must be 1–4096.');
        // Server-funded output is capped regardless of what the browser asked for.
        const max = funding.mode === 'free' ? Math.min(requested, freeOutputCap) : requested;
        const routed = funding.mode === 'free' ? routeFreeRequest(funding.entry) : { model: normalizeModel(provider, body.model) };
        payload = JSON.stringify({ model: routed.model, ...(routed.models ? { models: routed.models } : {}), messages: body.messages, stream: true, max_tokens: max, ...(!target.nativeCohere && provider !== 'custom' ? { stream_options: { include_usage: true } } : {}) });
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
      // Cohere native events are passed through unchanged; the browser normalizes them. A
      // free-tier stream additionally runs through a read-only meter so its real cost is
      // recorded from the bytes that crossed the wire, never from a client-reported number.
      const meter = funding.mode === 'free' ? createMeter({ promptChars: payload.length }) : null;
      if (meter) response.pipe(meter).pipe(res); else response.pipe(res);
      await new Promise((resolve, reject) => { response.on('end', resolve); response.on('error', reject); res.on('close', resolve); });
      // Bill even when the visitor navigated away mid-stream: the tokens were still spent.
      if (meter && db) { try { const tokens = meter.total(); db.recordUsage(workspace, { model: body.model, tier: 'free', mode: 'free', tokens, credits: creditsForTokens(tokens) }); } catch { /* metering must never fail a served request */ } }
      return true;
    } catch (error) {
      if (!res.headersSent) json(res, error instanceof HttpError ? error.status : 502, { error: { message: error instanceof HttpError ? error.message : controller.signal.aborted ? 'Provider request timed out.' : 'Could not connect to provider.' } });
      else if (!res.destroyed) { res.write(`event: error\ndata: ${JSON.stringify({ error: { message: 'Provider stream interrupted. Please retry.' } })}\n\n`); res.end(); }
      return true;
    } finally { clearTimeout(timeout); }
  };
}
