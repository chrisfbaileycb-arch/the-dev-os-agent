import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Google OAuth 2.0 handler — stateless signed-cookie sessions.
//
// Session cookie format: userId|workspaceId|HMAC-SHA256(userId|workspaceId, SESSION_SECRET)
// No sessions table: the signature is the proof of authenticity.
// The workspaceId embedded in the cookie is the server-canonical workspace tied to the account,
// so proxy.mjs can resolve the workspace from the cookie with no database round-trip.

const COOKIE_NAME = 'hb_session';
const STATE_COOKIE = 'hb_oauth_state';
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';

export function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  const out = {};
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    try { out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim()); } catch {}
  }
  return out;
}

function hmac(data, secret) {
  return createHmac('sha256', secret).update(data).digest('hex');
}

function makeSessionCookie(userId, workspaceId, secret) {
  const payload = `${userId}|${workspaceId}`;
  return `${payload}|${hmac(payload, secret)}`;
}

/** Returns { userId, workspaceId } when the cookie is valid, null otherwise. */
export function parseSession(cookieHeader, secret) {
  if (!secret) return null;
  const raw = parseCookies(cookieHeader)[COOKIE_NAME];
  if (!raw) return null;
  const parts = raw.split('|');
  if (parts.length !== 3) return null;
  const [userId, workspaceId, sig] = parts;
  if (!userId || !workspaceId || !sig) return null;
  const expected = hmac(`${userId}|${workspaceId}`, secret);
  try {
    if (sig.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
  } catch { return null; }
  return { userId, workspaceId };
}

function getOrigin(req, env) {
  if (env.APP_ORIGIN) return env.APP_ORIGIN.replace(/\/+$/, '');
  const host = req.headers['host'] || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${host}`;
}

function setCookies(res, cookies) {
  res.setHeader('Set-Cookie', cookies);
}

/**
 * Create the auth middleware. Returns null when Google OAuth is not configured
 * (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / SESSION_SECRET not set), in which case
 * all auth routes answer 503 and the frontend hides the sign-in button.
 */
export function createAuth({ db, env = process.env }) {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const secret = env.SESSION_SECRET;

  return async function handleAuth(req, res) {
    const url = new URL(req.url, 'http://app');
    const path = url.pathname;

    // Feature-flag check: if Google OAuth is not configured, signal that.
    if (path === '/api/auth/me' && req.method === 'GET') {
      if (!secret) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('null'); return true; }
      const session = parseSession(req.headers['cookie'], secret);
      if (!session) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('null'); return true; }
      const user = db?.getUserById ? await db.getUserById(session.userId).catch(() => null) : null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(user ? { id: user.id, email: user.email, name: user.name, picture: user.picture, workspaceId: user.workspace_id } : null));
      return true;
    }

    if (path === '/api/auth/config' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ googleEnabled: !!(clientId && clientSecret && secret) }));
      return true;
    }

    if (!clientId || !clientSecret || !secret) return false;

    if (path === '/auth/google' && req.method === 'GET') {
      const nonce = randomBytes(16).toString('hex');
      const stateToken = `${nonce}.${hmac(nonce, secret)}`;
      const callbackUrl = `${getOrigin(req, env)}/auth/google/callback`;
      const params = new URLSearchParams({ client_id: clientId, redirect_uri: callbackUrl, response_type: 'code', scope: 'openid email profile', state: stateToken, access_type: 'online' });
      setCookies(res, [`${STATE_COOKIE}=${encodeURIComponent(stateToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`]);
      res.writeHead(302, { Location: `${GOOGLE_AUTH}?${params}` });
      res.end();
      return true;
    }

    if (path === '/auth/google/callback' && req.method === 'GET') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const cookies = parseCookies(req.headers['cookie']);
      const storedState = cookies[STATE_COOKIE];

      const fail = (reason) => { res.writeHead(302, { Location: `/?auth_error=${encodeURIComponent(reason)}` }); res.end(); };

      if (!code || !state || !storedState || state !== storedState) return (fail('state_mismatch'), true);
      const [nonce, sig] = state.split('.');
      if (!nonce || !sig || hmac(nonce, secret) !== sig) return (fail('invalid_state'), true);

      try {
        const callbackUrl = `${getOrigin(req, env)}/auth/google/callback`;
        const tokenRes = await fetch(GOOGLE_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: callbackUrl, grant_type: 'authorization_code' }) });
        const tokens = await tokenRes.json();
        if (!tokens.access_token) throw new Error('No access_token in response');

        const infoRes = await fetch(GOOGLE_USERINFO, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
        const info = await infoRes.json();
        if (!info.sub) throw new Error('No sub in userinfo');

        const user = await db.findOrCreateUser(info.sub, info.email || '', info.name || info.email || '', info.picture || '');
        const sessionValue = makeSessionCookie(user.id, user.workspace_id, secret);

        setCookies(res, [
          `${STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
          `${COOKIE_NAME}=${encodeURIComponent(sessionValue)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000`,
        ]);
        res.writeHead(302, { Location: '/' });
        res.end();
      } catch (e) {
        console.error('OAuth callback error:', e.message);
        fail('oauth_failed');
      }
      return true;
    }

    if (path === '/auth/logout' && ['GET', 'POST'].includes(req.method)) {
      setCookies(res, [`${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`]);
      res.writeHead(302, { Location: '/' });
      res.end();
      return true;
    }

    return false;
  };
}
