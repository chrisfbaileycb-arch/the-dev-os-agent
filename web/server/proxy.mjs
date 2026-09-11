import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { createBurstLimiter, creditsForTokens, freeModel, freeTierStatus, monthlyPool, routeFreeRequest, xkiroBase } from './freetier.mjs';
import { createMeter } from './meter.mjs';

export class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
export function publicAddress(ip) {
  if (isIP(ip) === 6) return false; // Conservative: custom endpoints must resolve to public IPv4.
  if (isIP(ip) !== 4) return false;
  const [a,b] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
}
/**
 * Where each named provider lives. Fixed on the server on purpose: the browser sends a base URL
 * for display, and taking it on trust would make this proxy a forwarder to anywhere, with the
 * visitor's key attached. Only `custom` may steer the destination, and then only to an origin
 * the operator listed in CUSTOM_API_ORIGINS.
 *
 * Google publishes an OpenAI-compatible surface for Gemini, so it needs nothing special.
 * Anthropic and Cohere do not, and are translated below.
 */
export async function resolveTarget(provider, baseUrl, env = process.env, resolve = lookup) {
  const fixed = {
    openrouter: 'https://openrouter.ai/api/v1',
    groq: 'https://api.groq.com/openai/v1',
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com/v1',
    google: 'https://generativelanguage.googleapis.com/v1beta/openai',
    cohere: 'https://api.cohere.com/v2',
    xkiro: xkiroBase(env),
  };
  if (fixed[provider]) return { base: fixed[provider], nativeCohere: provider === 'cohere', nativeAnthropic: provider === 'anthropic' };
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
  return env[{ openrouter: 'OPENROUTER_API_KEY', groq: 'GROQ_API_KEY', cohere: 'COHERE_API_KEY', xkiro: 'XKIRO_API_KEY', custom: 'CUSTOM_API_KEY' }[body.provider]] || '';
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
  const entry = freeModel(body.model, env);
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

/**
 * What a visitor is told when the zero-config tier cannot serve them right now — whether the
 * deployment's keys are unset, the provider is rate-limiting, or the upstream is down. All three
 * look identical from a keyless browser and none of them are the visitor's key to fix, so they
 * share one message and one code. The operator sees the real cause in /api/providers and the logs.
 */
export const FREE_TIER_UNAVAILABLE = 'Public free tier warming up — enter your own key in Settings or try again shortly.';

/** Pinned so a future Anthropic API revision cannot change the wire format under a live deploy. */
export const ANTHROPIC_VERSION = '2023-06-01';

/**
 * OpenAI's reasoning models and the GPT-5 line reject `max_tokens` and require
 * `max_completion_tokens` instead; everything else still wants the original name. Sending the
 * wrong one is a hard 400 with an opaque message, so the choice is made here from the model id.
 */
export function outputLimit(provider, model, max) {
  const reasoning = provider === 'openai' && /^(o[134]|gpt-5)/i.test(model);
  return reasoning ? { max_completion_tokens: max } : { max_tokens: max };
}

/**
 * Whether to ask for a usage block on the stream. Not universal: a provider that does not know
 * `stream_options` rejects the whole request rather than ignoring the field, which would turn a
 * token count into a failed run. Requested only where it is known to be supported.
 */
export const usageReportable = (provider, target) =>
  !target.nativeCohere && !target.nativeAnthropic && ['openrouter', 'groq', 'openai', 'xkiro'].includes(provider);

/**
 * An OpenAI-shaped chat request as Anthropic's /v1/messages wants it.
 *
 * Two differences matter. The system prompt is a top-level field there rather than a message
 * with role "system" — left in the array it is rejected outright. And image parts are named
 * differently: `image_url` with a data URL becomes a `source` block of base64 plus media type.
 * Everything else is close enough to pass through.
 */
export function anthropicPayload(model, messages, max) {
  const system = messages.filter(m => m.role === 'system').map(m => typeof m.content === 'string' ? m.content : '').filter(Boolean).join('\n\n');
  const turns = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: anthropicContent(m.content) }));
  return { model, messages: turns, stream: true, max_tokens: max, ...(system ? { system } : {}) };
}
function anthropicContent(content) {
  if (typeof content === 'string') return content;
  return content.map(part => {
    if (part.type === 'text') return part;
    const url = part.image_url?.url || '';
    const match = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(url);
    // A remote image URL has no Anthropic equivalent that does not involve this server fetching
    // it, which is an SSRF hole for a feature nobody asked for. Only inline data is translated.
    return match ? { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } } : { type: 'text', text: '' };
  }).filter(part => part.type !== 'text' || part.text !== '');
}

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
      if (!apiKey && provider !== 'custom' && !(path === '/api/models' && provider === 'openrouter')) {
        // A model on the free allowlist that is simply not funded right now reads as a warming-up
        // tier, not as the visitor's mistake; anything else genuinely needs their own key.
        throw freeModel(body.model, env)
          ? new HttpError(503, FREE_TIER_UNAVAILABLE, 'free_tier_unavailable')
          : new HttpError(401, 'That model needs a key. Pick a free model, or add your own OpenRouter or Groq key in Settings.', 'key_required');
      }
      const workspace = typeof req.headers['x-workspace-id'] === 'string' ? req.headers['x-workspace-id'].slice(0, 64) : ip;
      if (funding.mode === 'free' && path === '/api/chat') {
        const burst = takeBurst(ip);
        if (!burst.ok) throw new HttpError(429, `Free tier limit reached: ${burst.limit} requests an hour from one network. Add your own key in Settings, or try again later.`, 'free_tier_busy');
        const pool = monthlyPool(env);
        const used = db ? db.usedThisMonth(workspace, new Date(), 'free') : 0;
        if (pool <= 0 || used >= pool) throw new HttpError(402, `This workspace has used its ${pool} free credits for the month. Add your own OpenRouter or Groq key in Settings — both offer free accounts — or wait for the monthly reset.`, 'free_tier_exhausted');
      }
      // Anthropic authenticates with x-api-key and a pinned API version rather than a bearer
      // token; every other provider here takes Authorization.
      const headers = { 'Content-Type': 'application/json', Accept: path === '/api/chat' ? 'text/event-stream' : 'application/json', ...(apiKey ? (target.nativeAnthropic ? { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION } : { Authorization: `Bearer ${apiKey}` }) : {}) };
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
        payload = target.nativeAnthropic
          ? JSON.stringify(anthropicPayload(routed.model, body.messages, max))
          : JSON.stringify({ model: routed.model, ...(routed.models ? { models: routed.models } : {}), messages: body.messages, stream: true, ...outputLimit(provider, routed.model, max), ...(usageReportable(provider, target) ? { stream_options: { include_usage: true } } : {}) });
        suffix = target.nativeCohere ? '/chat' : target.nativeAnthropic ? '/messages' : '/chat/completions';
      } else suffix = '/models';
      const upstreamUrl = path === '/api/models' && target.nativeCohere ? 'https://api.cohere.com/v1/models' : target.base + suffix;
      if (target.nativeAnthropic && path === '/api/models') headers.Accept = 'application/json';
      const response = await transport(upstreamUrl, { method: path === '/api/models' ? 'GET' : 'POST', headers, body: payload, signal: controller.signal, address: target.address });
      const status = response.statusCode || 502;
      if (status < 200 || status >= 300) {
        response.destroy();
        // On a free-tier request the credential is the deployment's, so "invalid API key" would
        // send the visitor hunting for a problem that is not theirs. Report it as a tier that is
        // not answering, and leave the real status for the operator's logs.
        if (funding.mode === 'free') throw new HttpError(503, FREE_TIER_UNAVAILABLE, 'free_tier_unavailable');
        throw new HttpError(status >= 300 && status < 400 ? 502 : status, errorMessage(status));
      }
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
      // Cohere and Anthropic native events are passed through unchanged; the browser normalizes
      // all three shapes in one place rather than this proxy rewriting a stream mid-flight. A
      // free-tier stream additionally runs through a read-only meter so its real cost is
      // recorded from the bytes that crossed the wire, never from a client-reported number.
      const meter = funding.mode === 'free' ? createMeter({ promptChars: payload.length }) : null;
      if (meter) response.pipe(meter).pipe(res); else response.pipe(res);
      await new Promise((resolve, reject) => { response.on('end', resolve); response.on('error', reject); res.on('close', resolve); });
      // Bill even when the visitor navigated away mid-stream: the tokens were still spent.
      if (meter && db) { try { const tokens = meter.total(); db.recordUsage(workspace, { model: body.model, tier: 'free', mode: 'free', tokens, credits: creditsForTokens(tokens) }); } catch { /* metering must never fail a served request */ } }
      return true;
    } catch (error) {
      if (!res.headersSent) json(res, error instanceof HttpError ? error.status : 502, { error: { message: error instanceof HttpError ? error.message : controller.signal.aborted ? 'Provider request timed out.' : 'Could not connect to provider.', ...(error instanceof HttpError && error.code ? { code: error.code } : {}) } });
      else if (!res.destroyed) { res.write(`event: error\ndata: ${JSON.stringify({ error: { message: 'Provider stream interrupted. Please retry.' } })}\n\n`); res.end(); }
      return true;
    } finally { clearTimeout(timeout); }
  };
}
