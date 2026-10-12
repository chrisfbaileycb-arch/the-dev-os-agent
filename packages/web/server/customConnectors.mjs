import WebSocket from 'ws';
import { lookup } from 'node:dns/promises';
import { HttpError, upstream } from './proxy.mjs';
import { checkTarget } from './fetch.mjs';
import { checkOrigin } from './state.mjs';
import { resolveWorkspace } from './workspace.mjs';

const MAX_RESPONSE = 1_000_000;
export async function callRest(url, { authorization, method = 'GET', input, address, signal, transport = upstream }) {
  const body = method === 'POST' ? JSON.stringify(input ?? {}) : undefined;
  const response = await transport(url, { method, address, signal, body, headers: { Accept: 'application/json,text/plain', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(authorization ? { Authorization: authorization } : {}) } });
  if (response.statusCode < 200 || response.statusCode >= 300) { response.destroy(); throw new HttpError(502, `Connector answered HTTP ${response.statusCode}. Redirects are not followed.`); }
  let size = 0; const chunks = [];
  for await (const chunk of response) { size += Buffer.byteLength(chunk); if (size > MAX_RESPONSE) { response.destroy(); throw new HttpError(413, 'Connector response exceeds 1 MB.'); } chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); }
  return Buffer.concat(chunks).toString('utf8');
}
export function callWebSocket(url, { authorization, input, address, signal, probe = false, Socket = WebSocket }) {
  return new Promise((resolve, reject) => {
    const socket = new Socket(url, { headers: authorization ? { Authorization: authorization } : {}, followRedirects: false, handshakeTimeout: 15_000, maxPayload: MAX_RESPONSE, perMessageDeflate: false, lookup: (_host, options, callback) => options.all ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4) });
    let finished = false;
    const finish = (error, value) => { if (finished) return; finished = true; signal.removeEventListener('abort', abort); socket.terminate(); error ? reject(error) : resolve(value); };
    const abort = () => finish(new HttpError(504, 'Connector request timed out or was cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
    socket.on('open', () => { if (probe) finish(null, 'WebSocket handshake succeeded.'); else socket.send(JSON.stringify(input ?? {})); });
    socket.on('message', (bytes, binary) => binary ? finish(new HttpError(415, 'This connector expects a text response.')) : finish(null, bytes.toString()));
    socket.on('error', () => finish(new HttpError(502, 'WebSocket connection failed. Check the endpoint and token.')));
    socket.on('unexpected-response', (_req, response) => { response.destroy(); finish(new HttpError(502, `WebSocket handshake answered HTTP ${response.statusCode}.`)); });
    socket.on('close', () => finish(new HttpError(502, 'WebSocket closed before returning a response.')));
    if (signal.aborted) abort();
  });
}
export function createCustomConnectors({ env = process.env, resolve = lookup, transport = upstream, Socket = WebSocket } = {}) {
  const windows = new Map();
  return async (req, res) => {
    if (new URL(req.url, 'http://connector').pathname !== '/api/connectors/call') return false;
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
      checkOrigin(req, env); resolveWorkspace(req, env);
      if (!String(req.headers['content-type']).startsWith('application/json')) throw new HttpError(415, 'Use application/json.');
      const ip = req.socket.remoteAddress || 'unknown'; const now = Date.now();
      for (const [key, value] of windows) if (now - value.start > 3_600_000) windows.delete(key);
      const entry = windows.get(ip) ?? { start: now, count: 0 }; windows.set(ip, entry); entry.count++;
      if (entry.count > 120) throw new HttpError(429, 'Connector request limit reached.');
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > 200_000) throw new HttpError(413, 'Connector input exceeds 200 KB.'); chunks.push(chunk); }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new HttpError(400, 'Invalid JSON.'); }
      if (!['rest', 'websocket'].includes(body.transport)) throw new HttpError(400, 'Choose REST or WebSocket.');
      let url; try { url = new URL(body.url); } catch { throw new HttpError(400, 'Invalid connector URL.'); }
      if (url.protocol !== (body.transport === 'websocket' ? 'wss:' : 'https:')) throw new HttpError(400, 'REST requires HTTPS; WebSocket requires WSS.');
      if (body.authorization && (typeof body.authorization !== 'string' || body.authorization.length > 4096 || /[\r\n]/.test(body.authorization))) throw new HttpError(400, 'Invalid authorization header.');
      const httpsTarget = new URL(url); httpsTarget.protocol = 'https:';
      const { address } = await checkTarget(httpsTarget.toString(), { env: { FETCH_ALLOWED_HOSTS: '' }, resolve });
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20_000);
      const abort = () => { if (!res.writableEnded) controller.abort(); }; res.once('close', abort);
      try {
        const options = { address, signal: controller.signal, authorization: body.authorization, input: body.input, transport, Socket, probe: body.probe === true };
        const result = body.transport === 'websocket' ? await callWebSocket(url.toString(), options) : await callRest(url.toString(), { ...options, method: body.probe === true ? 'GET' : body.method === 'POST' ? 'POST' : 'GET' });
        json(200, { result });
      } finally { clearTimeout(timer); res.off('close', abort); }
    } catch (e) { json(e instanceof HttpError ? e.status : 502, { error: { message: e instanceof HttpError ? e.message : 'Connector request failed.' } }); }
    return true;
  };
}
