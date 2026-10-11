import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { parseCookies, parseSession } from './auth.mjs';
import { HttpError } from './proxy.mjs';
import { checkOrigin } from './state.mjs';

const COOKIE = 'sf_workspace';
const TTL = 30 * 24 * 3_600_000;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const signature = (value, secret) => createHmac('sha256', secret).update(`workspace:${value}`).digest('hex');
export function workspaceCookie(id, secret, now = Date.now()) {
  const payload = `${id}.${now + TTL}`;
  return `${payload}.${signature(payload, secret)}`;
}
function anonymousWorkspace(req, env, now) {
  const value = parseCookies(req.headers.cookie)[COOKIE];
  if (!value || !env.SESSION_SECRET) return null;
  const [id, expiry, sig, extra] = value.split('.');
  if (extra || !ID.test(id) || !/^\d+$/.test(expiry) || Number(expiry) <= now || !/^[a-f0-9]{64}$/.test(sig)) return null;
  const expected = signature(`${id}.${expiry}`, env.SESSION_SECRET);
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? id : null;
}
export function resolveWorkspace(req, env, now = Date.now()) {
  // Explicit legacy mode supports local fixtures; deployments use signed ownership by default.
  if (env.WORKSPACE_AUTH_REQUIRED === 'false') {
    const id = req.headers['x-workspace-id'];
    if (!ID.test(id)) throw new HttpError(400, 'A workspace id header is required.');
    return id;
  }
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new HttpError(503, 'Workspace identity is not configured.');
  const account = parseSession(req.headers.cookie, env.SESSION_SECRET);
  const id = account?.workspaceId ?? anonymousWorkspace(req, env, now);
  if (!id || !ID.test(id)) throw new HttpError(401, 'Open the workspace to create a signed session.');
  const requested = req.headers['x-workspace-id'];
  if (requested && requested !== id) throw new HttpError(403, 'This session does not own that workspace.');
  return id;
}
export function createWorkspaceSession({ env = process.env, now = Date.now } = {}) {
  return async (req, res) => {
    if (new URL(req.url, 'http://app').pathname !== '/api/workspace/session') return false;
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); };
    try {
      checkOrigin(req, env);
      if (req.method !== 'GET') throw new HttpError(405, 'Use GET.');
      if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new HttpError(503, 'Workspace identity is not configured.');
      const account = parseSession(req.headers.cookie, env.SESSION_SECRET);
      const id = account?.workspaceId ?? anonymousWorkspace(req, env, now()) ?? randomUUID();
      if (!account) {
        const secure = req.socket?.encrypted || req.headers['x-forwarded-proto'] === 'https';
        res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(workspaceCookie(id, env.SESSION_SECRET, now()))}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${TTL / 1000}${secure ? '; Secure' : ''}`);
      }
      json(200, { workspaceId: id });
    } catch (e) { json(e instanceof HttpError ? e.status : 500, { error: { message: e instanceof HttpError ? e.message : 'Workspace identity failed.' } }); }
    return true;
  };
}
