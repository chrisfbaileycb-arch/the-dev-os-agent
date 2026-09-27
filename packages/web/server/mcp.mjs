import { lookup } from 'node:dns/promises';
import { HttpError, publicAddress } from './proxy.mjs';
import { checkOrigin } from './state.mjs';

// /api/mcp: lets the browser talk to remote MCP servers over Streamable HTTP (MCP 2025-06-18) or
// the older HTTP+SSE transport (MCP 2024-11-05) without exposing them to cross-origin fetches. The browser supplies the server URL and an optional bearer
// token per request; this proxy runs the initialize handshake, keeps the session id for a
// while, and forwards tools/list and tools/call. Guardrails: https only, public hosts only,
// no redirects, bounded responses, a per-workspace hourly budget.

const PROTOCOL = '2025-06-18';
const MAX_RESPONSE = 2_000_000; const TIMEOUT = 30_000; const SESSION_TTL = 10 * 60_000;
const METHODS = new Set(['tools/list', 'tools/call']);
const sessions = new Map(); const windows = new Map();
const SSE_PROTOCOL = '2024-11-05';
const MAX_SSE_SESSIONS = 40; const MAX_SSE_BYTES = 20_000_000;
const sseSessions = new Map();

/**
 * One HTTP+SSE session (MCP 2024-11-05): a long-lived GET event stream, an `endpoint` event naming
 * where to POST requests, and every response delivered back on the stream as a `message` event
 * matched by JSON-RPC id.
 *
 * The endpoint the server names must be on the same origin as the stream. That is the only thing
 * standing between this bridge and a server that answers "POST your requests to
 * http://169.254.169.254/…" — the public-address check ran on the stream URL, and a same-origin
 * endpoint is the same host it approved.
 */
export class SseSession {
  constructor(url, { authorization, fetchImpl = fetch } = {}) {
    this.url = url; this.authorization = authorization; this.fetchImpl = fetchImpl;
    this.pending = new Map(); this.controller = new AbortController(); this.at = Date.now(); this.closed = false;
    this.endpoint = new Promise((resolve, reject) => { this.resolveEndpoint = resolve; this.rejectEndpoint = reject; });
    this.endpoint.catch(() => {});
  }
  headers(extra = {}) { return { ...(this.authorization ? { Authorization: this.authorization } : {}), ...extra }; }
  async open(timeoutMs = TIMEOUT) {
    const timer = setTimeout(() => this.fail(new HttpError(502, 'The MCP server took too long to open its event stream.')), timeoutMs);
    let response;
    try { response = await this.fetchImpl(this.url, { method: 'GET', headers: this.headers({ Accept: 'text/event-stream' }), redirect: 'error', signal: this.controller.signal }); }
    catch { clearTimeout(timer); throw new HttpError(502, 'Could not reach the MCP server.'); }
    if (response.status === 401 || response.status === 403) { clearTimeout(timer); throw new HttpError(401, 'The MCP server rejected the token.'); }
    if (!response.ok || !response.body) { clearTimeout(timer); throw new HttpError(502, `The MCP server answered HTTP ${response.status} to the event stream.`); }
    if (!(response.headers.get('content-type') || '').includes('text/event-stream')) { clearTimeout(timer); throw new HttpError(502, 'That URL did not open an event stream. Choose Streamable HTTP for this server instead.'); }
    void this.read(response.body);
    try { return await this.endpoint; } finally { clearTimeout(timer); }
  }
  async read(body) {
    const reader = body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let bytes = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_SSE_BYTES) throw new HttpError(502, 'The MCP event stream exceeded its size limit.');
        buffer += decoder.decode(value, { stream: true });
        let split;
        while ((split = buffer.search(/\r?\n\r?\n/)) !== -1) {
          const block = buffer.slice(0, split); buffer = buffer.slice(split).replace(/^\r?\n\r?\n/, '');
          this.dispatch(block);
        }
      }
      this.fail(new HttpError(502, 'The MCP server closed its event stream.'));
    } catch (e) { this.fail(e instanceof HttpError ? e : new HttpError(502, 'The MCP event stream failed.')); }
  }
  dispatch(block) {
    let event = 'message'; const data = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    const text = data.join('\n');
    if (event === 'endpoint') {
      let target; try { target = new URL(text.trim(), this.url); } catch { this.fail(new HttpError(502, 'The MCP server named an invalid endpoint.')); return; }
      if (target.origin !== new URL(this.url).origin) { this.fail(new HttpError(502, 'The MCP server named an endpoint on a different host, which this bridge will not follow.')); return; }
      this.resolveEndpoint(target.toString());
      return;
    }
    if (event !== 'message' || !text) return;
    let message; try { message = JSON.parse(text); } catch { return; }
    const waiter = this.pending.get(message?.id);
    if (waiter) { this.pending.delete(message.id); waiter.resolve(message); }
  }
  async post(message) {
    const endpoint = await this.endpoint;
    let response;
    try { response = await this.fetchImpl(endpoint, { method: 'POST', headers: this.headers({ 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }), body: JSON.stringify(message), redirect: 'error', signal: this.controller.signal }); }
    catch { throw new HttpError(502, 'Could not reach the MCP server.'); }
    if (response.status === 401 || response.status === 403) throw new HttpError(401, 'The MCP server rejected the token.');
    if (!response.ok) throw new HttpError(502, `The MCP server answered HTTP ${response.status}.`);
    // Some servers answer inline as well as on the stream; take whichever arrives.
    const text = await response.text().catch(() => '');
    if (text && text.length <= MAX_RESPONSE) { try { const inline = JSON.parse(text); if (inline && inline.id !== undefined && this.pending.has(inline.id)) this.dispatch(`event: message\ndata: ${text}`); } catch { /* accepted, answer follows on the stream */ } }
  }
  request(message, timeoutMs = TIMEOUT) {
    this.at = Date.now();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(message.id); reject(new HttpError(502, 'The MCP server took too long to answer.')); }, timeoutMs);
      this.pending.set(message.id, { resolve: m => { clearTimeout(timer); resolve(m); }, reject: e => { clearTimeout(timer); reject(e); } });
      this.post(message).catch(e => { clearTimeout(timer); this.pending.delete(message.id); reject(e); });
    });
  }
  fail(error) {
    if (this.closed) return;
    this.closed = true; this.rejectEndpoint(error);
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear(); this.controller.abort();
  }
  close() { this.fail(new HttpError(502, 'MCP session closed.')); }
}

/** An initialized SSE session for this workspace and URL, reusing a live one. */
async function sseSession(key, url, authorization, fetchImpl, nextId) {
  const now = Date.now();
  for (const [k, s] of sseSessions) if (s.closed || now - s.at > SESSION_TTL) { s.close(); sseSessions.delete(k); }
  const live = sseSessions.get(key);
  if (live && !live.closed && live.authorization === authorization) return live;
  if (live) { live.close(); sseSessions.delete(key); }
  if (sseSessions.size >= MAX_SSE_SESSIONS) { const [oldest] = [...sseSessions.entries()].sort((a, b) => a[1].at - b[1].at); oldest[1].close(); sseSessions.delete(oldest[0]); }
  const session = new SseSession(url, { authorization, fetchImpl });
  await session.open();
  const init = await session.request({ jsonrpc: '2.0', id: nextId(), method: 'initialize', params: { protocolVersion: SSE_PROTOCOL, capabilities: {}, clientInfo: { name: 'Signal Forge OS', version: '0.1' } } });
  if (init.error) { session.close(); throw new HttpError(502, `MCP error: ${String(init.error.message || 'unknown').slice(0, 300)}`); }
  await session.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  sseSessions.set(key, session);
  return session;
}

export async function checkServer(rawUrl, { resolve = lookup, allowPrivate = false } = {}) {
  let url; try { url = new URL(rawUrl); } catch { throw new HttpError(400, 'Enter a valid MCP server URL.'); }
  if (url.username || url.password) throw new HttpError(400, 'URLs with credentials are not allowed.');
  if (!allowPrivate && url.protocol !== 'https:') throw new HttpError(400, 'MCP servers must use https.');
  if (!['http:', 'https:'].includes(url.protocol)) throw new HttpError(400, 'MCP servers must use http or https.');
  if (!allowPrivate) { const addresses = await resolve(url.hostname, { all: true }).catch(() => []); if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new HttpError(403, 'Private, reserved, or unresolvable MCP destinations are blocked.'); }
  return url;
}

function parseSse(text, id) {
  let fallback = null;
  for (const block of text.split(/\n\n+/)) {
    const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
    if (!data) continue;
    try { const message = JSON.parse(data); if (message.id === id) return message; if (!fallback && ('result' in message || 'error' in message)) fallback = message; } catch { /* keep scanning */ }
  }
  return fallback;
}

export async function rpc(url, message, { authorization, sessionId, fetchImpl = fetch, signal } = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': PROTOCOL };
  if (authorization) headers.Authorization = authorization;
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  let response;
  try { response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(message), redirect: 'error', signal }); }
  catch (e) { throw new HttpError(502, signal?.aborted ? 'The MCP server took too long to answer.' : 'Could not reach the MCP server.'); }
  const newSession = response.headers.get('mcp-session-id') || sessionId;
  if (response.status === 202 || response.status === 204) return { result: null, sessionId: newSession };
  if (response.status === 401 || response.status === 403) throw new HttpError(401, 'The MCP server rejected the token.');
  if (response.status === 404 && sessionId) throw new HttpError(404, 'MCP session expired.');
  if (!response.ok) throw new HttpError(502, `The MCP server answered HTTP ${response.status}.`);
  const text = await response.text();
  if (text.length > MAX_RESPONSE) throw new HttpError(502, 'The MCP response is too large.');
  const type = response.headers.get('content-type') || '';
  let parsed;
  if (type.includes('text/event-stream')) parsed = parseSse(text, message.id);
  else { try { parsed = JSON.parse(text); } catch { throw new HttpError(502, 'The MCP server did not return JSON.'); } }
  if (!parsed) throw new HttpError(502, 'The MCP server did not answer the request.');
  if (parsed.error) throw new HttpError(502, `MCP error: ${String(parsed.error.message || 'unknown').slice(0, 300)}`);
  return { result: parsed.result ?? null, sessionId: newSession };
}

export function createMcp({ env = process.env, resolve = lookup, allowPrivate = false, fetchImpl = fetch } = {}) {
  const budget = Math.max(1, Number(env.MCP_MAX_PER_HOUR) || 120);
  let counter = 1;
  async function callSse(url, method, params, authorization, workspace) {
    const key = `${workspace}|sse|${url}`;
    const session = await sseSession(key, url, authorization, fetchImpl, () => counter++);
    try {
      const reply = await session.request({ jsonrpc: '2.0', id: counter++, method, params });
      if (reply.error) throw new HttpError(502, `MCP error: ${String(reply.error.message || 'unknown').slice(0, 300)}`);
      return reply.result ?? null;
    } catch (e) { if (session.closed) sseSessions.delete(key); throw e; }
  }
  async function call(url, method, params, authorization, workspace, transport = 'http') {
    if (transport === 'sse') return callSse(url, method, params, authorization, workspace);
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TIMEOUT);
    const key = `${workspace}|${url}`; const opts = { authorization, fetchImpl, signal: controller.signal };
    try {
      let session = sessions.get(key); if (session && Date.now() - session.at > SESSION_TTL) { sessions.delete(key); session = null; }
      if (!session) {
        const init = await rpc(url, { jsonrpc: '2.0', id: counter++, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'Signal Forge OS', version: '0.1' } } }, opts);
        session = { id: init.sessionId || null, at: Date.now() }; sessions.set(key, session);
        await rpc(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, { ...opts, sessionId: session.id });
      }
      try { const out = await rpc(url, { jsonrpc: '2.0', id: counter++, method, params }, { ...opts, sessionId: session.id }); session.at = Date.now(); return out.result; }
      catch (e) { if (e instanceof HttpError && e.status === 404) { sessions.delete(key); return call(url, method, params, authorization, workspace); } throw e; }
    } finally { clearTimeout(timer); }
  }
  async function handler(req, res) {
    if (new URL(req.url, 'http://mcp').pathname !== '/api/mcp') return false;
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
      checkOrigin(req, env);
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Use application/json.');
      let size = 0; const chunks = []; for await (const chunk of req) { size += chunk.length; if (size > 200_000) throw new HttpError(413, 'Request is too large.'); chunks.push(chunk); }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON body.'); }
      if (typeof body?.url !== 'string' || body.url.length > 2000) throw new HttpError(400, 'An MCP server url is required.');
      if (!METHODS.has(body.method)) throw new HttpError(400, 'Unsupported MCP method.');
      const authorization = typeof body.authorization === 'string' && body.authorization.length <= 4096 && !/[\r\n]/.test(body.authorization) ? body.authorization : undefined;
      const workspace = typeof req.headers['x-workspace-id'] === 'string' ? req.headers['x-workspace-id'] : (req.socket.remoteAddress || 'unknown');
      const now = Date.now(); for (const [k, v] of windows) if (now - v.start > 3_600_000) windows.delete(k);
      const window = windows.get(workspace) || { start: now, count: 0 }; window.count++; windows.set(workspace, window);
      if (window.count > budget) throw new HttpError(429, `MCP budget reached (${budget} calls per hour). Try again later.`);
      const url = await checkServer(body.url, { resolve, allowPrivate });
      const params = body.params && typeof body.params === 'object' ? body.params : {};
      const transport = body.transport === 'sse' ? 'sse' : 'http';
      json(200, { result: await call(url.toString(), body.method, params, authorization, workspace, transport) }); return true;
    } catch (error) { json(error instanceof HttpError ? error.status : 500, { error: { message: error instanceof HttpError ? error.message : 'MCP request failed.' } }); return true; }
  }
  handler.call = call;
  return handler;
}
