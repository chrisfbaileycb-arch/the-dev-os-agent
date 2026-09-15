import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { HttpError, resolveTarget, cleanKey, ANTHROPIC_VERSION } from './proxy.mjs';
import { checkOrigin } from './state.mjs';
import { freeTierStatus, paidTierStatus, isFrontier, PROVIDER_KEY_VARS } from './freetier.mjs';
import { catalogStatus } from './discovery.mjs';
import { USER_AGENT } from './discovery.mjs';
import { modelsUrl, normalizeModelList } from './models.mjs';
import { PROVIDER_META, TUNABLES } from './settings.mjs';

// The operator's dashboard: /api/admin/*.
//
// One credential opens it, ADMIN_TOKEN, set once in the hosting environment. Everything else —
// every provider key, the free and paid model lists, the free-tier knobs — is then entered here
// and stored in the workspace database (keys sealed), so adding a provider or promoting a model
// to the free tier is a form and a click rather than a redeploy. Without ADMIN_TOKEN every route
// answers 503 and the dashboard page says how to switch it on; nothing is open by default.
//
// A successful login sets a signed, expiring cookie scoped to this path only, so the credential
// itself is typed once and never sits in the browser. A bearer header with the token is accepted
// too, for curl. Writes check the Origin header like every other POST on this server, so a page
// elsewhere cannot drive the dashboard through a logged-in browser.

const COOKIE = 'hb_admin';
const SESSION_MS = 12 * 3_600_000;
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX = 10;

function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); }
async function readBody(req, limit = 512_000) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new HttpError(413, 'Request is too large.'); chunks.push(chunk); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON body.'); }
}
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The secret that signs the session cookie: derived from the token so it rotates with it. */
export function sessionSecret(env) {
  return createHash('sha256').update(`hey-buddy-admin-session:${env.ADMIN_TOKEN}:${env.SESSION_SECRET || ''}`).digest('hex');
}
export function makeSession(env, now = Date.now()) {
  const expires = String(now + SESSION_MS);
  return `${expires}.${createHmac('sha256', sessionSecret(env)).update(expires).digest('hex')}`;
}
export function validSession(value, env, now = Date.now()) {
  if (typeof value !== 'string') return false;
  const [expires, sig] = value.split('.');
  if (!expires || !sig || !/^\d+$/.test(expires) || Number(expires) < now) return false;
  return equal(sig, createHmac('sha256', sessionSecret(env)).update(expires).digest('hex'));
}
function cookieValue(header) {
  for (const part of String(header || '').split(';')) {
    const eq = part.indexOf('='); if (eq < 0) continue;
    if (part.slice(0, eq).trim() === COOKIE) { try { return decodeURIComponent(part.slice(eq + 1).trim()); } catch { return ''; } }
  }
  return '';
}
const secure = req => req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket?.encrypted);
const cookieHeader = (req, value, maxAge) => `${COOKIE}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`;

/**
 * Fetch a provider's live model list with the deployment's own key for it, so the operator can
 * pick tier models by name from what the key actually reaches rather than typing ids.
 */
export async function discoverForProvider(provider, env, fetchImpl = fetch) {
  if (!Object.hasOwn(PROVIDER_KEY_VARS, provider) || provider === 'custom' || provider === 'omniroute') throw new HttpError(400, 'Choose a named provider.');
  const key = cleanKey(env[PROVIDER_KEY_VARS[provider]]) || (provider === 'openrouter' ? cleanKey(env.SETTINGS_OWNER_API_KEY) || cleanKey(env.OPENROUTER_OWNER_KEY) : '');
  if (!key && provider !== 'openrouter') throw new HttpError(400, `Add a ${PROVIDER_META[provider]?.name ?? provider} key first.`);
  const target = await resolveTarget(provider, '', env);
  const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT, ...(key ? (target.nativeAnthropic ? { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION } : { Authorization: `Bearer ${key}` }) : {}) };
  let response;
  try { response = await fetchImpl(modelsUrl(provider, target.base), { headers, signal: AbortSignal.timeout(15_000) }); }
  catch (error) { throw new HttpError(502, `Could not reach the provider: ${error?.message || 'connection failed'}`); }
  if (!response.ok) throw new HttpError(response.status === 401 || response.status === 403 ? 401 : 502, response.status === 401 || response.status === 403 ? 'The provider rejected this key.' : `The provider answered HTTP ${response.status}.`);
  let payload; try { payload = await response.json(); } catch { throw new HttpError(502, 'The provider did not return JSON.'); }
  const models = normalizeModelList(provider, payload);
  if (!models) throw new HttpError(502, 'Unsupported model catalog format.');
  return models;
}

export function createAdmin({ db = null, env: baseEnv = process.env, settings, log = console.error, fetchImpl = fetch, now = () => Date.now() } = {}) {
  const attempts = new Map();
  const currentEnv = () => settings ? settings.env(baseEnv) : baseEnv;
  /**
   * Two ways in, in this order: an ADMIN_TOKEN in the environment, or a password set from the
   * page. The environment wins when both exist, so an operator who manages the service from
   * Render's dashboard keeps that control and a password set in a moment of curiosity cannot
   * lock them out. A deployment with neither is the one this file previously refused outright;
   * it now offers first-run setup instead, because that is the only path that works when the
   * person who owns the app has no shell and no environment editor.
   */
  const envToken = () => (typeof baseEnv.ADMIN_TOKEN === 'string' && baseEnv.ADMIN_TOKEN.trim().length >= 12 ? baseEnv.ADMIN_TOKEN.trim() : '');
  const storedToken = () => Boolean(settings?.adminConfigured?.());
  const configured = () => Boolean(envToken()) || storedToken();
  /** A deployment with no storage cannot remember a password, so there is nothing to set up. */
  const canSetUp = () => !envToken() && !storedToken() && Boolean(settings?.persistent);
  const tokenSource = () => envToken() ? 'environment' : storedToken() ? 'dashboard' : 'none';
  /**
   * The environment the session cookie is signed with.
   *
   * `sessionSecret()` in this file derives its key from ADMIN_TOKEN, which does not exist on a
   * deployment whose password lives in the database. Rather than leave sessions signed with the
   * empty string — forgeable by anyone who reads this source — the stored scrypt hash stands in
   * for it. The hash is unique per password and never leaves the server, so a cookie cannot be
   * minted without it; changing the password invalidates every existing session as a bonus.
   */
  const sessionEnv = () => (envToken() ? baseEnv : { ...baseEnv, ADMIN_TOKEN: settings?.adminSessionSecret?.() || baseEnv.ADMIN_TOKEN });

  function authenticated(req) {
    if (!configured()) return false;
    const auth = req.headers.authorization;
    const bearer = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (bearer) return (Boolean(envToken()) && equal(bearer, envToken())) || settings?.checkAdminToken?.(bearer) === true;
    return validSession(cookieValue(req.headers.cookie), sessionEnv(), now());
  }

  function config() {
    const env = currentEnv();
    const tiers = settings.tiers();
    return {
      persistent: settings.persistent,
      providers: settings.keyStatus(baseEnv).map(p => ({ ...p, console: PROVIDER_META[p.provider]?.console ?? null })),
      tunables: settings.tunableStatus(baseEnv),
      tunableSpecs: Object.fromEntries(Object.entries(TUNABLES).map(([name, spec]) => [name, { kind: spec.kind, label: spec.label, min: spec.min, max: spec.max }])),
      tiers: { ...tiers, warnings: tiers.free.filter(m => isFrontier(m.id)).map(m => m.id) },
      unreadable: settings.unreadable(),
      // What visitors are being told right now, so a change here can be checked against its effect.
      published: { free: freeTierStatus(env), paid: paidTierStatus(env) },
      gateway: catalogStatus(),
    };
  }

  return async function handler(req, res) {
    const path = new URL(req.url, 'http://admin').pathname;
    if (!path.startsWith('/api/admin/')) return false;
    try {
      if (path === '/api/admin/status' && req.method === 'GET') { json(res, 200, { configured: configured(), authenticated: authenticated(req), persistent: Boolean(settings?.persistent), setup: canSetUp(), source: tokenSource(), storage: Boolean(settings?.persistent) }); return true; }
      // First-run setup. This is the one write that happens before any credential exists, so the
      // Origin check below is the whole of its protection: a page on another origin cannot call it
      // from a victim's browser. It also only works once — the moment a password (or an
      // environment token) exists, `canSetUp()` is false and this answers 403 forever after.
      if (path === '/api/admin/setup' && req.method === 'POST') {
        checkOrigin(req, baseEnv);
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Use application/json.');
        if (envToken() || storedToken()) throw new HttpError(403, 'A dashboard password is already set. Sign in instead.');
        if (!settings?.persistent) throw new HttpError(503, 'This deployment has no settings storage, so a password cannot be saved. Set ADMIN_TOKEN in the hosting environment instead.');
        const body = await readBody(req, 8_192);
        const token = typeof body.token === 'string' ? body.token.trim() : '';
        if (token.length < 12) throw new HttpError(400, 'Choose a password of at least 12 characters.');
        await settings.setAdminToken(token);
        log('[admin] dashboard password set from the setup form');
        res.setHeader('Set-Cookie', cookieHeader(req, makeSession(sessionEnv(), now()), SESSION_MS / 1000));
        json(res, 200, { ok: true }); return true;
      }
      if (!configured()) throw new HttpError(503, 'The admin dashboard is off. Set ADMIN_TOKEN in the hosting environment and restart.');
      if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) throw new HttpError(405, 'Method not allowed.');
      if (req.method !== 'GET') { checkOrigin(req, baseEnv); if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Use application/json.'); }

      if (path === '/api/admin/login' && req.method === 'POST') {
        const ip = req.socket.remoteAddress || 'unknown'; const at = now();
        for (const [k, v] of attempts) if (at - v.start > LOGIN_WINDOW_MS) attempts.delete(k);
        const window = attempts.get(ip) ?? { start: at, count: 0 }; window.count++; attempts.set(ip, window);
        if (window.count > LOGIN_MAX) throw new HttpError(429, 'Too many sign-in attempts. Wait fifteen minutes.');
        const body = await readBody(req, 8_192);
        const typed = typeof body.token === 'string' ? body.token.trim() : '';
        const ok = (Boolean(envToken()) && equal(typed, envToken())) || settings?.checkAdminToken?.(typed) === true;
        if (!ok) throw new HttpError(401, 'That is not the admin token.');
        attempts.delete(ip);
        res.setHeader('Set-Cookie', cookieHeader(req, makeSession(sessionEnv(), at), SESSION_MS / 1000));
        json(res, 200, { ok: true }); return true;
      }
      if (path === '/api/admin/logout' && req.method === 'POST') { res.setHeader('Set-Cookie', cookieHeader(req, '', 0)); json(res, 200, { ok: true }); return true; }
      if (!authenticated(req)) throw new HttpError(401, 'Sign in with the admin token.');

      if (path === '/api/admin/config' && req.method === 'GET') { json(res, 200, config()); return true; }
      /**
       * Change the dashboard password. Only for a password that lives here: when ADMIN_TOKEN is
       * set in the environment the credential belongs to the operator's hosting dashboard, and
       * silently shadowing it from the app would make the two disagree about who holds the keys.
       */
      if (path === '/api/admin/password' && req.method === 'PUT') {
        if (envToken()) throw new HttpError(403, 'This deployment signs in with ADMIN_TOKEN from the environment. Change it there.');
        const body = await readBody(req, 8_192);
        const next = typeof body.token === 'string' ? body.token.trim() : '';
        if (next.length < 12) throw new HttpError(400, 'Choose a password of at least 12 characters.');
        await settings.setAdminToken(next);
        log('[admin] dashboard password changed');
        // Re-issue the cookie, because it was signed with the previous password's hash.
        res.setHeader('Set-Cookie', cookieHeader(req, makeSession(sessionEnv(), now()), SESSION_MS / 1000));
        json(res, 200, { ok: true }); return true;
      }
      if (path === '/api/admin/keys' && req.method === 'PUT') {
        const body = await readBody(req, 16_384);
        const provider = typeof body.provider === 'string' ? body.provider : '';
        if (typeof body.key === 'string' && body.key.trim()) await settings.setKey(provider, body.key); else await settings.deleteKey(provider);
        log(`[admin] ${provider} key ${typeof body.key === 'string' && body.key.trim() ? 'set' : 'removed'} from the dashboard`);
        json(res, 200, config()); return true;
      }
      if (path === '/api/admin/tunables' && req.method === 'PUT') {
        const body = await readBody(req, 16_384);
        await settings.setTunable(typeof body.name === 'string' ? body.name : '', body.value);
        json(res, 200, config()); return true;
      }
      if (path === '/api/admin/tiers' && req.method === 'PUT') {
        const body = await readBody(req);
        await settings.setTiers(body);
        json(res, 200, config()); return true;
      }
      if (path === '/api/admin/discover' && req.method === 'POST') {
        const body = await readBody(req, 8_192);
        const models = await discoverForProvider(typeof body.provider === 'string' ? body.provider : '', currentEnv(), fetchImpl);
        json(res, 200, { provider: body.provider, models }); return true;
      }
      throw new HttpError(404, 'Not found.');
    } catch (error) {
      const known = error instanceof HttpError;
      if (!known) log(`[admin] ${error?.message || error}`);
      json(res, known ? error.status : 500, { error: { message: known ? error.message : (error?.message || 'Admin request failed.') } });
      return true;
    }
  };
}
